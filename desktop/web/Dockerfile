# JobRadar Desk online. Build context: desktop/ (Railway root directory).
FROM node:22-bookworm-slim

# Chromium prints CVs to PDF; Carlito matches Calibri's metrics so the layout holds.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-crosextra-carlito fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci && npm install --no-save puppeteer-core@24

COPY . .
RUN npx electron-vite build && node web/build.mjs

ENV NODE_ENV=production DESK_DATA_DIR=/data CHROME_PATH=/usr/bin/chromium TZ=Asia/Kolkata
EXPOSE 8080
CMD ["node", "--enable-source-maps", "web/dist/server.mjs"]
