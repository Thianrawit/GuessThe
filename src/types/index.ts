/* ──────────────────────────────────────────────
   GuessThe? — Type Definitions
   ────────────────────────────────────────────── */

export interface TrackItem {
  id: string;
  title: string;
  youtubeId: string;
  startTime: number;
  revealStartTime?: number; // timestamp to start playback during answer reveal
  type: 'audio' | 'video';
  points: number;
}

export interface QuestionSession {
  id: string;
  title: string;
  youtubeId: string;
  startTime: number;
  revealStartTime?: number;
  type: 'audio' | 'video';
  points: number;
  options: string[];
  correctIndex: number;
}

export interface GameConfig {
  snippetDuration?: number; // seconds of music/video to play before answering
  guessDuration: number;    // seconds allowed to answer after snippet ends
  revealDuration: number;   // seconds to show reveal preview
  questionCount: number | 'all';
}

export interface PlayerInfo {
  peerId: string;
  name: string;
  score: number;
  isHost: boolean;
  correctCount: number;
  wrongCount: number;
}

export type GamePhase =
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'GUESSING'
  | 'WAITING'
  | 'REVEAL'
  | 'GAME_OVER';

export type NetworkPacket =
  | { type: 'PLAYER_JOIN'; peerId: string; name: string }
  | { type: 'PLAYER_LEAVE'; peerId: string; remainingPlayers: PlayerInfo[] }
  | { type: 'PLAYER_LIST'; players: PlayerInfo[] }
  | { type: 'ROOM_INIT'; questions: QuestionSession[]; config: GameConfig; players: PlayerInfo[] }
  | { type: 'STATE_COUNTDOWN'; questionIndex: number }
  | { type: 'PLAYER_SUBMIT'; peerId: string; choiceIndex: number; timeUsedMs?: number }
  | { type: 'TRIGGER_GUESS'; questionIndex: number }
  | { type: 'TRIGGER_REVEAL'; questionIndex: number; answers: Record<string, number>; scores: Record<string, number>; correctCounts: Record<string, number>; wrongCounts: Record<string, number> }
  | { type: 'GAME_OVER'; finalScores: Record<string, number>; correctCounts: Record<string, number>; wrongCounts: Record<string, number> }
  | { type: 'REMATCH'; questions: QuestionSession[]; config: GameConfig; players: PlayerInfo[] }
  | { type: 'PING' }
  | { type: 'PONG' };
