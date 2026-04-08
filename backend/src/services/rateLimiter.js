/**
 * Redis Rate Limiter
 * 
 * Implements sliding window rate limiting using Redis sorted sets.
 * 
 * Algorithm:
 * 1. Remove entries older than the window
 * 2. Count remaining entries
 * 3. If under limit, add new entry
 * 4. If over limit, return 429
 * 
 * Default: 10 requests per IP per minute
 */

import Redis from 'ioredis';

const DEFAULT_LIMIT = 10;       // requests
const DEFAULT_WINDOW = 60;      // seconds
const KEY_PREFIX = 'ratelimit:';

class RateLimiter {
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
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      console.log('Redis rate limiter connected');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      console.error('Redis rate limiter error:', err.message);
      this.isConnected = false;
    });

    await this.client.connect();
  }

  /**
   * Check if request should be rate limited
   * @param {string} identifier - Usually IP address
   * @param {number} limit - Max requests per window
   * @param {number} windowSecs - Window size in seconds
   * @returns {Promise<{allowed: boolean, remaining: number, retryAfter: number|null}>}
   */
  async check(identifier, limit = DEFAULT_LIMIT, windowSecs = DEFAULT_WINDOW) {
    // If Redis is down, allow the request (fail open)
    if (!this.isConnected) {
      return { allowed: true, remaining: limit, retryAfter: null };
    }

    const key = KEY_PREFIX + identifier;
    const now = Date.now();
    const windowMs = windowSecs * 1000;
    const windowStart = now - windowMs;

    try {
      // Execute as pipeline for atomicity
      const pipeline = this.client.pipeline();
      
      // Remove old entries outside the window
      pipeline.zremrangebyscore(key, 0, windowStart);
      
      // Count current entries in window
      pipeline.zcard(key);
      
      // Get oldest entry (for retry-after calculation)
      pipeline.zrange(key, 0, 0, 'WITHSCORES');
      
      const results = await pipeline.exec();
      const currentCount = results[1][1];
      const oldestEntry = results[2][1];

      if (currentCount < limit) {
        // Under limit - add this request
        await this.client.pipeline()
          .zadd(key, now, `${now}-${Math.random()}`)
          .expire(key, windowSecs)
          .exec();

        return {
          allowed: true,
          remaining: limit - currentCount - 1,
          retryAfter: null,
        };
      } else {
        // Over limit - calculate retry-after
        const oldestTime = oldestEntry.length > 0 ? parseInt(oldestEntry[1], 10) : now;
        const retryAfter = Math.ceil((oldestTime + windowMs - now) / 1000);

        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(1, retryAfter),
        };
      }
    } catch (err) {
      console.error('Rate limiter error:', err.message);
      // Fail open on error
      return { allowed: true, remaining: limit, retryAfter: null };
    }
  }

  /**
   * Express middleware factory
   * @param {number} limit - Max requests per window
   * @param {number} windowSecs - Window size in seconds
   * @returns {Function} Express middleware
   */
  middleware(limit = DEFAULT_LIMIT, windowSecs = DEFAULT_WINDOW) {
    return async (req, res, next) => {
      // Use IP as identifier (trust proxy if behind reverse proxy)
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      
      const result = await this.check(ip, limit, windowSecs);

      // Set rate limit headers
      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', String(result.remaining));

      if (!result.allowed) {
        res.set('Retry-After', String(result.retryAfter));
        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
          retryAfter: result.retryAfter,
        });
      }

      next();
    };
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
export const rateLimiter = new RateLimiter();
export default rateLimiter;
