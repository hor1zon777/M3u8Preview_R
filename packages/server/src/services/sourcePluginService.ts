/**
 * 动态解析源插件服务门面。
 *
 * 实际实现已迁移到 src/sourcePlugins/（代码模块加载 + 数据库状态层）。本文件保留为薄门面，
 * 委托 sourcePluginRegistry，使既有消费者（mediaService / importService /
 * sourcePluginController）的 import 保持稳定。
 *
 * 插件不内置：开发者把插件放入 src/plugins/（随构建），或管理员在后台上传到运行时目录，
 * 再在「插件管理」中启用并配置即可生效，详见 src/plugins/README.md。
 */
import { sourcePluginRegistry } from '../sourcePlugins/index.js';
import type { ParsedSource, BatchParseEntry } from '../sourcePlugins/index.js';

export type { ParsedSource, BatchParseEntry };

type PluginConfigValues = Record<string, string | number | boolean>;

export const sourcePluginService = {
  /** 公开：列出已启用插件 */
  listPlugins: () => sourcePluginRegistry.listEnabled(),
  /** 管理：列出全部插件（含状态、配置、配置项声明） */
  listAll: () => sourcePluginRegistry.listAll(),
  /** 启用 / 禁用插件 */
  setEnabled: (id: string, enabled: boolean) => sourcePluginRegistry.setEnabled(id, enabled),
  /** 更新插件配置 */
  updateConfig: (id: string, config: PluginConfigValues) => sourcePluginRegistry.updateConfig(id, config),
  /** 安装上传的插件文件 */
  install: (tmpPath: string, originalName: string) => sourcePluginRegistry.install(tmpPath, originalName),
  /** 卸载插件（仅上传来源） */
  uninstall: (id: string) => sourcePluginRegistry.uninstall(id),
  /** 解析单个原始链接 */
  parseOne: (pluginId: string | undefined, originalUrl: string) =>
    sourcePluginRegistry.parseOne(pluginId, originalUrl),
  /** 批量解析原始链接 */
  parseBatch: (pluginId: string | undefined, urls: string[]) =>
    sourcePluginRegistry.parseBatch(pluginId, urls),
  /** 取插件默认套用的分类/标签及解析到的真实插件 id */
  getPluginDefaults: (pluginId?: string) => sourcePluginRegistry.getPluginDefaults(pluginId),
};
