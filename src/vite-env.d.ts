/// <reference types="vite/client" />

interface YT {
  Player: new (
    elementId: string | HTMLElement,
    options: {
      videoId?: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, unknown>;
      events?: {
        onReady?: (event: { target: YT.Player }) => void;
        onStateChange?: (event: { data: number; target: YT.Player }) => void;
        onError?: (event: { data: number }) => void;
      };
    }
  ) => YT.Player;
  PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}

declare namespace YT {
  interface Player {
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    setVolume(volume: number): void;
    getVolume(): number;
    getPlayerState(): number;
    getCurrentTime(): number;
    getDuration(): number;
    loadVideoById(videoId: string, startSeconds?: number): void;
    cueVideoById(videoId: string, startSeconds?: number): void;
    destroy(): void;
    getIframe(): HTMLIFrameElement;
  }
}

interface Window {
  YT: YT;
  onYouTubeIframeAPIReady: () => void;
}
