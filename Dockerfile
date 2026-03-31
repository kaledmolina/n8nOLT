FROM node:22-slim AS builder

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Stage 2: Production environment
FROM node:22-slim

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend assets and server files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/tsconfig.json ./

# Install tsx globally to run server.ts
RUN npm install tsx -g

# Expose the internal port
EXPOSE 3000

# Start the server
CMD ["tsx", "server.ts"]
