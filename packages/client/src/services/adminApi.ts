import api from './api.js';
import type { ApiResponse, DashboardStats, PaginatedResponse, RestoreResult, BatchOperationResult, LoginRecord, UserActivitySummary, UserActivityAggregate, WatchHistory } from '@m3u8-preview/shared';

export const adminApi = {
  async getDashboard() {
    const { data } = await api.get<ApiResponse<DashboardStats>>('/admin/dashboard');
    return data.data!;
  },

  async getUsers(page: number = 1, limit: number = 20, search?: string) {
    const { data } = await api.get<ApiResponse<PaginatedResponse<any>>>('/admin/users', {
      params: { page, limit, search },
    });
    return data.data!;
  },

  async updateUser(id: string, payload: { role?: string; isActive?: boolean }) {
    const { data } = await api.put<ApiResponse<any>>(`/admin/users/${id}`, payload);
    return data.data!;
  },

  async deleteUser(id: string) {
    await api.delete(`/admin/users/${id}`);
  },

  async getSettings() {
    const { data } = await api.get<ApiResponse<Array<{ key: string; value: string }>>>('/admin/settings');
    return data.data!;
  },

  async updateSetting(key: string, value: string) {
    await api.put('/admin/settings', { key, value });
  },

  async exportBackup(options?: { includePosters?: boolean }) {
    const params = new URLSearchParams();
    if (options?.includePosters === false) {
      params.set('includePosters', 'false');
    }
    const query = params.toString();
    const url = `/admin/backup/export${query ? `?${query}` : ''}`;

    const response = await api.get(url, {
      responseType: 'blob',
      timeout: 300000,
    });
    const blob = response.data as Blob;

    // 从 Content-Disposition 提取文件名
    const disposition = response.headers['content-disposition'];
    const match = disposition?.match(/filename="?([^";\n]+)"?/);
    const filename = match?.[1] || `backup-${new Date().toISOString().slice(0, 19)}.zip`;

    // 创建临时 <a> 标签触发下载
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  },

  async importBackup(file: File): Promise<RestoreResult> {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post<ApiResponse<RestoreResult>>('/admin/backup/import', formData, {
      timeout: 300000,
    });
    return data.data!;
  },

  async batchDeleteMedia(ids: string[]): Promise<BatchOperationResult> {
    const { data } = await api.post<ApiResponse<BatchOperationResult>>('/admin/media/batch-delete', { ids });
    return data.data!;
  },

  async batchUpdateMediaStatus(ids: string[], status: 'ACTIVE' | 'INACTIVE'): Promise<BatchOperationResult> {
    const { data } = await api.put<ApiResponse<BatchOperationResult>>('/admin/media/batch-status', { ids, status });
    return data.data!;
  },

  async batchUpdateMediaCategory(ids: string[], categoryId: string | null): Promise<BatchOperationResult> {
    const { data } = await api.put<ApiResponse<BatchOperationResult>>('/admin/media/batch-category', { ids, categoryId });
    return data.data!;
  },

  // ─── 封面管理 ─────────────────────────────────────

  async getPosterStats(): Promise<{ total: number; external: number; local: number; missing: number; totalSizeBytes: number }> {
    const { data } = await api.get<ApiResponse<{ total: number; external: number; local: number; missing: number; totalSizeBytes: number }>>('/admin/posters/stats');
    return data.data!;
  },

  async migratePosterImages(): Promise<{ enqueuedCount: number }> {
    const { data } = await api.post<ApiResponse<{ enqueuedCount: number }>>('/admin/posters/migrate');
    return data.data!;
  },

  async getPosterMigrationStatus() {
    const { data } = await api.get<ApiResponse<{
      pending: number;
      active: number;
      completed: number;
      failed: number;
      skipped: number;
      total: number;
      concurrency: number;
      running: boolean;
    }>>('/admin/posters/status');
    return data.data!;
  },

  async retryFailedPosters(): Promise<{ enqueuedCount: number }> {
    const { data } = await api.post<ApiResponse<{ enqueuedCount: number }>>('/admin/posters/retry');
    return data.data!;
  },

  // ─── 用户行为记录 ─────────────────────────────────────

  async getUserLoginRecords(userId: string, page: number = 1, limit: number = 20) {
    const { data } = await api.get<ApiResponse<PaginatedResponse<LoginRecord>>>(
      `/admin/users/${userId}/login-records`,
      { params: { page, limit } },
    );
    return data.data!;
  },

  async getUserWatchHistory(userId: string, page: number = 1, limit: number = 20) {
    const { data } = await api.get<ApiResponse<PaginatedResponse<WatchHistory>>>(
      `/admin/users/${userId}/watch-history`,
      { params: { page, limit } },
    );
    return data.data!;
  },

  async getUserActivitySummary(userId: string) {
    const { data } = await api.get<ApiResponse<UserActivitySummary>>(
      `/admin/users/${userId}/activity-summary`,
    );
    return data.data!;
  },

  async getActivityAggregate() {
    const { data } = await api.get<ApiResponse<UserActivityAggregate>>('/admin/activity');
    return data.data!;
  },
};
