import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import type { SourcePluginInfo } from '@m3u8-preview/shared';

/**
 * 动态解析源插件客户端。
 *
 * 统一封装对外部解析服务（haijiao parser 的中间插件接口 /api/plugin/parse）的调用，
 * 供「刷新源地址」与「插件源批量导入」复用，确保解析逻辑只有一份。
 */

/** 单个插件的运行时配置 */
interface PluginConfig {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  parsePath: string;
  timeoutMs: number;
}

/** 解析成功后的标准化结果 */
export interface ParsedSource {
  /** 最近一次解析出的可播放 m3u8 地址 */
  m3u8Url: string;
  title?: string;
  author?: string;
  /** 序列化后的来源元数据，存入 Media.sourceMeta，用于追溯 */
  meta: string;
}

/** 批量解析时单条结果 */
export interface BatchParseEntry {
  originalUrl: string;
  ok: boolean;
  result?: ParsedSource;
  error?: string;
}

/** haijiao /api/plugin/parse 的响应结构（见 haijiao-parser/MIDDLEWARE_PLUGIN.md） */
interface PluginApiResponse {
  code: number;
  message: string;
  data?: {
    inputUrl?: string;
    postId?: string;
    sourceDomain?: string;
    title?: string;
    author?: string;
    status?: string;
    sourceUrl?: string;
    sourceUrls?: string[];
    parsedAt?: string;
    error?: string;
  };
}

/** 从配置构建插件注册表（当前仅 haijiao；新增插件在此扩展） */
function getRegistry(): PluginConfig[] {
  const haijiao = config.sourcePlugins.haijiao;
  return [
    {
      id: 'haijiao',
      name: '海角解析',
      description: '输入原始帖子链接，实时解析出可播放的 m3u8 地址',
      baseUrl: haijiao.baseUrl,
      parsePath: haijiao.parsePath,
      timeoutMs: haijiao.timeoutMs,
    },
  ];
}

/** 解析 pluginId → 插件配置；缺省取注册表首个 */
function resolvePlugin(pluginId?: string): PluginConfig {
  const registry = getRegistry();
  const target = pluginId ? registry.find((p) => p.id === pluginId) : registry[0];
  if (!target) {
    throw new AppError(`未知的解析插件: ${pluginId}`, 400);
  }
  return target;
}

/** 返回可用插件元信息列表 */
function listPlugins(): SourcePluginInfo[] {
  return getRegistry().map(({ id, name, description }) => ({ id, name, description }));
}

/**
 * 解析单个原始链接为可播放地址。
 *
 * 注意（SSRF）：插件 baseUrl 来自管理员环境变量，是可信内网服务（默认 localhost:23000），
 * 因此**不经过** ssrfGuard.assertSafeUrl（否则 localhost / 内网 IP 会被拦截）。
 * 解析返回的 m3u8 是外部地址，但仅存库并经现有 /api/v1/proxy（已含 SSRF 防护）播放。
 */
async function parseOne(pluginId: string | undefined, originalUrl: string): Promise<ParsedSource> {
  const trimmed = (originalUrl ?? '').trim();
  if (!trimmed) {
    throw new AppError('原始链接不能为空', 400);
  }

  const plugin = resolvePlugin(pluginId);
  const endpoint = `${plugin.baseUrl.replace(/\/+$/, '')}${plugin.parsePath}`;
  const requestUrl = `${endpoint}?url=${encodeURIComponent(trimmed)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), plugin.timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(requestUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? '解析服务超时' : '无法连接解析服务';
    throw new AppError(`${plugin.name}解析失败：${reason}`, 502);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new AppError(`${plugin.name}解析失败：HTTP ${resp.status}`, 502);
  }

  let payload: PluginApiResponse;
  try {
    payload = (await resp.json()) as PluginApiResponse;
  } catch {
    throw new AppError(`${plugin.name}返回了无法解析的响应`, 502);
  }

  // 业务失败：插件返回 code !== 0，或没有解析到地址
  const sourceUrl = payload.data?.sourceUrl;
  if (payload.code !== 0 || !sourceUrl) {
    const msg = payload.message || payload.data?.error || '未解析到可播放地址';
    throw new AppError(`${plugin.name}解析失败：${msg}`, 422);
  }

  const data = payload.data!;
  const meta = JSON.stringify({
    plugin: plugin.id,
    postId: data.postId ?? null,
    sourceDomain: data.sourceDomain ?? null,
    title: data.title ?? null,
    author: data.author ?? null,
    sourceUrls: data.sourceUrls ?? [data.sourceUrl],
    parsedAt: data.parsedAt ?? null,
  });

  return {
    m3u8Url: sourceUrl,
    title: data.title || undefined,
    author: data.author || undefined,
    meta,
  };
}

/**
 * 批量解析原始链接。
 * - 去重 / 去空，并截断到 config.sourcePlugins.maxPreviewBatch
 * - 按 config.sourcePlugins.previewConcurrency 控制并发
 * - 单条失败不影响其他条目，结果按原顺序返回
 */
async function parseBatch(pluginId: string | undefined, urls: string[]): Promise<BatchParseEntry[]> {
  const cleaned = Array.from(new Set((urls ?? []).map((u) => u.trim()).filter(Boolean)));
  const limited = cleaned.slice(0, config.sourcePlugins.maxPreviewBatch);
  if (limited.length === 0) {
    return [];
  }

  const results: BatchParseEntry[] = new Array(limited.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= limited.length) return;
      const originalUrl = limited[index]!;
      try {
        const result = await parseOne(pluginId, originalUrl);
        results[index] = { originalUrl, ok: true, result };
      } catch (err) {
        results[index] = {
          originalUrl,
          ok: false,
          error: err instanceof Error ? err.message : '解析失败',
        };
      }
    }
  }

  const workerCount = Math.min(Math.max(1, config.sourcePlugins.previewConcurrency), limited.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export const sourcePluginService = {
  listPlugins,
  parseOne,
  parseBatch,
};
