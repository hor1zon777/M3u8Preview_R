const FOURHOI_HOST = 'fourhoi.com';
const FOURHOI_PROXY_PREFIX = '/api/v1/proxy/m3u8?url=';
const PROXYABLE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

function getPathExtension(pathname: string): string {
  const lastSegment = pathname.split('/').pop() || '';
  const dotIndex = lastSegment.lastIndexOf('.');
  return dotIndex >= 0 ? lastSegment.slice(dotIndex).toLowerCase() : '';
}

function shouldProxyPosterUrl(posterUrl: string): boolean {
  try {
    const parsed = new URL(posterUrl);
    const hostname = parsed.hostname.toLowerCase();
    const isFourhoiHost = hostname === FOURHOI_HOST || hostname.endsWith(`.${FOURHOI_HOST}`);

    return isFourhoiHost && PROXYABLE_IMAGE_EXTENSIONS.has(getPathExtension(parsed.pathname));
  } catch {
    return false;
  }
}

export function resolvePosterUrl(posterUrl?: string | null): string | undefined {
  if (!posterUrl) {
    return undefined;
  }

  if (!shouldProxyPosterUrl(posterUrl)) {
    return posterUrl;
  }

  return `${FOURHOI_PROXY_PREFIX}${encodeURIComponent(posterUrl)}`;
}

export function useVideoThumbnail(
  _mediaId: string,
  _m3u8Url: string,
  posterUrl?: string | null,
  _watchedPercentage?: number,
  _enabled?: boolean,
): string | undefined {
  return resolvePosterUrl(posterUrl);
}
