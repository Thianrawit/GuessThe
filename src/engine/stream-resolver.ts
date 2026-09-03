/* ──────────────────────────────────────────────
   Stream Resolver — Invidious Fallback Proxy
   Resolves YouTube ID to Direct Stream URL (.mp4 / .webm)
   ────────────────────────────────────────────── */

export const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://invidious.jing.rocks',
  'https://yt.artemislena.eu',
  'https://invidious.f5.si',
  'https://invidious.drgns.space',
  'https://iv.melmac.space',
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
 * @param youtubeId 11-character YouTube video ID
 * @param type 'audio' | 'video'
 * @param timeoutMs Timeout per instance attempt (default: 3500ms)
 */
export async function resolveStreamUrl(
  youtubeId: string,
  type: 'audio' | 'video',
  timeoutMs: number = 3500
): Promise<string> {
  const cleanId = youtubeId.trim();
  if (!cleanId) {
    throw new Error('ไม่พบ YouTube ID');
  }

  const cacheKey = `${cleanId}_${type}`;
  if (streamCache.has(cacheKey)) {
    return streamCache.get(cacheKey)!;
  }

  let lastError: Error | null = null;

  for (const instance of INVIDIOUS_INSTANCES) {
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
        // Find audio stream from adaptiveFormats
        const audioFormats = (data.adaptiveFormats || []).filter((f) => {
          const mime = (f.type || f.mimeType || '').toLowerCase();
          return (
            mime.startsWith('audio/mp4') ||
            mime.startsWith('audio/webm') ||
            mime.includes('audio')
          );
        });

        if (audioFormats.length > 0) {
          // Prefer audio/mp4 for broad HTML5 audio compatibility
          const preferred =
            audioFormats.find((f) =>
              (f.type || f.mimeType || '').toLowerCase().startsWith('audio/mp4')
            ) || audioFormats[0];
          chosenUrl = preferred.url;
        } else if (data.formatStreams && data.formatStreams.length > 0) {
          // Fallback to formatStreams (contains combined audio + video)
          chosenUrl = data.formatStreams[0].url;
        }
      } else {
        // type === 'video'
        // formatStreams has combined video + audio (720p / 360p)
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
        // Resolve relative URLs returned by some Invidious instances
        const fullUrl = chosenUrl.startsWith('http')
          ? chosenUrl
          : `${instance.replace(/\/$/, '')}${chosenUrl.startsWith('/') ? '' : '/'}${chosenUrl}`;

        streamCache.set(cacheKey, fullUrl);
        return fullUrl;
      }

      throw new Error(`ไม่พบสตรีมประเภท ${type} จาก ${instance}`);
    } catch (err) {
      lastError = err as Error;
      console.warn(
        `[StreamResolver] Instance ${instance} failed for ${cleanId}:`,
        (err as Error).message
      );
    }
  }

  throw (
    lastError ||
    new Error('ไม่สามารถดึง Direct Stream URL จาก Invidious API ทุก instance')
  );
}

/** Clear in-memory cache */
export function clearStreamCache(): void {
  streamCache.clear();
}
