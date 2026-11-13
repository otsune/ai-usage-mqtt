FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/usage/package.json services/usage/package.json
COPY packages/usage-contracts/package.json packages/usage-contracts/package.json
RUN npm ci
COPY services services
COPY packages packages
COPY collectors collectors
COPY scripts scripts
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/usage/start.mjs"]
