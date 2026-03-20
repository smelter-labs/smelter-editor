#!/usr/bin/env python3
"""
Motion detector: receives RTP video via ffmpeg, computes frame-differencing
motion scores, and outputs JSON lines to stdout.

Supports a --regions flag to split the frame into equal horizontal regions
and report per-region scores (for tiled multi-input grids).

Supports optional MediaPipe Hands detection on designated regions via
--hand-regions flag and dynamic stdin IPC commands.
"""

import argparse
import json
import os
import select
import signal
import subprocess
import sys
import tempfile
import threading
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


mp_hands_module = None
mp_hands_instance = None


def get_hands_detector():
    """Lazy-load MediaPipe Hands on first use."""
    global mp_hands_module, mp_hands_instance
    if mp_hands_instance is not None:
        return mp_hands_instance
    try:
        import mediapipe as mp
        mp_hands_module = mp.solutions.hands
        mp_hands_instance = mp_hands_module.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        print("[motion_detector] MediaPipe Hands loaded", file=sys.stderr, flush=True)
    except ImportError:
        print("[motion_detector] WARNING: mediapipe not installed, hand detection disabled",
              file=sys.stderr, flush=True)
        mp_hands_instance = False
    return mp_hands_instance


def process_hands(region_bgr):
    """Run MediaPipe Hands on a BGR region, return list of hand dicts."""
    detector = get_hands_detector()
    if not detector:
        return []
    rgb = cv2.cvtColor(region_bgr, cv2.COLOR_BGR2RGB)
    results = detector.process(rgb)
    if not results.multi_hand_landmarks:
        return []
    hands = []
    for hand_lm in results.multi_hand_landmarks:
        landmarks = [{"x": round(lm.x, 4), "y": round(lm.y, 4)} for lm in hand_lm.landmark]
        hands.append({"landmarks": landmarks})
    return hands


class StdinReader:
    """Non-blocking stdin reader that runs in a background thread."""

    def __init__(self):
        self._commands = []
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def _read_loop(self):
        try:
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    cmd = json.loads(line)
                    with self._lock:
                        self._commands.append(cmd)
                except json.JSONDecodeError:
                    pass
        except Exception:
            pass

    def drain_commands(self):
        with self._lock:
            cmds = self._commands[:]
            self._commands.clear()
        return cmds


def main():
    parser = argparse.ArgumentParser(description="RTP motion detector")
    parser.add_argument("--port", type=int, required=True, help="UDP port for RTP input")
    parser.add_argument("--width", type=int, default=320, help="Frame width (default: 320)")
    parser.add_argument("--height", type=int, default=180, help="Frame height (default: 180)")
    parser.add_argument("--interval", type=float, default=0.15, help="Min seconds between outputs (default: 0.15)")
    parser.add_argument("--regions", type=int, default=1, help="Number of horizontal regions to score independently")
    parser.add_argument("--hand-regions", type=str, default="",
                        help="Comma-separated region indices to run hand detection on (default: none)")
    args = parser.parse_args()

    frame_size = args.width * args.height * 3
    region_width = args.width // max(args.regions, 1)
    region_height = args.height

    hand_regions = set()
    if args.hand_regions:
        for s in args.hand_regions.split(","):
            s = s.strip()
            if s.isdigit():
                hand_regions.add(int(s))

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
        if hand_regions:
            print(f"[motion_detector] Hand tracking enabled for regions: {sorted(hand_regions)}", file=sys.stderr, flush=True)
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

        stdin_reader = StdinReader()

        sys.stdout.write(json.dumps({"ready": True}) + "\n")
        sys.stdout.flush()

        baselines = [None] * args.regions
        last_output_time = 0.0

        try:
            while True:
                raw = proc.stdout.read(frame_size)
                if len(raw) != frame_size:
                    break

                for cmd in stdin_reader.drain_commands():
                    action = cmd.get("cmd")
                    region = cmd.get("region")
                    if action == "enable_hands" and isinstance(region, int):
                        hand_regions.add(region)
                        print(f"[motion_detector] Hand tracking enabled for region {region}",
                              file=sys.stderr, flush=True)
                    elif action == "disable_hands" and isinstance(region, int):
                        hand_regions.discard(region)
                        print(f"[motion_detector] Hand tracking disabled for region {region}",
                              file=sys.stderr, flush=True)

                now = time.time()
                if (now - last_output_time) < args.interval:
                    continue

                frame = np.frombuffer(raw, dtype=np.uint8).reshape((args.height, args.width, 3))
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                scores = {}
                hands_data = {}
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

                    if i in hand_regions:
                        region_bgr = frame[:region_height, x_start:x_end]
                        detected = process_hands(region_bgr)
                        if detected:
                            hands_data[str(i)] = detected

                output = {"scores": scores, "ts": now}
                if hands_data:
                    output["hands"] = hands_data

                if scores or hands_data:
                    line = json.dumps(output)
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
