#!/usr/bin/env python3
"""Fine-tune a YOLO11 ball detector (single class) on the dataset written by
scripts/bb-ball/build_dataset.py, on the Mac (MPS) or CUDA.

  V=src/ai-models/people-counter/.venv/bin/python
  $V scripts/bb-ball/train.py --data data/bb-train/apidis/data.yaml --model yolo11n.pt --name bb-ball-n --smoke
  $V scripts/bb-ball/train.py --data data/bb-train/apidis/data.yaml --model yolo11n.pt --name bb-ball-n --epochs 30 --install

Base weights are taken from the scorer dir (already present there; nothing is
downloaded). --install copies runs/<name>/weights/best.pt to
src/ai-models/basketball-scorer/bb-ball.pt, the name the worker accepts as
`yoloWeights` (gitignored — ship it out of band).
"""

from __future__ import annotations

import argparse
import csv
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.abspath(os.path.join(HERE, "..", ".."))
SCORER = os.path.join(SERVER, "src", "ai-models", "basketball-scorer")
INSTALL_NAME = "bb-ball.pt"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", default=os.path.join(SERVER, "data", "bb-train", "apidis", "data.yaml"))
    p.add_argument("--model", default="yolo11n.pt", help="base weights: a name in the scorer dir or a path")
    p.add_argument("--name", default="bb-ball-n")
    p.add_argument("--project", default=os.path.join(SERVER, "data", "bb-train", "runs"))
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--device", default=None, help="mps | cuda:0 | cpu (default: auto)")
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--patience", type=int, default=10)
    p.add_argument("--freeze", type=int, default=0, help="freeze the first N layers (0 = train everything)")
    p.add_argument("--lr0", type=float, default=0.01)
    p.add_argument("--no-plots", action="store_true", help="skip result plots (needs a font download on first use)")
    p.add_argument("--smoke", action="store_true", help="1 epoch on 5%% of the data to validate the loop")
    p.add_argument("--install", action="store_true", help=f"copy best.pt to the scorer dir as {INSTALL_NAME}")
    return p.parse_args()


def pick_device(explicit: str | None) -> str:
    if explicit:
        return explicit
    import torch

    if torch.cuda.is_available():
        return "cuda:0"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main() -> int:
    a = parse_args()
    from ultralytics import YOLO

    base = a.model if os.path.exists(a.model) else os.path.join(SCORER, a.model)
    if not os.path.exists(base):
        print(f"base weights not found: {base}", file=sys.stderr)
        return 2
    device = pick_device(a.device)
    epochs = 1 if a.smoke else a.epochs
    print(f"train {a.name}: base={base} data={a.data} device={device} epochs={epochs} imgsz={a.imgsz} batch={a.batch}")
    model = YOLO(base)
    model.train(
        data=a.data,
        epochs=epochs,
        imgsz=a.imgsz,
        batch=a.batch,
        device=device,
        workers=a.workers,
        amp=False,  # MPS: keep fp32
        cache=False,
        single_cls=True,
        mosaic=1.0,
        scale=0.4,
        fliplr=0.5,
        degrees=0.0,
        hsv_v=0.4,
        close_mosaic=5 if not a.smoke else 0,
        patience=a.patience,
        freeze=a.freeze or None,
        lr0=a.lr0,
        fraction=0.05 if a.smoke else 1.0,
        project=a.project,
        name=a.name,
        exist_ok=True,
        seed=0,
        plots=not a.no_plots,
        verbose=True,
    )
    run_dir = os.path.join(a.project, a.name)
    best = os.path.join(run_dir, "weights", "best.pt")
    results = os.path.join(run_dir, "results.csv")
    if os.path.exists(results):
        with open(results, newline="", encoding="utf8") as f:
            rows = list(csv.DictReader(f))
        if rows:
            last = {k.strip(): v for k, v in rows[-1].items()}
            top = max(rows, key=lambda r: float({k.strip(): v for k, v in r.items()}.get("metrics/mAP50(B)", 0) or 0))
            top = {k.strip(): v for k, v in top.items()}
            print(
                f"val (last epoch {last.get('epoch')}): P={float(last.get('metrics/precision(B)', 0)):.3f} "
                f"R={float(last.get('metrics/recall(B)', 0)):.3f} mAP50={float(last.get('metrics/mAP50(B)', 0)):.3f}; "
                f"best mAP50={float(top.get('metrics/mAP50(B)', 0)):.3f} at epoch {top.get('epoch')}"
            )
    if a.install:
        if not os.path.exists(best):
            print(f"no best.pt at {best}", file=sys.stderr)
            return 1
        dst = os.path.join(SCORER, INSTALL_NAME)
        shutil.copyfile(best, dst)
        print(f"installed {dst} ({os.path.getsize(dst) // 1024} KiB) — select yoloWeights = {INSTALL_NAME}")
    print(f"run dir: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
