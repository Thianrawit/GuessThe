/* ──────────────────────────────────────────────
   Game Controller — State Machine
   ────────────────────────────────────────────── */

import type {
  GameConfig,
  GameState,
  GamePhase,
  NetworkPacket,
  PlayerInfo,
  QuestionSession,
} from '../types/index';
import { peerManager } from '../network/peer-manager';
import { generateQuestions } from '../engine/shuffle';
import { loadPool } from '../engine/track-pool';

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
  private _readyPlayers: Map<number, Set<string>> = new Map(); // questionIndex → Set<peerId>
  private _lastScoreDeltas: Map<string, number> = new Map(); // peerId → points earned on last question
  private _previousRanks: Map<string, number> = new Map(); // peerId → rank (0-indexed)
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
  get lastScoreDeltas(): Record<string, number> {
    return Object.fromEntries(this._lastScoreDeltas);
  }

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
    const prevCount = this._config.questionCount;
    this._config = { ...this._config, ...config };

    if (this._phase === 'LOBBY' && config.questionCount !== undefined && config.questionCount !== prevCount) {
      const pool = loadPool();
      if (pool.length >= 4) {
        const targetCount = this._config.questionCount === 'all'
          ? pool.length
          : Math.min(Number(this._config.questionCount), pool.length);
        if (this._questions.length > 0) {
          if (this._questions.length > targetCount) {
            this._questions = this._questions.slice(0, targetCount);
          } else {
            this._questions = generateQuestions(pool, this._config.questionCount);
          }
        }
      }
    }
  }

  /** Add or update a player */
  addPlayer(peerId: string, name: string, isHost: boolean = false): void {
    const existing = this._players.get(peerId);
    this._players.set(peerId, {
      peerId,
      name,
      score: existing ? existing.score : 0,
      isHost,
      correctCount: existing ? existing.correctCount : 0,
      wrongCount: existing ? existing.wrongCount : 0,
      isReady: existing ? existing.isReady : false,
      lastScoreDelta: existing ? existing.lastScoreDelta : 0,
    });
  }

  /** Remove a player and re-check if all remaining players have answered */
  removePlayer(peerId: string): void {
    this._players.delete(peerId);
    this._answers.delete(peerId);
    this._answerTimes.delete(peerId);
    this._lastScoreDeltas.delete(peerId);
    this._previousRanks.delete(peerId);

    // Remove from ready tracking
    this._readyPlayers.forEach((set) => set.delete(peerId));

    if (this._phase === 'GUESSING' || this._phase === 'WAITING') {
      this.checkAllAnswered();
    }
  }

  /** Set player readiness for a specific question (Initial Buffering or Prebuffer) */
  setPlayerReady(peerId: string, questionIndex: number): boolean {
    const player = this._players.get(peerId);
    if (player) {
      player.isReady = true;
    }

    if (!this._readyPlayers.has(questionIndex)) {
      this._readyPlayers.set(questionIndex, new Set());
    }
    const set = this._readyPlayers.get(questionIndex)!;
    set.add(peerId);

    return this.isAllPlayersReady(questionIndex);
  }

  /** Check if all currently registered players are ready for questionIndex */
  isAllPlayersReady(questionIndex: number): boolean {
    if (this._players.size === 0) return false;
    const readySet = this._readyPlayers.get(questionIndex);
    if (!readySet) return false;

    for (const peerId of this._players.keys()) {
      if (!readySet.has(peerId)) {
        return false;
      }
    }
    return true;
  }

  /** Reset isReady state for all players */
  resetReadyStates(): void {
    this._players.forEach((p) => {
      p.isReady = false;
    });
  }

  /** CLIENT: Sync question index from host */
  setQuestionIndex(index: number): void {
    this._currentIndex = index;
    this._answers.clear();
    this._answerTimes.clear();
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

  /** Prepare questions early in lobby (for background preloading) */
  ensureQuestionsPrepared(): QuestionSession[] {
    if (this._questions.length === 0) {
      const pool = loadPool();
      if (pool.length >= 4) {
        this._questions = generateQuestions(pool, this._config.questionCount);
      }
    }
    return this._questions;
  }

  /** HOST: Start the game — transitions to INITIAL_BUFFERING */
  startGame(): void {
    if (this._phase !== 'LOBBY') {
      console.warn('[GameController] startGame() called while phase is', this._phase, '— ignoring');
      return;
    }

    const pool = loadPool();
    if (pool.length < 4) {
      throw new Error('ต้องมีเพลงอย่างน้อย 4 เพลงในคลัง');
    }
    const targetCount = this._config.questionCount === 'all'
      ? pool.length
      : Math.min(Number(this._config.questionCount), pool.length);

    if (this._questions.length === 0 || this._questions.length !== targetCount) {
      if (this._questions.length > targetCount) {
        this._questions = this._questions.slice(0, targetCount);
      } else {
        this._questions = generateQuestions(pool, this._config.questionCount);
      }
    }
    this._currentIndex = 0;
    this._readyPlayers.clear();
    this._lastScoreDeltas.clear();
    this._previousRanks.clear();

    // Reset all scores & ready states
    let playerIdx = 0;
    this._players.forEach((p) => {
      p.score = 0;
      p.correctCount = 0;
      p.wrongCount = 0;
      p.isReady = false;
      p.lastScoreDelta = 0;
      this._previousRanks.set(p.peerId, playerIdx++);
    });

    // Broadcast ROOM_INIT to clients
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
    // Transition to INITIAL_BUFFERING
    this.emitPhase('INITIAL_BUFFERING', { questionIndex: 0 });
  }

  /** CLIENT: Receive game init from host */
  receiveGameInit(questions: QuestionSession[], config: GameConfig, players: PlayerInfo[]): void {
    this._questions = questions;
    this._config = config;
    this._currentIndex = 0;
    this._readyPlayers.clear();
    this._lastScoreDeltas.clear();
    this._previousRanks.clear();

    this._players.clear();
    players.forEach((p, idx) => {
      this._players.set(p.peerId, {
        ...p,
        score: 0,
        correctCount: 0,
        wrongCount: 0,
        isReady: false,
        lastScoreDelta: 0,
      });
      this._previousRanks.set(p.peerId, idx);
    });

    this.emitPhase('INITIAL_BUFFERING', { questionIndex: 0 });
  }

  /** Start countdown phase (3..2..1) */
  startCountdown(questionIndex?: number): void {
    if (typeof questionIndex === 'number') {
      this._currentIndex = questionIndex;
    }
    this._answers.clear();
    this._answerTimes.clear();
    this.resetReadyStates();

    this.emitPhase('COUNTDOWN', { questionIndex: this._currentIndex });

    if (peerManager.role === 'host') {
      peerManager.broadcastAllReady(this._currentIndex);
      peerManager.broadcast({
        type: 'STATE_COUNTDOWN',
        questionIndex: this._currentIndex,
      });
    }
  }

  /** HOST: Force start game (e.g. on 10s timeout) */
  forceStart(questionIndex: number = 0): void {
    if (peerManager.role === 'host') {
      peerManager.broadcastForceStart(questionIndex);
    }
    this.startCountdown(questionIndex);
  }

  /** Called after countdown completes — move to guessing/answering */
  triggerGuessing(): void {
    this.emitPhase('GUESSING', { questionIndex: this._currentIndex });

    if (peerManager.role === 'host') {
      peerManager.broadcast({
        type: 'TRIGGER_GUESS',
        questionIndex: this._currentIndex,
      });

      // Dynamic timeout based on configured guessDuration + 1.5s grace period
      const waitMs = (this._config.guessDuration * 1000) + 1500;
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

    if (peerManager.isHost) {
      this.checkAllAnswered();
    } else {
      peerManager.send({
        type: 'SUBMIT_ANSWER',
        peerId,
        choiceIndex,
        timeUsedMs: timeUsedMs || 0,
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
      setTimeout(() => this.triggerReveal(), 400);
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

    this._lastScoreDeltas.clear();

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
        player.lastScoreDelta = earned;
        this._lastScoreDeltas.set(peerId, earned);
      } else {
        player.wrongCount++;
        player.lastScoreDelta = 0;
        this._lastScoreDeltas.set(peerId, 0);
      }
    });

    // Players who didn't answer get 0 delta and wrong count
    this._players.forEach((player) => {
      if (!this._answers.has(player.peerId)) {
        player.wrongCount++;
        player.lastScoreDelta = 0;
        this._lastScoreDeltas.set(player.peerId, 0);
      }
    });

    const revealData = {
      questionIndex: this._currentIndex,
      answers: Object.fromEntries(this._answers),
      scores: this.getScores(),
      correctCounts: this.getCorrectCounts(),
      wrongCounts: this.getWrongCounts(),
      lastScoreDeltas: this.lastScoreDeltas,
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
    wrongCounts: Record<string, number>,
    deltas?: Record<string, number>
  ): void {
    this._answers.clear();
    for (const [peerId, choice] of Object.entries(answers)) {
      this._answers.set(peerId, choice);
    }

    this._lastScoreDeltas.clear();
    if (deltas) {
      for (const [peerId, delta] of Object.entries(deltas)) {
        this._lastScoreDeltas.set(peerId, delta);
      }
    }

    for (const [peerId, score] of Object.entries(scores)) {
      const player = this._players.get(peerId);
      if (player) {
        player.score = score;
        player.correctCount = correctCounts[peerId] || 0;
        player.wrongCount = wrongCounts[peerId] || 0;
        if (deltas && typeof deltas[peerId] === 'number') {
          player.lastScoreDelta = deltas[peerId];
        }
      }
    }

    this.emitPhase('REVEAL', {
      questionIndex: this._currentIndex,
      answers,
      scores,
      correctCounts,
      wrongCounts,
      lastScoreDeltas: this.lastScoreDeltas,
    });
  }

  /** Trigger Intermediate Leaderboard phase (with Rank Deltas) */
  triggerIntermediateLeaderboard(): { scores: Record<string, number>; rankDeltas: Record<string, number> } {
    const scores = this.getScores();
    const rankDeltas: Record<string, number> = {};

    // Sort current players by score descending
    const sorted = [...this.players].sort((a, b) => b.score - a.score);
    sorted.forEach((p, newRank) => {
      const oldRank = this._previousRanks.get(p.peerId) ?? newRank;
      // rankDelta: positive if moved up (e.g. from rank 3 to rank 1 -> 3 - 1 = +2)
      rankDeltas[p.peerId] = oldRank - newRank;
      this._previousRanks.set(p.peerId, newRank);
    });

    if (peerManager.role === 'host') {
      peerManager.broadcast({
        type: 'SHOW_INTERMEDIATE_LEADERBOARD',
        scores,
        rankDeltas,
      });
    }

    this.emitPhase('INTERMEDIATE_LEADERBOARD', { scores, rankDeltas });
    return { scores, rankDeltas };
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
  gameOver(): void {
    this.clearSession();

    const finalLeaderboard = [...this.players].sort((a, b) => b.score - a.score);

    if (peerManager.role === 'host') {
      peerManager.broadcast({
        type: 'GAME_OVER',
        finalLeaderboard,
        finalScores: this.getScores(),
        correctCounts: this.getCorrectCounts(),
        wrongCounts: this.getWrongCounts(),
      });
    }

    this.emitPhase('GAME_OVER', {
      finalLeaderboard,
      finalScores: this.getScores(),
      correctCounts: this.getCorrectCounts(),
      wrongCounts: this.getWrongCounts(),
    });
  }

  /** CLIENT: receive game over */
  receiveGameOver(
    finalScores?: Record<string, number>,
    correctCounts?: Record<string, number>,
    wrongCounts?: Record<string, number>,
    finalLeaderboard?: any[]
  ): void {
    this.clearSession();

    if (finalScores) {
      for (const [peerId, score] of Object.entries(finalScores)) {
        const player = this._players.get(peerId);
        if (player) {
          player.score = score;
          player.correctCount = correctCounts?.[peerId] || 0;
          player.wrongCount = wrongCounts?.[peerId] || 0;
        }
      }
    }

    this.emitPhase('GAME_OVER', {
      finalLeaderboard: finalLeaderboard || [...this.players].sort((a, b) => b.score - a.score),
      finalScores: this.getScores(),
      correctCounts: this.getCorrectCounts(),
      wrongCounts: this.getWrongCounts(),
    });
  }

  /** HOST: Rematch — reshuffle and restart */
  rematch(): void {
    const pool = loadPool();
    this._questions = generateQuestions(pool, this._config.questionCount);
    this._currentIndex = 0;
    this._readyPlayers.clear();
    this._lastScoreDeltas.clear();
    this._previousRanks.clear();

    let playerIdx = 0;
    this._players.forEach((p) => {
      p.score = 0;
      p.correctCount = 0;
      p.wrongCount = 0;
      p.isReady = false;
      p.lastScoreDelta = 0;
      this._previousRanks.set(p.peerId, playerIdx++);
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
    this.emitPhase('INITIAL_BUFFERING', { questionIndex: 0 });
  }

  /** Clear only the player map */
  clearPlayers(): void {
    this._players.clear();
  }

  /** Reset to lobby state */
  resetToLobby(): void {
    this.clearSession();
    this._phase = 'LOBBY';
    this._questions = [];
    this._currentIndex = 0;
    this._answers.clear();
    this._answerTimes.clear();
    this._readyPlayers.clear();
    this._lastScoreDeltas.clear();
    this._previousRanks.clear();
    this._players.clear();
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

  saveSession(): void {}
  clearSession(): void {
    try { sessionStorage.removeItem(SESSION_STORAGE_KEY); } catch {}
  }
  restoreSession(): boolean { return false; }
}

// Singleton
export const gameController = new GameController();
