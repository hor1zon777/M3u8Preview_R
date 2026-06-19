import api from './api.js';
import type { ApiResponse, SourcePluginInfo, SourcePluginAdminInfo } from '@m3u8-preview/shared';

/** 测试解析单条结果 */
export interface PluginParseEntry {
  originalUrl: string;
  ok: boolean;
  result?: { m3u8Url: string; title?: string; author?: string; meta: string };
  error?: string;
}

type PluginConfigValues = Record<string, string | number | boolean>;

export const sourcePluginApi = {
  /** 公开：获取已启用的解析插件列表（导入页/详情页用）。带 no-cache 确保启用后立即可见 */
  async listPlugins() {
    const { data } = await api.get<ApiResponse<SourcePluginInfo[]>>('/source-plugins', {
      headers: { 'Cache-Control': 'no-cache' },
    });
    return data.data!;
  },

  /** 管理：获取全部插件（含启用状态、配置、配置项声明）。带 no-cache 防止取到陈旧列表 */
  async listAll() {
    const { data } = await api.get<ApiResponse<SourcePluginAdminInfo[]>>('/source-plugins/admin', {
      headers: { 'Cache-Control': 'no-cache' },
    });
    return data.data!;
  },

  /** 启用 / 禁用插件 */
  async toggle(id: string, enabled: boolean) {
    await api.patch(`/source-plugins/admin/${encodeURIComponent(id)}/enabled`, { enabled });
  },

  /** 更新插件配置 */
  async updateConfig(id: string, config: PluginConfigValues) {
    await api.put(`/source-plugins/admin/${encodeURIComponent(id)}/config`, { config });
  },

  /** 上传安装插件（.js / .zip）；不手动设 Content-Type，交由浏览器附带 multipart boundary */
  async install(file: File) {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<ApiResponse<SourcePluginAdminInfo>>('/source-plugins/admin/install', form);
    return data.data!;
  },

  /** 卸载插件（仅上传来源可删） */
  async uninstall(id: string) {
    await api.delete(`/source-plugins/admin/${encodeURIComponent(id)}`);
  },

  /** 测试解析：传入原始链接列表，返回每条解析结果 */
  async testParse(urls: string[], pluginId?: string) {
    const { data } = await api.post<ApiResponse<PluginParseEntry[]>>('/source-plugins/parse', { urls, pluginId });
    return data.data!;
  },
};
