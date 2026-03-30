FROM ghcr.io/software-mansion/smelter:v0.5.0

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG USERNAME=smelter

ENV DEBIAN_FRONTEND=noninteractive
ENV NVIDIA_DRIVER_CAPABILITIES=compute,graphics,utility,video
ENV NODE_VERSION=24.6.0

USER root
WORKDIR /tmp

RUN apt-get update -y -qq && \
  apt-get install -y \
    sudo build-essential curl pipx python3-pip git pkg-config \
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
  && npm install -i pnpm \
  && rm -rf /tmp/*

## Build
USER $USERNAME
ENV SMELTER_PATH=/home/smelter/smelter/main_process

RUN sudo npm install -g pnpm

RUN pipx install streamlink
RUN pip3 install --break-system-packages opencv-python-headless numpy
ENV PATH=/home/smelter/.local/bin:$PATH

ARG CACHE_BUST=1
COPY --chown=$USERNAME:$USERNAME  . /home/$USERNAME/demo
WORKDIR /home/$USERNAME/demo/server
RUN mkdir -p /home/$USERNAME/demo/server/recordings /home/$USERNAME/demo/server/configs /home/$USERNAME/demo/server/mp4s /home/$USERNAME/demo/server/pictures
RUN CI=1 pnpm install && pnpm --filter @smelter-editor/types build && pnpm build

ENTRYPOINT ["/home/smelter/demo/entrypoint.sh"]
