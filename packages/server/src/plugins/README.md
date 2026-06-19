# 源解析插件目录

本目录用于放置「源解析插件」。系统**初始不内置任何插件**。

插件的职责很单一：**输入一个原始链接，输出一个可播放的 m3u8 地址**（以及可选的标题/作者/元数据）。加载、并发调度、超时、错误包裹、元数据序列化等通用工作由核心层（`../sourcePlugins/`）完成，插件本身只需实现 `parse()`。

插件的**启用状态**与**配置值**存在数据库，由后台「插件管理」页管理；插件**代码**则来自下面两类目录。

---

## 一、两种安装方式

| 方式 | 位置 | 适用 | 是否需重启 |
|------|------|------|-----------|
| **源码插件** | `packages/server/src/plugins/`（本目录） | 用 TypeScript 编写、随项目构建 | 是（启动时扫描） |
| **上传插件** | `packages/server/plugins-data/`（运行时目录，自动创建） | 后台「插件管理 → 上传安装」`.js`/`.zip` | 否（上传即时生效） |

- 用 `.ts` 写的源码插件会随主程序 `tsc` 编译进 `dist/plugins/`，生产环境从那里加载。
- 后台上传的插件**必须是 `.js`（编译后的 ESM）**或包含 `index.js` 的 `.zip`——运行时目录不经过 `tsc`，无法直接运行 `.ts`。

安装/上传后，到「插件管理」页**启用**并填写**配置**即可使用。

---

## 二、插件契约

每个插件需 **`default export`** 一个实现 `SourceParserPlugin` 的对象：

```ts
// ../sourcePlugins/types.ts
export interface SourceParserPlugin {
  id: string;                 // 唯一标识，对应 Media.sourcePlugin，建议小写字母/数字/连字符
  name: string;               // 展示名
  description?: string;
  author?: string;            // 后台展示
  version?: string;           // 后台展示
  defaultCategory?: string;   // 导入该插件源时默认套用的分类名
  defaultTags?: string[];     // 导入该插件源时默认套用的标签名
  configSchema?: PluginConfigField[];   // 声明配置项，后台据此渲染表单
  parse(originalUrl: string, ctx: PluginContext): Promise<PluginParseResult>;
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'textarea';
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  description?: string;
}

export interface PluginParseResult {
  m3u8Url: string;            // 必填：解析出的可播放地址
  title?: string;
  author?: string;
  meta?: Record<string, unknown>;  // 任意来源元数据，核心层会 JSON.stringify 后存入 Media.sourceMeta
}

export interface PluginContext {
  fetchJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T>;
  defaultTimeoutMs: number;
  fail(message: string, status?: number): never;   // 抛业务错误并中断（status 默认 502）
  config: Record<string, string | number | boolean>;  // 后台填写的配置值（如 baseUrl、密钥）
}
```

要点：
- **配置不写死在代码里**：插件用 `configSchema` 声明需要哪些配置（如解析服务地址），管理员在后台填，`parse` 时通过 `ctx.config` 读取。
- 核心层校验 `id`/`name` 为非空字符串且 `parse` 为函数，否则该插件被**跳过并告警**。
- `id` 全局唯一；上传时与现有插件冲突会被拒绝。
- 单个插件加载失败不影响其他插件或服务启动。

---

## 三、安全须知

- **任意代码执行**：插件是被服务端直接 `import` 执行的代码。请只放入/上传你信任的插件文件。后台上传限管理员，与 WordPress/epay 装插件同理——但务必只用可信来源。
- **SSRF**：`ctx.fetchJson` 不做 SSRF 拦截（解析服务常部署在 `localhost`/内网）。插件请求的目标由你自行负责；解析出的 m3u8 在播放时仍会经过 `/api/v1/proxy`（已内置 SSRF 防护）。

---

## 四、示例：HTTP 中间插件（带配置项）

把它保存为本目录下的 `haijiao.ts`，重启服务后到「插件管理」启用并在「配置」里填入解析服务地址即可。

```ts
// src/plugins/haijiao.ts
import type { SourceParserPlugin } from '../sourcePlugins/types.js';

/** 中间解析服务 /api/plugin/parse 的响应结构 */
interface MiddlewareResponse {
  code: number;
  message: string;
  data?: {
    sourceUrl?: string;
    sourceUrls?: string[];
    title?: string;
    author?: string;
    postId?: string;
    sourceDomain?: string;
    parsedAt?: string;
    error?: string;
  };
}

const plugin: SourceParserPlugin = {
  id: 'haijiao',
  name: '海角解析',
  description: '输入原始帖子链接，实时解析出可播放的 m3u8 地址',
  author: 'example',
  version: '1.0.0',
  defaultCategory: '海角',
  defaultTags: ['海角', '自动解析'],
  configSchema: [
    { key: 'baseUrl', label: '解析服务地址', type: 'text', required: true, default: 'http://localhost:23000', placeholder: 'http://host:port' },
    { key: 'parsePath', label: '解析路径', type: 'text', default: '/api/plugin/parse' },
  ],

  async parse(originalUrl, ctx) {
    const baseUrl = String(ctx.config.baseUrl || '');
    const parsePath = String(ctx.config.parsePath || '/api/plugin/parse');
    if (!baseUrl) {
      ctx.fail('未配置解析服务地址，请在「插件管理 → 配置」中填写', 400);
    }
    const endpoint = `${baseUrl.replace(/\/+$/, '')}${parsePath}?url=${encodeURIComponent(originalUrl)}`;

    const payload = await ctx.fetchJson<MiddlewareResponse>(endpoint);

    const sourceUrl = payload.data?.sourceUrl;
    if (payload.code !== 0 || !sourceUrl) {
      ctx.fail(payload.message || payload.data?.error || '未解析到可播放地址', 422);
    }

    return {
      m3u8Url: sourceUrl,
      title: payload.data?.title,
      author: payload.data?.author,
      meta: {
        postId: payload.data?.postId ?? null,
        sourceDomain: payload.data?.sourceDomain ?? null,
        sourceUrls: payload.data?.sourceUrls ?? [sourceUrl],
        parsedAt: payload.data?.parsedAt ?? null,
      },
    };
  },
};

export default plugin;
```

要上传安装：把上面的代码用 `tsc`/`esbuild` 编译成 `.js`（ESM）后，在「插件管理」上传该 `.js`；或打包成含 `index.js` 的 `.zip` 上传。

---

## 五、自定义插件提示

- 不一定要走 HTTP——`parse()` 内可实现任意解析逻辑（爬取页面、调用 SDK、读取签名接口等），只要最终返回 `{ m3u8Url }`。
- 需要超时控制的网络请求优先用 `ctx.fetchJson`；其他场景可自行 `fetch`。
- 解析失败时调用 `ctx.fail('原因', 422)` 给出可读错误，前台会展示该信息。
- `meta` 用于追溯来源（核心层会自动补上 `plugin` 字段），按需放入帖子 id、原站域名、备用地址等。
