# Backend Dockerfile
# Multi-stage build for production optimization
# Using Debian-slim instead of Alpine for better Prisma compatibility

# Stage 1: Dependencies
FROM node:20-slim AS deps
WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Builder (for Prisma generation)
FROM node:20-slim AS builder
WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

# Stage 3: Production
FROM node:20-slim AS runner
WORKDIR /app

# Install OpenSSL and wget for health checks
RUN apt-get update && apt-get install -y openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid nodejs expressjs

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy Prisma client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy application files
COPY package*.json ./
COPY prisma ./prisma
COPY src ./src

# Set ownership
RUN chown -R expressjs:nodejs /app

# Switch to non-root user
USER expressjs

# Environment
ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# Start command
CMD ["node", "src/app.js"]
