/* ──────────────────────────────────────────────
   YouTube IFrame Player Wrapper & Dual-Player Manager
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
 * 100 = Video not found / removed
 * 101 = Embedding not allowed (by owner)
 * 150 = Same as 101 — embedding restricted
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

/* ──────────────────────────────────────────────
   Dual YouTube Player Manager (Ping-Pong Buffering)
   ────────────────────────────────────────────── */

export interface PreloadResult {
  success: boolean;
  adDetected: boolean;
  timeTakenMs: number;
}

export class DualYouTubePlayerManager {
  playerA: YT.Player | null = null;
  playerB: YT.Player | null = null;
  activeSlot: 'A' | 'B' = 'A';

  isReadyA: boolean = false;
  isReadyB: boolean = false;
  currentVideoIdA: string = '';
  currentVideoIdB: string = '';

  private stageEl: HTMLElement | null = null;
  private slotAWrapper: HTMLElement | null = null;
  private slotBWrapper: HTMLElement | null = null;
  private antiSpoilerBar: HTMLElement | null = null;
  private isStageVisible: boolean = false;
  private isWarmedUp: boolean = false;
  private initPromise: Promise<void> | null = null;

  private activeIntervalA: ReturnType<typeof setInterval> | null = null;
  private activeIntervalB: ReturnType<typeof setInterval> | null = null;
  private activeTimeoutA: ReturnType<typeof setTimeout> | null = null;
  private activeTimeoutB: ReturnType<typeof setTimeout> | null = null;

  private snippetTimer: ReturnType<typeof setTimeout> | null = null;
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cleanupViewportListeners: (() => void) | null = null;

  /**
   * Ensure host container and player mount divs exist in the DOM.
   * If #yt-player-a and #yt-player-b do not exist yet, creates a persistent stage in document.body.
   */
  ensureContainers(containerAId = 'yt-player-a', containerBId = 'yt-player-b'): { elA: HTMLElement; elB: HTMLElement } {
    let elA = document.getElementById(containerAId);
    let elB = document.getElementById(containerBId);

    if (!elA || !elB) {
      // Create persistent stage in body so player iframes survive route changes
      if (!this.stageEl) {
        const existingStage = document.getElementById('dual-player-stage');
        if (existingStage) {
          this.stageEl = existingStage;
        } else {
          this.stageEl = document.createElement('div');
          this.stageEl.id = 'dual-player-stage';
          this.stageEl.className = 'fixed pointer-events-none transition-opacity duration-300';
          this.stageEl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:640px;height:360px;opacity:0;visibility:hidden;pointer-events:none;z-index:15;border-radius:1rem;overflow:hidden;background:#000;';
          this.stageEl.innerHTML = `
            <div id="dual-slot-wrapper-a" style="position:absolute;inset:0;width:100%;height:100%;transition:opacity 0.3s ease;z-index:2;opacity:1;visibility:visible;">
              <div id="${containerAId}" style="width:100%;height:100%;"></div>
            </div>
            <div id="dual-slot-wrapper-b" style="position:absolute;inset:0;width:100%;height:100%;transition:opacity 0.3s ease;z-index:1;opacity:0;visibility:hidden;pointer-events:none;">
              <div id="${containerBId}" style="width:100%;height:100%;"></div>
            </div>
            <div id="dual-anti-spoiler-bar" style="position:absolute;top:0;left:0;right:0;height:72px;background:#0a0a14;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;padding:0 16px;pointer-events:none;z-index:30;transition:opacity 0.3s ease;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span id="dual-anti-spoiler-dot" class="w-2.5 h-2.5 rounded-full bg-accent-purple animate-pulse"></span>
                <span style="font-weight:bold;font-size:13px;color:#fff;letter-spacing:0.02em;">
                  GuessThe? <span id="dual-anti-spoiler-mode" class="gradient-text font-semibold">Game</span>
                </span>
              </div>
              <span id="dual-anti-spoiler-badge" style="font-size:11px;font-weight:600;color:#c084fc;background:rgba(192,132,252,0.15);border:1px solid rgba(192,132,252,0.3);padding:3px 10px;border-radius:9999px;">
                🎬 GuessThe?
              </span>
            </div>
          `;
          document.body.appendChild(this.stageEl);
        }
      }
      elA = document.getElementById(containerAId);
      elB = document.getElementById(containerBId);
    }

    this.slotAWrapper = document.getElementById('dual-slot-wrapper-a');
    this.slotBWrapper = document.getElementById('dual-slot-wrapper-b');
    this.antiSpoilerBar = document.getElementById('dual-anti-spoiler-bar');

    return { elA: elA!, elB: elB! };
  }

