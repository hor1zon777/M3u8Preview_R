import api from './api.js';
import type { ApiResponse, SourcePluginInfo } from '@m3u8-preview/shared';

export const sourcePluginApi = {
  /** 获取可用的动态解析插件列表 */
  async listPlugins() {
    const { data } = await api.get<ApiResponse<SourcePluginInfo[]>>('/source-plugins');
    return data.data!;
  },
};
