/**
 * GET /analytics/:code
 * DELETE /urls/:code
 * 
 * Analytics endpoint returns click statistics for a short URL.
 * Delete endpoint removes a short URL (requires API key).
 */

import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { cache } from '../services/cache.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

/**
 * API Key authentication middleware
 */
function requireApiKey(req, res, next) {
  const apiKey = req.get('X-API-Key');
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    // API key not configured - allow request (development mode)
    return next();
  }

  if (!apiKey || apiKey !== expectedKey) {
    throw new ApiError(401, 'Invalid or missing API key');
  }

  next();
}

/**
 * GET /analytics/:code
 * 
 * Returns click statistics for a short URL.
 */
router.get('/analytics/:code', async (req, res, next) => {
  try {
    const { code } = req.params;

    // Find the URL
    const url = await prisma.url.findUnique({
      where: { shortCode: code },
      include: {
        clicks: {
          orderBy: { clickedAt: 'desc' },
        },
      },
    });

    if (!url) {
      throw new ApiError(404, 'Short URL not found');
    }

    // Calculate statistics
    const totalClicks = url.clicks.length;

    // Clicks over time (grouped by day)
    const clicksByDay = {};
    url.clicks.forEach(click => {
      const day = click.clickedAt.toISOString().split('T')[0];
      clicksByDay[day] = (clicksByDay[day] || 0) + 1;
    });

    const clicksOverTime = Object.entries(clicksByDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Top referrers
    const referrerCounts = {};
    url.clicks.forEach(click => {
      if (click.referrer) {
        try {
          const hostname = new URL(click.referrer).hostname;
          referrerCounts[hostname] = (referrerCounts[hostname] || 0) + 1;
        } catch {
          referrerCounts['Direct'] = (referrerCounts['Direct'] || 0) + 1;
        }
      } else {
        referrerCounts['Direct'] = (referrerCounts['Direct'] || 0) + 1;
      }
    });

    const topReferrers = Object.entries(referrerCounts)
      .map(([referrer, count]) => ({ referrer, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top countries (will be mostly null since we skipped geolocation)
    const countryCounts = {};
    url.clicks.forEach(click => {
      const country = click.country || 'Unknown';
      countryCounts[country] = (countryCounts[country] || 0) + 1;
    });

    const topCountries = Object.entries(countryCounts)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top user agents (browsers)
    const browserCounts = {};
    url.clicks.forEach(click => {
      if (click.userAgent) {
        // Simple browser detection
        let browser = 'Other';
        if (click.userAgent.includes('Chrome')) browser = 'Chrome';
        else if (click.userAgent.includes('Firefox')) browser = 'Firefox';
        else if (click.userAgent.includes('Safari')) browser = 'Safari';
        else if (click.userAgent.includes('Edge')) browser = 'Edge';
        else if (click.userAgent.includes('Opera')) browser = 'Opera';
        browserCounts[browser] = (browserCounts[browser] || 0) + 1;
      } else {
        browserCounts['Unknown'] = (browserCounts['Unknown'] || 0) + 1;
      }
    });

    const topBrowsers = Object.entries(browserCounts)
      .map(([browser, count]) => ({ browser, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      shortCode: url.shortCode,
      longUrl: url.longUrl,
      createdAt: url.createdAt,
      expiresAt: url.expiresAt,
      totalClicks,
      clicksOverTime,
      topReferrers,
      topCountries,
      topBrowsers,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /urls/:code
 * 
 * Deletes a short URL. Requires API key authentication.
 */
router.delete('/urls/:code', requireApiKey, async (req, res, next) => {
  try {
    const { code } = req.params;

    // Delete from database (cascades to clicks)
    const deleted = await prisma.url.delete({
      where: { shortCode: code },
    });

    // Remove from cache
    await cache.delete(code);

    res.json({
      message: 'URL deleted successfully',
      shortCode: deleted.shortCode,
    });
  } catch (err) {
    if (err.code === 'P2025') {
      return next(new ApiError(404, 'Short URL not found'));
    }
    next(err);
  }
});

export default router;
