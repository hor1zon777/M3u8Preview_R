import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Archive, Download, Upload, AlertTriangle, CheckCircle } from 'lucide-react';
import { adminApi } from '../../services/adminApi.js';
import type { RestoreResult } from '@m3u8-preview/shared';

export function BackupSection() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [includePosters, setIncludePosters] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportMutation = useMutation({
    mutationFn: () => adminApi.exportBackup({ includePosters }),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => adminApi.importBackup(file),
    onSuccess: (result) => {
      setRestoreResult(result);
      setSelectedFile(null);
      setShowConfirm(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    onError: () => {
      setShowConfirm(false);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    setRestoreResult(null);
  };

  const handleRestore = () => {
    if (!selectedFile) return;
    importMutation.mutate(selectedFile);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="bg-emby-bg-card border border-emby-border-subtle rounded-md p-5">
      <div className="flex items-center gap-2 mb-4">
        <Archive className="w-5 h-5 text-emby-text-secondary" />
        <h3 className="text-white font-semibold">数据备份与恢复</h3>
      </div>

      {/* 导出备份 */}
      <div>
        <p className="text-white text-sm">导出备份</p>
        <p className="text-emby-text-muted text-xs mt-0.5">
          将所有数据和上传文件打包为 ZIP 备份文件
        </p>
        <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includePosters}
            onChange={(e) => setIncludePosters(e.target.checked)}
            className="w-4 h-4 rounded border-emby-border-subtle bg-emby-bg-input text-emby-green focus:ring-emby-green focus:ring-offset-0"
          />
          <span className="text-emby-text-secondary text-sm">包含封面图片</span>
          <span className="text-emby-text-muted text-xs">（不勾选可显著减小备份体积）</span>
        </label>
        <button
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-emby-green hover:bg-emby-green-light text-white text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          {exportMutation.isPending ? '正在打包备份...' : '下载备份文件'}
        </button>
        {exportMutation.isError && (
          <p className="text-red-400 text-xs mt-2">
            导出失败: {(exportMutation.error as Error)?.message || '未知错误'}
          </p>
        )}
      </div>

      <div className="border-t border-emby-border-subtle my-5" />

      {/* 恢复备份 */}
      <div>
        <p className="text-white text-sm">恢复备份</p>
        <p className="text-emby-text-muted text-xs mt-0.5">
          上传 ZIP 备份文件恢复所有数据（将覆盖当前数据）
        </p>

        <div className="mt-3 flex items-center gap-3">
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-emby-bg-input hover:bg-emby-border-subtle text-emby-text-secondary text-sm font-medium rounded transition-colors cursor-pointer">
            <Upload className="w-4 h-4" />
            选择备份文件
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
          {selectedFile && (
            <span className="text-emby-text-muted text-xs">
              已选: {selectedFile.name} ({formatFileSize(selectedFile.size)})
            </span>
          )}
        </div>

        {selectedFile && !showConfirm && (
          <button
            onClick={() => setShowConfirm(true)}
            disabled={importMutation.isPending}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            开始恢复
          </button>
        )}

        {/* 确认警告框 */}
        {showConfirm && (
          <div className="mt-3 p-4 bg-amber-900/30 border border-amber-700/50 rounded">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-200 text-sm font-medium">
                  此操作将清空所有数据并替换为备份内容，不可撤销！
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setShowConfirm(false)}
                    disabled={importMutation.isPending}
                    className="px-3 py-1.5 bg-emby-bg-input hover:bg-emby-border-subtle text-emby-text-secondary text-sm rounded transition-colors disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleRestore}
                    disabled={importMutation.isPending}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
                  >
                    {importMutation.isPending ? '正在恢复...' : '确认恢复'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 导入错误 */}
        {importMutation.isError && (
          <div className="mt-3 p-3 bg-red-900/30 border border-red-700/50 rounded">
            <p className="text-red-400 text-sm">
              恢复失败: {(importMutation.error as any)?.response?.data?.message || (importMutation.error as Error)?.message || '未知错误'}
            </p>
          </div>
        )}

        {/* 恢复结果 */}
        {restoreResult && (
          <div className="mt-3 p-4 bg-green-900/30 border border-green-700/50 rounded">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <p className="text-green-200 text-sm font-medium">恢复完成</p>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-3 text-xs text-emby-text-muted">
              <div>
                <span className="text-white font-medium">{restoreResult.tablesRestored}</span> 张表
              </div>
              <div>
                <span className="text-white font-medium">{restoreResult.totalRecords.toLocaleString()}</span> 条记录
              </div>
              <div>
                <span className="text-white font-medium">{restoreResult.uploadsRestored}</span> 个文件
              </div>
              <div>
                耗时 <span className="text-white font-medium">{restoreResult.duration}</span>s
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
