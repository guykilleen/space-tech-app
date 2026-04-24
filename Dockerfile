FROM node:20-slim

# Install system Chromium — Debian Bookworm (node:20-slim base) provides a
# fully-linked chromium package that handles all shared-library dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends chromium postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Skip puppeteer's bundled Chrome download — we'll use the system binary instead
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY . .

# Install server deps (puppeteer-core, @sparticuz/chromium, express, etc.)
RUN npm install --prefix server

# server's build script: cd ../client && npm install && npm run build
RUN npm run build --prefix server

EXPOSE 5000
CMD ["node", "server/index.js"]
