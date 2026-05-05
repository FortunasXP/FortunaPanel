FROM node:22-slim

# Install Java (needed for Minecraft servers) and basic tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy application source and pre-built CSS
COPY src/ ./src/
COPY public/ ./public/
COPY .env.example ./

# Create data and server directories
RUN mkdir -p /app/data /app/servers /app/logs

# Expose panel port and SFTP port
EXPOSE 3000 2222

# Persistent volumes for data, servers, and logs
VOLUME ["/app/data", "/app/servers", "/app/logs"]

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    SERVERS_ROOT=/app/servers \
    LOGS_DIR=/app/logs

CMD ["node", "src/index.js"]
