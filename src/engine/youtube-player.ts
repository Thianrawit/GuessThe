/* ──────────────────────────────────────────────
   YouTube IFrame Player Wrapper
   ────────────────────────────────────────────── */

let ytApiReady = false;

// Global callback called by YouTube IFrame API
const prevOnReady = window.onYouTubeIframeAPIReady;
window.onYouTubeIframeAPIReady = () => {
  ytApiReady = true;
  if (prevOnReady) prevOnReady();
};

export function waitForYTApi(): Promise<void> {
  if (window.YT && window.YT.Player) {
    ytApiReady = true;
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        ytApiReady = true;
        resolve();
      }
    };

    const interval = setInterval(() => {
      if (window.YT && window.YT.Player) {
        clearInterval(interval);
        done();
      }
    }, 50);

    const existingOnReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (existingOnReady) existingOnReady();
      clearInterval(interval);
      done();
    };

    // Fallback timeout after 6 seconds
    setTimeout(() => {
      clearInterval(interval);
      done();
    }, 6000);
  });
}

let currentPlayer: YT.Player | null = null;
let lastError: number | null = null;

/** Check if last player creation had an error */
export function getLastPlayerError(): number | null {
  return lastError;
}

/**
 * YouTube Error Codes:
 * 2   = Invalid parameter
 * 5   = HTML5 player error
 * 100  = Video not found / removed
 * 101  = Embedding not allowed (by owner)
 * 150  = Same as 101 — embedding restricted
 */
const ERROR_MESSAGES: Record<number, string> = {
  2: 'พารามิเตอร์ไม่ถูกต้อง',
  5: 'เบราว์เซอร์ไม่รองรับ HTML5 Player',
  100: 'ไม่พบวิดีโอ หรือถูกลบแล้ว',
  101: 'เจ้าของวิดีโอบล็อกการ Embed',
  150: 'เจ้าของวิดีโอบล็อกการ Embed',
};

export function getErrorMessage(code: number): string {
  return ERROR_MESSAGES[code] || `YouTube Error (${code})`;
}

/**
 * Extract 11-character YouTube video ID from various URL formats or plain ID
 */
export function extractYouTubeId(urlOrId: string): string {
  if (!urlOrId) return '';
  const trimmed = urlOrId.trim();
  // Already 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  // Try matching standard YouTube URL patterns (youtu.be, watch?v=, embed, shorts, music.youtube)
  const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/)|music\.youtube\.com\/watch\?v=)([\w-]{11})/;
  const match = trimmed.match(regExp);
  if (match && match[1]) {
    return match[1];
  }
  // Fallback: extract any 11-char base64url sequence
  const fallback = trimmed.match(/([a-zA-Z0-9_-]{11})/);
  return fallback ? fallback[1] : trimmed;
}

/**
 * Clean common YouTube title clutter (e.g. [Official MV], 【OFFICIAL MV】, etc.)
 */
export function cleanSongTitle(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\s*[\[\(【「].*?(official|mv|audio|video|lyrics|เพลงประกอบ|ost).*?[\]\)】」]\s*/gi, '')
    .replace(/\s*·\s*/g, ' - ')
    .trim();
}

/**
 * Fetch video title from YouTube via client-side CORS oEmbed proxy (no API key required)
 */
export async function fetchYouTubeTitle(urlOrId: string): Promise<{ cleanTitle: string; rawTitle: string }> {
  const videoId = extractYouTubeId(urlOrId);
  if (!videoId) {
    throw new Error('ไม่พบ YouTube Video ID ที่ถูกต้อง');
  }

  const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error('ไม่สามารถเชื่อมต่อดึงข้อมูลจาก YouTube ได้');
  }

  const data = await response.json();
  if (data.error || !data.title) {
    throw new Error(data.error || 'ไม่พบวิดีโอนี้ใน YouTube หรือวิดีโอเป็นแบบส่วนตัว');
  }

  return {
    rawTitle: data.title,
    cleanTitle: cleanSongTitle(data.title) || data.title,
  };
}

