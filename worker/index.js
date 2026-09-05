/**
 * GuessThe? — Cloudflare Worker Stream Proxy
 * 
 * ทำหน้าที่เป็น Reverse Proxy ดึง Direct Stream URL จาก Invidious API
 * แล้วส่งกลับให้ Client พร้อม CORS Headers เพื่อให้ <video>/<audio> เล่นได้ตรง
 *
 * Deploy: npx wrangler deploy
 * Test:   https://guessthe-stream-proxy.thianrawit-9347.workers.dev/?id=VIDEO_ID&type=video
 */

// Invidious instances ที่ Worker จะยิงหา (server-side ไม่มีปัญหา CORS)
const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://invidious.jing.rocks',
  'https://yt.artemislena.eu',
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com',
  'https://invidious.f5.si',
];

// CORS Headers สำหรับ Response
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const videoId = url.searchParams.get('id');
    const type = url.searchParams.get('type') || 'video'; // 'audio' | 'video'

    if (!videoId) {
      return jsonResponse({ success: false, error: 'Missing ?id= parameter' }, 400);
    }

    // Try each Invidious instance until one works
    const errors = [];

    for (const instance of INVIDIOUS_INSTANCES) {
      try {
        const endpoint = `${instance}/api/v1/videos/${encodeURIComponent(videoId)}`;
        const resp = await fetch(endpoint, {
          signal: AbortSignal.timeout(5000),
          headers: { 'User-Agent': 'GuessThe-StreamProxy/1.0' },
        });

        if (!resp.ok) {
          errors.push(`${instance}: HTTP ${resp.status}`);
          continue;
        }

        const data = await resp.json();
        if (data.error) {
          errors.push(`${instance}: ${data.error}`);
          continue;
        }

        let streamUrl = '';

        if (type === 'audio') {
          // Extract best audio stream
          const audioFormats = (data.adaptiveFormats || []).filter((f) => {
            const mime = (f.type || f.mimeType || '').toLowerCase();
            return mime.startsWith('audio/mp4') || mime.startsWith('audio/webm') || mime.includes('audio');
          });

          if (audioFormats.length > 0) {
            const preferred = audioFormats.find((f) =>
              (f.type || f.mimeType || '').toLowerCase().startsWith('audio/mp4')
            ) || audioFormats[0];
            streamUrl = preferred.url;
          } else if (data.formatStreams?.length > 0) {
            streamUrl = data.formatStreams[0].url;
          }
        } else {
          // Extract best video stream (720p > 360p > first available)
          if (data.formatStreams?.length > 0) {
            const preferred =
              data.formatStreams.find((f) => f.qualityLabel === '720p') ||
              data.formatStreams.find((f) => f.qualityLabel === '360p') ||
              data.formatStreams[0];
            streamUrl = preferred.url;
          } else if (data.adaptiveFormats?.length > 0) {
            const videoFormats = data.adaptiveFormats.filter((f) => {
              const mime = (f.type || f.mimeType || '').toLowerCase();
              return mime.startsWith('video/mp4') || mime.startsWith('video/webm');
            });
            if (videoFormats.length > 0) {
              streamUrl = videoFormats[0].url;
            }
          }
        }

        if (streamUrl) {
          // Build absolute URL if relative
          const fullUrl = streamUrl.startsWith('http')
            ? streamUrl
            : `${instance.replace(/\/$/, '')}${streamUrl.startsWith('/') ? '' : '/'}${streamUrl}`;

          return jsonResponse({
            success: true,
            url: fullUrl,
            instance,
            type,
          });
        }

        errors.push(`${instance}: No ${type} stream found`);
      } catch (err) {
        errors.push(`${instance}: ${err.message || 'Unknown error'}`);
      }
    }

    // All instances failed
    return jsonResponse({
      success: false,
      error: `Failed to resolve stream for ${videoId} (${type})`,
      details: errors,
    }, 502);
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
