FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN npm install --workspace=apps/worker --workspace=packages/shared --legacy-peer-deps

FROM deps AS builder
COPY packages/shared/src ./packages/shared/src
COPY apps/worker/src ./apps/worker/src
COPY apps/worker/tsconfig.json ./apps/worker/
COPY apps/api/prisma ./apps/api/prisma
RUN cd apps/worker && npx prisma generate --schema=../api/prisma/schema.prisma
RUN cd apps/worker && npx tsc

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/packages/shared/src ./packages/shared/src

WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
