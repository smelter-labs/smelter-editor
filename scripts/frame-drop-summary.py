#!/usr/bin/env python3
"""Filter Smelter frame-drop spam and print periodic summaries instead.

Drop lines are swallowed; everything else passes through unchanged.

Usage:
  docker compose logs -f server 2>&1 | python3 scripts/frame-drop-summary.py
  docker compose logs -f server 2>&1 | python3 scripts/frame-drop-summary.py --interval 15 --fps 30
"""

from __future__ import annotations

import argparse
import re
import sys
import threading
import time
from datetime import datetime, timezone

DROP_RE = re.compile(
    r"Dropping video frame on queue output\.\s*pts=([\d.]+)s"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Suppress frame-drop log spam and print summaries every N seconds.",
    )
    parser.add_argument(
        "-i",
        "--interval",
        type=float,
        default=15.0,
        help="Summary interval in seconds (default: 15)",
    )
    parser.add_argument(
        "--fps",
        type=float,
        default=30.0,
        help="Expected output FPS used to estimate total frames (default: 30)",
    )
    parser.add_argument(
        "--show-drops",
        action="store_true",
        help="Also print individual drop lines (default: suppress them)",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Hide all non-drop logs; print only periodic summaries",
    )
    return parser.parse_args()


def format_summary(
    *,
    label: str,
    drops: int,
    expected: int,
) -> str:
    pct = (drops / expected * 100.0) if expected else 0.0
    return f"{label}: {drops} drop / {expected} (~{pct:.1f}%)"


def main() -> int:
    args = parse_args()
    if args.interval <= 0:
        print("error: --interval must be > 0", file=sys.stderr)
        return 2
    if args.fps <= 0:
        print("error: --fps must be > 0", file=sys.stderr)
        return 2

    lock = threading.Lock()
    stop_event = threading.Event()
    started_at = time.monotonic()
    window_started_at = started_at
    window_drops = 0
    total_drops = 0

    def emit_summary(*, final: bool = False) -> None:
        nonlocal window_drops, window_started_at, total_drops

        now = time.monotonic()
        with lock:
            window_elapsed = now - window_started_at
            total_elapsed = now - started_at
            window_expected = max(1, round(window_elapsed * args.fps))
            total_expected = max(1, round(total_elapsed * args.fps))
            ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
            window_label = (
                f"ostatnie {window_elapsed:.0f}s"
                if final
                else f"ostatnie {args.interval:.0f}s"
            )
            line = " | ".join(
                [
                    format_summary(
                        label=window_label,
                        drops=window_drops,
                        expected=window_expected,
                    ),
                    format_summary(
                        label="suma",
                        drops=total_drops,
                        expected=total_expected,
                    ),
                ]
            )
            print(f"[frame-drops] [{ts}] {line}", flush=True)
            window_drops = 0
            window_started_at = now

    def reporter() -> None:
        while not stop_event.wait(args.interval):
            emit_summary()

    reporter_thread = threading.Thread(target=reporter, daemon=True)
    reporter_thread.start()

    for raw_line in sys.stdin:
        line = raw_line.rstrip("\n")
        if DROP_RE.search(line):
            with lock:
                window_drops += 1
                total_drops += 1
            if args.show_drops:
                print(raw_line, end="", flush=True)
            continue

        if not args.summary_only:
            print(raw_line, end="", flush=True)

    stop_event.set()
    reporter_thread.join(timeout=0.1)
    emit_summary(final=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
