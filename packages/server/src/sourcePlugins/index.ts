/**
 * 源解析插件系统对外入口。
 *
 * - initSourcePlugins：启动时扫描 plugins/ 与 plugins-data/ 目录加载插件（在 index.ts main() 调用）
 * - sourcePluginRegistry：运行时注册表（listEnabled / listAll / setEnabled / updateConfig /
 *   install / uninstall / parseOne / parseBatch / getPluginDefaults）
 *
 * 业务代码请通过 services/sourcePluginService.ts 门面间接使用，保持低耦合。
 */
export { initSourcePlugins, sourcePluginRegistry } from './registry.js';
export type { ParsedSource, BatchParseEntry, PluginDefaults } from './registry.js';
export type { SourceParserPlugin, PluginParseResult, PluginContext, PluginConfigField } from './types.js';
