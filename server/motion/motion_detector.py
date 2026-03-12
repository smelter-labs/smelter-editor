#!/usr/bin/env python3
"""
Motion detector: receives RTP video via ffmpeg, computes frame-differencing
motion scores, and outputs JSON lines to stdout.

Supports a --regions flag to split the frame into equal horizontal regions
and report per-region scores (for tiled multi-input grids).
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import tempfile
import time

import cv2
import numpy as np


def has_nvdec() -> bool:
    """Check if ffmpeg has the h264_cuvid decoder (NVDEC hardware decoding)."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-decoders"],
            capture_output=True, text=True, timeout=5,
        )
        return "h264_cuvid" in result.stdout
    except Exception:
        return False


def create_sdp(port: int) -> str:
    """Generate an SDP file telling ffmpeg to expect H.264 RTP on the given port."""
    return (
        "v=0\n"
        "o=- 0 0 IN IP4 127.0.0.1\n"
        "s=MotionDetect\n"
        "c=IN IP4 127.0.0.1\n"
        "t=0 0\n"
        f"m=video {port} RTP/AVP 96\n"
        "a=rtpmap:96 H264/90000\n"
    )


def main():
    parser = argparse.ArgumentParser(description="RTP motion detector")
    parser.add_argument("--port", type=int, required=True, help="UDP port for RTP input")
    parser.add_argument("--width", type=int, default=160, help="Frame width (default: 160)")
    parser.add_argument("--height", type=int, default=90, help="Frame height (default: 90)")
    parser.add_argument("--interval", type=float, default=0.15, help="Min seconds between outputs (default: 0.15)")
    parser.add_argument("--regions", type=int, default=1, help="Number of horizontal regions to score independently")
    args = parser.parse_args()

    frame_size = args.width * args.height * 3
    region_width = args.width // max(args.regions, 1)

    # Write a temporary SDP file so ffmpeg knows to expect H.264 RTP
    sdp_fd, sdp_path = tempfile.mkstemp(suffix=".sdp", prefix="motion_")
    try:
        with os.fdopen(sdp_fd, "w") as f:
            f.write(create_sdp(args.port))

        use_hwaccel = has_nvdec()

        ffmpeg_cmd = ["ffmpeg"]
        if use_hwaccel:
            ffmpeg_cmd += ["-hwaccel", "cuda", "-c:v", "h264_cuvid"]
        ffmpeg_cmd += [
            "-probesize", "5000000",
            "-analyzeduration", "5000000",
            "-fflags", "+genpts+discardcorrupt",
            "-protocol_whitelist", "file,udp,rtp",
            "-reorder_queue_size", "0",
            "-i", sdp_path,
        ]
        ffmpeg_cmd += [
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{args.width}x{args.height}",
            "-an",
            "pipe:1",
        ]

        hwaccel_label = "NVDEC (cuda)" if use_hwaccel else "software"
        print(f"[motion_detector] Starting ffmpeg on port {args.port} ({args.width}x{args.height}, {args.regions} regions, decode: {hwaccel_label})", file=sys.stderr, flush=True)
        print(f"[motion_detector] SDP content:\n{create_sdp(args.port)}", file=sys.stderr, flush=True)
        print(f"[motion_detector] cmd: {' '.join(ffmpeg_cmd)}", file=sys.stderr, flush=True)

        proc = subprocess.Popen(
            ffmpeg_cmd,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
        )

        def handle_signal(_sig, _frame):
            proc.kill()
            proc.wait()
            sys.exit(0)

        signal.signal(signal.SIGTERM, handle_signal)
        signal.signal(signal.SIGINT, handle_signal)

        # Signal to the parent process that ffmpeg has been spawned
        sys.stdout.write(json.dumps({"ready": True}) + "\n")
        sys.stdout.flush()

        # Per-region baselines
        baselines = [None] * args.regions
        last_output_time = 0.0

        try:
            while True:
                raw = proc.stdout.read(frame_size)
                if len(raw) != frame_size:
                    break

                now = time.time()
                if (now - last_output_time) < args.interval:
                    continue

                frame = np.frombuffer(raw, dtype=np.uint8).reshape((args.height, args.width, 3))
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                scores = {}
                for i in range(args.regions):
                    x_start = i * region_width
                    x_end = x_start + region_width
                    region_gray = gray[:, x_start:x_end]

                    if baselines[i] is None:
                        baselines[i] = region_gray
                        continue

                    diff = cv2.absdiff(baselines[i], region_gray)
                    raw_score = diff.mean() / 255.0
                    score = round(min(float(raw_score ** 0.5) * 1.5, 1.0), 4)
                    scores[str(i)] = score
                    baselines[i] = region_gray

                if scores:
                    line = json.dumps({"scores": scores, "ts": now})
                    sys.stdout.write(line + "\n")
                    sys.stdout.flush()
                    last_output_time = now

        except (BrokenPipeError, IOError):
            pass
        finally:
            proc.kill()
            proc.wait()
    finally:
        try:
            os.unlink(sdp_path)
        except OSError:
            pass


if __name__ == "__main__":
    main()
