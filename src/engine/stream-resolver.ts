/* ──────────────────────────────────────────────
   Stream Resolver — Invidious Fallback Proxy
   Resolves YouTube ID to Direct Stream URL (.mp4 / .webm)
   ────────────────────────────────────────────── */

export const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://invidious.jing.rocks',
  'https://yt.artemislena.eu',
];

// In-memory Cache for resolved stream URLs in the current session
const streamCache = new Map<string, string>();

interface StreamFormat {
  url: string;
  type?: string;
  mimeType?: string;
  qualityLabel?: string;
  container?: string;
  bitrate?: string | number;
}

interface InvidiousResponse {
  formatStreams?: StreamFormat[];
  adaptiveFormats?: StreamFormat[];
  error?: string;
}

/**
 * Resolves a YouTube ID into a direct HTML5 stream URL with automatic fallback.
 * @param youtubeId 11-character YouTube video ID or direct media URL
 * @param type 'audio' | 'video'
 * @param timeoutMs Timeout per instance attempt (default: 1500ms to prevent game lag)
 */
export async function resolveStreamUrl(
  youtubeId: string,
  type: 'audio' | 'video',
  timeoutMs: number = 1500
): Promise<string> {
  const cleanId = youtubeId.trim();
  if (!cleanId) {
    throw new Error('ไม่พบ YouTube ID');
  }

  // If already a direct media URL (.mp3 / .mp4 / .webm), return it directly
  if (
    cleanId.startsWith('http') &&
    (cleanId.endsWith('.mp3') ||
      cleanId.endsWith('.mp4') ||
      cleanId.endsWith('.webm') ||
      cleanId.includes('.mp3?') ||
      cleanId.includes('.mp4?'))
  ) {
    return cleanId;
  }

  const cacheKey = `${cleanId}_${type}`;
  if (streamCache.has(cacheKey)) {
    return streamCache.get(cacheKey)!;
  }

  let lastError: Error | null = null;
  let corsBlocked = false;

  for (const instance of INVIDIOUS_INSTANCES) {
    // If browser CORS policy blocked the request on this domain, break immediately
    if (corsBlocked) break;

    try {
      const endpoint = `${instance}/api/v1/videos/${encodeURIComponent(cleanId)}`;
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${instance}`);
      }

      const data: InvidiousResponse = await response.json();
      if (data.error) {
        throw new Error(`Invidious error: ${data.error}`);
      }

      let chosenUrl = '';

      if (type === 'audio') {
        const audioFormats = (data.adaptiveFormats || []).filter((f) => {
          const mime = (f.type || f.mimeType || '').toLowerCase();
          return (
            mime.startsWith('audio/mp4') ||
            mime.startsWith('audio/webm') ||
            mime.includes('audio')
          );
        });

        if (audioFormats.length > 0) {
          const preferred =
            audioFormats.find((f) =>
              (f.type || f.mimeType || '').toLowerCase().startsWith('audio/mp4')
            ) || audioFormats[0];
          chosenUrl = preferred.url;
        } else if (data.formatStreams && data.formatStreams.length > 0) {
          chosenUrl = data.formatStreams[0].url;
        }
      } else {
        if (data.formatStreams && data.formatStreams.length > 0) {
          const preferred =
            data.formatStreams.find((f) => f.qualityLabel === '720p') ||
            data.formatStreams.find((f) => f.qualityLabel === '360p') ||
            data.formatStreams[0];
          chosenUrl = preferred.url;
        } else if (data.adaptiveFormats && data.adaptiveFormats.length > 0) {
          const videoFormats = data.adaptiveFormats.filter((f) => {
            const mime = (f.type || f.mimeType || '').toLowerCase();
            return (
              mime.startsWith('video/mp4') ||
              mime.startsWith('video/webm')
            );
          });
          if (videoFormats.length > 0) {
            chosenUrl = videoFormats[0].url;
          }
        }
      }

      if (chosenUrl) {
        const fullUrl = chosenUrl.startsWith('http')
          ? chosenUrl
          : `${instance.replace(/\/$/, '')}${chosenUrl.startsWith('/') ? '' : '/'}${chosenUrl}`;

        streamCache.set(cacheKey, fullUrl);
        return fullUrl;
      }

      throw new Error(`ไม่พบสตรีมประเภท ${type} จาก ${instance}`);
    } catch (err) {
      lastError = err as Error;
      const errMsg = (err as Error).message || '';
      if (
        errMsg.includes('Failed to fetch') ||
        errMsg.includes('CORS') ||
        errMsg.includes('NetworkError')
      ) {
        corsBlocked = true;
      }
      console.warn(
        `[StreamResolver] Instance ${instance} failed for ${cleanId}:`,
        errMsg
      );
    }
  }

  throw (
    lastError ||
    new Error('ไม่สามารถดึง Direct Stream URL จาก Invidious API ได้ (ติด CORS / บล็อก IP)')
  );
}

/** Clear in-memory cache */
export function clearStreamCache(): void {
  streamCache.clear();
}
