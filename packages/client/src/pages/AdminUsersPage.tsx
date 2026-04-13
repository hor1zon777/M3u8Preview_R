import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, Heart, ListVideo, Clock } from 'lucide-react';
import { adminApi } from '../services/adminApi.js';

export function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  // H2: 搜索变化时重置分页
  useEffect(() => {
    setPage(1);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', page, search],
    queryFn: () => adminApi.getUsers(page, 20, search || undefined),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.updateUser(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3"><Users className="w-6 h-6 text-emby-text-secondary" /><h1 className="text-2xl font-bold text-white">用户管理</h1></div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索用户名..."
          className="px-4 py-2 bg-emby-bg-input border border-emby-border rounded-lg text-white text-sm placeholder-emby-text-muted focus:outline-none focus:ring-2 focus:ring-emby-green w-64"
        />
      </div>

      <div className="bg-emby-bg-card border border-emby-border-subtle rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-emby-border-subtle">
              <th className="px-4 py-3 text-left text-emby-text-secondary font-medium">用户名</th>
              <th className="px-4 py-3 text-left text-emby-text-secondary font-medium">角色</th>
              <th className="px-4 py-3 text-left text-emby-text-secondary font-medium">状态</th>
              <th className="px-4 py-3 text-left text-emby-text-secondary font-medium">统计</th>
              <th className="px-4 py-3 text-left text-emby-text-secondary font-medium">注册时间</th>
              <th className="px-4 py-3 text-left text-emby-text-secondary font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-emby-border-subtle/50">
                  <td colSpan={6} className="px-4 py-3"><div className="h-5 bg-emby-bg-input rounded animate-pulse" /></td>
                </tr>
              ))
            ) : data?.items?.map((user: any) => (
              <tr key={user.id} className="border-b border-emby-border-subtle/50 hover:bg-emby-bg-input/30">
                <td className="px-4 py-3 text-white font-medium">{user.username}</td>
                <td className="px-4 py-3">
                  <select
                    value={user.role}
                    onChange={e => updateMutation.mutate({ id: user.id, payload: { role: e.target.value } })}
                    className="bg-emby-bg-input text-white text-xs px-2 py-1 rounded border border-emby-border"
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => updateMutation.mutate({ id: user.id, payload: { isActive: !user.isActive } })}
                    className={`px-2 py-0.5 rounded text-xs ${user.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
                  >
                    {user.isActive ? '活跃' : '禁用'}
                  </button>
                </td>
                <td className="px-4 py-3 text-emby-text-muted text-xs">
                  <span className="inline-flex items-center gap-0.5"><Heart className="w-3 h-3" />{user._count?.favorites || 0}</span>{' '}
                  <span className="inline-flex items-center gap-0.5"><ListVideo className="w-3 h-3" />{user._count?.playlists || 0}</span>{' '}
                  <span className="inline-flex items-center gap-0.5"><Clock className="w-3 h-3" />{user._count?.watchHistory || 0}</span>
                </td>
                <td className="px-4 py-3 text-emby-text-muted text-xs">
                  {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                </td>
                <td className="px-4 py-3">
                  {user.role !== 'ADMIN' && (
                    <button
                      onClick={() => {
                        if (confirm(`确定要删除用户 ${user.username} 吗？`)) {
                          deleteMutation.mutate(user.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
                    >
                      删除
                    </button>
                  )}
                  <Link
                    to={`/admin/users/${user.id}`}
                    className="text-emby-green hover:text-emby-green/80 text-xs ml-2"
                  >
                    详情
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-4 py-2 bg-emby-bg-input text-white rounded-lg disabled:opacity-50 hover:bg-emby-bg-elevated text-sm">上一页</button>
          <span className="text-emby-text-secondary text-sm">{page} / {data.totalPages}</span>
          <button onClick={() => setPage(Math.min(data.totalPages, page + 1))} disabled={page === data.totalPages} className="px-4 py-2 bg-emby-bg-input text-white rounded-lg disabled:opacity-50 hover:bg-emby-bg-elevated text-sm">下一页</button>
        </div>
      )}
    </div>
  );
}
