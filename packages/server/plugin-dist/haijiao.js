// 海角解析插件（内置解析版）—— 可直接上传的产物（纯 ESM，无需编译）
//
// 用途：输入海角帖子链接，插件自身抓取帖子页 + /api/topic 接口、三重 Base64 解码、
//   推导真实 m3u8 播放地址。无需再部署任何外部解析服务。
// 上传：后台「插件管理 → 上传安装」选择本文件 → 启用 → 在「配置」粘贴你本人账号 Cookie。
//
// 解析逻辑移植自 haijiao-parser 项目（Go / Cloudflare Worker 双实现），改写为纯 ESM：
//   plugins-data/ 不经过 tsc，故无 TypeScript 语法、无相对 import；
//   fetch / AbortController / Buffer / URL 均为 Node 内置（核心层 context.ts 同样直接使用 fetch）。
//
// ⚠️ Cookie 是你本人登录后抓取的身份凭据，仅存于本地数据库、仅管理员可见；请勿外传。

const DEFAULT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const DEFAULT_BASE = 'https://hj260202ffb.top/';

// ---------- URL / 文本工具 ----------

const rePostDetails = /\/post\/details\/(\d+)/;
const rePid = /[?&]pid=(\d+)/;
const reID = /[?&]id=(\d+)/;
const rePureNum = /^(\d+)$/;
const reTSFile = /([\w_]+_?)\d+\.ts/;

/** 从原始链接提取帖子 ID：支持 /post/details/数字、?pid=、?id= 或纯数字 */
function extractPostID(raw) {
  for (const re of [rePostDetails, rePid, reID, rePureNum]) {
    const m = raw.match(re);
    if (m && m[1]) return m[1];
  }
  return '';
}

/** 从链接取 scheme://host；取不到（如纯数字 ID）则回退到配置的兜底域名 */
function extractBaseURL(raw, fallback) {
  try {
    const u = new URL(raw);
    if (u.protocol && u.host) return `${u.protocol}//${u.host}`;
  } catch {
    // 用户可能直接传数字 ID，走 fallback
  }
  return fallback.replace(/\/+$/, '');
}

function stripHtml(s) {
  return s.replace(/<[^>]*>/g, '');
}

/** 从 HTML 抽标题：首个 h2>span → <title> → og:title */
function extractTitleFromHTML(html) {
  const h2 = html.match(/<h2\b[^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i);
  if (h2 && h2[1]) {
    const t = stripHtml(h2[1]).trim();
    if (t) return t;
  }
  const tt = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (tt && tt[1]) {
    const t = stripHtml(tt[1]).trim();
    if (t) return t;
  }
  const og =
    html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  if (og && og[1]) return og[1];
  return '未知标题';
}

/** 从 HTML 抽作者：首个 a[href*="/user/"] 的文本 */
function extractAuthorFromHTML(html) {
  const a = html.match(/<a\b[^>]*href=["'][^"']*\/user\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  if (a && a[1]) {
    const t = stripHtml(a[1]).trim();
    if (t) return t;
  }
  return '未知作者';
}

/** 按优先级取对象里首个非空字符串字段 */
function firstString(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v !== '') return v;
  }
  return '';
}

/** 从解密后的 data 取 title / author */
function extractTitleAndAuthorFromAPI(data) {
  const title = firstString(data, 'title', 'subject', 'name', 'topicTitle');
  let author = '';
  const userObj = data['user'] ?? data['author'] ?? data['creator'];
  if (typeof userObj === 'string') {
    author = userObj;
  } else if (userObj && typeof userObj === 'object') {
    author = firstString(userObj, 'nickname', 'name', 'username');
  }
  return { title, author };
}

// ---------- 三重 Base64 解码 ----------

/** Base64 → UTF-8（Node 用 Buffer，等价于 Worker 版 atob + TextDecoder） */
function base64ToUtf8(str) {
  return Buffer.from(str, 'base64').toString('utf8');
}

/** 连续 3 次 Base64 解码后 JSON.parse，失败返回 null */
function bareDecode(text) {
  try {
    let decoded = text;
    for (let i = 0; i < 3; i++) decoded = base64ToUtf8(decoded);
    const obj = JSON.parse(decoded);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * 解析 /api/topic/:id 原始响应：
 *   1. 整体是 { data: ... } 信封
 *   2. data 为对象（历史格式）→ 直接返回
 *   3. data 为字符串 → 三重 Base64 解码后 JSON.parse
 */
function decodeEncryptString(text) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    return null;
  }
  if (!envelope || typeof envelope !== 'object') return null;
  const data = envelope.data;
  if (data == null) return null;
  if (typeof data === 'object') return data;
  if (typeof data === 'string') return bareDecode(data);
  return null;
}

/** 按 m3u8 入口内容推导真实播放地址 */
function getRealVideoSrc(content, requestURL) {
  if (!content) return '';
  if (content.includes('#EXTM3U')) {
    const idx = requestURL.lastIndexOf('/');
    if (idx < 0) return '';
    const base = requestURL.slice(0, idx + 1);
    const m = content.match(reTSFile);
    return m && m[1] ? base + m[1] + '.m3u8' : '';
  }
  for (const line of content.split('\n')) {
    if (line.includes('.ts')) {
      const m = line.match(reTSFile);
      if (m && m[0] && m[1]) {
        return line.replace(m[0], m[1] + '.m3u8').trim();
      }
    }
  }
  return '';
}

