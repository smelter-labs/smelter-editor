FROM ghcr.io/software-mansion/smelter:v0.6.0

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG USERNAME=smelter

ENV DEBIAN_FRONTEND=noninteractive
ENV NVIDIA_DRIVER_CAPABILITIES=compute,graphics,utility,video
ENV NODE_VERSION=24.6.0

USER root
WORKDIR /tmp

RUN apt-get update -y -qq && \
  apt-get install -y \
  sudo build-essential curl pipx python3-pip python3-venv git pkg-config \
  libegl1-mesa-dev libgl1-mesa-dri libxcb-xfixes0-dev mesa-vulkan-drivers \
  nasm yasm libx264-dev libx265-dev libfdk-aac-dev libmp3lame-dev \
  libopus-dev libvpx-dev libass-dev libfreetype-dev && \
  rm -rf /var/lib/apt/lists/*

# Build ffmpeg with NVDEC (h264_cuvid) support
RUN git clone --depth 1 --branch n12.2.72.0 https://git.videolan.org/git/ffmpeg/nv-codec-headers.git /tmp/nv-codec-headers && \
  cd /tmp/nv-codec-headers && make install && rm -rf /tmp/nv-codec-headers

RUN curl -fsSL https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz | tar xJ -C /tmp && \
  cd /tmp/ffmpeg-7.1.1 && \
  ./configure \
  --enable-gpl --enable-nonfree \
  --enable-cuda --enable-cuvid --enable-nvdec --enable-nvenc \
  --enable-libx264 --enable-libx265 --enable-libfdk-aac \
  --enable-libmp3lame --enable-libopus --enable-libvpx \
  --enable-libass --enable-libfreetype \
  --disable-doc --disable-debug --enable-small && \
  make -j"$(nproc)" && make install && \
  rm -rf /tmp/ffmpeg-7.1.1

RUN ARCH= && dpkgArch="$(dpkg --print-architecture)" \
  && case "${dpkgArch##*-}" in \
  amd64) ARCH='x64';; \
  ppc64el) ARCH='ppc64le';; \
  s390x) ARCH='s390x';; \
  arm64) ARCH='arm64';; \
  armhf) ARCH='armv7l';; \
  i386) ARCH='x86';; \
  *) echo "unsupported architecture"; exit 1 ;; \
  esac \
  && curl -fsSLO --compressed "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz" \
  && tar -xJf "node-v$NODE_VERSION-linux-$ARCH.tar.xz" -C /usr/local --strip-components=1 --no-same-owner \
  && ln -s /usr/local/bin/node /usr/local/bin/nodejs \
  && node --version \
  && npm --version \
  && rm -rf /tmp/*

## Build
USER $USERNAME
ENV SMELTER_PATH=/home/smelter/smelter/main_process

RUN sudo npm install -g pnpm@10

RUN pipx install streamlink
RUN pip3 install --break-system-packages opencv-python-headless numpy
ENV PATH=/home/smelter/.local/bin:$PATH

ARG CACHE_BUST=1
COPY --chown=$USERNAME:$USERNAME  . /home/$USERNAME/demo
WORKDIR /home/$USERNAME/demo/server
RUN mkdir -p /home/$USERNAME/demo/server/data/recordings /home/$USERNAME/demo/server/data/configs /home/$USERNAME/demo/server/data/mp4s /home/$USERNAME/demo/server/data/pictures /home/$USERNAME/demo/server/data/audios /home/$USERNAME/demo/server/data/screenshots /home/$USERNAME/demo/server/data/thumbnails /home/$USERNAME/demo/server/data/shader-presets /home/$USERNAME/demo/server/data/dashboard-layouts /home/$USERNAME/demo/server/data/presentation-configs /home/$USERNAME/demo/server/data/hls-streams
RUN CI=1 pnpm install --filter smelter-app... && pnpm --filter @smelter-editor/types build && pnpm build

# Captions sidecar (Whisper) — CPU PyTorch venv baked into the image.
RUN python3 -m venv /home/smelter/demo/server/captions/.venv && \
  /home/smelter/demo/server/captions/.venv/bin/pip install --upgrade pip && \
  /home/smelter/demo/server/captions/.venv/bin/pip install --quiet \
    -r /home/smelter/demo/server/captions/requirements-cpu.txt && \
  /home/smelter/demo/server/captions/.venv/bin/python3 -c \
    "import torch; import torchaudio; import silero_vad; import faster_whisper; import smelter"

# AI-model sidecar venvs, baked for the same reason as captions above.
#
# Without this every container start pays for them at RUNTIME: BaseSidecar
# starts all sidecars when the first room is created, and the shared venv is
# installed under a per-venvDir queue, so the pip runs are serialized and the
# last model in the chain waits out all of them. Meanwhile pip saturates the
# CPU the render pipeline needs, which shows up as `Dropping video frame on
# queue output` for minutes after boot.
#
# Paths are `dist/ai-models/*` — that is where the manifests resolve venvDir
# from (__dirname of the COMPILED js), and `pnpm build` above has already put
# the requirements files there via copy-ai-assets.sh.
ARG AI_MODELS_DIR=/home/smelter/demo/server/dist/ai-models

# Shared venv: people-counter (4 backends), car-ads, car-hue and
# kettlebell-coach all point venvDir here. kettlebell-coach's requirements are
# a superset of people-counter's, so installing THAT file satisfies every one
# of them in a single pass — and its depsCheck (the strictest: it also demands
# clip/ftfy and ultralytics >= 8.3) is what verifies the result.
RUN python3 -m venv "$AI_MODELS_DIR/people-counter/.venv" && \
  "$AI_MODELS_DIR/people-counter/.venv/bin/pip" install --upgrade pip && \
  "$AI_MODELS_DIR/people-counter/.venv/bin/pip" install --quiet --no-cache-dir \
    -r "$AI_MODELS_DIR/kettlebell-coach/requirements.txt" && \
  "$AI_MODELS_DIR/people-counter/.venv/bin/python3" -c \
    "import cv2; import numpy; import websockets; import smelter; import clip; import ftfy; import ultralytics; assert tuple(map(int, ultralytics.__version__.split('.')[:2])) >= (8, 3)"

# Own venvs: motion is tiny, building-detector pulls its own torch +
# transformers (SegFormer) and is the other heavy runtime install.
RUN python3 -m venv "$AI_MODELS_DIR/motion/.venv" && \
  "$AI_MODELS_DIR/motion/.venv/bin/pip" install --upgrade pip && \
  "$AI_MODELS_DIR/motion/.venv/bin/pip" install --quiet --no-cache-dir \
    -r "$AI_MODELS_DIR/motion/requirements.txt" && \
  "$AI_MODELS_DIR/motion/.venv/bin/python3" -c \
    "import cv2; import numpy; import websockets; import smelter"

RUN python3 -m venv "$AI_MODELS_DIR/building-detector/.venv" && \
  "$AI_MODELS_DIR/building-detector/.venv/bin/pip" install --upgrade pip && \
  "$AI_MODELS_DIR/building-detector/.venv/bin/pip" install --quiet --no-cache-dir \
    -r "$AI_MODELS_DIR/building-detector/requirements.txt" && \
  "$AI_MODELS_DIR/building-detector/.venv/bin/python3" -c \
    "import cv2; import numpy; import websockets; import smelter; import torch; import transformers"

# Ultralytics fetches weights on the FIRST predict, into the worker's cwd
# (= the model's dist dir, which is what BaseSidecar spawns python with). Left
# to runtime that is a second cold-start stall right after the venv one, on the
# same starved CPU. Pull the defaults now; a non-default pick from the UI still
# downloads on demand. YOLOWorld.set_classes() additionally pulls the CLIP
# text encoder into ~/.cache/clip, so warm that here too.
RUN cd "$AI_MODELS_DIR/kettlebell-coach" && \
  "$AI_MODELS_DIR/people-counter/.venv/bin/python3" -c \
    "from ultralytics import YOLO, YOLOWorld; YOLO('yolo11n-pose.pt'); YOLOWorld('yolov8s-worldv2.pt').set_classes(['kettlebell'])" && \
  cd "$AI_MODELS_DIR/people-counter" && \
  "$AI_MODELS_DIR/people-counter/.venv/bin/python3" -c \
    "from ultralytics import YOLO; YOLO('yolov8n.pt'); YOLO('yolov8s.pt')"

ENTRYPOINT ["/home/smelter/demo/entrypoint.sh"]
