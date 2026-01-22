FROM ghcr.io/software-mansion/smelter:v0.5.0

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG USERNAME=smelter

ENV DEBIAN_FRONTEND=noninteractive
ENV NVIDIA_DRIVER_CAPABILITIES=compute,graphics,utility
ENV NODE_VERSION=24.6.0

USER root
WORKDIR /tmp

RUN apt-get update -y -qq && \
  apt-get install -y \
    sudo build-essential curl ffmpeg pipx \
    libegl1-mesa-dev libgl1-mesa-dri libxcb-xfixes0-dev mesa-vulkan-drivers && \
  rm -rf /var/lib/apt/lists/*

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
ENV PATH=/home/smelter/.local/bin:$PATH

COPY --chown=$USERNAME:$USERNAME  . /home/$USERNAME/demo
WORKDIR /home/$USERNAME/demo/server
RUN CI=1 pnpm install && pnpm build

ENTRYPOINT ["node", "./dist/index.js"]
