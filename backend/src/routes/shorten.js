/**
 * POST /shorten
 * 
 * Creates a shortened URL from a long URL.
 * 
 * Request body:
 * { "url": "https://example.com/very/long/path" }
 * 
 * Response:
 * { "shortUrl": "http://localhost:8000/abc123", "shortCode": "abc123" }
 */

import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { snowflake } from '../services/snowflake.js';
import { encode } from '../services/base62.js';
import { cache } from '../services/cache.js';
import { rateLimiter } from '../services/rateLimiter.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

/**
 * Validate URL format (basic check)
 * @param {string} url 
 * @returns {boolean}
 */
function isValidUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  // Basic protocol check
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * POST /shorten
 */
router.post('/shorten', rateLimiter.middleware(10, 60), async (req, res, next) => {
  try {
    const { url, expiresAt } = req.body;

    // Validate URL
    if (!isValidUrl(url)) {
      throw new ApiError(400, 'Invalid URL. Must start with http:// or https://');
    }

    // Generate Snowflake ID and encode to short code
    const id = snowflake.generate();
    const shortCode = encode(id);

    // Parse expiration date if provided
    let expirationDate = null;
    if (expiresAt) {
      expirationDate = new Date(expiresAt);
      if (isNaN(expirationDate.getTime())) {
        throw new ApiError(400, 'Invalid expiration date format');
      }
      if (expirationDate <= new Date()) {
        throw new ApiError(400, 'Expiration date must be in the future');
      }
    }

    // Store in database
    const newUrl = await prisma.url.create({
      data: {
        id,
        shortCode,
        longUrl: url,
        expiresAt: expirationDate,
      },
    });

    // Cache the mapping
    await cache.set(shortCode, url);

    // Build response
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 8000}`;
    const shortUrl = `${baseUrl}/${shortCode}`;

    res.status(201).json({
      shortUrl,
      shortCode,
      longUrl: url,
      createdAt: newUrl.createdAt,
      expiresAt: newUrl.expiresAt,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
