import { prisma } from '../lib/prisma.js';

const DEFAULT_SETTINGS: Record<string, string> = {
  siteName: 'M3u8 Preview',
  allowRegistration: 'true',
  enableRateLimit: 'true',
  proxyAllowedExtensions: '.m3u8,.ts,.m4s,.mp4,.aac,.key,.jpg,.jpeg,.png,.webp',
};

export async function ensureDefaultSettings(): Promise<void> {
  const existing = await prisma.systemSetting.findMany({ select: { key: true } });
  const existingKeys = new Set(existing.map(s => s.key));

  const missing = Object.entries(DEFAULT_SETTINGS).filter(([key]) => !existingKeys.has(key));

  if (missing.length === 0) return;

  for (const [key, value] of missing) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }

  console.log(`[SettingsMigration] 已补全 ${missing.length} 项默认设置: ${missing.map(([k]) => k).join(', ')}`);
}