export async function createYouTubePlayer(
  containerId: string,
  rawVideoId: string,
  onReady?: () => void
): Promise<YT.Player> {
  await waitForYTApi();
  lastError = null;

  const videoId = extractYouTubeId(rawVideoId);
  if (!videoId) {
    throw new Error('ไม่พบ YouTube Video ID ที่ถูกต้อง');
  }

  // Destroy existing player
  if (currentPlayer) {
    try { currentPlayer.destroy(); } catch { /* ignore */ }
    currentPlayer = null;
  }

  return new Promise((resolve, reject) => {
    const player = new window.YT.Player(containerId, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        showinfo: 0,
        cc_load_policy: 0,
        origin: window.location.origin,
      },
      events: {
        onReady: (event) => {
          currentPlayer = event.target;
          if (onReady) onReady();
          resolve(event.target);
        },
        onError: (event) => {
          const code = event.data;
          lastError = code;
          console.warn(`YouTube Player Error ${code}: ${getErrorMessage(code)} (Video: ${videoId})`);
          // Reject so the game can handle it (skip to reveal, show error, etc.)
          reject(new Error(getErrorMessage(code)));
        },
      },
    });
  });
}

/**
 * Interactive preview player for the Track Editor with player controls enabled
 */
export async function createPreviewPlayer(
  containerId: string,
  rawVideoId: string,
  startTime: number = 0
): Promise<YT.Player> {
  await waitForYTApi();
  const videoId = extractYouTubeId(rawVideoId);
  if (!videoId) {
    throw new Error('ไม่พบ YouTube Video ID ที่ถูกต้อง');
  }

  return new Promise((resolve, reject) => {
    const player = new window.YT.Player(containerId, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0,
        controls: 1, // Enable playback and timeline controls
        disablekb: 0,
        fs: 1,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        start: Math.max(0, Math.floor(startTime)),
        origin: window.location.origin,
      },
      events: {
        onReady: (event) => {
          resolve(event.target);
        },
        onError: (event) => {
          reject(new Error(getErrorMessage(event.data)));
        },
      },
    });
  });
}

/**
 * Pre-buffer: mute → seekTo → play briefly → pause
 * Call during countdown to have the video ready
 */
export async function prebufferAt(player: YT.Player, startTime: number): Promise<void> {
  try {
    player.mute();
    player.seekTo(startTime, true);
    player.playVideo();
  } catch {
    // Player may have been destroyed or errored
    return;
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      try { player.pauseVideo(); } catch { /* ignore */ }
      resolve();
    }, 800);
  });
}

/**
 * Play a segment: unmute → play → auto-stop after duration
 */
export function playSegment(
  player: YT.Player,
  startTime: number,
  duration: number,
  onEnd?: () => void
): { cancel: () => void } {
  try {
    player.seekTo(startTime, true);
    player.unMute();
    player.setVolume(100);
    player.playVideo();
  } catch {
    if (onEnd) onEnd();
    return { cancel: () => {} };
  }

  const timer = setTimeout(() => {
    try {
      player.pauseVideo();
      player.mute();
    } catch { /* ignore */ }
    if (onEnd) onEnd();
  }, duration * 1000);

  return {
    cancel: () => {
      clearTimeout(timer);
      try { player.pauseVideo(); player.mute(); } catch { /* ignore */ }
    },
  };
}

/**
 * Play for reveal phase — continuous play with unmuted audio
 */
export function playReveal(player: YT.Player, startTime: number, duration: number): { cancel: () => void } {
  try {
    player.seekTo(startTime, true);
    player.unMute();
    player.setVolume(80);
    player.playVideo();
  } catch {
    return { cancel: () => {} };
  }

  const timer = setTimeout(() => {
    try { player.pauseVideo(); } catch { /* ignore */ }
  }, duration * 1000);

  return {
    cancel: () => {
      clearTimeout(timer);
      try { player.pauseVideo(); } catch { /* ignore */ }
    },
  };
}

/** Fully stop and mute */
export function stopPlayer(player: YT.Player): void {
  try {
    player.pauseVideo();
    player.mute();
  } catch { /* ignore if destroyed */ }
}

/** Get current player instance */
export function getCurrentPlayer(): YT.Player | null {
  return currentPlayer;
}

/** Destroy current player */
export function destroyPlayer(): void {
  if (currentPlayer) {
    try { currentPlayer.destroy(); } catch { /* ignore */ }
    currentPlayer = null;
  }
}
