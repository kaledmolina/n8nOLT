# Build Stage
FROM node:20 AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production Stage
FROM node:20
WORKDIR /app
COPY package*.json ./
# Install only production dependencies
RUN npm install --production
# Install tsx globally to run the server.ts
RUN npm install -g tsx

# Copy built frontend
COPY --from=build /app/dist ./dist
# Copy server and necessary files
COPY --from=build /app/server.ts ./
# Copy tsconfig for tsx
COPY --from=build /app/tsconfig.json ./

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start the server
CMD ["tsx", "server.ts"]
