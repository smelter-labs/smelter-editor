"""APIDIS dataset access for the ball-detector scripts: labels + source frames.

Dataset: APIDIS (UCLouvain, 2008) — non-commercial research use only, please
credit the APIDIS project (http://www.apidis.org/Dataset).

Layout under the archive root:
  h264/CAMERA{N}/20080409/camera{N}_20080409T{HHMMSS}Z.avi (+ .avi.idx)
      one file per minute, 1600x1200, ~22 fps real. The file name is LOCAL
      time (+02) despite the trailing Z; the true UTC of every frame is in
      the .idx sidecar (12-byte header, then 24-byte LE records:
      u32 sec, u32 usec, u64 offset, u32 frameNo, u32 reserved).
  all/ball/GroundTruth_Ball_184700_3min/camera{N}_…ballposition.txt
      manual ball CENTRES (px, float) for 3 minutes from 18:47 local, one
      row per source frame in which the ball is visible: `HHMMSS.FFF x y`.
  camera{N}/camera{N}_20080409T184700+02.objects.xml
      boxes (ball / player team-A|B / referee / basket) for the first of
      those minutes; `<time>` is UTC epoch with thousands separators.

Media time of the converted q2 clips (scripts/apidis-prep.mjs) is
`utc − T0_UTC`, so the labelled window is media 60–240 s.
"""

from __future__ import annotations

import bisect
import json
import os
import struct
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterator

DAY = "20080409"
DAY0_UTC = 1207699200  # 2008-04-09T00:00:00Z
LOCAL_OFFSET_S = 2 * 3600
T0_UTC = 1207759560  # 16:46:00Z — frame 0 of data/mp4s/apidis/q2/cam*.mp4
LABEL_MINUTES = ("184700", "184800", "184900")  # local HHMMSS of the labelled 3 min
FRAME_W, FRAME_H = 1600, 1200


def local_to_utc(hhmmss: str) -> float:
    """`HHMMSS.FFF` local (+02) on the match day → UTC epoch seconds."""
    hh = int(hhmmss[0:2])
    mm = int(hhmmss[2:4])
    ss = float(hhmmss[4:])
    return DAY0_UTC + hh * 3600 + mm * 60 + ss - LOCAL_OFFSET_S


def media_s(utc: float) -> float:
    return utc - T0_UTC


def read_idx(path: str) -> list[float]:
    """UTC seconds of every frame of an AVI, from its .idx sidecar."""
    with open(path, "rb") as f:
        buf = f.read()
    n = (len(buf) - 12) // 24
    out = []
    for i in range(n):
        sec, usec = struct.unpack_from("<II", buf, 12 + 24 * i)
        out.append(sec + usec / 1e6)
    return out


def avi_path(archive: str, cam: int, minute: str) -> str:
    return os.path.join(archive, "h264", f"CAMERA{cam}", DAY, f"camera{cam}_{DAY}T{minute}Z.avi")


@dataclass(frozen=True)
class FrameRef:
    minute: str
    index: int  # frame index inside the minute file
    utc: float


def frame_refs(archive: str, cam: int, minutes=LABEL_MINUTES) -> list[FrameRef]:
    """Every source frame of `minutes`, in playback order, with its UTC."""
    refs: list[FrameRef] = []
    for minute in minutes:
        for i, t in enumerate(read_idx(avi_path(archive, cam, minute) + ".idx")):
            refs.append(FrameRef(minute, i, t))
    return refs