  /**
   * Initialize both YT.Player instances with required options
   */
  async init(containerAId = 'yt-player-a', containerBId = 'yt-player-b'): Promise<void> {
    if (this.initPromise) return this.initPromise;

    // Check if both players already exist and respond
    if (
      this.playerA && typeof (this.playerA as any).getPlayerState === 'function' &&
      this.playerB && typeof (this.playerB as any).getPlayerState === 'function'
    ) {
      return Promise.resolve();
    }

    this.initPromise = (async () => {
      await waitForYTApi();
      this.ensureContainers(containerAId, containerBId);

      const playerVars: Record<string, any> = {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        iv_load_policy: 3,
        enablejsapi: 1,
        playsinline: 1,
        origin: window.location.origin,
        widget_referrer: window.location.href,
      };

      const initSlot = (slot: 'A' | 'B', containerId: string): Promise<YT.Player> => {
        return new Promise((resolve) => {
          let settled = false;
          const safetyTimeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              console.warn(`[DualPlayer] Slot ${slot} onReady timeout — continuing`);
              resolve(instance);
            }
          }, 6000);

          const instance = new window.YT.Player(containerId, {
            width: '100%',
            height: '100%',
            host: 'https://www.youtube.com',
            playerVars,
            events: {
              onReady: (evt) => {
                if (!settled) {
                  settled = true;
                  clearTimeout(safetyTimeout);
                  resolve(evt.target);
                }
              },
              onError: (evt) => {
                const code = evt.data;
                console.warn(`[DualPlayer] Slot ${slot} error ${code}: ${getErrorMessage(code)}`);
                if (!settled) {
                  settled = true;
                  clearTimeout(safetyTimeout);
                  resolve(instance);
                }
              },
            },
          });
        });
      };

      const [pA, pB] = await Promise.all([
        initSlot('A', containerAId),
        initSlot('B', containerBId),
      ]);

