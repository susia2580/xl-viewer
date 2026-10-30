# Pinned environment for visual regression baselines (docs/01-design.md 12.3).
FROM mcr.microsoft.com/playwright:v1.64.1-noble
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g corepack@latest && corepack enable
WORKDIR /work
COPY . .
RUN pnpm install --frozen-lockfile
ENV CI=1
