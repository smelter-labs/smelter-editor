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
    parser.add_argument("--interval", type=float, default=0.5, help="Min seconds between outputs (default: 0.5)")
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

        proc = subprocess.Popen(
            ffmpeg_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )

        def handle_signal(_sig, _frame):
            proc.kill()
            proc.wait()
            sys.exit(0)

        signal.signal(signal.SIGTERM, handle_signal)
        signal.signal(signal.SIGINT, handle_signal)

        prev_gray = None
        last_output_time = 0.0

        try:
            while True:
                raw = proc.stdout.read(frame_size)
                if len(raw) != frame_size:
                    break

                now = time.time()
                frame = np.frombuffer(raw, dtype=np.uint8).reshape((args.height, args.width, 3))
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                if prev_gray is not None and (now - last_output_time) >= args.interval:
                    diff = cv2.absdiff(prev_gray, gray)
                    score = round(float(diff.mean() / 255.0), 4)
                    line = json.dumps({"score": score, "ts": now})
                    sys.stdout.write(line + "\n")
                    sys.stdout.flush()
                    last_output_time = now

                prev_gray = gray
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
