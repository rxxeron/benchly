FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
RUN chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=3001

USER node

EXPOSE 3001

CMD ["node", "dist/server.js"]
