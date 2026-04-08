/**
 * URL Shortener API
 * 
 * Main Express application entry point.
 * 
 * Endpoints:
 * - POST /shorten        - Create short URL
 * - GET /:code           - Redirect to long URL
 * - GET /analytics/:code - Get click statistics
 * - DELETE /urls/:code   - Delete short URL
 * - GET /health          - Health check
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

// Database
import { prisma } from './db/prisma.js';

// Services
import { cache } from './services/cache.js';
import { rateLimiter } from './services/rateLimiter.js';
import { analyticsPublisher } from './services/analyticsPublisher.js';

// Routes
import shortenRouter from './routes/shorten.js';
import redirectRouter from './routes/redirect.js';
import analyticsRouter from './routes/analytics.js';

// Middleware
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();
const PORT = process.env.PORT || 8000;

// Trust proxy (important for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      cache: 'unknown',
    },
  };

  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`;
    health.services.database = 'connected';
  } catch {
    health.services.database = 'disconnected';
    health.status = 'degraded';
  }

  try {
    // Check Redis cache
    const cacheOk = await cache.ping();
    health.services.cache = cacheOk ? 'connected' : 'disconnected';
    if (!cacheOk) health.status = 'degraded';
  } catch {
    health.services.cache = 'disconnected';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// API Routes (order matters!)
app.use(shortenRouter);      // POST /shorten
app.use(analyticsRouter);    // GET /analytics/:code, DELETE /urls/:code
app.use(redirectRouter);     // GET /:code (must be last - catches all)

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize services and start server
async function startServer() {
  try {
    console.log('Initializing services...');

    // Connect to Redis
    await cache.connect();
    await rateLimiter.connect();
    await analyticsPublisher.connect();

    // Verify database connection
    await prisma.$connect();
    console.log('Database connected');

    // Start server
    app.listen(PORT, () => {
      console.log(`\n🚀 URL Shortener API running at http://localhost:${PORT}`);
      console.log(`\nEndpoints:`);
      console.log(`  POST   /shorten          - Create short URL`);
      console.log(`  GET    /:code            - Redirect to long URL`);
      console.log(`  GET    /analytics/:code  - Get click statistics`);
      console.log(`  DELETE /urls/:code       - Delete short URL`);
      console.log(`  GET    /health           - Health check\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('\nShutting down gracefully...');
  
  await cache.disconnect();
  await rateLimiter.disconnect();
  await analyticsPublisher.disconnect();
  await prisma.$disconnect();
  
  console.log('Goodbye!');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the server
startServer();

export default app;
