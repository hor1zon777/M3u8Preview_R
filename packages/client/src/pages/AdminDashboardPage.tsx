import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Film, Users, FolderOpen, Play, Settings, Download, Shield, Activity } from 'lucide-react';
import { adminApi } from '../services/adminApi.js';
import { MediaThumbnail } from '../components/media/MediaThumbnail.js';
import { BackupSection } from '../components/admin/BackupSection.js';
import { PosterSection } from '../components/admin/PosterSection.js';

export function AdminDashboardPage() {
  const queryClient = useQueryClient();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => adminApi.getDashboard(),
  });

  const { data: settings } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => adminApi.getSettings(),
  });

  const updateSettingMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      adminApi.updateSetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: () => {
      setSettingError('设置更新失败，请重试');
      setTimeout(() => setSettingError(''), 3000);
    },
  });

  const [settingError, setSettingError] = useState('');
  const settingsLoaded = !!settings;
  const allowRegistration = settings?.find((s) => s.key === 'allowRegistration')?.value !== 'false';
  const enableRateLimit = settings?.find((s) => s.key === 'enableRateLimit')?.value !== 'false';

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-emby-bg-input rounded" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-emby-bg-input rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const statCards = [
    { label: '总媒体数', value: stats.totalMedia, icon: Film, color: 'text-blue-400' },
    { label: '总用户数', value: stats.totalUsers, icon: Users, color: 'text-green-400' },
    { label: '分类数', value: stats.totalCategories, icon: FolderOpen, color: 'text-purple-400' },
    { label: '总播放量', value: stats.totalViews, icon: Play, color: 'text-orange-400' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-emby-text-secondary" />
        <h1 className="text-2xl font-bold text-white">管理面板</h1>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="bg-emby-bg-card border border-emby-border-subtle rounded-md p-5">
            <div className="flex items-center justify-between">
              <card.icon className={`w-6 h-6 ${card.color}`} />
            </div>
            <p className="text-3xl font-bold text-white mt-3">{card.value.toLocaleString()}</p>
            <p className="text-sm text-emby-text-secondary mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Link
          to="/admin/users"
          className="bg-emby-bg-card border border-emby-border-subtle rounded-md p-5 hover:border-emby-border-light transition-colors group"
        >
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emby-text-secondary group-hover:text-emby-green-light" />
            <h3 className="text-white font-semibold group-hover:text-emby-green-light">用户管理</h3>
          </div>
          <p className="text-emby-text-muted text-sm mt-1">管理用户角色和状态</p>
        </Link>
        <Link
          to="/admin/activity"
          className="bg-emby-bg-card border border-emby-border-subtle rounded-md p-5 hover:border-emby-border-light transition-colors group"
        >
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emby-text-secondary group-hover:text-emby-green-light" />
            <h3 className="text-white font-semibold group-hover:text-emby-green-light">用户行为</h3>
          </div>
          <p className="text-emby-text-muted text-sm mt-1">查看登录记录、观看历史</p>
        </Link>
        <Link
          to="/admin/media"
          className="bg-emby-bg-card border border-emby-border-subtle rounded-md p-5 hover:border-emby-border-light transition-colors group"
        >
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5 text-emby-text-secondary group-hover:text-emby-green-light" />
            <h3 className="text-white font-semibold group-hover:text-emby-green-light">媒体管理</h3>
          </div>
          <p className="text-emby-text-muted text-sm mt-1">管理所有媒体内容</p>
        </Link>
        <Link
          to="/import"
          className="bg-emby-bg-card border border-emby-border-subtle rounded-md p-5 hover:border-emby-border-light transition-colors group"
        >
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-emby-text-secondary group-hover:text-emby-green-light" />
            <h3 className="text-white font-semibold group-hover:text-emby-green-light">批量导入</h3>
          </div>
          <p className="text-emby-text-muted text-sm mt-1">导入M3U8链接</p>
        </Link>
      </div>

      {/* System Settings */}
      <div className="bg-emby-bg-card border border-emby-border-subtle rounded-md p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-emby-text-secondary" />
          <h3 className="text-white font-semibold">系统设置</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-sm">允许新用户注册</p>
              <p className="text-emby-text-muted text-xs mt-0.5">关闭后新用户将无法注册账号</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={allowRegistration}
              disabled={updateSettingMutation.isPending || !settingsLoaded}
              onClick={() =>
                updateSettingMutation.mutate({
                  key: 'allowRegistration',
                  value: allowRegistration ? 'false' : 'true',
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emby-green focus:ring-offset-2 focus:ring-offset-emby-bg-card disabled:opacity-50 ${
                allowRegistration ? 'bg-emby-green' : 'bg-emby-bg-input'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  allowRegistration ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-sm">启用网站速率限制</p>
              <p className="text-emby-text-muted text-xs mt-0.5">
                关闭后将跳过全局、认证、代理、签名与播放量限流
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enableRateLimit}
              disabled={updateSettingMutation.isPending || !settingsLoaded}
              onClick={() =>
                updateSettingMutation.mutate({
                  key: 'enableRateLimit',
                  value: enableRateLimit ? 'false' : 'true',
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emby-green focus:ring-offset-2 focus:ring-offset-emby-bg-card disabled:opacity-50 ${
                enableRateLimit ? 'bg-emby-green' : 'bg-emby-bg-input'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  enableRateLimit ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
        {settingError && <p className="text-red-400 text-xs mt-2">{settingError}</p>}
      </div>

      {/* Poster Management */}
      <PosterSection />

      {/* Backup */}
      <BackupSection />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Media */}
        <div className="bg-emby-bg-card border border-emby-border-subtle rounded-md p-5">
          <h3 className="text-white font-semibold mb-4">最近添加</h3>
          <div className="space-y-3">
            {stats.recentMedia.map((media: any) => (
              <Link
                key={media.id}
                to={`/media/${media.id}`}
                className="flex items-center gap-3 text-sm group"
              >
                <div className="w-16 aspect-video bg-emby-bg-input rounded flex-shrink-0 overflow-hidden">
                  <MediaThumbnail
                    mediaId={media.id}
                    m3u8Url={media.m3u8Url}
                    posterUrl={media.posterUrl}
                    title={media.title}
                    iconSize="w-4 h-4"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-white truncate group-hover:text-emby-green-light">{media.title}</p>
                  <p className="text-emby-text-muted text-xs">{media.category?.name || '未分类'}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Top Media */}
        <div className="bg-emby-bg-card border border-emby-border-subtle rounded-md p-5">
          <h3 className="text-white font-semibold mb-4">热门内容</h3>
          <div className="space-y-3">
            {stats.topMedia.map((media: any, index: number) => (
              <Link
                key={media.id}
                to={`/media/${media.id}`}
                className="flex items-center gap-3 text-sm group"
              >
                <span className="text-emby-text-muted font-mono w-6 text-center">{index + 1}</span>
                <div className="w-16 aspect-video bg-emby-bg-input rounded flex-shrink-0 overflow-hidden">
                  <MediaThumbnail
                    mediaId={media.id}
                    m3u8Url={media.m3u8Url}
                    posterUrl={media.posterUrl}
                    title={media.title}
                    iconSize="w-4 h-4"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-white truncate group-hover:text-emby-green-light">{media.title}</p>
                </div>
                <span className="text-emby-text-muted text-xs flex-shrink-0">{media.views} 次</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}