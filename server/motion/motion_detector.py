#!/usr/bin/env python3
"""
Motion detector: receives RTP video via ffmpeg, computes frame-differencing
motion scores, and outputs JSON lines to stdout.
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
    args = parser.parse_args()

    frame_size = args.width * args.height * 3

    # Write a temporary SDP file so ffmpeg knows to expect H.264 RTP
    sdp_fd, sdp_path = tempfile.mkstemp(suffix=".sdp", prefix="motion_")
    try:
        with os.fdopen(sdp_fd, "w") as f:
            f.write(create_sdp(args.port))

        ffmpeg_cmd = [
            "ffmpeg",
            "-protocol_whitelist", "file,udp,rtp",
            "-i", sdp_path,
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{args.width}x{args.height}",
            "-an",
            "pipe:1",
        ]

        print(f"[motion_detector] Starting ffmpeg on port {args.port}", file=sys.stderr, flush=True)
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

        baseline_gray = None
        last_output_time = 0.0

        try:
            while True:
                raw = proc.stdout.read(frame_size)
                if len(raw) != frame_size:
                    break

                now = time.time()
                frame = np.frombuffer(raw, dtype=np.uint8).reshape((args.height, args.width, 3))
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                if baseline_gray is None:
                    baseline_gray = gray
                    last_output_time = now
                    continue

                if (now - last_output_time) >= args.interval:
                    diff = cv2.absdiff(baseline_gray, gray)
                    raw_score = diff.mean() / 255.0
                    # power curve: gently amplify small motion, cap at 1.0
                    score = round(min(float(raw_score ** 0.5) * 1.5, 1.0), 4)
                    line = json.dumps({"score": score, "ts": now})
                    sys.stdout.write(line + "\n")
                    sys.stdout.flush()
                    baseline_gray = gray
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