      this.playerA = pA;
      this.playerB = pB;
      currentPlayer = pA; // Default current player
    })();

    return this.initPromise;
  }

  /**
   * Warm-up players to satisfy browser Autoplay Policy:
   * Called on user gestures (สร้างห้อง, เข้าห้อง, เล่นคนเดียว)
   * Mutes both players and calls play/pause briefly
   */
  async warmUp(): Promise<void> {
    if (this.isWarmedUp) return;
    try {
      await this.init();
      if (this.playerA && typeof this.playerA.mute === 'function') {
        this.playerA.mute();
        this.playerA.playVideo?.();
      }
      if (this.playerB && typeof this.playerB.mute === 'function') {
        this.playerB.mute();
        this.playerB.playVideo?.();
      }

      await new Promise((r) => setTimeout(r, 60));

      if (this.playerA && typeof this.playerA.pauseVideo === 'function') {
        this.playerA.pauseVideo();
      }
      if (this.playerB && typeof this.playerB.pauseVideo === 'function') {
        this.playerB.pauseVideo();
      }

      this.isWarmedUp = true;
      console.log('[DualPlayer] Warm-up complete — Autoplay policy unlocked');
    } catch (err) {
      console.warn('[DualPlayer] Warm-up warning:', err);
    }
  }

  /**
   * Silent Ad Burner & Preloader for a slot:
   * 1. Mutes player
   * 2. Loads video at startTime
   * 3. Polls status every 250ms:
   *    - If duration < 60s -> pre-roll ad is playing, let it burn silently
   *    - When state === 1 (PLAYING) and duration >= 60s -> reached real video!
   *    - Immediately seekTo(startTime, true) and pauseVideo()
   * 4. Hard safety timeout 25s: force seekTo & pauseVideo
   */
  async preload(slot: 'A' | 'B', rawVideoId: string, startTime: number = 0): Promise<PreloadResult> {
    const videoId = extractYouTubeId(rawVideoId);
    if (!videoId) {
      return { success: false, adDetected: false, timeTakenMs: 0 };
    }

    await this.init();
    const player = slot === 'A' ? this.playerA : this.playerB;
    if (!player || typeof (player as any).loadVideoById !== 'function') {
      return { success: false, adDetected: false, timeTakenMs: 0 };
    }

    // Clear any active polling on this slot
    this.clearSlotTimers(slot);

    // If slot is already loaded with the same video and ready, just seek and pause
    const currentVideoId = slot === 'A' ? this.currentVideoIdA : this.currentVideoIdB;
    const isReady = slot === 'A' ? this.isReadyA : this.isReadyB;
    if (currentVideoId === videoId && isReady) {
      try {
        player.mute();
        player.seekTo(startTime, true);
        player.pauseVideo();
      } catch {}
      return { success: true, adDetected: false, timeTakenMs: 0 };
    }

    if (slot === 'A') {
      this.isReadyA = false;
      this.currentVideoIdA = videoId;
    } else {
      this.isReadyB = false;
      this.currentVideoIdB = videoId;
    }

    const startTimestamp = Date.now();
    const startSec = Math.max(0, Math.floor(startTime));
    let adDetected = false;

    return new Promise<PreloadResult>((resolve) => {
      let resolved = false;

      const finish = (success: boolean) => {
        if (resolved) return;
        resolved = true;
        this.clearSlotTimers(slot);

        try {
          player.pauseVideo();
          player.seekTo(startTime, true);
        } catch {}

        if (slot === 'A') this.isReadyA = true;
        else this.isReadyB = true;

        const timeTakenMs = Date.now() - startTimestamp;
        resolve({ success, adDetected, timeTakenMs });
      };

      try {
        player.mute();
        player.loadVideoById({
          videoId,
          startSeconds: startSec,
        });
        player.playVideo();
      } catch (err) {
        console.warn(`[DualPlayer] Preload initiation error on slot ${slot}:`, err);
      }

      // Check status every 250ms
      const interval = setInterval(() => {
        try {
          const duration = typeof player.getDuration === 'function' ? player.getDuration() : 0;
          const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;

          // Ad check
          const isAdState = (
            (typeof (player as any).getAdState === 'function' && (player as any).getAdState() === 1) ||
            (typeof (player as any).isAdPlaying === 'function' && (player as any).isAdPlaying() === true)
          );
          const videoData = typeof (player as any).getVideoData === 'function' ? (player as any).getVideoData() : null;
          const isWrongVideo = videoData && videoData.video_id && videoData.video_id !== videoId;

          if (isAdState || isWrongVideo || (duration > 0 && duration < 60)) {
            adDetected = true;
            // Let the ad burn silently muted
            return;
          }

          // Main video reached
          if (state === 1 && duration >= 60) {
            // Reached real video! Seek to startTime and pause immediately
            finish(true);
            return;
          }

          // Fallback check: if paused/buffering with target duration and current time near startTime
          if ((state === 2 || state === 3) && duration >= 60) {
            const curTime = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
            if (startTime <= 1 || curTime >= Math.max(0, startTime - 1)) {
              finish(true);
            }
          }
        } catch {
          // Ignore transient postMessage timing errors
        }
      }, 250);

      if (slot === 'A') this.activeIntervalA = interval;
      else this.activeIntervalB = interval;

      // 25s Hard Timeout: prevent game freeze on slow networks or stalled ads
      const timeout = setTimeout(() => {
        console.warn(`[DualPlayer] Slot ${slot} preload reached 25s hard timeout — forcing pause`);
        finish(false);
      }, 25000);

      if (slot === 'A') this.activeTimeoutA = timeout;
      else this.activeTimeoutB = timeout;
    });
  }

  /**
   * Deterministically synchronize active slot based on question index:
   * Even index (0, 2, 4...) -> Slot A
   * Odd index (1, 3, 5...)  -> Slot B
   */
  syncActiveSlot(questionIndex: number): 'A' | 'B' {
    const targetSlot: 'A' | 'B' = (questionIndex % 2 === 0) ? 'A' : 'B';
    return this.setActiveSlot(targetSlot);
  }

  /**
   * Set active slot explicitly, properly toggling opacity, visibility, and pointer-events on wrappers
   */
  setActiveSlot(slot: 'A' | 'B'): 'A' | 'B' {
    this.activeSlot = slot;

    if (!this.slotAWrapper || !this.slotBWrapper) {
      this.slotAWrapper = document.getElementById('dual-slot-wrapper-a');
      this.slotBWrapper = document.getElementById('dual-slot-wrapper-b');
    }

    if (this.slotAWrapper && this.slotBWrapper) {
      if (slot === 'A') {
        this.slotAWrapper.style.opacity = '1';
        this.slotAWrapper.style.visibility = 'visible';
        this.slotAWrapper.style.zIndex = '2';
        this.slotAWrapper.style.pointerEvents = 'none';

        this.slotBWrapper.style.opacity = '0';
        this.slotBWrapper.style.visibility = 'hidden';
        this.slotBWrapper.style.zIndex = '1';
        this.slotBWrapper.style.pointerEvents = 'none';
      } else {
        this.slotBWrapper.style.opacity = '1';
        this.slotBWrapper.style.visibility = 'visible';
        this.slotBWrapper.style.zIndex = '2';
        this.slotBWrapper.style.pointerEvents = 'none';

        this.slotAWrapper.style.opacity = '0';
        this.slotAWrapper.style.visibility = 'hidden';
        this.slotAWrapper.style.zIndex = '1';
        this.slotAWrapper.style.pointerEvents = 'none';
      }
    }

    // Safety: ensure background player is muted and paused
    const bgPlayer = this.getBackgroundPlayer();
    if (bgPlayer) {
      try {
        bgPlayer.pauseVideo();
        bgPlayer.mute();
      } catch {}
    }

    currentPlayer = this.getActivePlayer();
    console.log(`[DualPlayer] Active slot set to ${this.activeSlot} (Bg: ${this.getBackgroundSlot()})`);
    return this.activeSlot;
  }

  /**
   * Toggle between A and B
   */
  switchActivePlayer(): 'A' | 'B' {
    const nextSlot = this.activeSlot === 'A' ? 'B' : 'A';
    return this.setActiveSlot(nextSlot);
  }

  getBackgroundSlot(): 'A' | 'B' {
    return this.activeSlot === 'A' ? 'B' : 'A';
  }

  /**
   * Play snippet on Active Player: unmute, volume 100, play for durationSec
   */
  playSnippet(durationSec: number, onEnd?: () => void): { cancel: () => void } {
    if (this.snippetTimer) {
      clearTimeout(this.snippetTimer);
      this.snippetTimer = null;
    }

    const player = this.getActivePlayer();
    if (!player) {
      if (onEnd) onEnd();
      return { cancel: () => {} };
    }

    try {
      player.unMute();
      player.setVolume(100);
      player.playVideo();
    } catch (err) {
      console.warn('[DualPlayer] playSnippet error:', err);
      if (onEnd) onEnd();
      return { cancel: () => {} };
    }

    const timer = setTimeout(() => {
      try {
        player.pauseVideo();
      } catch {}
      if (onEnd) onEnd();
    }, durationSec * 1000);

    this.snippetTimer = timer;

    return {
      cancel: () => {
        clearTimeout(timer);
        try { player.pauseVideo(); } catch {}
      },
    };
  }

  /**
   * Play reveal on Active Player: seekTo revealStartTime, unmute, volume 100, play for durationSec
   */
  playReveal(revealStartTime: number, durationSec: number, onEnd?: () => void): { cancel: () => void } {
    if (this.revealTimer) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }

    const player = this.getActivePlayer();
    if (!player) {
      if (onEnd) onEnd();
      return { cancel: () => {} };
    }

    try {
      player.unMute();
      player.setVolume(100);
      player.seekTo(revealStartTime, true);
      player.playVideo();
    } catch (err) {
      console.warn('[DualPlayer] playReveal error:', err);
      if (onEnd) onEnd();
      return { cancel: () => {} };
    }

    const timer = setTimeout(() => {
      try {
        player.pauseVideo();
      } catch {}
      if (onEnd) onEnd();
    }, durationSec * 1000);

    this.revealTimer = timer;

    return {
      cancel: () => {
        clearTimeout(timer);
        try { player.pauseVideo(); } catch {}
      },
    };
  }

  /**
   * Synchronize stage visual viewport with 16:9 container on Game Screen
   */
  mountToGameScreen(viewportAnchor: HTMLElement): void {
    this.ensureContainers();
    if (!this.stageEl) return;

    if (this.cleanupViewportListeners) {
      this.cleanupViewportListeners();
      this.cleanupViewportListeners = null;
    }

    const sync = () => {
      if (!this.stageEl || !viewportAnchor.isConnected) return;
      const rect = viewportAnchor.getBoundingClientRect();
      const style = window.getComputedStyle(viewportAnchor);

      this.stageEl.style.display = 'block';
      this.stageEl.style.position = 'fixed';
      this.stageEl.style.top = `${rect.top}px`;
      this.stageEl.style.left = `${rect.left}px`;
      this.stageEl.style.width = `${rect.width}px`;
      this.stageEl.style.height = `${rect.height}px`;
      this.stageEl.style.borderRadius = style.borderRadius || '1rem';
      this.stageEl.style.zIndex = '15';
      this.stageEl.style.pointerEvents = 'none';

      // Keep stage hidden initially until explicitly revealed
      if (!this.isStageVisible) {
        this.stageEl.style.opacity = '0';
        this.stageEl.style.visibility = 'hidden';
      } else {
        this.stageEl.style.opacity = '1';
        this.stageEl.style.visibility = 'visible';
      }
    };

    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync);

    let syncFrames = 0;
    let syncAnimId: number | null = null;
    const continuousSync = () => {
      sync();
      if (syncFrames++ < 45 && viewportAnchor.isConnected) {
        syncAnimId = requestAnimationFrame(continuousSync);
      }
    };
    continuousSync();

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(sync);
      this.resizeObserver.observe(viewportAnchor);
    }

    this.cleanupViewportListeners = () => {
      if (syncAnimId) {
        cancelAnimationFrame(syncAnimId);
        syncAnimId = null;
      }
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync);
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
    };
  }

  /**
   * Toggle visibility of the dual player stage (hide completely during countdown/curtain)
   */
  setStageVisible(visible: boolean): void {
    this.isStageVisible = visible;
    if (!this.stageEl) return;
    if (visible) {
      this.stageEl.style.opacity = '1';
      this.stageEl.style.visibility = 'visible';
    } else {
      this.stageEl.style.opacity = '0';
      this.stageEl.style.visibility = 'hidden';
    }
  }

  /**
   * Update Anti-Spoiler Top Bar styling & visibility
   */
  updateAntiSpoiler(mode: 'video' | 'audio' | 'music', showTitleMask: boolean = true): void {
    if (!this.antiSpoilerBar) {
      this.antiSpoilerBar = document.getElementById('dual-anti-spoiler-bar');
    }
    if (!this.antiSpoilerBar) return;

    if (showTitleMask) {
      this.antiSpoilerBar.style.display = 'flex';
      this.antiSpoilerBar.style.opacity = '1';
      const modeEl = document.getElementById('dual-anti-spoiler-mode');
      const badgeEl = document.getElementById('dual-anti-spoiler-badge');
      const dotEl = document.getElementById('dual-anti-spoiler-dot');
      if (modeEl) modeEl.textContent = mode === 'video' ? 'MV' : 'Music';
      if (badgeEl) badgeEl.textContent = mode === 'video' ? '🎬 ทาย MV' : '🎵 ทายเพลง';
      if (dotEl) {
        dotEl.className = `w-2.5 h-2.5 rounded-full ${mode === 'video' ? 'bg-accent-blue' : 'bg-accent-purple'} animate-pulse`;
      }
    } else {
      this.antiSpoilerBar.style.opacity = '0';
      setTimeout(() => {
        if (this.antiSpoilerBar && this.antiSpoilerBar.style.opacity === '0') {
          this.antiSpoilerBar.style.display = 'none';
        }
      }, 300);
    }
  }

  /**
   * Hide player stage off-screen when leaving game screen
   */
  hideFromGameScreen(): void {
    if (this.cleanupViewportListeners) {
      this.cleanupViewportListeners();
      this.cleanupViewportListeners = null;
    }
    this.isStageVisible = false;
    if (this.stageEl) {
      this.stageEl.style.opacity = '0';
      this.stageEl.style.visibility = 'hidden';
      this.stageEl.style.top = '-9999px';
      this.stageEl.style.left = '-9999px';
      this.stageEl.style.display = 'none';
    }
    this.pauseAll();
  }

  getActivePlayer(): YT.Player | null {
    return this.activeSlot === 'A' ? this.playerA : this.playerB;
  }

  getBackgroundPlayer(): YT.Player | null {
    return this.activeSlot === 'A' ? this.playerB : this.playerA;
  }

  getActiveSlot(): 'A' | 'B' {
    return this.activeSlot;
  }

  isSlotReady(slot: 'A' | 'B'): boolean {
    return slot === 'A' ? this.isReadyA : this.isReadyB;
  }

  pauseAll(): void {
    try { this.playerA?.pauseVideo(); } catch {}
    try { this.playerB?.pauseVideo(); } catch {}
  }

  stopAll(): void {
    this.pauseAll();
    try { this.playerA?.mute(); } catch {}
    try { this.playerB?.mute(); } catch {}
  }

  private clearSlotTimers(slot: 'A' | 'B'): void {
    if (slot === 'A') {
      if (this.activeIntervalA) { clearInterval(this.activeIntervalA); this.activeIntervalA = null; }
      if (this.activeTimeoutA) { clearTimeout(this.activeTimeoutA); this.activeTimeoutA = null; }
    } else {
      if (this.activeIntervalB) { clearInterval(this.activeIntervalB); this.activeIntervalB = null; }
      if (this.activeTimeoutB) { clearTimeout(this.activeTimeoutB); this.activeTimeoutB = null; }
    }
  }

  destroy(): void {
    this.clearSlotTimers('A');
    this.clearSlotTimers('B');
    if (this.snippetTimer) { clearTimeout(this.snippetTimer); this.snippetTimer = null; }
    if (this.revealTimer) { clearTimeout(this.revealTimer); this.revealTimer = null; }
    if (this.cleanupViewportListeners) {
      this.cleanupViewportListeners();
      this.cleanupViewportListeners = null;
    }

    try { this.playerA?.destroy(); } catch {}
    try { this.playerB?.destroy(); } catch {}
    this.playerA = null;
    this.playerB = null;
    this.initPromise = null;
    this.isWarmedUp = false;
    this.isReadyA = false;
    this.isReadyB = false;

    if (this.stageEl) {
      this.stageEl.remove();
      this.stageEl = null;
    }
  }
}