def load_centres(archive: str, cam: int) -> list[tuple[float, float, float]]:
    """(utc, x, y) ball centres of the 3-minute ground truth, sorted by time."""
    path = os.path.join(
        archive,
        "all",
        "ball",
        "GroundTruth_Ball_184700_3min",
        f"camera{cam}_{DAY}T184700+02.3min.ballposition.txt",
    )
    out = []
    with open(path, encoding="utf8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 3:
                continue
            out.append((local_to_utc(parts[0]), float(parts[1]), float(parts[2])))
    out.sort()
    return out


def parse_xml_time(s: str) -> float:
    """`1,207,759,620.046000s` → 1207759620.046"""
    return float(s.strip().replace(",", "").rstrip("s"))


@dataclass
class Objects:
    size: tuple[int, int]
    basket: dict | None
    ball_size: tuple[int, int]
    times: list[float] = field(default_factory=list)  # sorted frame times
    # utc → {"ball": [box…], "player": [box…], "referee": [box…]}; box = {x,y,w,h[,team]}
    frames: dict[float, dict[str, list[dict]]] = field(default_factory=dict)


def load_objects(archive: str, cam: int) -> Objects:
    path = os.path.join(archive, f"camera{cam}", f"camera{cam}_{DAY}T184700+02.objects.xml")
    root = ET.parse(path).getroot()
    w = int(root.findtext("./tracks/framesize/width") or FRAME_W)
    h = int(root.findtext("./tracks/framesize/height") or FRAME_H)
    frames: dict[float, dict[str, list[dict]]] = {}
    sizes: Counter = Counter()
    basket = None
    for frame in root.iter("frame"):
        t = parse_xml_time(frame.findtext("time") or "0")
        per: dict[str, list[dict]] = {}
        for track in frame.findall("track"):
            kind = track.get("type", "")
            pos = track.find("position")
            if pos is None:
                continue
            box = {
                "x": int(pos.findtext("x") or 0),
                "y": int(pos.findtext("y") or 0),
                "w": int(pos.findtext("w") or 0),
                "h": int(pos.findtext("h") or 0),
            }
            team = track.get("player-team")
            if team:
                box["team"] = team
            if kind == "basket":
                basket = basket or box
                continue
            per.setdefault(kind, []).append(box)
            if kind == "ball":
                sizes[(box["w"], box["h"])] += 1
        frames[t] = per
    ball_size = sizes.most_common(1)[0][0] if sizes else (32, 32)
    return Objects((w, h), basket, ball_size, sorted(frames), frames)


def nearest_time(times: list[float], t: float, tol_s: float) -> float | None:
    """The element of the sorted `times` closest to `t` within `tol_s`."""
    i = bisect.bisect_left(times, t)
    best = None
    for j in (i - 1, i):
        if 0 <= j < len(times) and abs(times[j] - t) <= tol_s:
            if best is None or abs(times[j] - t) < abs(best - t):
                best = times[j]
    return best


def match_labels(
    times: list[float], centres: list[tuple[float, float, float]], tol_s: float = 0.025
) -> tuple[dict[int, tuple[float, float]], int]:
    """Map ball centres onto frame indices (nearest frame within `tol_s`).
    Returns (index → (x, y), unmatched count)."""
    out: dict[int, tuple[float, float]] = {}
    best_dt: dict[int, float] = {}
    unmatched = 0
    for t, x, y in centres:
        i = bisect.bisect_left(times, t)
        cand = [(abs(times[j] - t), j) for j in (i - 1, i) if 0 <= j < len(times)]
        cand = [c for c in cand if c[0] <= tol_s]
        if not cand:
            unmatched += 1
            continue
        dt, j = min(cand)
        if j not in out or dt < best_dt[j]:
            out[j] = (x, y)
            best_dt[j] = dt
    return out, unmatched


def inside(box: dict, x: float, y: float, margin: float = 0.0) -> bool:
    return (
        box["x"] - margin <= x <= box["x"] + box["w"] + margin
        and box["y"] - margin <= y <= box["y"] + box["h"] + margin
    )


def iter_frames(archive: str, cam: int, minutes=LABEL_MINUTES) -> Iterator[tuple[int, float, "object"]]:
    """(global index, utc, BGR frame) for every frame of `minutes`, decoded
    sequentially (no seeking) and joined with the .idx by position."""
    import cv2  # local import: keep the label helpers importable without it

    g = 0
    for minute in minutes:
        path = avi_path(archive, cam, minute)
        times = read_idx(path + ".idx")
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            raise RuntimeError(f"cannot open {path}")
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if i >= len(times):
                break  # more decoded frames than index records: stop at the index
            yield g, times[i], frame
            i += 1
            g += 1
        cap.release()
        if i < len(times):
            # fewer decoded frames than records — keep the global index aligned
            # with frame_refs() by skipping the missing tail
            g += len(times) - i


def load_sidecar(data_dir: str, cam: int, quarter: str = "q2") -> dict:
    """`cam{N}.apidis.json` written by scripts/apidis-prep.mjs (rim, t0Utc)."""
    with open(os.path.join(data_dir, "mp4s", "apidis", quarter, f"cam{cam}.apidis.json"), encoding="utf8") as f:
        return json.load(f)
