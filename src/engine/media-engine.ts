/* ──────────────────────────────────────────────
   Resilient Dual Media Engine
   1. Direct HTML5 Media Streaming (.mp3/.mp4/.webm)
   2. YouTube IFrame Player API
   ────────────────────────────────────────────── */

import {
  extractYouTubeId,
  createYouTubePlayer,
  prebufferAt,
  playSegment,
  playReveal as ytPlayReveal,
  stopPlayer,
  destroyPlayer,
} from './youtube-player';

export interface MediaSegmentControl {
  cancel: () => void;
}

type PlayerMode = 'html5' | 'youtube' | null;

class MediaEngine {
  private mode: PlayerMode = null;
  private html5Element: HTMLVideoElement | null = null;
  private ytPlayer: YT.Player | null = null;
  private segmentTimeout: number | null = null;

  get isReady(): boolean {
    if (this.mode === 'html5') return this.html5Element !== null;
    if (this.mode === 'youtube') return this.ytPlayer !== null && typeof this.ytPlayer.seekTo === 'function';
    return false;
  }

  /**
   * Initializes and prebuffers the media element at startTime
   */
  async initAndPrebuffer(
    containerId: string,
    rawUrlOrId: string,
    type: 'audio' | 'video',
    startTime: number
  ): Promise<void> {
    this.stop();
    this.destroy();

    // Wait for container to appear in DOM (retry up to 1s)
    let container = document.getElementById(containerId);
    if (!container) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((r) => setTimeout(r, 100));
        container = document.getElementById(containerId);
        if (container) break;
      }
    }
    if (!container) {
      throw new Error(`Container #${containerId} ไม่พบในหน้าจอ`);
    }

    const youtubeId = extractYouTubeId(rawUrlOrId);

    // ── Direct Media URL (.mp3 / .mp4 / .webm) ──
    if (
      rawUrlOrId.startsWith('http') &&
      (rawUrlOrId.endsWith('.mp3') ||
        rawUrlOrId.endsWith('.mp4') ||
        rawUrlOrId.endsWith('.webm') ||
        rawUrlOrId.includes('.mp3?') ||
        rawUrlOrId.includes('.mp4?'))
    ) {
      await this.setupHtml5Player(container, rawUrlOrId, type, startTime);
      this.mode = 'html5';
      console.log('[MediaEngine] Using HTML5 Direct Media Player');
      return;
    }

    // ── YouTube Video Player ──
    if (youtubeId && youtubeId.length === 11) {
      await this.setupYouTubePlayer(container, youtubeId, type, startTime);
      this.mode = 'youtube';
      console.log('[MediaEngine] Using YouTube Player');
      return;
    }

    throw new Error('ไม่สามารถเล่นสื่อนี้ได้: ไม่พบ YouTube ID หรือไฟล์สื่อที่ถูกต้อง');
  }

  /**
   * Setup HTML5 Video Element
   */
  private async setupHtml5Player(
    container: HTMLElement,
    streamUrl: string,
    type: 'audio' | 'video',
    startTime: number
  ): Promise<void> {
    container.innerHTML = '';

    const el = document.createElement('video');
    el.id = 'active-media-player';
    el.className = 'w-full h-full object-contain bg-black transition-opacity duration-300';
    el.setAttribute('playsinline', 'true');
    el.setAttribute('webkit-playsinline', 'true');
    el.preload = 'auto';

    if (type === 'audio') {
      el.classList.add('opacity-0');
    } else {
      el.classList.add('opacity-100');
    }

    container.appendChild(el);
    this.html5Element = el;

    el.src = streamUrl;
    el.muted = true;

    return new Promise<void>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 3500);

      const onCanPlay = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          try {
            el.currentTime = Math.max(0, startTime);
            const p = el.play();
            if (p !== undefined) {
              p.then(() => {
                setTimeout(() => {
                  try { el.pause(); } catch { /* ignore */ }
                  resolve();
                }, 150);
              }).catch(() => resolve());
            } else {
              el.pause();
              resolve();
            }
          } catch {
            resolve();
          }
        }
      };

      el.addEventListener('canplay', onCanPlay, { once: true });
      el.addEventListener('loadedmetadata', () => {
        try { el.currentTime = Math.max(0, startTime); } catch { /* ignore */ }
      }, { once: true });
      el.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        }
      }, { once: true });

      el.load();
    });
  }

  /**
   * Setup YouTube Player
   */
  private async setupYouTubePlayer(
    container: HTMLElement,
    youtubeId: string,
    type: 'audio' | 'video',
    startTime: number
  ): Promise<void> {
    if (this.ytPlayer) {
      try { this.ytPlayer.destroy(); } catch { /* ignore */ }
      this.ytPlayer = null;
    }

    container.innerHTML = `<div id="yt-player-embed" class="w-full h-full ${type === 'audio' ? 'opacity-0' : 'opacity-100'}"></div>`;

    const player = await createYouTubePlayer('yt-player-embed', youtubeId);
    this.ytPlayer = player;
    await prebufferAt(player, startTime);
  }

  /**
   * Play snippet segment and auto-pause when snippet duration expires
   */
  playSnippet(
    startTime: number,
    durationSec: number,
    onEnd?: () => void
  ): MediaSegmentControl {
    this.clearTimer();

    if (this.mode === 'html5' && this.html5Element) {
      try {
        this.html5Element.currentTime = Math.max(0, startTime);
        this.html5Element.muted = false;
        this.html5Element.volume = 1.0;
        this.html5Element.play().catch((err) => console.warn('[MediaEngine] HTML5 play error:', err));
      } catch (e) {
        console.warn('[MediaEngine] Error seeking HTML5 snippet:', e);
      }

      this.segmentTimeout = window.setTimeout(() => {
        this.pauseAndMute();
        this.segmentTimeout = null;
        if (onEnd) onEnd();
      }, durationSec * 1000);

      return {
        cancel: () => {
          this.clearTimer();
          this.pauseAndMute();
        },
      };
    } else if (this.mode === 'youtube' && this.ytPlayer) {
      return playSegment(this.ytPlayer, startTime, durationSec, onEnd);
    } else {
      if (onEnd) onEnd();
      return { cancel: () => {} };
    }
  }

  /**
   * Play reveal segment for revealDuration seconds
   */
  playReveal(
    revealStartTime: number,
    durationSec: number,
    onEnd?: () => void
  ): MediaSegmentControl {
    this.clearTimer();

    if (this.mode === 'html5' && this.html5Element) {
      try {
        this.html5Element.currentTime = Math.max(0, revealStartTime);
        this.html5Element.muted = false;
        this.html5Element.volume = 0.85;
        this.html5Element.play().catch((err) => console.warn('[MediaEngine] HTML5 reveal error:', err));
      } catch (e) {
        console.warn('[MediaEngine] Error seeking HTML5 reveal:', e);
      }

      this.segmentTimeout = window.setTimeout(() => {
        this.stop();
        this.segmentTimeout = null;
        if (onEnd) onEnd();
      }, durationSec * 1000);

      return {
        cancel: () => {
          this.clearTimer();
          this.stop();
        },
      };
    } else if (this.mode === 'youtube' && this.ytPlayer) {
      return ytPlayReveal(this.ytPlayer, revealStartTime, durationSec);
    } else {
      if (onEnd) onEnd();
      return { cancel: () => {} };
    }
  }

  /**
   * Show video frame (during reveal)
   */
  showVideo(): void {
    if (this.mode === 'html5' && this.html5Element) {
      this.html5Element.classList.remove('opacity-0');
      this.html5Element.classList.add('opacity-100');
    }
    const ytEl = document.getElementById('yt-player-embed');
    if (ytEl) {
      ytEl.classList.remove('opacity-0');
      ytEl.classList.add('opacity-100');
    }
  }

  private pauseAndMute(): void {
    if (this.mode === 'html5' && this.html5Element) {
      try {
        this.html5Element.pause();
        this.html5Element.muted = true;
      } catch { /* ignore */ }
    } else if (this.mode === 'youtube' && this.ytPlayer) {
      stopPlayer(this.ytPlayer);
    }
  }

  /**
   * Stop playback and mute
   */
  stop(): void {
    this.clearTimer();
    this.pauseAndMute();
  }

  /**
   * Destroy and clean up elements
   */
  destroy(): void {
    this.stop();
    if (this.html5Element) {
      try {
        this.html5Element.pause();
        this.html5Element.removeAttribute('src');
        this.html5Element.load();
        this.html5Element.remove();
      } catch { /* ignore */ }
      this.html5Element = null;
    }
    if (this.ytPlayer) {
      destroyPlayer();
      this.ytPlayer = null;
    }
    this.mode = null;
  }

  private clearTimer(): void {
    if (this.segmentTimeout !== null) {
      clearTimeout(this.segmentTimeout);
      this.segmentTimeout = null;
    }
  }
}

export const mediaEngine = new MediaEngine();
