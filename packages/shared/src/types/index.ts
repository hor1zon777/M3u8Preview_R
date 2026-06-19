// ========== Enums ==========
export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export enum MediaStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ERROR = 'ERROR',
}

export enum MediaSourceType {
  DIRECT_M3U8 = 'DIRECT_M3U8',
  PLUGIN = 'PLUGIN',
}

export enum ImportFormat {
  TEXT = 'TEXT',
  CSV = 'CSV',
  EXCEL = 'EXCEL',
  JSON = 'JSON',
  SOURCE_PLUGIN = 'SOURCE_PLUGIN',
}

export enum ImportStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

// ========== User ==========
export interface User {
  id: string;
  username: string;
  role: UserRole;
  avatar?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserWithStats extends User {
  _count?: {
    favorites: number;
    playlists: number;
    watchHistory: number;
  };
}

// ========== Auth ==========
export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface TokenPayload {
  userId: string;
  role: UserRole;
}

// ========== Media ==========
export interface Media {
  id: string;
  title: string;
  m3u8Url: string;
  sourceType: MediaSourceType | string;
  sourceOriginalUrl?: string | null;
  sourcePlugin?: string | null;
  sourceResolvedAt?: string | null;
  sourceLastError?: string | null;
  sourceMeta?: string | null;
  posterUrl?: string | null;
  description?: string | null;
  year?: number | null;
  rating?: number | null;
  duration?: number | null;
  artist?: string | null;
  views: number;
  status: MediaStatus;
  categoryId?: string | null;
  category?: Category | null;
  tags?: Tag[];
  createdAt: string;
  updatedAt: string;
}

export interface MediaCreateRequest {
  title: string;
  m3u8Url: string;
  sourceType?: MediaSourceType | string;
  sourceOriginalUrl?: string;
  sourcePlugin?: string;
  sourceResolvedAt?: string;
  sourceLastError?: string;
  sourceMeta?: string;
  posterUrl?: string;
  description?: string;
  year?: number;
  rating?: number;
  duration?: number;
  artist?: string;
  categoryId?: string;
  tagIds?: string[];
}

export interface MediaUpdateRequest extends Partial<MediaCreateRequest> {}

export interface MediaQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  tagId?: string;
  artist?: string;
  status?: MediaStatus;
  sortBy?: 'title' | 'createdAt' | 'year' | 'rating' | 'views';
  sortOrder?: 'asc' | 'desc';
}

