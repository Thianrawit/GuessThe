/* ──────────────────────────────────────────────
   HTML5 Media Engine
   High-performance, Ad-free direct media player (<video> & <audio>)
   ────────────────────────────────────────────── */

import { resolveStreamUrl } from './stream-resolver';

export interface MediaSegmentControl {
  cancel: () => void;
}

class MediaEngine {
  private mediaElement: HTMLVideoElement | null = null;
  private segmentTimeout: number | null = null;
  private currentType: 'audio' | 'video' = 'video';

  get element(): HTMLVideoElement | null {
    return this.mediaElement;
  }

  /**
   * Prebuffer media at specific startTime during the 3-2-1 countdown phase
   */
  async initAndPrebuffer(
    containerId: string,
    youtubeId: string,
    type: 'audio' | 'video',
    startTime: number
  ): Promise<HTMLVideoElement> {
    this.stop();
    this.destroy();

    this.currentType = type;
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container #${containerId} ไม่พบในหน้าจอ`);
    }

    container.innerHTML = '';

    // Create HTML5 Video element (capable of rendering both video and audio streams)
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
    this.mediaElement = el;

    // 1. Resolve direct stream URL via Invidious proxy
    const streamUrl = await resolveStreamUrl(youtubeId, type);

    // 2. Set src, mute, and pre-seek to startTime
    el.src = streamUrl;
    el.muted = true;

    return new Promise<HTMLVideoElement>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          // Even if canplay did not fire within 4.5s, resolve so gameplay is not blocked
          resolve(el);
        }
      }, 4500);

      const onCanPlay = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          try {
            el.currentTime = Math.max(0, startTime);
            const playPromise = el.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => {
                  setTimeout(() => {
                    try { el.pause(); } catch { /* ignore */ }
                    resolve(el);
                  }, 200);
                })
                .catch(() => {
                  resolve(el);
                });
            } else {
              el.pause();
              resolve(el);
            }
          } catch {
            resolve(el);
          }
        }
      };

      const onError = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('HTML5 Video Error: ไม่สามารถโหลดไฟล์สตรีมได้'));
        }
      };

      el.addEventListener('loadedmetadata', () => {
        try { el.currentTime = Math.max(0, startTime); } catch { /* ignore */ }
      }, { once: true });
      el.addEventListener('canplay', onCanPlay, { once: true });
      el.addEventListener('error', onError, { once: true });

      el.load();
    });
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

    const el = this.mediaElement;
    if (!el) {
      if (onEnd) onEnd();
      return { cancel: () => {} };
    }

    try {
      el.currentTime = Math.max(0, startTime);
      el.muted = false;
      el.volume = 1.0;
      el.play().catch((err) => {
        console.warn('[MediaEngine] Play snippet failed:', err);
      });
    } catch (e) {
      console.warn('[MediaEngine] Error seeking snippet:', e);
    }

    this.segmentTimeout = window.setTimeout(() => {
      try {
        el.pause();
        el.muted = true;
      } catch { /* ignore */ }
      this.segmentTimeout = null;
      if (onEnd) onEnd();
    }, durationSec * 1000);

    return {
      cancel: () => {
        this.clearTimer();
        try {
          el.pause();
          el.muted = true;
        } catch { /* ignore */ }
      },
    };
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

    const el = this.mediaElement;
    if (!el) {
      if (onEnd) onEnd();
      return { cancel: () => {} };
    }

    try {
      el.currentTime = Math.max(0, revealStartTime);
      el.muted = false;
      el.volume = 0.85;
      el.play().catch((err) => {
        console.warn('[MediaEngine] Play reveal failed:', err);
      });
    } catch (e) {
      console.warn('[MediaEngine] Error seeking reveal:', e);
    }

    this.segmentTimeout = window.setTimeout(() => {
      try {
        el.pause();
      } catch { /* ignore */ }
      this.segmentTimeout = null;
      if (onEnd) onEnd();
    }, durationSec * 1000);

    return {
      cancel: () => {
        this.clearTimer();
        try {
          el.pause();
        } catch { /* ignore */ }
      },
    };
  }

  /**
   * Show video frame (during reveal)
   */
  showVideo(): void {
    if (this.mediaElement) {
      this.mediaElement.classList.remove('opacity-0');
      this.mediaElement.classList.add('opacity-100');
    }
  }

  /**
   * Stop playback and mute
   */
  stop(): void {
    this.clearTimer();
    if (this.mediaElement) {
      try {
        this.mediaElement.pause();
        this.mediaElement.muted = true;
      } catch { /* ignore */ }
    }
  }

  /**
   * Destroy and clean up DOM element
   */
  destroy(): void {
    this.stop();
    if (this.mediaElement) {
      try {
        this.mediaElement.pause();
        this.mediaElement.removeAttribute('src');
        this.mediaElement.load();
        this.mediaElement.remove();
      } catch { /* ignore */ }
      this.mediaElement = null;
    }
  }

  private clearTimer(): void {
    if (this.segmentTimeout !== null) {
      clearTimeout(this.segmentTimeout);
      this.segmentTimeout = null;
    }
  }
}

export const mediaEngine = new MediaEngine();
