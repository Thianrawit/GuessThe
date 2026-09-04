/* ──────────────────────────────────────────────
   Resilient Dual Media Engine
   1. Primary: Direct HTML5 Media Streaming (.mp4/.webm)
   2. Fallback: Optimized Privacy-Enhanced YouTube No-Cookie Player (start param pre-set)
   ────────────────────────────────────────────── */

import { resolveStreamUrl } from './stream-resolver';
import { waitForYTApi, extractYouTubeId } from './youtube-player';

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
    return this.mode !== null;
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
        await new Promise(r => setTimeout(r, 100));
        container = document.getElementById(containerId);
        if (container) break;
      }
    }
    if (!container) {
      throw new Error(`Container #${containerId} ไม่พบในหน้าจอ`);
    }

    const youtubeId = extractYouTubeId(rawUrlOrId);

    // ── ATTEMPT 1: Direct HTML5 Stream via Invidious / Direct URL ──
    try {
      const streamUrl = await resolveStreamUrl(youtubeId || rawUrlOrId, type, 3000);
      if (streamUrl) {
        await this.setupHtml5Player(container, streamUrl, type, startTime);
        this.mode = 'html5';
        console.log('[MediaEngine] Using HTML5 Stream Engine');
        return;
      }
    } catch (e) {
      console.warn(
        '[MediaEngine] Invidious direct stream unavailable (CORS/Offline). Falling back to YouTube No-Cookie Player:',
        (e as Error).message
      );
    }

    // ── ATTEMPT 2: Fallback to YouTube Privacy-Enhanced No-Cookie Player ──
    if (youtubeId && youtubeId.length === 11) {
      await this.setupYouTubePlayer(container, youtubeId, type, startTime);
      this.mode = 'youtube';
      console.log('[MediaEngine] Using YouTube No-Cookie Fallback Player');
      return;
    }

    throw new Error('ไม่สามารถเล่นสื่อนี้ได้');
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
   * Setup YouTube Player with Privacy-Enhanced No-Cookie & start param to skip 0s pre-roll ads
   */
  private async setupYouTubePlayer(
    container: HTMLElement,
    youtubeId: string,
    type: 'audio' | 'video',
    startTime: number
  ): Promise<void> {
    await waitForYTApi();

    container.innerHTML = `<div id="yt-fallback-embed" class="w-full h-full ${type === 'audio' ? 'opacity-0' : 'opacity-100'}"></div>`;

    return new Promise<void>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 4500);

      try {
        this.ytPlayer = new window.YT.Player('yt-fallback-embed', {
          host: 'https://www.youtube-nocookie.com',
          videoId: youtubeId,
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
            start: Math.max(0, Math.floor(startTime)), // Direct seek at embed level skips 0s pre-roll
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                try {
                  event.target.mute();
                  event.target.seekTo(startTime, true);
                  event.target.playVideo();
                  setTimeout(() => {
                    try { event.target.pauseVideo(); } catch { /* ignore */ }
                    resolve();
                  }, 400);
                } catch {
                  resolve();
                }
              }
            },
            onError: () => {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve();
              }
            },
          },
        });
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        }
      }
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

    if (this.mode === 'html5' && this.html5Element) {
      try {
        this.html5Element.currentTime = Math.max(0, startTime);
        this.html5Element.muted = false;
        this.html5Element.volume = 1.0;
        this.html5Element.play().catch((err) => console.warn('[MediaEngine] HTML5 play error:', err));
      } catch (e) {
        console.warn('[MediaEngine] Error seeking HTML5 snippet:', e);
      }
    } else if (this.mode === 'youtube' && this.ytPlayer) {
      try {
        this.ytPlayer.seekTo(startTime, true);
        this.ytPlayer.unMute();
        this.ytPlayer.setVolume(100);
        this.ytPlayer.playVideo();
      } catch (e) {
        console.warn('[MediaEngine] Error seeking YouTube snippet:', e);
      }
    } else {
      if (onEnd) onEnd();
      return { cancel: () => {} };
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
    } else if (this.mode === 'youtube' && this.ytPlayer) {
      try {
        this.ytPlayer.seekTo(revealStartTime, true);
        this.ytPlayer.unMute();
        this.ytPlayer.setVolume(85);
        this.ytPlayer.playVideo();
      } catch (e) {
        console.warn('[MediaEngine] Error seeking YouTube reveal:', e);
      }
    } else {
      if (onEnd) onEnd();
      return { cancel: () => {} };
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
  }

  /**
   * Show video frame (during reveal)
   */
  showVideo(): void {
    if (this.mode === 'html5' && this.html5Element) {
      this.html5Element.classList.remove('opacity-0');
      this.html5Element.classList.add('opacity-100');
    }
    const ytEl = document.getElementById('yt-fallback-embed');
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
      try {
        this.ytPlayer.pauseVideo();
        this.ytPlayer.mute();
      } catch { /* ignore */ }
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
      try {
        this.ytPlayer.destroy();
      } catch { /* ignore */ }
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
