# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
COPY drizzle ./drizzle
RUN npm run build && npx tsc -p tsconfig.seed.json

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-seed ./dist-seed
COPY scripts/start-render.sh scripts/seed-if-empty.cjs ./scripts/
COPY drizzle ./drizzle
USER node
EXPOSE 4000
# Apply pending migrations, then start the API.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
