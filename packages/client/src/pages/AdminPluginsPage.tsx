import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Puzzle, Plug, CheckCircle2, XCircle } from 'lucide-react';
import { sourcePluginApi } from '../services/sourcePluginApi.js';

export function AdminPluginsPage() {
  const [selectedPlugin, setSelectedPlugin] = useState('');
  const [urlsText, setUrlsText] = useState('');

  const { data: plugins, isLoading } = useQuery({
    queryKey: ['sourcePlugins'],
    queryFn: () => sourcePluginApi.listPlugins(),
  });

  const testMutation = useMutation({
    mutationFn: () => {
      const urls = urlsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (urls.length === 0) throw new Error('请粘贴至少一个原始链接');
      return sourcePluginApi.testParse(urls, selectedPlugin || undefined);
    },
  });

  const results = testMutation.data;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Puzzle className="w-6 h-6 text-emby-text-secondary" />
        <div>
          <h1 className="text-2xl font-bold text-white">插件管理</h1>
          <p className="text-sm text-emby-text-muted mt-0.5">管理动态解析源插件，测试链接解析能力</p>
        </div>
      </div>

      {/* 插件列表 */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-28 bg-emby-bg-input rounded-lg animate-pulse" />
          ))}
        </div>
      ) : plugins && plugins.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plugins.map((p) => (
            <div key={p.id} className="bg-emby-bg-card border border-emby-border-subtle rounded-lg p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Plug className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">{p.name}</h3>
                    <p className="text-xs text-emby-text-muted mt-0.5 font-mono">{p.id}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-400 border border-green-500/30">
                  <CheckCircle2 className="w-3 h-3" /> 已启用
                </span>
              </div>
              {p.description && <p className="text-sm text-emby-text-secondary mt-3">{p.description}</p>}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-emby-bg-card border border-emby-border-subtle rounded-lg p-8 text-center text-emby-text-muted text-sm">
          暂无可用插件
        </div>
      )}

      {/* 测试解析 */}
      <div className="bg-emby-bg-card border border-emby-border-subtle rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-white font-semibold">测试解析</h3>
          <p className="text-sm text-emby-text-muted mt-0.5">粘贴原始帖子链接（每行一个），验证插件能否解析出可播放地址</p>
        </div>

        {plugins && plugins.length > 1 && (
          <select
            value={selectedPlugin}
            onChange={(e) => setSelectedPlugin(e.target.value)}
            className="px-3 py-2 bg-emby-bg-input border border-emby-border rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emby-green"
          >
            <option value="">默认插件</option>
            {plugins.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        <textarea
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          rows={5}
          placeholder={'https://hj260202ffb.top/post/details/123456'}
          className="w-full px-4 py-3 bg-emby-bg-input border border-emby-border rounded-lg text-white placeholder-emby-text-muted text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emby-green resize-y"
        />

        <button
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending || !urlsText.trim()}
          className="px-6 py-2 bg-emby-green text-white rounded-lg hover:bg-emby-green-dark disabled:opacity-50 text-sm"
        >
          {testMutation.isPending ? '解析中...' : '测试解析'}
        </button>

        {testMutation.isError && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-md text-sm">
            {(testMutation.error as Error).message}
          </div>
        )}

        {results && results.length > 0 && (
          <div className="border border-emby-border-subtle rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-emby-border-subtle">
                  <th className="px-4 py-3 text-left text-emby-text-secondary font-medium">原始链接</th>
                  <th className="px-4 py-3 text-left text-emby-text-secondary font-medium">状态</th>
                  <th className="px-4 py-3 text-left text-emby-text-secondary font-medium">解析结果</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-emby-border-subtle/50">
                    <td className="px-4 py-2 text-emby-text-secondary max-w-xs truncate">{r.originalUrl}</td>
                    <td className="px-4 py-2">
                      {r.ok ? (
                        <span className="inline-flex items-center gap-1 text-green-400 text-xs"><CheckCircle2 className="w-3.5 h-3.5" /> 成功</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-400 text-xs"><XCircle className="w-3.5 h-3.5" /> 失败</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-emby-text-secondary max-w-md truncate">
                      {r.ok ? (r.result?.m3u8Url || '-') : (r.error || '解析失败')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
