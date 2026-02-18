# Multi-Stage Build für NEXORA

# Stage 1: Build
FROM node:20-alpine AS builder
ENV NODE_ENV=development
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
ENV NODE_ENV=production PORT=5000
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist
EXPOSE 5000
CMD ["node", "dist/index.js"]
