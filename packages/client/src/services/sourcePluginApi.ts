import api from './api.js';
import type { ApiResponse, SourcePluginInfo } from '@m3u8-preview/shared';

/** 测试解析单条结果 */
export interface PluginParseEntry {
  originalUrl: string;
  ok: boolean;
  result?: { m3u8Url: string; title?: string; author?: string; meta: string };
  error?: string;
}

export const sourcePluginApi = {
  /** 获取可用的动态解析插件列表 */
  async listPlugins() {
    const { data } = await api.get<ApiResponse<SourcePluginInfo[]>>('/source-plugins');
    return data.data!;
  },

  /** 测试解析：传入原始链接列表，返回每条解析结果 */
  async testParse(urls: string[], pluginId?: string) {
    const { data } = await api.post<ApiResponse<PluginParseEntry[]>>('/source-plugins/parse', { urls, pluginId });
    return data.data!;
  },
};
