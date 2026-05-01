FROM node:22-bookworm-slim

# System deps:
#  - ffmpeg: the ENTIRE render pipeline (clip prep + Ken Burns + concat + ASS subtitle burn + audio mux)
#  - python3 + pip: yt-dlp install target
#  - dumb-init: clean PID 1 signal handling
#  - fonts-liberation + fonts-dejavu: ASS subtitle font (Liberation Sans Bold)
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash git ca-certificates curl wget gnupg dumb-init unzip \
      ffmpeg \
      python3 python3-pip \
      fonts-dejavu fonts-liberation fontconfig \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y \
 && fc-cache -f \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 && useradd -ms /bin/bash agent

ENV NODE_ENV=production

WORKDIR /app

RUN npm install -g tsx

COPY --chown=agent:agent package*.json tsconfig.json ./
RUN npm ci --omit=dev && chown -R agent:agent /app

COPY --chown=agent:agent src ./src
COPY --chown=agent:agent analyses ./analyses

# /app/data is the Fly volume mount point — must be writable by `agent`.
RUN mkdir -p /app/data && chown agent:agent /app/data
USER agent

ENTRYPOINT ["dumb-init", "--"]
CMD ["tsx", "src/index.ts"]
