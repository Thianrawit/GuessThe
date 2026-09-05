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
  isReady?: boolean;        // Buffering readiness status
  lastScoreDelta?: number;  // Points gained on latest question
}

export type GameState = 
  | 'LOBBY'
  | 'INITIAL_BUFFERING'
  | 'COUNTDOWN'
  | 'SNIPPET_PLAYING'
  | 'ANSWERING'
  | 'GUESSING'
  | 'WAITING'
  | 'REVEAL'
  | 'INTERMEDIATE_LEADERBOARD'
  | 'GAME_OVER';

export type GamePhase = GameState; // Alias for backward compatibility

export type NetworkPacket =
  | { type: 'START_BUFFERING'; questionIndex: number }
  | { type: 'BUFFER_READY'; peerId: string; questionIndex: number }
  | { type: 'FORCE_START'; questionIndex: number }
  | { type: 'ALL_READY'; questionIndex: number }
  | { type: 'SYNC_COUNTDOWN'; seconds: number }
  | { type: 'START_SNIPPET'; startTime: number; duration: number }
  | { type: 'START_ANSWERING'; timeLimit: number }
  | { type: 'SUBMIT_ANSWER'; peerId: string; choiceIndex: number; timeUsedMs: number }
  | { type: 'REVEAL_ANSWER'; correctIndex: number; revealStartTime: number; playerAnswers: Record<string, number>; currentScores: Record<string, number> }
  | { type: 'SHOW_INTERMEDIATE_LEADERBOARD'; scores: Record<string, number>; rankDeltas: Record<string, number> }
  | { type: 'GAME_OVER'; finalLeaderboard?: any[]; finalScores?: Record<string, number>; correctCounts?: Record<string, number>; wrongCounts?: Record<string, number> }
  // Retained for room lobby, disconnects, and backward compatibility:
  | { type: 'PLAYER_JOIN'; peerId: string; name: string }
  | { type: 'PLAYER_LEAVE'; peerId: string; remainingPlayers: PlayerInfo[] }
  | { type: 'PLAYER_LIST'; players: PlayerInfo[] }
  | { type: 'ROOM_INIT'; questions: QuestionSession[]; config: GameConfig; players: PlayerInfo[] }
  | { type: 'PLAYER_SUBMIT'; peerId: string; choiceIndex: number; timeUsedMs?: number }
  | { type: 'STATE_COUNTDOWN'; questionIndex: number }
  | { type: 'TRIGGER_GUESS'; questionIndex: number }
  | { type: 'TRIGGER_REVEAL'; questionIndex: number; answers: Record<string, number>; scores: Record<string, number>; correctCounts: Record<string, number>; wrongCounts: Record<string, number> }
  | { type: 'REMATCH'; questions: QuestionSession[]; config: GameConfig; players: PlayerInfo[] }
  | { type: 'PING' }
  | { type: 'PONG' };