// Export singleton instance and class aliases
export const dualPlayerManager = new DualYouTubePlayerManager();
export const DualPlayerManager = DualYouTubePlayerManager;

/* ──────────────────────────────────────────────
   Legacy Single-Player API Compatibility Helpers
   (Required by Track Editor, Leaderboard & Media Engine)
   ────────────────────────────────────────────── */

export async function createYouTubePlayer(
  containerId: string,
  rawVideoId: string,
  startTime: number = 0,
  onReady?: () => void
): Promise<YT.Player> {
  await waitForYTApi();
  lastError = null;

  const videoId = extractYouTubeId(rawVideoId);
  if (!videoId) {
    throw new Error('ไม่พบ YouTube Video ID ที่ถูกต้อง');
  }

  if (currentPlayer && typeof (currentPlayer as any).loadVideoById === 'function') {
    try {
      (currentPlayer as any).loadVideoById({
        videoId,
        startSeconds: Math.max(0, Math.floor(startTime)),
      });
      return currentPlayer;
    } catch {}
  }

  if (currentPlayer) {
    try { currentPlayer.destroy(); } catch {}
    currentPlayer = null;
  }

  let containerEl = document.getElementById(containerId);
  if (!containerEl) {
    const wrap = document.getElementById('game-yt-player-wrap');
    if (wrap) {
      wrap.innerHTML = `<div id="${containerId}" class="w-full h-full"></div>`;
      containerEl = document.getElementById(containerId);
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        if (currentPlayer) resolve(currentPlayer);
        else reject(new Error('YouTube Player initialization timed out'));
      }
    }, 4500);

    const player = new window.YT.Player(containerId, {
      videoId,
      width: '100%',
      height: '100%',
      host: 'https://www.youtube.com',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        enablejsapi: 1,
        fs: 0,
        iv_load_policy: 3,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        start: Math.max(0, Math.floor(startTime)),
        showinfo: 0,
        cc_load_policy: 0,
        origin: window.location.origin,
        widget_referrer: window.location.href,
      },
      events: {
        onReady: (event) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            currentPlayer = event.target;
            if (onReady) onReady();
            resolve(event.target);
          }
        },
        onError: (event) => {
          const code = event.data;
          lastError = code;
          console.warn(`YouTube Player Error ${code}: ${getErrorMessage(code)} (Video: ${videoId})`);
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error(getErrorMessage(code)));
          }
        },
      },
    });
    currentPlayer = player;
  });
}

