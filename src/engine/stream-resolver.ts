/* ──────────────────────────────────────────────
   Stream Resolver — Cloudflare Worker Proxy + Invidious Fallback
   Extracts direct HTML5 stream URLs (.mp4 / .webm / audio)
   100% Ad-Free via reverse-proxy, no YouTube IFrame needed
   ────────────────────────────────────────────── */

// ── Primary: Cloudflare Worker Reverse Proxy ──
const WORKER_ENDPOINT = 'https://guessthe-stream-proxy.thianrawit-9347.workers.dev/';

// ── Emergency Fallback: Public Invidious Instances ──
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

// Track if Worker is down for this session to skip retries
let workerDown = false;

// Track if Invidious instances are CORS-blocked for this session
let instancesCORSBlocked = false;

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

interface WorkerResponse {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Resolves a YouTube ID into a direct HTML5 stream URL.
 *
 * Resolution order:
 *   1. In-memory cache (instant)
 *   2. Cloudflare Worker Reverse Proxy (primary, 4s timeout)
 *   3. Public Invidious Instances (emergency fallback, 2s timeout)
 *
 * @param youtubeId  11-character YouTube video ID or direct media URL
 * @param type       'audio' | 'video'
 * @param timeoutMs  Timeout for fallback Invidious attempts (default: 2000ms)
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

  // ── Shortcut: If already a direct media URL ──
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

  // ── Check in-memory cache ──
  const cacheKey = `${cleanId}_${type}`;
  if (streamCache.has(cacheKey)) {
    return streamCache.get(cacheKey)!;
  }

  // ── Step 1: Cloudflare Worker Reverse Proxy (Primary Source) ──
  if (!workerDown) {
    try {
      const workerUrl = `${WORKER_ENDPOINT}?id=${encodeURIComponent(cleanId)}&type=${encodeURIComponent(type)}`;
      const response = await fetch(workerUrl, {
        signal: AbortSignal.timeout(4000),
      });

      if (response.ok) {
        const data: WorkerResponse = await response.json();
        if (data.success && data.url) {
          console.log(`[StreamResolver] ✅ Worker resolved ${cleanId} (${type})`);
          streamCache.set(cacheKey, data.url);
          return data.url;
        } else {
          console.warn(`[StreamResolver] Worker returned error for ${cleanId}:`, data.error);
        }
      } else {
        console.warn(`[StreamResolver] Worker HTTP ${response.status} for ${cleanId}`);
      }
    } catch (err) {
      console.warn(`[StreamResolver] Worker unreachable for ${cleanId}:`, err);
      // Mark worker as down for this session to avoid spamming failed requests
      workerDown = true;
    }
  }

  // ── Step 2: Emergency Fallback — Public Invidious Instances ──
  if (instancesCORSBlocked) {
    throw new Error('ทุกแหล่งสตรีมไม่สามารถใช้งานได้ในเซสชันนี้ (Worker down + Invidious CORS blocked)');
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
    console.warn('[StreamResolver] Worker failed, trying Invidious fallback...');
    const result = await Promise.race([
      Promise.any(INVIDIOUS_INSTANCES.map((inst) => fetchFromInstance(inst))),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Invidious instances timed out')), timeoutMs + 500)
      ),
    ]);
    return result;
  } catch {
    instancesCORSBlocked = true;
    throw new Error('ไม่สามารถดึง Direct Stream URL ได้ (Cloudflare Worker และ Invidious ทั้งหมดไม่ตอบสนอง)');
  }
}

/** Clear in-memory cache */
export function clearStreamCache(): void {
  streamCache.clear();
}

/** Reset blocked status (useful for testing or session refresh) */
export function resetInstancesBlocked(): void {
  instancesCORSBlocked = false;
  workerDown = false;
}
