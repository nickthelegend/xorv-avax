# Xorv gateway + four provider nodes (one container; the gateway spawns the nodes as child processes).
# Build context: the repo root (git archive of committed main). Keys are mounted at run time, never built in.
FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/eerc/package.json packages/eerc/
COPY packages/node/package.json packages/node/
COPY packages/gateway/package.json packages/gateway/
COPY packages/mcp/package.json packages/mcp/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --prod --filter "@xorv/gateway..." --filter "@xorv/node..."
COPY packages ./packages
COPY deployments/fuji.json ./deployments/
ENV NODE_ENV=production XORV_GATEWAY_HOST=0.0.0.0 XORV_GATEWAY_PORT=5421
EXPOSE 5421
CMD ["node", "packages/gateway/src/server.ts"]
