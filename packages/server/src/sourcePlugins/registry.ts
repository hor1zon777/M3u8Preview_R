import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import { prisma } from '../lib/prisma.js';
import type { SourcePluginInfo, SourcePluginAdminInfo } from '@m3u8-preview/shared';
import { loadPlugins, type LoadedPlugin } from './loader.js';
import { installPlugin, uninstallPlugin } from './installer.js';
import { createPluginContext } from './context.js';
import type { SourceParserPlugin, PluginContext } from './types.js';

/** 解析成功后的标准化结果（meta 已序列化为字符串，写入 Media.sourceMeta） */
export interface ParsedSource {
  m3u8Url: string;
  title?: string;
  author?: string;
  meta: string;
}

/** 批量解析时单条结果 */
export interface BatchParseEntry {
  originalUrl: string;
  ok: boolean;
  result?: ParsedSource;
  error?: string;
}

/** 插件默认套用的分类/标签 */
export interface PluginDefaults {
  category?: string;
  tags?: string[];
}

type PluginConfigValues = Record<string, string | number | boolean>;
interface PluginState {
  enabled: boolean;
  config: PluginConfigValues;
}

/** 已加载插件的内存注册表（代码定义 + 来源 + 路径），启动 / reload 时刷新 */
let loaded = new Map<string, LoadedPlugin>();

/** 启动时加载插件（由 index.ts 的 main() 调用） */
export async function initSourcePlugins(): Promise<void> {
  loaded = await loadPlugins();
  const ids = Array.from(loaded.keys());
  console.log(`[SourcePlugins] 已加载 ${ids.length} 个插件${ids.length ? '：' + ids.join(', ') : ''}`);
}

/** 重新扫描插件目录（上传 / 卸载后调用，免重启生效） */
async function reload(): Promise<void> {
  loaded = await loadPlugins();
}

function parseConfig(raw: string): PluginConfigValues {
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as PluginConfigValues) : {};
  } catch {
    return {};
  }
}

/** 批量读取所有插件的 DB 状态 */
async function getStates(): Promise<Map<string, PluginState>> {
  const rows = await prisma.sourcePlugin.findMany();
  const m = new Map<string, PluginState>();
  for (const r of rows) {
    m.set(r.id, { enabled: r.enabled, config: parseConfig(r.config) });
  }
  return m;
}

/** 校验插件代码已加载，返回其加载信息 */
function requireLoaded(id: string): LoadedPlugin {
  const entry = loaded.get(id);
  if (!entry) throw new AppError(`插件 "${id}" 不存在`, 404);
  return entry;
}

/** 公开：列出已启用插件（导入页 / 详情页用） */
async function listEnabled(): Promise<SourcePluginInfo[]> {
  const states = await getStates();
  return Array.from(loaded.values())
    .filter(({ plugin }) => states.get(plugin.id)?.enabled)
    .map(({ plugin }) => ({ id: plugin.id, name: plugin.name, description: plugin.description, enabled: true }));
}

/** 管理：列出全部插件（代码定义 + 启用状态 + 配置 + 配置项声明） */
async function listAll(): Promise<SourcePluginAdminInfo[]> {
  const states = await getStates();
  return Array.from(loaded.values()).map(({ plugin, installedFrom }) => {
    const st = states.get(plugin.id);
    return {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      author: plugin.author,
      version: plugin.version,
      enabled: st?.enabled ?? false,
      installedFrom,
      configSchema: plugin.configSchema,
      config: st?.config ?? {},
    };
  });
}

/** 启用 / 禁用插件 */
async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const entry = requireLoaded(id);
  await prisma.sourcePlugin.upsert({
    where: { id },
    update: { enabled },
    create: { id, enabled, config: '{}', installedFrom: entry.installedFrom },
  });
}

/** 更新插件配置（按 configSchema 校验 required） */
async function updateConfig(id: string, cfg: PluginConfigValues): Promise<void> {
  const entry = requireLoaded(id);
  for (const f of entry.plugin.configSchema ?? []) {
    if (f.required) {
      const v = cfg[f.key];
      if (v === undefined || v === null || v === '') {
        throw new AppError(`配置项「${f.label}」为必填`, 400);
      }
    }
  }
  await prisma.sourcePlugin.upsert({
    where: { id },
    update: { config: JSON.stringify(cfg) },
    create: { id, enabled: false, config: JSON.stringify(cfg), installedFrom: entry.installedFrom },
  });
}

