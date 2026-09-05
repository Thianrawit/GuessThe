/* ──────────────────────────────────────────────
   Stream Resolver — Invidious Fallback Proxy
   Extracts direct HTML5 stream URLs (.mp4 / .webm / audio)
   ────────────────────────────────────────────── */

export const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://invidious.jing.rocks',
  'https://yt.artemislena.eu',
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com',
  'https://invidious.f5.si',
];

// In-memory Cache for resolved stream URLs in current session
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
 * Resolves a YouTube ID into a direct HTML5 stream URL with automatic concurrent fallback across public Invidious instances.
 * @param youtubeId 11-character YouTube video ID or direct media URL
 * @param type 'audio' | 'video'
 * @param timeoutMs Timeout per instance attempt (default: 2000ms)
 */
export async function resolveStreamUrl(
  youtubeId: string,
  type: 'audio' | 'video',
  timeoutMs: number = 2000
): Promise<string> {
  const cleanId = youtubeId.trim();
  if (!cleanId) {
    throw new Error('ไม่พบ YouTube ID');
  }

  // If already a direct media URL (.mp3 / .mp4 / .webm), return directly
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

  const fetchFromInstance = async (instance: string): Promise<string> => {
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
  };

  try {
    const result = await Promise.race([
      Promise.any(INVIDIOUS_INSTANCES.map((inst) => fetchFromInstance(inst))),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Invidious instances timed out')), timeoutMs + 100)
      ),
    ]);
    return result;
  } catch {
    throw new Error('ไม่สามารถดึง Direct Stream URL จาก Invidious API ได้ (ทุก instance ไม่ตอบสนอง)');
  }
}

/** Clear in-memory cache */
export function clearStreamCache(): void {
  streamCache.clear();
}
