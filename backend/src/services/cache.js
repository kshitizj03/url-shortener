/**
 * Redis Cache Service
 * 
 * Implements cache-aside pattern for URL lookups:
 * - Check Redis first
 * - On miss, query PostgreSQL and cache result
 * - TTL: 24 hours
 * 
 * Key format: "url:{shortCode}"
 */

import Redis from 'ioredis';

const CACHE_TTL = 60 * 60 * 24; // 24 hours in seconds
const KEY_PREFIX = 'url:';

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  /**
   * Initialize Redis connection
   */
  async connect() {
    if (this.client) return;

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      console.log('Redis cache connected');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      console.error('Redis cache error:', err.message);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      console.log('Redis cache connection closed');
      this.isConnected = false;
    });

    await this.client.connect();
  }

  /**
   * Get a URL from cache
   * @param {string} shortCode 
   * @returns {Promise<string|null>} Long URL or null if not cached
   */
  async get(shortCode) {
    if (!this.isConnected) return null;
    
    try {
      const key = KEY_PREFIX + shortCode;
      const value = await this.client.get(key);
      return value;
    } catch (err) {
      console.error('Cache get error:', err.message);
      return null;
    }
  }

  /**
   * Store a URL in cache
   * @param {string} shortCode 
   * @param {string} longUrl 
   * @param {number} ttl - TTL in seconds (default: 24 hours)
   */
  async set(shortCode, longUrl, ttl = CACHE_TTL) {
    if (!this.isConnected) return;
    
    try {
      const key = KEY_PREFIX + shortCode;
      await this.client.setex(key, ttl, longUrl);
    } catch (err) {
      console.error('Cache set error:', err.message);
    }
  }

  /**
   * Remove a URL from cache
   * @param {string} shortCode 
   */
  async delete(shortCode) {
    if (!this.isConnected) return;
    
    try {
      const key = KEY_PREFIX + shortCode;
      await this.client.del(key);
    } catch (err) {
      console.error('Cache delete error:', err.message);
    }
  }

  /**
   * Check Redis connection health
   * @returns {Promise<boolean>}
   */
  async ping() {
    if (!this.isConnected) return false;
    
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
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
export const cache = new CacheService();
export default cache;
