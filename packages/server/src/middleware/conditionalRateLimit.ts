import type { Request, RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';

const SETTING_KEY = 'enableRateLimit';
const CACHE_TTL_MS = 5000;
const DEFAULT_ENABLED = true;

let cachedEnabled = DEFAULT_ENABLED;
let cacheExpiresAt = 0;
let inFlightLoad: Promise<boolean> | null = null;

export function invalidateRateLimitSettingCache(): void {
  cachedEnabled = DEFAULT_ENABLED;
  cacheExpiresAt = 0;
  inFlightLoad = null;
}

async function loadRateLimitEnabled(): Promise<boolean> {
  const now = Date.now();
  if (now < cacheExpiresAt) {
    return cachedEnabled;
  }

  if (inFlightLoad) {
    return inFlightLoad;
  }

  inFlightLoad = prisma.systemSetting.findUnique({
    where: { key: SETTING_KEY },
    select: { value: true },
  })
    .then((setting) => {
      cachedEnabled = !setting || setting.value !== 'false';
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return cachedEnabled;
    })
    .catch(() => {
      cachedEnabled = DEFAULT_ENABLED;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return cachedEnabled;
    })
    .finally(() => {
      inFlightLoad = null;
    });

  return inFlightLoad;
}

export function isRateLimitToggleRequest(req: Request): boolean {
  return req.method === 'PUT'
    && req.path === '/admin/settings'
    && req.body?.key === SETTING_KEY;
}

export function conditionalRateLimit(
  limiter: RequestHandler,
  shouldBypass?: (req: Request) => boolean,
): RequestHandler {
  return async (req, res, next) => {
    if (shouldBypass?.(req)) {
      next();
      return;
    }

    if (!(await loadRateLimitEnabled())) {
      next();
      return;
    }

    limiter(req, res, next);
  };
}
