/**
 * Analytics Worker
 * 
 * Subscribes to Redis "clicks" channel and writes events to PostgreSQL.
 * Runs as a separate process from the main API server.
 * 
 * Usage: npm run worker
 */

import 'dotenv/config';
import Redis from 'ioredis';
import { prisma } from '../db/prisma.js';

const CHANNEL = 'clicks';

class AnalyticsWorker {
  constructor() {
    this.subscriber = null;
    this.isRunning = false;
  }

  /**
   * Start the worker
   */
  async start() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    this.subscriber = new Redis(redisUrl);

    this.subscriber.on('connect', () => {
      console.log('Analytics worker connected to Redis');
    });

    this.subscriber.on('error', (err) => {
      console.error('Analytics worker Redis error:', err.message);
    });

    // Subscribe to clicks channel
    await this.subscriber.subscribe(CHANNEL);
    console.log(`Analytics worker subscribed to "${CHANNEL}" channel`);

    this.isRunning = true;

    // Handle incoming messages
    this.subscriber.on('message', async (channel, message) => {
      if (channel !== CHANNEL) return;

      try {
        const clickData = JSON.parse(message);
        await this.processClick(clickData);
      } catch (err) {
        console.error('Failed to process click event:', err.message);
      }
    });

    // Graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    console.log('Analytics worker is running...');
  }

  /**
   * Process a click event
   * @param {object} clickData 
   */
  async processClick(clickData) {
    const { urlId, clickedAt, referrer, userAgent, country } = clickData;

    try {
      await prisma.click.create({
        data: {
          urlId: BigInt(urlId),
          clickedAt: new Date(clickedAt),
          referrer: referrer || null,
          userAgent: userAgent || null,
          country: country || null,
        },
      });

      console.log(`Recorded click for URL ${urlId}`);
    } catch (err) {
      // URL might have been deleted - that's okay
      if (err.code === 'P2003') {
        console.warn(`URL ${urlId} no longer exists, skipping click`);
      } else {
        throw err;
      }
    }
  }

  /**
   * Stop the worker gracefully
   */
  async stop() {
    console.log('\nShutting down analytics worker...');
    this.isRunning = false;

    if (this.subscriber) {
      await this.subscriber.unsubscribe(CHANNEL);
      await this.subscriber.quit();
    }

    await prisma.$disconnect();
    console.log('Analytics worker stopped');
    process.exit(0);
  }
}

// Run if this is the main module
const worker = new AnalyticsWorker();
worker.start().catch((err) => {
  console.error('Failed to start analytics worker:', err);
  process.exit(1);
});

export default AnalyticsWorker;
