#!/usr/bin/env bash
#
# setup-macos.sh — raise macOS local-socket buffers so Smelter's side channels
# can deliver video/audio frames to the Python workers.
#
# Why this is needed:
#   AI models (people/bird counter YOLO, motion) and live captions read frames
#   from Smelter over a LOCAL (unix-domain) stream socket.
#
#   Smelter's side-channel server sets its listener non-blocking, and on macOS
#   (BSD) the socket returned by accept() INHERITS that non-blocking flag (unlike
#   Linux). It writes each message with a single write_all(); on a non-blocking
#   socket, if the message doesn't fit in the kernel send buffer the write returns
#   EWOULDBLOCK, write_all fails, and the channel is closed before the client
#   reads anything. So the ENTIRE message must fit in net.local.stream.sendspace.
#
#   macOS defaults sendspace/recvspace to 8192 bytes:
#     - Audio batches are small — they fit, so captions work.
#     - Video frames are RAW RGBA (width*height*4). They don't fit, so the video
#       side channel dies before the first frame. Symptom:
#         subscribe_video_channel ... returned 0 frames — giving up
#         Detector loop ended ... after 0 frames
#
#   So the buffer must hold a whole raw frame. Frame sizes by camera resolution:
#     480p  854x480  = 1.6 MB      720p  1280x720 = 3.7 MB
#     1080p 1920x1080 = 8.3 MB
#
#   macOS also hard-caps kern.ipc.maxsockbuf (often ~8 MB), and a socket buffer
#   can't exceed it. If the cap is below a full 1080p frame, either raise the cap
#   (this script tries) or drop the camera to 720p in the editor.
#
# These sysctls RESET to their small defaults on every reboot, so re-run this
# script after each restart (see the persistence note at the end).
#
# Usage:
#   server/scripts/setup-macos.sh                        # apply the 16 MiB default
#   BUFFER_BYTES=$((12*1024*1024)) server/scripts/setup-macos.sh   # override
#
set -euo pipefail

# Aspirational buffer — big enough for a full raw 1080p RGBA frame plus overhead.
# Clamped below to whatever kern.ipc.maxsockbuf actually allows on this machine.
BUFFER_BYTES="${BUFFER_BYTES:-16777216}"  # 16 MiB
KEYS=(net.local.stream.sendspace net.local.stream.recvspace)

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "setup-macos.sh: not macOS (uname=$(uname -s)) — nothing to do." >&2
  exit 0
fi

# sysctl -w needs root; re-invoke through sudo only when we aren't already root.
SUDO=""
if [[ "$(id -u)" != "0" ]]; then
  SUDO="sudo"
  echo "setup-macos.sh: configuring local-socket buffers (sudo may prompt for your password)…"
fi

# 1. Raise the kern.ipc.maxsockbuf ceiling as far as this kernel allows. macOS
#    caps it and rejects values that are too large ("Result too large"), so probe
#    downward from the target and keep the largest that sticks.
want_ceiling=$(( BUFFER_BYTES * 2 ))
maxsockbuf="$(sysctl -n kern.ipc.maxsockbuf)"
if (( maxsockbuf < want_ceiling )); then
  for cand in "$want_ceiling" 16777216 12582912 10485760; do
    (( cand <= maxsockbuf )) && continue
    $SUDO sysctl -w "kern.ipc.maxsockbuf=$cand" >/dev/null 2>&1 && break || true
  done
  new_max="$(sysctl -n kern.ipc.maxsockbuf)"
  if (( new_max != maxsockbuf )); then
    echo "  kern.ipc.maxsockbuf: $maxsockbuf -> $new_max"
  else
    echo "  kern.ipc.maxsockbuf: stays $maxsockbuf (kernel refused to raise it)"
  fi
  maxsockbuf="$new_max"
fi

# 2. A socket buffer can't exceed the ceiling, and macOS reserves ~11% as mbuf
#    overhead — clamp the buffer to ~90% of the ceiling.
usable=$(( maxsockbuf * 90 / 100 ))
if (( BUFFER_BYTES > usable )); then
  echo "  clamping buffer $BUFFER_BYTES -> $usable (kern.ipc.maxsockbuf ceiling)"
  BUFFER_BYTES=$usable
fi

# 3. Apply send/recv space.
for key in "${KEYS[@]}"; do
  current="$(sysctl -n "$key")"
  if (( current >= BUFFER_BYTES )); then
    echo "  $key already $current (>= $BUFFER_BYTES) — leaving as is."
    continue
  fi
  if $SUDO sysctl -w "$key=$BUFFER_BYTES" >/dev/null 2>&1; then
    echo "  $key: $current -> $(sysctl -n "$key")"
  else
    echo "  $key: FAILED to set to $BUFFER_BYTES" >&2
  fi
done

# 4. Report the largest raw frame the buffer now holds (payload after overhead).
payload_mb=$(( BUFFER_BYTES * 8 / 9 / 1024 / 1024 ))
echo
echo "setup-macos.sh: done. The side-channel buffer now holds raw frames up to ~${payload_mb} MB:"
echo "    480p=1.6MB   720p=3.7MB   1080p=8.3MB   (width*height*4)"
if (( BUFFER_BYTES * 8 / 9 < 8300000 )); then
  echo "  !! A full 1080p frame (8.3 MB) does NOT fit. If AI models still log"
  echo "     '0 frames', drop the camera resolution to 720p in the editor."
fi
echo "  Reconnect the input (or restart the server) so the side channels reconnect."
echo
echo "Note: these values reset on reboot. Re-run this script after each restart,"
echo "or install a LaunchDaemon that runs it at boot to make it permanent."