/**
 * Interactive preview player for Track Editor with controls enabled
 * (Strictly preserved for track-editor-screen.ts)
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
      host: 'https://www.youtube.com',
      playerVars: {
        autoplay: 0,
        controls: 1,
        disablekb: 0,
        enablejsapi: 1,
        fs: 1,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        start: Math.max(0, Math.floor(startTime)),
        origin: window.location.origin,
        widget_referrer: window.location.href,
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

export interface BurnPreRollResult {
  success: boolean;
  adDetected: boolean;
  timeTakenMs: number;
}

let activeBurnCancel: (() => void) | null = null;

export function cancelBurnPreRoll(): void {
  if (activeBurnCancel) {
    activeBurnCancel();
    activeBurnCancel = null;
  }
}

export function burnPreRoll(
  player: YT.Player,
  rawVideoId: string,
  startTime: number = 0,
  maxWaitMs: number = 8500
): Promise<BurnPreRollResult> & { cancel: () => void } {
  cancelBurnPreRoll();

  const videoId = extractYouTubeId(rawVideoId);
  const startTimestamp = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let adDetected = false;

  const cancel = () => {
    cancelled = true;
    if (timer) { clearInterval(timer); timer = null; }
    if (timeout) { clearTimeout(timeout); timeout = null; }
    if (activeBurnCancel === cancel) { activeBurnCancel = null; }
  };

  activeBurnCancel = cancel;

  const promise = new Promise<BurnPreRollResult>((resolve) => {
    if (!player || typeof (player as any).loadVideoById !== 'function') {
      resolve({ success: false, adDetected: false, timeTakenMs: 0 });
      return;
    }

    const startSec = Math.max(0, Math.floor(startTime));

    try {
      player.mute();
      player.loadVideoById({
        videoId,
        startSeconds: startSec,
      });
      player.playVideo();
    } catch (err) {
      console.warn('[YouTubePlayer] burnPreRoll initiation error:', err);
    }

    const checkReady = () => {
      if (cancelled) return;

      try {
        const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
        const isAdActive = (
          (typeof (player as any).getAdState === 'function' && (player as any).getAdState() === 1) ||
          (typeof (player as any).isAdPlaying === 'function' && (player as any).isAdPlaying() === true)
        );

        const videoData = typeof (player as any).getVideoData === 'function' ? (player as any).getVideoData() : null;
        const isDifferentVideo = videoData && videoData.video_id && videoData.video_id !== videoId;
        const isAdTitle = videoData && videoData.title && /advertisement|sponsor|promo/i.test(videoData.title);

        if (isAdActive || isDifferentVideo || isAdTitle) {
          adDetected = true;
          return;
        }

        if (state === 1 || state === 2 || state === 3) {
          const curTime = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
          const reachedTarget = startTime > 1
            ? (curTime >= Math.max(0, startTime - 0.75))
            : (state === 1 && curTime >= 0);

          if (reachedTarget) {
            try {
              player.pauseVideo();
              player.seekTo(startTime, true);
            } catch {}

            const durationMs = Date.now() - startTimestamp;
            cancel();
            resolve({ success: true, adDetected, timeTakenMs: durationMs });
          }
        }
      } catch {}
    };

    timer = setInterval(checkReady, 100);

    timeout = setTimeout(() => {
      if (!cancelled) {
        try {
          player.pauseVideo();
          player.seekTo(startTime, true);
        } catch {}
        const durationMs = Date.now() - startTimestamp;
        cancel();
        resolve({ success: false, adDetected, timeTakenMs: durationMs });
      }
    }, maxWaitMs);
  });

  const cancellable = promise as Promise<BurnPreRollResult> & { cancel: () => void };
  cancellable.cancel = cancel;
  return cancellable;
}

export async function prebufferAt(player: YT.Player, startTime: number): Promise<void> {
  try {
    player.mute();
    player.seekTo(startTime, true);
    player.playVideo();
  } catch {
    return;
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        player.pauseVideo();
        player.unMute();
        player.setVolume(100);
      } catch {}
      resolve();
    }, 600);
  });
}

export function playSegment(
  player: YT.Player,
  startTime: number,
  duration: number,
  onEnd?: () => void
): { cancel: () => void } {
  try {
    player.unMute();
    player.setVolume(100);
    player.seekTo(startTime, true);
    player.playVideo();
  } catch (err) {
    console.warn('[YouTubePlayer] playSegment error:', err);
    if (onEnd) onEnd();
    return { cancel: () => {} };
  }

  const timer = setTimeout(() => {
    try { player.pauseVideo(); } catch {}
    if (onEnd) onEnd();
  }, duration * 1000);

  return {
    cancel: () => {
      clearTimeout(timer);
      try { player.pauseVideo(); } catch {}
    },
  };
}

export function playReveal(player: YT.Player, startTime: number, duration: number): { cancel: () => void } {
  try {
    player.unMute();
    player.setVolume(100);
    player.seekTo(startTime, true);
    player.playVideo();
  } catch {
    return { cancel: () => {} };
  }

  const timer = setTimeout(() => {
    try { player.pauseVideo(); } catch {}
  }, duration * 1000);

  return {
    cancel: () => {
      clearTimeout(timer);
      try { player.pauseVideo(); } catch {}
    },
  };
}

export function stopPlayer(player: YT.Player): void {
  try {
    player.pauseVideo();
    player.mute();
  } catch {}
}

export function getCurrentPlayer(): YT.Player | null {
  return currentPlayer;
}

export function destroyPlayer(): void {
  if (currentPlayer) {
    try { currentPlayer.destroy(); } catch {}
    currentPlayer = null;
  }
}
