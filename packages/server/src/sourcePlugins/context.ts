import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import type { PluginContext } from './types.js';

/**
 * 构建注入给插件的运行时上下文。
 *
 * @param pluginConfig 该插件在后台保存的配置值（注入 ctx.config，供 parse 读取 baseUrl/密钥等）
 *
 * fetchJson 提供带超时的 JSON 请求（AbortController），让 HTTP 型插件不必重复处理
 * 超时 / HTTP 状态 / JSON 解析。
 */
export function createPluginContext(
  pluginConfig: Record<string, string | number | boolean> = {},
): PluginContext {
  const defaultTimeoutMs = config.sourcePlugins.timeoutMs;

  return {
    defaultTimeoutMs,
    config: pluginConfig,

    fail(message: string, status = 502): never {
      throw new AppError(message, status);
    },

    async fetchJson<T = unknown>(
      url: string,
      init: RequestInit & { timeoutMs?: number } = {},
    ): Promise<T> {
      const { timeoutMs = defaultTimeoutMs, ...rest } = init;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let resp: Response;
      try {
        resp = await fetch(url, {
          ...rest,
          headers: { Accept: 'application/json', ...(rest.headers as Record<string, string> | undefined) },
          signal: controller.signal,
        });
      } catch (err) {
        const reason = err instanceof Error && err.name === 'AbortError' ? '请求超时' : '无法连接目标服务';
        throw new AppError(`插件请求失败：${reason}`, 502);
      } finally {
        clearTimeout(timer);
      }

      if (!resp.ok) {
        throw new AppError(`插件请求失败：HTTP ${resp.status}`, 502);
      }

      try {
        return (await resp.json()) as T;
      } catch {
        throw new AppError('插件目标返回了无法解析的响应', 502);
      }
    },
  };
}
