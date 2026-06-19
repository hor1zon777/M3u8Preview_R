/**
 * 源解析插件契约。
 *
 * 每个插件是 src/plugins/ 目录（或后台上传到运行时目录）下的一个模块文件，
 * default export 一个实现 SourceParserPlugin 的对象。核心层（loader/registry）负责
 * 扫描加载、并发调度、错误包裹与元数据序列化；插件本身只需实现 parse()：
 * 输入原始链接，输出可播放 m3u8。
 *
 * 插件可声明 configSchema（配置项），后台据此渲染配置表单；管理员填写的值存数据库，
 * parse 时通过 ctx.config 注入——因此目标地址、密钥等不写死在代码里。
 */
import type { SourcePluginConfigField } from '@m3u8-preview/shared';

/** 配置项声明（等价于 shared 的 SourcePluginConfigField），后台据此渲染配置表单 */
export type PluginConfigField = SourcePluginConfigField;

/** 插件解析单个原始链接后的标准化结果 */
export interface PluginParseResult {
  /** 解析出的可播放 m3u8 地址（必填） */
  m3u8Url: string;
  title?: string;
  author?: string;
  /** 任意来源元数据；registry 会 JSON.stringify 后存入 Media.sourceMeta */
  meta?: Record<string, unknown>;
}

/** 注入给插件 parse() 的运行时工具，避免每个插件重复造轮子 */
export interface PluginContext {
  /**
   * 带超时的 JSON 请求。未显式传 timeoutMs 时使用 defaultTimeoutMs。
   * 注意：不做 SSRF 拦截（解析服务常为 localhost/内网），调用方自负其责。
   */
  fetchJson<T = unknown>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T>;
  /** 全局默认超时（毫秒） */
  defaultTimeoutMs: number;
  /** 抛出业务错误（HTTP status 默认 502），中断解析 */
  fail(message: string, status?: number): never;
  /** 该插件在后台保存的配置值（来自数据库），供 parse 读取（如 baseUrl、密钥等） */
  config: Record<string, string | number | boolean>;
}

/** 插件模块需 default export 的对象 */
export interface SourceParserPlugin {
  /** 唯一标识，对应 Media.sourcePlugin，建议小写字母/数字/连字符 */
  id: string;
  /** 展示名 */
  name: string;
  /** 描述（可选） */
  description?: string;
  /** 作者（可选，后台展示） */
  author?: string;
  /** 版本（可选，后台展示） */
  version?: string;
  /** 导入该插件源时默认套用的分类名（可选） */
  defaultCategory?: string;
  /** 导入该插件源时默认套用的标签名（可选） */
  defaultTags?: string[];
  /** 声明该插件需要的配置项；后台渲染为表单，值存数据库并在 parse 时注入 ctx.config */
  configSchema?: PluginConfigField[];
  /** 解析单个原始链接为可播放地址 */
  parse(originalUrl: string, ctx: PluginContext): Promise<PluginParseResult>;
}
