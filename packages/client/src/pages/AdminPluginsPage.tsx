import { useState, useRef, type DragEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Puzzle, Upload, Settings, Trash2, Info, FileCode2, Loader2, ChevronLeft, CheckCircle2, XCircle } from 'lucide-react';
import { sourcePluginApi } from '../services/sourcePluginApi.js';
import type { SourcePluginAdminInfo } from '@m3u8-preview/shared';

type ConfigValues = Record<string, string | number | boolean>;

/** 取插件首字（用于卡片图标占位） */
function initial(p: SourcePluginAdminInfo): string {
  const s = (p.name || p.id).trim();
  return s ? Array.from(s)[0]!.toUpperCase() : '?';
}

/** emby 风格插件卡片 */
function PluginCard({
  plugin,
  onOpen,
  onToggle,
  onDelete,
  toggling,
  deleting,
}: {
  plugin: SourcePluginAdminInfo;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
  toggling: boolean;
  deleting: boolean;
}) {
  return (
    <div className="group bg-emby-bg-card border border-emby-border-subtle rounded-lg overflow-hidden hover:border-emby-green/50 transition-colors flex flex-col">
      {/* 图标区 */}
      <button
        onClick={onOpen}
        className="relative aspect-[16/9] w-full bg-gradient-to-br from-blue-500/20 via-emby-bg-elevated to-purple-500/20 flex items-center justify-center"
        title="打开配置"
      >
        <div className="w-16 h-16 rounded-2xl bg-emby-bg-card/70 border border-white/10 flex items-center justify-center">
          <span className="text-2xl font-bold text-white">{initial(plugin)}</span>
        </div>
        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] bg-black/40 text-emby-text-secondary border border-white/10">
          {plugin.installedFrom === 'upload' ? '上传' : '内置'}
        </span>
      </button>

      {/* 信息区 */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <button onClick={onOpen} className="min-w-0 text-left">
            <h3 className="text-white font-semibold truncate hover:text-emby-green-light transition-colors">{plugin.name}</h3>
            <p className="text-xs text-emby-text-muted font-mono truncate">{plugin.id}</p>
          </button>
          {/* 启用开关 */}
          <button
            onClick={onToggle}
            disabled={toggling}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${plugin.enabled ? 'bg-emby-green' : 'bg-emby-bg-input'}`}
            title={plugin.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${plugin.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-flex items-center gap-1 ${plugin.enabled ? 'text-green-400' : 'text-emby-text-muted'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${plugin.enabled ? 'bg-green-400' : 'bg-emby-text-muted'}`} />
            {plugin.enabled ? '已启用' : '已禁用'}
          </span>
          {plugin.version && <span className="text-emby-text-muted">v{plugin.version}</span>}
          {plugin.author && <span className="text-emby-text-muted truncate">by {plugin.author}</span>}
        </div>

        {plugin.description && <p className="text-sm text-emby-text-secondary line-clamp-2">{plugin.description}</p>}

        <div className="flex items-center gap-2 mt-auto pt-1">
          <button
            onClick={onOpen}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emby-bg-input text-emby-text-primary rounded-lg hover:bg-emby-bg-elevated text-xs"
          >
            <Settings className="w-3.5 h-3.5" /> 设置
          </button>
          {plugin.installedFrom === 'upload' && (
            <button
              onClick={onDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 disabled:opacity-50 text-xs"
            >
              <Trash2 className="w-3.5 h-3.5" /> 卸载
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 独立配置页（替代弹窗）：插件头部 + 启用 + 动态配置表单 + 该插件测试 */
function PluginDetailView({ plugin, onBack }: { plugin: SourcePluginAdminInfo; onBack: () => void }) {
  const qc = useQueryClient();
  const fields = plugin.configSchema ?? [];
  const [values, setValues] = useState<ConfigValues>(() => {
    const init: ConfigValues = {};
    for (const f of fields) {
      const current = plugin.config[f.key];
      init[f.key] = current !== undefined ? current : f.default !== undefined ? f.default : f.type === 'boolean' ? false : '';
    }
    return init;
  });
  const [urlsText, setUrlsText] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['sourcePlugins', 'admin'] });
    qc.invalidateQueries({ queryKey: ['sourcePlugins'] });
  };

  const toggleMutation = useMutation({
    mutationFn: () => sourcePluginApi.toggle(plugin.id, !plugin.enabled),
    onSuccess: invalidate,
  });
  const configMutation = useMutation({
    mutationFn: () => sourcePluginApi.updateConfig(plugin.id, values),
    onSuccess: invalidate,
  });
  const testMutation = useMutation({
    mutationFn: () => {
      const urls = urlsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (urls.length === 0) throw new Error('请粘贴至少一个原始链接');
      return sourcePluginApi.testParse(urls, plugin.id);
    },
  });
  const results = testMutation.data;

  return (
    <div className="space-y-6 max-w-3xl">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-emby-text-secondary hover:text-white transition-colors">
        <ChevronLeft className="w-4 h-4" /> 返回插件
      </button>

      {/* 头部 */}
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center flex-shrink-0">
          <span className="text-2xl font-bold text-white">{initial(plugin)}</span>
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">{plugin.name}</h1>
          <p className="text-xs text-emby-text-muted font-mono mt-0.5">
            {plugin.id}
            {plugin.version && ` · v${plugin.version}`}
            {plugin.author && ` · by ${plugin.author}`}
            {` · ${plugin.installedFrom === 'upload' ? '上传安装' : '内置'}`}
          </p>
          {plugin.description && <p className="text-sm text-emby-text-secondary mt-2">{plugin.description}</p>}
        </div>
      </div>

      {/* 启用状态 */}
      <div className="bg-emby-bg-card border border-emby-border-subtle rounded-lg p-5 flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-sm">启用此插件</h3>
          <p className="text-xs text-emby-text-muted mt-0.5">仅启用的插件可用于批量导入与刷新源</p>
        </div>
        <button
          onClick={() => toggleMutation.mutate()}
          disabled={toggleMutation.isPending}
          className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${plugin.enabled ? 'bg-emby-green' : 'bg-emby-bg-input'}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${plugin.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* 配置表单 */}
      <div className="bg-emby-bg-card border border-emby-border-subtle rounded-lg p-5 space-y-4">
        <h3 className="text-white font-semibold text-sm">配置</h3>
        {fields.length === 0 ? (
          <p className="text-sm text-emby-text-muted">该插件未声明可配置项。</p>
        ) : (
          <>
            {fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <label className="text-sm text-emby-text-secondary">
                  {field.label}
                  {field.required && <span className="text-red-400 ml-1">*</span>}
                </label>
                {field.type === 'boolean' ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!values[field.key]}
                      onChange={(e) => setValues({ ...values, [field.key]: e.target.checked })}
                      className="w-4 h-4 accent-emby-green"
                    />
                    <span className="text-sm text-emby-text-muted">启用</span>
                  </label>
                ) : field.type === 'textarea' ? (
                  <textarea
                    value={String(values[field.key] ?? '')}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    rows={3}
                    className="w-full px-3 py-2 bg-emby-bg-input border border-emby-border rounded-lg text-white text-sm placeholder-emby-text-muted focus:outline-none focus:ring-2 focus:ring-emby-green resize-y"
                  />
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'}
                    value={String(values[field.key] ?? '')}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [field.key]: field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                      })
                    }
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 bg-emby-bg-input border border-emby-border rounded-lg text-white text-sm placeholder-emby-text-muted focus:outline-none focus:ring-2 focus:ring-emby-green"
                  />
                )}
                {field.description && <p className="text-xs text-emby-text-muted">{field.description}</p>}
              </div>
            ))}
            {configMutation.isError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-2 rounded-md text-sm">
                {(configMutation.error as Error).message}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={() => configMutation.mutate()}
                disabled={configMutation.isPending}
                className="px-5 py-2 bg-emby-green text-white rounded-lg hover:bg-emby-green-dark disabled:opacity-50 text-sm"
              >
                {configMutation.isPending ? '保存中...' : '保存配置'}
              </button>
              {configMutation.isSuccess && !configMutation.isPending && (
                <span className="text-green-400 text-sm inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> 已保存</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* 测试解析 */}
      <div className="bg-emby-bg-card border border-emby-border-subtle rounded-lg p-5 space-y-3">
        <h3 className="text-white font-semibold text-sm">测试解析</h3>
        <p className="text-xs text-emby-text-muted">粘贴原始帖子链接（每行一个），验证该插件能否解析出可播放地址</p>
        <textarea
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          rows={4}
          placeholder={'https://example.com/post/details/123456'}
          className="w-full px-4 py-3 bg-emby-bg-input border border-emby-border rounded-lg text-white placeholder-emby-text-muted text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emby-green resize-y"
        />
        <button
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending || !urlsText.trim()}
          className="px-5 py-2 bg-emby-bg-input text-emby-text-primary rounded-lg hover:bg-emby-bg-elevated disabled:opacity-50 text-sm"
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

export function AdminPluginsPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: plugins, isLoading } = useQuery({
    queryKey: ['sourcePlugins', 'admin'],
    queryFn: () => sourcePluginApi.listAll(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['sourcePlugins', 'admin'] });
    qc.invalidateQueries({ queryKey: ['sourcePlugins'] });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => sourcePluginApi.toggle(id, enabled),
    onSuccess: invalidate,
  });
  const uninstallMutation = useMutation({
    mutationFn: (id: string) => sourcePluginApi.uninstall(id),
    onSuccess: invalidate,
  });
  const installMutation = useMutation({
    mutationFn: (file: File) => sourcePluginApi.install(file),
    onSuccess: (info) => {
      // 乐观写入缓存：安装成功立即在列表插入/替换该插件，不依赖 refetch 时机
      qc.setQueryData<SourcePluginAdminInfo[]>(['sourcePlugins', 'admin'], (old) => {
        const cur = old ?? [];
        return cur.some((p) => p.id === info.id)
          ? cur.map((p) => (p.id === info.id ? info : p))
          : [...cur, info];
      });
      invalidate();
      if (fileRef.current) fileRef.current.value = '';
    },
  });

  const list = plugins ?? [];
  const openPlugin = openId ? list.find((p) => p.id === openId) : undefined;

  const ACCEPT_EXT = ['.js', '.mjs', '.zip'];

  /** 统一的文件入口：扩展名校验通过后走安装；供 input/拖拽/点击共用 */
  function handleFile(file?: File | null) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!ACCEPT_EXT.some((ext) => lower.endsWith(ext))) {
      setDragError(`不支持的文件「${file.name}」，仅支持 .js / .mjs / .zip`);
      return;
    }
    setDragError(null);
    installMutation.mutate(file);
  }

  function handleFileChange() {
    handleFile(fileRef.current?.files?.[0]);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!installMutation.isPending && !isDragging) setIsDragging(true);
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }

  // ── 配置页（独立视图）──
  if (openPlugin) {
    return <PluginDetailView plugin={openPlugin} onBack={() => setOpenId(null)} />;
  }

  // ── 列表页 ──
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Puzzle className="w-6 h-6 text-emby-text-secondary" />
          <div>
            <h1 className="text-2xl font-bold text-white">我的插件</h1>
            <p className="text-sm text-emby-text-muted mt-0.5">管理已安装的解析插件，点击插件进入配置</p>
          </div>
        </div>
        <div>
          <input ref={fileRef} type="file" accept=".js,.mjs,.zip" className="hidden" onChange={handleFileChange} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={installMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emby-green text-white rounded-lg hover:bg-emby-green-dark disabled:opacity-50 text-sm"
          >
            {installMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {installMutation.isPending ? '安装中...' : '上传安装'}
          </button>
        </div>
      </div>

      {/* 拖拽 / 点击上传区 */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !installMutation.isPending && fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        className={`border-2 border-dashed rounded-lg p-8 transition-colors ${
          isDragging
            ? 'border-emby-green bg-emby-green/5'
            : 'border-emby-border hover:border-emby-green/50 bg-emby-bg-input/30'
        } ${installMutation.isPending ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}
      >
        <div className="flex flex-col items-center gap-2 text-center pointer-events-none">
          {installMutation.isPending ? (
            <Loader2 className="w-8 h-8 text-emby-green animate-spin" />
          ) : (
            <Upload className={`w-8 h-8 ${isDragging ? 'text-emby-green' : 'text-emby-text-muted'}`} />
          )}
          <p className="text-sm text-emby-text-secondary">
            {installMutation.isPending
              ? '安装中...'
              : isDragging
                ? '松开以上传插件'
                : '将插件文件拖到此处，或点击选择'}
          </p>
          <p className="text-xs text-emby-text-muted">支持 .js（ESM）/ .mjs / 含 index.js 的 .zip</p>
        </div>
      </div>

      {/* 前端文件类型校验失败 */}
      {dragError && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-md text-sm">
          {dragError}
        </div>
      )}

      {/* 安装反馈 */}
      {installMutation.isError && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-md text-sm">
          {(installMutation.error as Error).message}
        </div>
      )}
      {installMutation.isSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-md text-sm">
          已安装「{installMutation.data?.name}」，点击其卡片进入配置并启用。
        </div>
      )}
      {uninstallMutation.isError && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-md text-sm">
          {(uninstallMutation.error as Error).message}
        </div>
      )}

      {/* 插件网格 */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-60 bg-emby-bg-input rounded-lg animate-pulse" />
          ))}
        </div>
      ) : list.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((p) => (
            <PluginCard
              key={p.id}
              plugin={p}
              onOpen={() => setOpenId(p.id)}
              onToggle={() => toggleMutation.mutate({ id: p.id, enabled: !p.enabled })}
              onDelete={() => {
                if (window.confirm(`确定卸载插件「${p.name}」？此操作会移除其文件。`)) {
                  uninstallMutation.mutate(p.id);
                }
              }}
              toggling={toggleMutation.isPending}
              deleting={uninstallMutation.isPending}
            />
          ))}
        </div>
      ) : (
        /* 空状态 */
        <div className="bg-emby-bg-card border border-emby-border-subtle rounded-lg p-10">
          <div className="flex flex-col items-center text-center">
            <div className="p-3 bg-emby-bg-input rounded-full">
              <FileCode2 className="w-7 h-7 text-emby-text-muted" />
            </div>
            <h3 className="text-white font-semibold mt-4">还没有任何插件</h3>
            <p className="text-sm text-emby-text-muted mt-1 max-w-md">
              将 <code className="px-1.5 py-0.5 bg-emby-bg-input rounded font-mono text-xs">.js</code> / <code className="px-1.5 py-0.5 bg-emby-bg-input rounded font-mono text-xs">.zip</code> 插件包拖到上方区域或点击上传，或将插件文件放入服务端 <code className="px-1.5 py-0.5 bg-emby-bg-input rounded text-emby-green-light font-mono text-xs">src/plugins/</code> 后重启服务。
            </p>
          </div>
        </div>
      )}

      {/* 安全提示 */}
      <div className="flex items-start gap-2 text-xs text-emby-text-muted bg-emby-bg-input/40 border border-emby-border-subtle rounded-lg p-3">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>插件是被服务端直接执行的代码，请只安装可信文件。上传须为 .js（ESM）或含 index.js 的 .zip；解析请求默认不做 SSRF 拦截（解析服务通常位于内网）。</span>
      </div>
    </div>
  );
}
