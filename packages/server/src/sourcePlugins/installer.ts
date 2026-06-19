import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import AdmZip from 'adm-zip';
import { AppError } from '../middleware/errorHandler.js';
import { RUNTIME_DIR, validatePlugin, type LoadedPlugin } from './loader.js';

/** zip 安全限制（参照 backupService） */
const MAX_ENTRIES = 2000;
const MAX_UNCOMPRESSED = 50 * 1024 * 1024; // 50MB
const ENTRY_NAMES = ['index.js', 'index.mjs', 'index.cjs'];

function ensureRuntimeDir(): void {
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

/** id 仅允许字母/数字/-/_，防止作为文件名时路径穿越 */
function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new AppError(`插件 id "${id}" 含非法字符（仅允许字母、数字、- 和 _）`, 400);
  }
  return id;
}

function rmrf(target: string): void {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** 动态 import 文件，校验并返回插件 id */
async function resolvePluginId(entryFile: string): Promise<string> {
  const mod = await import(pathToFileURL(entryFile).href + `?v=${Date.now()}`);
  const plugin = validatePlugin(mod);
  if (!plugin) {
    throw new AppError('插件文件未导出合法插件（需 default export { id, name, parse }）', 400);
  }
  return plugin.id;
}

/** 安全解压 zip 到目标目录（zip-bomb + 路径穿越防护） */
function extractZipSafe(zipPath: string, destDir: string): void {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    throw new AppError('无法解析 ZIP 文件，请确认文件格式正确', 400);
  }
  const entries = zip.getEntries();
  if (entries.length > MAX_ENTRIES) {
    throw new AppError('ZIP 包含过多条目，疑似异常文件', 400);
  }
  let total = 0;
  for (const e of entries) {
    total += e.header.size;
    if (total > MAX_UNCOMPRESSED) {
      throw new AppError('ZIP 解压体积过大，疑似异常文件', 400);
    }
  }
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of entries) {
    if (e.isDirectory) continue;
    const targetPath = path.join(destDir, e.entryName);
    const rel = path.relative(destDir, targetPath);
    // rel 不得以 '..' 开头、不得包含段级 '..'、不得为绝对路径
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('..')) {
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, e.getData());
  }
}

/** 在目录（含单层子目录）中查找入口 index.js */
function findIndexEntry(dir: string): string | null {
  for (const name of ENTRY_NAMES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  // 兼容 zip 内多包了一层目录的情况
  const children = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  if (children.length === 1) {
    const sub = path.join(dir, children[0]!.name);
    for (const name of ENTRY_NAMES) {
      const p = path.join(sub, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * 安装上传的插件文件到运行时目录。先落到 `_` 前缀的 staging（loader 不扫描），
 * 动态 import 校验并解析出插件 id，检测冲突后再正式命名落地。
 *
 * @param existingIds 当前已加载的全部插件 id（用于冲突检测）
 * @returns 安装成功的插件 id
 */
export async function installPlugin(
  tmpPath: string,
  originalName: string,
  existingIds: Set<string>,
): Promise<string> {
  ensureRuntimeDir();
  const ext = path.extname(originalName).toLowerCase();
  const uid = crypto.randomBytes(8).toString('hex');

  if (ext === '.js' || ext === '.mjs') {
    const staging = path.join(RUNTIME_DIR, `_pending-${uid}${ext}`);
    fs.copyFileSync(tmpPath, staging);
    try {
      const id = await resolvePluginId(staging);
      if (existingIds.has(id)) {
        throw new AppError(`插件 "${id}" 已存在，请先删除同 id 插件`, 409);
      }
      const dest = path.join(RUNTIME_DIR, `${safeId(id)}${ext}`);
      if (fs.existsSync(dest)) {
        throw new AppError(`插件 "${id}" 已存在`, 409);
      }
      fs.renameSync(staging, dest);
      return id;
    } catch (err) {
      rmrf(staging);
      throw err;
    }
  }

  if (ext === '.zip') {
    const stagingDir = path.join(RUNTIME_DIR, `_pending-${uid}`);
    try {
      extractZipSafe(tmpPath, stagingDir);
      const entry = findIndexEntry(stagingDir);
      if (!entry) {
        throw new AppError('ZIP 内未找到 index.js 入口文件', 400);
      }
      const id = await resolvePluginId(entry);
      if (existingIds.has(id)) {
        throw new AppError(`插件 "${id}" 已存在，请先删除同 id 插件`, 409);
      }
      const dest = path.join(RUNTIME_DIR, safeId(id));
      if (fs.existsSync(dest)) {
        throw new AppError(`插件 "${id}" 已存在`, 409);
      }
      const entryDir = path.dirname(entry);
      fs.renameSync(entryDir, dest);
      if (entryDir !== stagingDir) rmrf(stagingDir); // 清理外层残壳
      return id;
    } catch (err) {
      rmrf(stagingDir);
      throw err;
    }
  }

  throw new AppError('仅支持 .js 或 .zip 插件文件', 400);
}

/** 卸载上传的插件（删除其文件/目录）；仅允许删除 RUNTIME_DIR 内、来源为 upload 的插件 */
export function uninstallPlugin(loaded: LoadedPlugin): void {
  if (loaded.installedFrom !== 'upload') {
    throw new AppError('内置插件不可在后台删除，请从源码目录移除', 400);
  }
  const target = loaded.dir ?? loaded.filePath;
  const rel = path.relative(RUNTIME_DIR, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new AppError('不允许删除该路径', 400);
  }
  rmrf(target);
}
