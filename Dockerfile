# syntax=docker/dockerfile:1.6
# Single image used by BOTH services on Railway:
#   - web service:    CMD ["npm","start"]   (default)
#   - worker service: CMD ["npm","run","worker"]  (override in Railway service settings)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Install everything (build needs devDeps like tailwindcss, eslint-config-next, types).
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Copy production artifacts. We keep full node_modules so the worker (tsx) and
# Prisma client both work — Next standalone output would shrink this further
# but adds complexity for the dual-service setup.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
EXPOSE 3000
CMD ["npm","start"]