// ========== Category ==========
export interface Category {
  id: string;
  name: string;
  slug: string;
  posterUrl?: string | null;
  _count?: {
    media: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CategoryCreateRequest {
  name: string;
  slug: string;
  posterUrl?: string;
}

// ========== Tag ==========
export interface Tag {
  id: string;
  name: string;
  _count?: {
    media: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TagCreateRequest {
  name: string;
}

// ========== Favorite ==========
export interface Favorite {
  id: string;
  userId: string;
  mediaId: string;
  media?: Media;
  createdAt: string;
}

// ========== Playlist ==========
export interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  posterUrl?: string | null;
  userId: string;
  isPublic: boolean;
  items?: PlaylistItem[];
  _count?: {
    items: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItem {
  id: string;
  playlistId: string;
  mediaId: string;
  position: number;
  media?: Media;
  createdAt: string;
}

export interface PlaylistCreateRequest {
  name: string;
  description?: string;
  posterUrl?: string;
  isPublic?: boolean;
}

export interface PlaylistUpdateRequest extends Partial<PlaylistCreateRequest> {}

// ========== Watch History ==========
export interface WatchHistory {
  id: string;
  userId: string;
  mediaId: string;
  progress: number;      // seconds watched
  duration: number;       // total duration in seconds
  percentage: number;     // 0-100
  completed: boolean;
  media?: Media;
  updatedAt: string;
}

export interface WatchProgressUpdate {
  mediaId: string;
  progress: number;
  duration: number;
}

// ========== Import ==========
export interface ImportItem {
  title: string;
  m3u8Url: string;
  sourceType?: MediaSourceType | string;
  sourceOriginalUrl?: string;
  sourcePlugin?: string;
  sourceResolvedAt?: string;
  sourceLastError?: string;
  sourceMeta?: string;
  posterUrl?: string;
  description?: string;
  year?: number;
  artist?: string;
  categoryName?: string;
  tagNames?: string[];
}

export interface ImportPreviewResponse {
  items: ImportItem[];
  totalCount: number;
  validCount: number;
  invalidCount: number;
  errors: ImportError[];
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
}

export interface ImportResult {
  totalCount: number;
  successCount: number;
  failedCount: number;
  errors: ImportError[];
}

// ========== Source Parser Plugins ==========
/** 公开插件信息（导入页/详情页用，仅返回已启用插件） */
export interface SourcePluginInfo {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
}

/** 插件配置项声明：后台据此动态渲染配置表单 */
export interface SourcePluginConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'textarea';
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  description?: string;
}

/** 管理端插件信息（含代码定义 + 数据库状态 + 配置） */
export interface SourcePluginAdminInfo {
  id: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  enabled: boolean;
  installedFrom: 'builtin' | 'upload';
  configSchema?: SourcePluginConfigField[];
  config: Record<string, string | number | boolean>;
}

/** 启用/禁用插件请求 */
export interface SourcePluginToggleRequest {
  enabled: boolean;
}

/** 更新插件配置请求 */
export interface SourcePluginConfigRequest {
  config: Record<string, string | number | boolean>;
}

export interface SourcePluginPreviewRequest {
  pluginId?: string;
  urls: string[];
}

export interface RefreshSourceRequest {
  reason?: string;
  failedUrl?: string;
}

export interface RefreshSourceResponse {
  mediaId: string;
  m3u8Url: string;
  sourceResolvedAt: string;
}

export interface ImportLog {
  id: string;
  userId: string;
  format: ImportFormat;
  fileName?: string | null;
  totalCount: number;
  successCount: number;
  failedCount: number;
  status: ImportStatus;
  createdAt: string;
}

// ========== System Settings ==========
export interface SystemSetting {
  key: string;
  value: string;
}

// ========== API Response ==========
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ========== Artist ==========
export interface ArtistInfo {
  name: string;
  videoCount: number;
}

// ========== Dashboard Stats ==========
export interface DashboardStats {
  totalMedia: number;
  totalUsers: number;
  totalCategories: number;
  totalViews: number;
  recentMedia: Media[];
  topMedia: Media[];
}

// ========== Backup ==========
export interface RestoreResult {
  tablesRestored: number;
  totalRecords: number;
  uploadsRestored: number;
  duration: number;
}

export type ExportPhase = 'db' | 'files' | 'finalize' | 'complete' | 'error';

export type BackupPhase = 'upload' | 'parse' | 'db' | 'delete' | 'write' | 'files' | 'finalize' | 'complete' | 'error';

export interface ExportProgress {
  phase: ExportPhase;
  message: string;
  current: number;
  total: number;
  percentage: number;
  downloadId?: string;
}

export interface BackupProgress {
  phase: BackupPhase;
  message: string;
  current: number;
  total: number;
  percentage: number;
  downloadId?: string;
  result?: RestoreResult;
}

// ========== Batch Operations ==========
export interface BatchOperationResult {
  affectedCount: number;
}

// ========== Login Record ==========
export interface LoginRecord {
  id: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  createdAt: string;
}

// ========== User Activity Summary ==========
export interface UserActivitySummary {
  user: {
    username: string;
    role: string;
    isActive: boolean;
    createdAt: string;
  } | null;
  totalLogins: number;
  lastLogin: {
    createdAt: string;
    ip: string | null;
    browser: string | null;
    os: string | null;
    device: string | null;
  } | null;
  totalWatched: number;
  totalCompleted: number;
}

// ========== User Activity Aggregate (all users) ==========
export interface UserActivityAggregate {
  loginStats: {
    totalLogins: number;
    uniqueUsers: number;
    todayLogins: number;
    yesterdayLogins: number;
    last7DaysLogins: number;
  };
  watchStats: {
    totalWatchRecords: number;
    totalCompleted: number;
    totalWatchTime: number; // seconds
  };
  recentLogins: Array<{
    id: string;
    userId: string;
    username: string | null;
    ip: string | null;
    browser: string | null;
    os: string | null;
    device: string | null;
    createdAt: string;
  }>;
  topWatchedMedia: Array<{
    mediaId: string;
    title: string;
    watchCount: number;
    completedCount: number;
  }>;
  topActiveUsers: Array<{
    userId: string;
    username: string;
    loginCount: number;
    watchCount: number;
  }>;
  recentWatchRecords: Array<{
    id: string;
    userId: string;
    username: string | null;
    mediaId: string;
    mediaTitle: string;
    progress: number;
    duration: number;
    percentage: number;
    completed: boolean;
    updatedAt: string;
  }>;
}
