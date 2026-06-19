import { readdir, stat } from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { SourceParserPlugin } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 内置/源码插件目录：dev(tsx) → src/plugins，prod(node) → dist/plugins */
export const BUILTIN_DIR = path.resolve(__dirname, '../plugins');
/** 运行时上传插件目录：始终为 packages/server/plugins-data（不随构建变化、持久化） */
export const RUNTIME_DIR = path.resolve(__dirname, '../../plugins-data');

/** 插件来源 */
export type PluginSource = 'builtin' | 'upload';

/** 已加载插件（代码定义 + 来源 + 文件路径，路径用于卸载） */
export interface LoadedPlugin {
  plugin: SourceParserPlugin;
  installedFrom: PluginSource;
  /** 插件入口文件绝对路径 */
  filePath: string;
  /** 若插件以目录形式安装（zip 解压），其目录绝对路径（卸载时删整个目录） */
  dir?: string;
}

/** 可加载的插件模块扩展名 */
const LOADABLE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts']);
/** 子目录入口候选文件名 */
const ENTRY_NAMES = ['index.js', 'index.mjs', 'index.cjs', 'index.ts'];

/** 判断顶层文件是否为候选插件模块（排除类型声明 / sourcemap / 内部文件 / index / README） */
function isPluginFile(file: string): boolean {
  const ext = path.extname(file);
  if (!LOADABLE_EXT.has(ext)) return false;
  if (file.endsWith('.d.ts')) return false;
  if (file.startsWith('_') || file.startsWith('.')) return false;
  const name = path.basename(file, ext).toLowerCase();
  if (name === 'index' || name === 'readme') return false;
  return true;
}

/** 在子目录中查找入口文件 */
async function findEntry(dir: string): Promise<string | null> {
  for (const name of ENTRY_NAMES) {
    const p = path.join(dir, name);
    try {
      const s = await stat(p);
      if (s.isFile()) return p;
    } catch {
      /* 不存在，继续 */
    }
  }
  return null;
}

/** 校验动态 import 的模块导出是否为合法插件 */
export function validatePlugin(mod: unknown): SourceParserPlugin | null {
  const candidate = (mod as { default?: unknown })?.default ?? mod;
  if (!candidate || typeof candidate !== 'object') return null;
  const p = candidate as Partial<SourceParserPlugin>;
  if (typeof p.id !== 'string' || !p.id.trim()) return null;
  if (typeof p.name !== 'string' || !p.name.trim()) return null;
  if (typeof p.parse !== 'function') return null;
  return p as SourceParserPlugin;
}

/**
 * 扫描单个目录：顶层 .js 文件 + 子目录的 index.js 入口。
 * 排除以 `_` / `.` 开头的文件与目录（用于 staging）。
 */
async function scanDir(
  dir: string,
  source: PluginSource,
  stamp: number,
  out: Map<string, LoadedPlugin>,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // 目录不存在或不可读 → 跳过
  }

  for (const e of entries) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;

    let entryPath: string | null = null;
    let pluginDir: string | undefined;

    if (e.isFile() && isPluginFile(e.name)) {
      entryPath = path.join(dir, e.name);
    } else if (e.isDirectory()) {
      const idx = await findEntry(path.join(dir, e.name));
      if (idx) {
        entryPath = idx;
        pluginDir = path.join(dir, e.name);
      }
    }
    if (!entryPath) continue;

    try {
      // Windows ESM：动态 import 必须 file:// URL；?v= 用于绕过模块缓存（reload 生效）
      const mod = await import(pathToFileURL(entryPath).href + `?v=${stamp}`);
      const plugin = validatePlugin(mod);
      if (!plugin) {
        console.warn(`[SourcePlugins] 跳过 ${entryPath}：未导出合法插件（需 default export { id, name, parse }）`);
        continue;
      }
      if (out.has(plugin.id)) {
        console.warn(`[SourcePlugins] 跳过 ${entryPath}：插件 id "${plugin.id}" 已存在`);
        continue;
      }
      out.set(plugin.id, { plugin, installedFrom: source, filePath: entryPath, dir: pluginDir });
    } catch (err) {
      console.warn(`[SourcePlugins] 加载 ${entryPath} 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * 扫描两个目录（内置 + 运行时上传）并加载所有合法插件。
 * - 目录不存在 → 跳过（视为该来源 0 插件）
 * - 单个插件加载/校验失败 → 跳过并告警，不影响其他插件与服务启动
 * - id 冲突 → 保留先注册者（内置优先于上传）并告警
 */
export async function loadPlugins(): Promise<Map<string, LoadedPlugin>> {
  const out = new Map<string, LoadedPlugin>();
  const stamp = Date.now();
  await scanDir(BUILTIN_DIR, 'builtin', stamp, out);
  await scanDir(RUNTIME_DIR, 'upload', stamp, out);
  return out;
}