// ---------- HTTP ----------

function buildHeaders(cfg, base) {
  const headers = {
    'User-Agent': String(cfg.userAgent || DEFAULT_UA),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  if (base) headers.Referer = base + '/';
  const cookie = String(cfg.cookie || '');
  if (cookie) headers.Cookie = cookie;
  return headers;
}

/** 带超时的 GET，返回响应文本（用于 HTML / m3u8） */
async function doGet(url, headers, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: ctl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 插件定义 ----------

const plugin = {
  id: 'haijiao',
  name: '海角解析',
  description: '内置解析：输入海角帖子链接，自动抓取并解析出可播放 m3u8（需配置本人账号 Cookie）',
  author: 'haijiao-parser',
  version: '2.0.0',
  defaultCategory: '海角',
  defaultTags: ['海角', '自动解析'],
  configSchema: [
    {
      key: 'cookie',
      label: '海角账号 Cookie',
      type: 'textarea',
      required: false,
      placeholder: '浏览器 F12 → Network → 任一请求 → Headers → Cookie',
      description: '你本人登录后抓取的 Cookie；不配置或失效时接口多半返回空数据',
    },
    {
      key: 'baseUrl',
      label: '兜底域名',
      type: 'text',
      default: DEFAULT_BASE,
      placeholder: 'https://host',
      description: '仅当传入纯数字 ID（无域名）时用于拼接；传完整链接时自动取其域名',
    },
    {
      key: 'userAgent',
      label: 'User-Agent',
      type: 'text',
      default: DEFAULT_UA,
      description: '默认移动端 UA，一般无需修改',
    },
    {
      key: 'timeoutSec',
      label: '单次请求超时（秒）',
      type: 'number',
      default: 15,
    },
  ],

  /**
   * 解析单个海角帖子链接 → 可播放 m3u8。
   * 流程：提取 postID/域名 → 并行抓帖子页(标题/作者)+/api/topic(附件) →
   *       三重 Base64 解码 → 取 category=video 的 remoteUrl → 抓每个 m3u8 入口推导真实地址。
   */
  async parse(originalUrl, ctx) {
    const cfg = ctx.config || {};
    const fallbackBase = String(cfg.baseUrl || DEFAULT_BASE);
    const timeoutMs = Math.max(1, Number(cfg.timeoutSec) || 15) * 1000;

    const postID = extractPostID(originalUrl);
    if (!postID) {
      ctx.fail('无法从链接中提取帖子 ID（支持 /post/details/数字、?pid=、?id= 或纯数字）', 400);
    }

    const base = extractBaseURL(originalUrl, fallbackBase);
    if (!base) {
      ctx.fail('无法确定目标域名，请在「配置 → 兜底域名」中填写', 400);
    }

    const headers = buildHeaders(cfg, base);
    const pageURL = `${base}/post/details/${postID}`;
    const apiURL = `${base}/api/topic/${postID}`;

    let title = '未知标题';
    let author = '未知作者';

    const [pageRes, apiRes] = await Promise.allSettled([
      doGet(pageURL, headers, timeoutMs),
      doGet(apiURL, headers, timeoutMs),
    ]);

    if (pageRes.status === 'fulfilled') {
      title = extractTitleFromHTML(pageRes.value);
      author = extractAuthorFromHTML(pageRes.value);
    }

    if (apiRes.status === 'rejected') {
      const reason = apiRes.reason instanceof Error ? apiRes.reason.message : String(apiRes.reason);
      ctx.fail(`获取帖子数据失败：${reason}`, 502);
    }

    const data = decodeEncryptString(apiRes.value);
    const m3u8Urls = [];
    if (data) {
      const ta = extractTitleAndAuthorFromAPI(data);
      if (ta.title) title = ta.title;
      if (ta.author) author = ta.author;

      const atts = data.attachments;
      if (Array.isArray(atts)) {
        const videoURLs = [];
        for (const att of atts) {
          if (
            att &&
            typeof att === 'object' &&
            att.category === 'video' &&
            typeof att.remoteUrl === 'string' &&
            att.remoteUrl
          ) {
            videoURLs.push(att.remoteUrl);
          }
        }
        const settled = await Promise.allSettled(
          videoURLs.map(async (vu) => getRealVideoSrc(await doGet(vu, headers, timeoutMs), vu)),
        );
        for (const r of settled) {
          if (r.status === 'fulfilled' && r.value) m3u8Urls.push(r.value);
        }
      }
    }

    if (m3u8Urls.length === 0) {
      ctx.fail('未找到视频资源（可能需要配置 Cookie 或账号权限不足）', 422);
    }

    return {
      m3u8Url: m3u8Urls[0],
      title,
      author,
      meta: {
        postId: postID,
        sourceDomain: base,
        sourceUrls: m3u8Urls,
        parsedAt: new Date().toISOString(),
      },
    };
  },
};

export default plugin;

// 额外导出纯函数仅供离线自测/复用；核心层加载时只取 default export，不受影响。
export { extractPostID, extractBaseURL, decodeEncryptString, getRealVideoSrc };