/** 安装上传的插件文件 → reload → 返回新插件管理信息 */
async function install(tmpPath: string, originalName: string): Promise<SourcePluginAdminInfo> {
  const existingIds = new Set(loaded.keys());
  const id = await installPlugin(tmpPath, originalName, existingIds);
  await reload();
  const info = (await listAll()).find((p) => p.id === id);
  if (!info) {
    throw new AppError('插件安装后未能加载，请检查插件文件是否合法', 500);
  }
  return info;
}

/** 卸载插件（仅 upload 来源）→ 删除文件 + DB 记录 → reload */
async function uninstall(id: string): Promise<void> {
  const entry = requireLoaded(id);
  uninstallPlugin(entry);
  await prisma.sourcePlugin.deleteMany({ where: { id } });
  await reload();
}

/** 解析出可用（已启用）插件及其配置；缺省取首个已启用插件 */
async function resolveEnabled(
  pluginId?: string,
): Promise<{ plugin: SourceParserPlugin; cfg: PluginConfigValues }> {
  const states = await getStates();
  const enabledEntries = Array.from(loaded.values()).filter(({ plugin }) => states.get(plugin.id)?.enabled);
  if (enabledEntries.length === 0) {
    throw new AppError('尚未启用任何解析插件，请在「插件管理」中启用插件', 400);
  }
  const entry = pluginId
    ? enabledEntries.find((e) => e.plugin.id === pluginId)
    : enabledEntries[0];
  if (!entry) {
    throw new AppError(`解析插件 "${pluginId}" 不存在或未启用，请在「插件管理」中检查`, 400);
  }
  return { plugin: entry.plugin, cfg: states.get(entry.plugin.id)!.config };
}

/** 用指定插件 + 上下文执行 parse 并包裹结果/错误 */
async function runParse(
  plugin: SourceParserPlugin,
  pluginCtx: PluginContext,
  originalUrl: string,
): Promise<ParsedSource> {
  let result;
  try {
    result = await plugin.parse(originalUrl, pluginCtx);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(`${plugin.name}解析失败：${err instanceof Error ? err.message : '未知错误'}`, 502);
  }
  if (!result || !result.m3u8Url) {
    throw new AppError(`${plugin.name}未解析到可播放地址`, 422);
  }
  return {
    m3u8Url: result.m3u8Url,
    title: result.title || undefined,
    author: result.author || undefined,
    meta: JSON.stringify({ plugin: plugin.id, ...(result.meta ?? {}) }),
  };
}

/**
 * 解析单个原始链接为可播放地址。
 *
 * SSRF 说明：插件可能请求 localhost/内网解析服务，PluginContext.fetchJson 不做拦截；
 * 解析出的 m3u8 仅存库并经 /api/v1/proxy（已含 SSRF 防护）播放。
 */
async function parseOne(pluginId: string | undefined, originalUrl: string): Promise<ParsedSource> {
  const trimmed = (originalUrl ?? '').trim();
  if (!trimmed) {
    throw new AppError('原始链接不能为空', 400);
  }
  const { plugin, cfg } = await resolveEnabled(pluginId);
  return runParse(plugin, createPluginContext(cfg), trimmed);
}

/**
 * 批量解析原始链接。
 * - 去重 / 去空，并截断到 config.sourcePlugins.maxPreviewBatch
 * - 按 config.sourcePlugins.previewConcurrency 控制并发
 * - 单条失败不影响其他条目，结果按原顺序返回
 */
async function parseBatch(pluginId: string | undefined, urls: string[]): Promise<BatchParseEntry[]> {
  // 提前校验插件可用并取其配置（无可用插件直接抛错，而非逐条失败）
  const { plugin, cfg } = await resolveEnabled(pluginId);
  const pluginCtx = createPluginContext(cfg);

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
        const result = await runParse(plugin, pluginCtx, originalUrl);
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

/** 返回解析到的真实插件 id 及其默认套用的分类/标签 */
async function getPluginDefaults(pluginId?: string): Promise<{ pluginId: string; defaults: PluginDefaults }> {
  const { plugin } = await resolveEnabled(pluginId);
  return {
    pluginId: plugin.id,
    defaults: { category: plugin.defaultCategory, tags: plugin.defaultTags },
  };
}

export const sourcePluginRegistry = {
  listEnabled,
  listAll,
  setEnabled,
  updateConfig,
  install,
  uninstall,
  parseOne,
  parseBatch,
  getPluginDefaults,
  /** 当前已加载（代码）插件数量 */
  get size() {
    return loaded.size;
  },
};
