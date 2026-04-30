FROM node:22-bookworm-slim

# System deps:
#  - ffmpeg: required by Hyperframes + our renderVideo normalization pass
#  - google-chrome-stable: Hyperframes captures frames via Chrome
#  - python3 + pip: yt-dlp install target
#  - dumb-init: clean PID 1 signal handling
#  - fonts: ensure captions render
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash git ca-certificates curl wget gnupg dumb-init \
      ffmpeg \
      python3 python3-pip \
      fonts-dejavu fonts-liberation \
 && install -d -m 0755 /usr/share/keyrings \
 && wget -qO- https://dl-ssl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /usr/share/keyrings/google-linux-signing.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux-signing.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 && useradd -ms /bin/bash agent

# Pin Chrome so Hyperframes / Puppeteer never tries to download its own copy.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    HYPERFRAMES_BROWSER_PATH=/usr/bin/google-chrome-stable \
    NODE_ENV=production

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
