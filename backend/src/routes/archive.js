import express from 'express';
import { getCachedArchive, refreshArchiveCache, isCacheStale, isRefreshing, refreshStartedAt } from '../services/archiveService.js';

const router = express.Router();

/**
 * GET /api/archive
 * Returns the cached archive data. If the cache is empty, triggers a fresh fetch
 * and waits for it (first-boot only). Otherwise always returns the stale-while-revalidate cache.
 */
router.get('/archive', async (req, res) => {
  try {
    let cached = getCachedArchive();

    // First boot — no cache yet, do a blocking fetch
    if (!cached) {
      console.log('[archive] No cache found — performing initial fetch');
      cached = await refreshArchiveCache();
      if (!cached) {
        return res.status(503).json({
          success: false,
          error: 'Archive not yet available. JIRA_FILTER_ID_ARCHIVE may not be configured.',
        });
      }
    }

    res.json({
      success: true,
      data: cached.issues,
      fetchedAt: cached.fetchedAt,
      issueCount: cached.issueCount,
    });
  } catch (error) {
    console.error('[archive] Error serving archive:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/archive/status
 * Returns cache metadata without the full payload.
 */
router.get('/archive/status', (req, res) => {
  const cached = getCachedArchive();
  res.json({
    success: true,
    hasCachedData: !!cached,
    fetchedAt: cached?.fetchedAt || null,
    issueCount: cached?.issueCount || 0,
    isStale: isCacheStale(),
    refreshing: isRefreshing(),
    refreshStartedAt: refreshStartedAt(),
  });
});

/**
 * POST /api/archive/refresh
 * Triggers a background cache refresh and returns immediately.
 * The existing cached data continues to be served until the refresh completes.
 * Safe to call multiple times — concurrent calls are ignored.
 */
router.post('/archive/refresh', (req, res) => {
  if (isRefreshing()) {
    const cached = getCachedArchive();
    return res.json({
      success: true,
      message: 'Refresh already in progress',
      refreshing: true,
      refreshStartedAt: refreshStartedAt(),
      currentCache: { fetchedAt: cached?.fetchedAt || null, issueCount: cached?.issueCount || 0 },
    });
  }

  // Fire-and-forget: do not await
  refreshArchiveCache().catch(err =>
    console.error('[archive] Background refresh triggered via API failed:', err.message)
  );

  const cached = getCachedArchive();
  res.json({
    success: true,
    message: 'Background refresh started. Existing cache data will continue to be served until complete.',
    refreshing: true,
    refreshStartedAt: refreshStartedAt(),
    currentCache: { fetchedAt: cached?.fetchedAt || null, issueCount: cached?.issueCount || 0 },
  });
});

export default router;
