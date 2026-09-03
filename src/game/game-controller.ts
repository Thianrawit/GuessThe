/* ──────────────────────────────────────────────
   Game Controller — State Machine
   ────────────────────────────────────────────── */

import type {
  GameConfig,
  GamePhase,
  NetworkPacket,
  PlayerInfo,
  QuestionSession,
} from '../types/index';
import { peerManager } from '../network/peer-manager';
import { generateQuestions } from '../engine/shuffle';
import { loadPool } from '../engine/track-pool';

interface SavedSession {
  questions: QuestionSession[];
  currentIndex: number;
  config: GameConfig;
  players: PlayerInfo[];
  role: 'solo' | 'host' | 'client';
}

const SESSION_STORAGE_KEY = 'guessthe_active_session';

type PhaseChangeCallback = (phase: GamePhase, data?: unknown) => void;

class GameController {
  // Game state
  private _phase: GamePhase = 'LOBBY';
  private _questions: QuestionSession[] = [];
  private _currentIndex: number = 0;
  private _config: GameConfig = {
    snippetDuration: 3,
    guessDuration: 10,
    revealDuration: 5,
    questionCount: 'all',
  };
  private _players: Map<string, PlayerInfo> = new Map();
  private _answers: Map<string, number> = new Map(); // peerId → choiceIndex
  private _answerTimes: Map<string, number> = new Map(); // peerId → timeUsedMs
  private _phaseCallback: PhaseChangeCallback | null = null;
  private _waitTimeout: ReturnType<typeof setTimeout> | null = null;

  // Getters
  get phase(): GamePhase { return this._phase; }
  get questions(): QuestionSession[] { return this._questions; }
  get currentIndex(): number { return this._currentIndex; }
  get currentQuestion(): QuestionSession | null {
    return this._questions[this._currentIndex] || null;
  }
  get config(): GameConfig { return this._config; }
  get players(): PlayerInfo[] { return Array.from(this._players.values()); }
  get answers(): Record<string, number> {
    return Object.fromEntries(this._answers);
  }
  get totalQuestions(): number { return this._questions.length; }

  /** Register phase change callback */
  onPhaseChange(callback: PhaseChangeCallback): void {
    this._phaseCallback = callback;
  }

  private emitPhase(phase: GamePhase, data?: unknown): void {
    this._phase = phase;
    if (this._phaseCallback) this._phaseCallback(phase, data);
  }

  /** Set game config */
  setConfig(config: Partial<GameConfig>): void {
    this._config = { ...this._config, ...config };
  }

  /** Add or update a player */
  addPlayer(peerId: string, name: string, isHost: boolean = false): void {
    this._players.set(peerId, {
      peerId,
      name,
      score: 0,
      isHost,
      correctCount: 0,
      wrongCount: 0,
    });
  }

  /** Remove a player and re-check if all remaining players have answered */
  removePlayer(peerId: string): void {
    this._players.delete(peerId);
    this._answers.delete(peerId);
    if (this._phase === 'GUESSING' || this._phase === 'WAITING') {
      this.checkAllAnswered();
    }
  }

  /** CLIENT: Sync question index from host */
  setQuestionIndex(index: number): void {
    this._currentIndex = index;
    this._answers.clear();
  }

  /** Get scores as record */
  getScores(): Record<string, number> {
    const scores: Record<string, number> = {};
    this._players.forEach((p) => { scores[p.peerId] = p.score; });
    return scores;
  }

  getCorrectCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    this._players.forEach((p) => { counts[p.peerId] = p.correctCount; });
    return counts;
  }

  getWrongCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    this._players.forEach((p) => { counts[p.peerId] = p.wrongCount; });
    return counts;
  }

  /** HOST: Start the game — generate questions and broadcast */
  startGame(): void {
    const pool = loadPool();
    if (pool.length < 4) {
      throw new Error('ต้องมีเพลงอย่างน้อย 4 เพลงในคลัง');
    }

    this._questions = generateQuestions(pool, this._config.questionCount);
    this._currentIndex = 0;
    
    // Reset all scores
    this._players.forEach((p) => {
      p.score = 0;
      p.correctCount = 0;
      p.wrongCount = 0;
    });

    // Broadcast to clients
    if (peerManager.role === 'host') {
      const packet: NetworkPacket = {
        type: 'ROOM_INIT',
        questions: this._questions,
        config: this._config,
        players: this.players,
      };
      peerManager.broadcast(packet);
    }

    this.saveSession();
    this.startCountdown();
  }

  /** CLIENT: Receive game init from host */
  receiveGameInit(questions: QuestionSession[], config: GameConfig, players: PlayerInfo[]): void {
    this._questions = questions;
    this._config = config;
    this._currentIndex = 0;
    
    this._players.clear();
    players.forEach((p) => {
      this._players.set(p.peerId, { ...p, score: 0, correctCount: 0, wrongCount: 0 });
    });

    this.startCountdown();
  }

  /** Start countdown phase */
  private startCountdown(): void {
    this._answers.clear();
    this._answerTimes.clear();
    this.emitPhase('COUNTDOWN', { questionIndex: this._currentIndex });

    if (peerManager.role === 'host') {
      peerManager.broadcast({
        type: 'STATE_COUNTDOWN',
        questionIndex: this._currentIndex,
      });
    }
  }

  /** Called after countdown completes — move to guessing */
  triggerGuessing(): void {
    this.emitPhase('GUESSING', { questionIndex: this._currentIndex });

    if (peerManager.role === 'host') {
      peerManager.broadcast({
        type: 'TRIGGER_GUESS',
        questionIndex: this._currentIndex,
      });

      // Dynamic timeout based on configured guessDuration + 1s grace period
      const waitMs = (this._config.guessDuration * 1000) + 1000;
      this._waitTimeout = setTimeout(() => {
        // Prune any players stalled > 5s so remaining players are never blocked
        const pruned = peerManager.pruneInactivePeers(5000);
        pruned.forEach((id) => this.removePlayer(id));
        this.triggerReveal();
      }, waitMs);
    }
  }

  /** Player submits an answer */
  submitAnswer(peerId: string, choiceIndex: number, timeUsedMs?: number): void {
    if (this._answers.has(peerId)) return; // Already answered
    this._answers.set(peerId, choiceIndex);
    if (typeof timeUsedMs === 'number') {
      this._answerTimes.set(peerId, timeUsedMs);
    }

    // If host, broadcast is not needed for submit — just check
    if (peerManager.isHost) {
      this.checkAllAnswered();
    } else {
      // Client sends to host
      peerManager.send({
        type: 'PLAYER_SUBMIT',
        peerId,
        choiceIndex,
        timeUsedMs,
      });
    }

    this.emitPhase('WAITING', {
      answeredCount: this._answers.size,
      totalPlayers: this._players.size,
    });
  }

  /** HOST: receive answer from a client */
  receiveAnswer(peerId: string, choiceIndex: number, timeUsedMs?: number): void {
    if (this._answers.has(peerId)) return;
    this._answers.set(peerId, choiceIndex);
    if (typeof timeUsedMs === 'number') {
      this._answerTimes.set(peerId, timeUsedMs);
    }
    this.checkAllAnswered();
  }

  /** Check if all players answered */
  private checkAllAnswered(): void {
    if (this._answers.size >= this._players.size) {
      if (this._waitTimeout) {
        clearTimeout(this._waitTimeout);
        this._waitTimeout = null;
      }
      // Small delay before reveal for UX
      setTimeout(() => this.triggerReveal(), 500);
    }
  }

  /** Trigger reveal phase */
  triggerReveal(): void {
    if (this._waitTimeout) {
      clearTimeout(this._waitTimeout);
      this._waitTimeout = null;
    }

    const question = this.currentQuestion;
    if (!question) return;

    // Calculate scores with speed deduction (0.5s = 0.5pt deduction)
    this._answers.forEach((choiceIndex, peerId) => {
      const player = this._players.get(peerId);
      if (!player) return;
      if (choiceIndex === question.correctIndex) {
        const timeUsedMs = this._answerTimes.get(peerId) ?? 0;
        const deduction = Math.floor(timeUsedMs / 500) * 0.5;
        const earned = Math.max(0.5, Math.round((question.points - deduction) * 10) / 10);
        player.score = Math.round((player.score + earned) * 10) / 10;
        player.correctCount++;
      } else {
        player.wrongCount++;
      }
    });

    // For players who didn't answer, mark wrong
    this._players.forEach((player) => {
      if (!this._answers.has(player.peerId)) {
        player.wrongCount++;
      }
    });

    const revealData = {
      questionIndex: this._currentIndex,
      answers: Object.fromEntries(this._answers),
      scores: this.getScores(),
      correctCounts: this.getCorrectCounts(),
      wrongCounts: this.getWrongCounts(),
    };

    if (peerManager.role === 'host') {
      peerManager.broadcast({
        type: 'TRIGGER_REVEAL',
        ...revealData,
      });
    }

    this.saveSession();
    this.emitPhase('REVEAL', revealData);
  }

  /** CLIENT: receive reveal from host */
  receiveReveal(
    answers: Record<string, number>,
    scores: Record<string, number>,
    correctCounts: Record<string, number>,
    wrongCounts: Record<string, number>
  ): void {
    // Update local answers
    this._answers.clear();
    for (const [peerId, choice] of Object.entries(answers)) {
      this._answers.set(peerId, choice);
    }

    // Update scores
    for (const [peerId, score] of Object.entries(scores)) {
      const player = this._players.get(peerId);
      if (player) {
        player.score = score;
        player.correctCount = correctCounts[peerId] || 0;
        player.wrongCount = wrongCounts[peerId] || 0;
      }
    }

    this.emitPhase('REVEAL', {
      questionIndex: this._currentIndex,
      answers,
      scores,
      correctCounts,
      wrongCounts,
    });
  }

  /** Move to next question or game over */
  nextQuestion(): void {
    this._currentIndex++;
    
    if (this._currentIndex >= this._questions.length) {
      this.gameOver();
    } else {
      this.saveSession();
      this.startCountdown();
    }
  }

  /** Game over */
  private gameOver(): void {
    this.clearSession();

    if (peerManager.role === 'host') {
      peerManager.broadcast({
        type: 'GAME_OVER',
        finalScores: this.getScores(),
        correctCounts: this.getCorrectCounts(),
        wrongCounts: this.getWrongCounts(),
      });
    }

    this.emitPhase('GAME_OVER', {
      finalScores: this.getScores(),
      correctCounts: this.getCorrectCounts(),
      wrongCounts: this.getWrongCounts(),
    });
  }

  /** CLIENT: receive game over */
  receiveGameOver(
    finalScores: Record<string, number>,
    correctCounts: Record<string, number>,
    wrongCounts: Record<string, number>
  ): void {
    this.clearSession();

    for (const [peerId, score] of Object.entries(finalScores)) {
      const player = this._players.get(peerId);
      if (player) {
        player.score = score;
        player.correctCount = correctCounts[peerId] || 0;
        player.wrongCount = wrongCounts[peerId] || 0;
      }
    }

    this.emitPhase('GAME_OVER', { finalScores, correctCounts, wrongCounts });
  }

  /** HOST: Rematch — reshuffle and restart */
  rematch(): void {
    const pool = loadPool();
    this._questions = generateQuestions(pool, this._config.questionCount);
    this._currentIndex = 0;

    this._players.forEach((p) => {
      p.score = 0;
      p.correctCount = 0;
      p.wrongCount = 0;
    });

    if (peerManager.role === 'host') {
      peerManager.broadcast({
        type: 'REMATCH',
        questions: this._questions,
        config: this._config,
        players: this.players,
      });
    }

    this.saveSession();
    this.startCountdown();
  }

  /** Reset to lobby state */
  resetToLobby(): void {
    this.clearSession();
    this._phase = 'LOBBY';
    this._questions = [];
    this._currentIndex = 0;
    this._answers.clear();
    if (this._waitTimeout) {
      clearTimeout(this._waitTimeout);
      this._waitTimeout = null;
    }
  }

  /** Full cleanup */
  destroy(): void {
    this.clearSession();
    this.resetToLobby();
    this._players.clear();
    this._phaseCallback = null;
  }

  /** Save active game state to sessionStorage */
  saveSession(): void {
    if (this._questions.length === 0 || this._currentIndex >= this._questions.length) {
      this.clearSession();
      return;
    }
    try {
      const sessionData: SavedSession = {
        questions: this._questions,
        currentIndex: this._currentIndex,
        config: this._config,
        players: this.players,
        role: peerManager.role,
      };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
    } catch {
      /* ignore */
    }
  }

  /** Clear saved game session */
  clearSession(): void {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Restore game session if still in progress */
  restoreSession(): boolean {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return false;
      const data: SavedSession = JSON.parse(raw);
      if (
        !data ||
        !Array.isArray(data.questions) ||
        data.questions.length === 0 ||
        typeof data.currentIndex !== 'number' ||
        data.currentIndex >= data.questions.length
      ) {
        this.clearSession();
        return false;
      }

      // If it was multiplayer (host/client), the WebRTC connection was severed on refresh
      if (data.role !== 'solo') {
        this.clearSession();
        return false;
      }

      this._questions = data.questions;
      this._currentIndex = data.currentIndex;
      this._config = data.config;
      this._players.clear();
      data.players.forEach((p) => {
        this._players.set(p.peerId, p);
      });
      this._phase = 'COUNTDOWN';
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  }
}

// Singleton
export const gameController = new GameController();
