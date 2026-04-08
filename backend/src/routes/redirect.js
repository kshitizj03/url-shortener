/**
 * GET /:code
 * 
 * Redirects to the original long URL.
 * Uses cache-aside pattern: check Redis first, then PostgreSQL.
 * Publishes click event to analytics channel (async, non-blocking).
 */

import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { cache } from '../services/cache.js';
import { analyticsPublisher } from '../services/analyticsPublisher.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

/**
 * GET /:code
 */
router.get('/:code', async (req, res, next) => {
  try {
    const { code } = req.params;

    // Validate short code format (alphanumeric only)
    if (!/^[a-zA-Z0-9]+$/.test(code)) {
      throw new ApiError(400, 'Invalid short code format');
    }

    let longUrl = null;
    let urlId = null;

    // Try cache first
    longUrl = await cache.get(code);

    if (longUrl) {
      // Cache hit - need to get ID for analytics
      // We store it in a secondary cache key or query DB
      const urlRecord = await prisma.url.findUnique({
        where: { shortCode: code },
        select: { id: true, expiresAt: true },
      });

      if (!urlRecord) {
        // Cache is stale, remove it
        await cache.delete(code);
        throw new ApiError(404, 'Short URL not found');
      }

      // Check expiration
      if (urlRecord.expiresAt && urlRecord.expiresAt < new Date()) {
        await cache.delete(code);
        throw new ApiError(410, 'Short URL has expired');
      }

      urlId = urlRecord.id;
    } else {
      // Cache miss - query database
      const urlRecord = await prisma.url.findUnique({
        where: { shortCode: code },
      });

      if (!urlRecord) {
        throw new ApiError(404, 'Short URL not found');
      }

      // Check expiration
      if (urlRecord.expiresAt && urlRecord.expiresAt < new Date()) {
        throw new ApiError(410, 'Short URL has expired');
      }

      longUrl = urlRecord.longUrl;
      urlId = urlRecord.id;

      // Cache for future requests
      await cache.set(code, longUrl);
    }

    // Publish click event (fire and forget - don't await)
    analyticsPublisher.publishClick({
      urlId: urlId.toString(),
      referrer: req.get('Referer') || req.get('Referrer') || null,
      userAgent: req.get('User-Agent') || null,
    }).catch(err => {
      console.error('Failed to publish click:', err.message);
    });

    // Redirect to original URL
    res.redirect(302, longUrl);
  } catch (err) {
    next(err);
  }
});

export default router;
