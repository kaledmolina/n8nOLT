FROM node:22 AS builder

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Stage 2: Production environment
FROM node:22

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev
RUN npm rebuild sqlite3 --build-from-source

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
