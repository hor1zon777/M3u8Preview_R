import type { ImportItem } from '@m3u8-preview/shared';

/** 仅把整行以 # 起始的行视为注释，不影响 URL 内部的 #fragment（后者不在行首） */
function isCommentLine(line: string): boolean {
  return line.startsWith('#');
}

export function parseText(content: string): ImportItem[] {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l && !isCommentLine(l));

  return lines.map(line => {
    if (line.includes('|')) {
      const parts = line.split('|').map(p => p.trim());
      const partCount = parts.length;

      if (partCount === 2) {
        // 标题|URL
        return {
          title: parts[0] || '',
          m3u8Url: parts[1] || '',
        };
      } else if (partCount === 3) {
        // 标题|URL|作者
        return {
          title: parts[0] || '',
          m3u8Url: parts[1] || '',
          artist: parts[2] || undefined,
        };
      } else if (partCount === 4) {
        // 标题|URL|分类|标签
        return {
          title: parts[0] || '',
          m3u8Url: parts[1] || '',
          categoryName: parts[2] || undefined,
          tagNames: parts[3] ? parts[3].split(',').map(t => t.trim()).filter(Boolean) : undefined,
        };
      } else {
        // 标题|URL|分类|标签|作者（5段及以上）
        return {
          title: parts[0] || '',
          m3u8Url: parts[1] || '',
          categoryName: parts[2] || undefined,
          tagNames: parts[3] ? parts[3].split(',').map(t => t.trim()).filter(Boolean) : undefined,
          artist: parts[4] || undefined,
        };
      }
    }

    // URL only - extract title from URL
    const url = line;
    const urlParts = url.split('/');
    const filename = urlParts[urlParts.length - 1]?.replace(/\.m3u8.*$/, '') || 'Untitled';
    // decodeURIComponent 可能抛 URIError，安全降级
    let title: string;
    try {
      title = decodeURIComponent(filename);
    } catch {
      title = filename;
    }
    return {
      title,
      m3u8Url: url,
    };
  });
}
