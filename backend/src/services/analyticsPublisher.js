/**
 * Analytics Publisher
 * 
 * Publishes click events to Redis Pub/Sub channel.
 * This decouples analytics from the redirect response,
 * ensuring redirects are never delayed by database writes.
 * 
 * Channel: "clicks"
 */

import Redis from 'ioredis';

const CHANNEL = 'clicks';

class AnalyticsPublisher {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  /**
   * Initialize Redis publisher connection
   */
  async connect() {
    if (this.client) return;

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      console.log('Analytics publisher connected');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      console.error('Analytics publisher error:', err.message);
      this.isConnected = false;
    });

    await this.client.connect();
  }

  /**
   * Publish a click event
   * @param {object} clickData
   * @param {string} clickData.urlId - BigInt as string
   * @param {string} clickData.referrer - Referrer URL
   * @param {string} clickData.userAgent - User agent string
   */
  async publishClick(clickData) {
    if (!this.isConnected) {
      console.warn('Analytics publisher not connected, dropping click event');
      return;
    }

    try {
      const event = {
        ...clickData,
        clickedAt: new Date().toISOString(),
      };

      await this.client.publish(CHANNEL, JSON.stringify(event));
    } catch (err) {
      // Log but don't throw - analytics should never break redirects
      console.error('Failed to publish click event:', err.message);
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }
}

// Export singleton instance
export const analyticsPublisher = new AnalyticsPublisher();
export default analyticsPublisher;
