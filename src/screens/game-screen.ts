/* ──────────────────────────────────────────────
   Game Screen — Main Gameplay Engine
   - 100% Native Dual YouTube Player (Ping-Pong Buffering)
   - Silent Pre-roll Ad-Burner in Background
   - Initial Buffering with 10s Hard Timeout & Force Start
   - Intermediate Leaderboard with FLIP Animation
   - Personalized Reveal Styling
   ────────────────────────────────────────────── */

import { setScreen } from '../utils/dom';
import { navigate } from '../utils/router';
import { gameController } from '../game/game-controller';
import { peerManager } from '../network/peer-manager';
import { countdown } from '../engine/timer';
import { dualPlayerManager } from '../engine/youtube-player';
import type { NetworkPacket, QuestionSession, PlayerInfo } from '../types/index';

// ── State variables for active game session ──
let activeFlowId = 0;
let currentTimerCancel: (() => void) | null = null;
let currentCountdownCancel: (() => void) | null = null;
let snippetTimeout: ReturnType<typeof setTimeout> | null = null;
let revealTimeout: ReturnType<typeof setTimeout> | null = null;
let intermediateTimeout: ReturnType<typeof setTimeout> | null = null;
let hardTimeoutTimer: ReturnType<typeof setInterval> | null = null;

let isForceStarted = false;
let isPreparingNext = false;
let hasAnsweredCurrent = false;
let activeSegmentCancel: (() => void) | null = null;

// Store previous player positions for FLIP animation
const previousCardTops = new Map<string, number>();

/**
 * Main Render Function for Game Screen
 */
export function renderGameScreen(): void {
  cleanupTimers();

  const isHost = peerManager.isHost;
  const myPeerId = peerManager.peerId || 'local';

  setScreen(() => {
    const container = document.createElement('div');
    container.className = 'min-h-[100dvh] flex flex-col px-3 py-3 sm:px-4 sm:py-4 relative select-none';

    // Verify questions exist
    if (!gameController.currentQuestion && gameController.phase !== 'GAME_OVER') {
      setTimeout(() => navigate('/main'), 0);
      return container;
    }

    const currentIdx = gameController.currentIndex;
    const totalQ = gameController.totalQuestions;
    const question = gameController.currentQuestion;
    const players = gameController.players;
    const config = gameController.config;

    container.innerHTML = `
      <!-- Top Header: Progress & Scoreboard -->
      <div class="w-full max-w-3xl mx-auto mb-2.5 animate-fade-in" id="game-header">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-text-secondary text-xs font-semibold" id="header-question-step">ข้อ ${currentIdx + 1}/${totalQ}</span>
          <div class="flex-1 h-1.5 bg-bg-card rounded-full overflow-hidden">
            <div id="header-progress-bar" class="h-full bg-gradient-to-r from-accent-purple to-accent-blue rounded-full transition-all duration-500" style="width: ${((currentIdx + 1) / totalQ) * 100}%"></div>
          </div>
          <span class="text-text-muted text-xs font-mono" id="header-points">${question ? question.points : 10}pt</span>
        </div>
        
        <div class="flex flex-wrap gap-1.5 justify-center" id="scoreboard-container">
          ${renderScoreboardItems(players)}
        </div>
        <div id="player-alert-banner" class="hidden text-center text-xs text-accent-yellow font-semibold mt-1 px-3 py-1 glass-card-light rounded-lg"></div>
      </div>

      <!-- 16:9 Media Container with Dual-Player Stage -->
      <div class="w-full max-w-3xl mx-auto mb-3" id="media-outer-box">
        <div class="w-full aspect-video bg-black rounded-2xl overflow-hidden relative shadow-2xl border border-border-subtle flex items-center justify-center" id="media-viewport">

          <!-- Anchor for Dual-Player Stage Positioning -->
          <div id="dual-player-anchor" class="absolute inset-0 w-full h-full pointer-events-none"></div>

          <!-- Audio Curtain / Visualizer Overlay -->
          <div id="media-curtain" class="absolute inset-0 bg-[#0a0a14] z-20 flex flex-col items-center justify-center gap-3">
            <div class="flex items-end gap-1.5 h-12 mb-1" id="audio-visualizer-bars">
              ${Array.from({ length: 14 }, () => `<div class="w-1.5 bg-gradient-to-t from-accent-purple to-accent-cyan rounded-full animate-pulse" style="height: ${20 + Math.random() * 75}%;"></div>`).join('')}
            </div>
            <p class="font-heading font-bold text-sm sm:text-base text-text-primary" id="curtain-title">🎵 โหมดฟังเสียงเพลง</p>
            <p class="text-text-muted text-xs" id="curtain-sub">รอฟังเพลงทายให้จบก่อนเริ่มตอบ</p>
          </div>

          <!-- Countdown 3..2..1 Overlay (100% Solid Black, Zero Faint Video Leak) -->
          <div id="countdown-overlay" class="absolute inset-0 z-40 bg-[#0a0a14] flex flex-col items-center justify-center hidden">
            <div class="flex flex-col items-center gap-2">
              <div id="countdown-number" class="text-7xl sm:text-8xl font-heading font-black text-transparent bg-clip-text bg-gradient-to-br from-accent-purple via-accent-cyan to-white">3</div>
              <span class="text-xs font-semibold text-text-muted uppercase tracking-widest animate-pulse">เตรียมพร้อม...</span>
            </div>
          </div>

          <!-- Slow Connection Warning Banner -->
          <div id="slow-network-banner" class="absolute bottom-2 left-2 right-2 z-35 bg-accent-red/80 backdrop-blur-md text-white text-xs py-1 px-3 rounded-lg text-center font-semibold hidden animate-slide-up">
            ⚠️ การเชื่อมต่อช้า กำลังเร่งข้ามเพื่อเล่นต่อ...
          </div>
        </div>
      </div>

      <!-- Question Timer Bar -->
      <div id="timer-container" class="w-full max-w-3xl mx-auto mb-2.5 px-1 transition-all duration-300">
        <div class="flex items-center justify-between text-xs font-bold font-mono mb-1.5 px-0.5">
          <div class="flex items-center gap-1.5" id="timer-label-box">
            <span class="text-sm" id="timer-icon">⏳</span>
            <span class="text-text-secondary uppercase tracking-wider text-[11px]" id="timer-label">เวลาตอบ</span>
          </div>
          <div class="flex items-center gap-1 font-mono text-sm sm:text-base font-extrabold text-accent-cyan transition-colors" id="timer-text-wrap">
            <span id="timer-seconds">${config.guessDuration}</span><span class="text-xs">s</span>
          </div>
        </div>
        
        <div class="timer-bar-wrapper w-full h-3 sm:h-3.5 bg-black/50 rounded-full p-0.5 border border-border-subtle/80 overflow-hidden shadow-inner relative">
          <div
            id="timer-progress-bar"
            class="h-full rounded-full transition-all ease-linear"
            style="width: 100%; background: linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4);"
          ></div>
        </div>
      </div>

      <!-- Choice Buttons Grid -->
      <div class="w-full max-w-3xl mx-auto flex-1 flex flex-col justify-end animate-slide-up stagger-2" id="choices-container">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 w-full" id="choices-grid">
          ${(question?.options || ['', '', '', '']).map((opt, i) => {
            const labels = ['A', 'B', 'C', 'D'];
            return `
              <button class="choice-btn" id="choice-${i}" data-index="${i}" disabled>
                <span class="choice-label">${labels[i]}</span>
                <span class="flex-1 truncate">${opt}</span>
                <div class="player-badges hidden flex-wrap gap-1 mt-1" id="badges-${i}"></div>
              </button>
            `;
          }).join('')}
        </div>

        <!-- Status Bar -->
        <div id="status-bar" class="text-center py-3">
          <span class="text-text-muted text-sm font-medium" id="status-text">⏳ กำลังเตรียมพร้อม...</span>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════
           OVERLAY 1: INITIAL BUFFERING SCREEN (10s Hard Timeout)
           ══════════════════════════════════════════════ -->
      <div id="initial-buffering-overlay" class="fixed inset-0 z-50 bg-bg-primary/95 backdrop-blur-xl flex flex-col items-center justify-center p-4 ${gameController.phase === 'INITIAL_BUFFERING' ? 'flex' : 'hidden'}">
        <div class="w-full max-w-lg glass-card p-6 sm:p-8 flex flex-col items-center text-center shadow-2xl border border-accent-purple/30">
          <div class="w-16 h-16 rounded-full bg-accent-purple/20 border border-accent-purple/40 flex items-center justify-center text-3xl mb-4 animate-float">
            🎧
          </div>
          <h2 class="text-xl sm:text-2xl font-bold font-heading gradient-text mb-1">
            กำลังเตรียมความพร้อมเข้าสู่เกม
          </h2>
          <p class="text-text-secondary text-xs sm:text-sm mb-6" id="buffering-subtext">
            ระบบกำลังเบิร์นโฆษณาและเตรียมบัฟเฟอร์แบบไร้รอยต่อ...
          </p>

          <!-- Players Ready Grid -->
          <div class="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-6" id="buffering-players-list">
            ${renderBufferingPlayersList(players)}
          </div>

          <!-- Hard Timeout Counter / Force Start Button Area -->
          <div class="w-full flex flex-col items-center gap-3 pt-2" id="buffering-controls">
            <div class="flex items-center gap-2 text-xs text-text-muted font-mono" id="hard-timeout-status">
              <div class="spinner !w-3.5 !h-3.5"></div>
              <span id="hard-timeout-text">กำลังเบิร์นโฆษณา (จะเริ่มอัตโนมัติเมื่อทุกคนพร้อม)</span>
            </div>

            <!-- Neon Red Force Start Button (Shown for Host on 10s Timeout) -->
            <button id="btn-force-start" class="btn-force-start w-full text-base sm:text-lg hidden">
              ⚡ บังคับเริ่มเกมเลย (Force Start)
            </button>
          </div>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════
           OVERLAY 2: INTERMEDIATE LEADERBOARD (FLIP Animation)
           ══════════════════════════════════════════════ -->
      <div id="intermediate-leaderboard-overlay" class="fixed inset-0 z-45 bg-bg-primary/95 backdrop-blur-xl flex flex-col items-center justify-center p-4 hidden">
        <div class="w-full max-w-lg glass-card p-6 sm:p-8 flex flex-col shadow-2xl border border-border-subtle">
          <div class="text-center mb-5">
            <span class="text-xs uppercase tracking-widest text-accent-cyan font-bold">Leaderboard</span>
            <h2 class="text-xl sm:text-2xl font-bold font-heading gradient-text mt-0.5" id="intermediate-title">
              🏆 สรุปคะแนน (ข้อ ${currentIdx + 1}/${totalQ})
            </h2>
            <p class="text-text-muted text-xs mt-1">
              ✨ เครื่องเล่นคู่กำลังเตรียมสื่อข้อถัดไปแบบไร้โฆษณา...
            </p>
          </div>

          <!-- FLIP Card Items Container -->
          <div class="flex flex-col gap-2 w-full mb-4 relative" id="flip-leaderboard-list">
            ${renderIntermediateCards(players, gameController.lastScoreDeltas)}
          </div>

          <div class="w-full h-1.5 bg-bg-card rounded-full overflow-hidden mt-2">
            <div id="intermediate-progress" class="h-full bg-gradient-to-r from-accent-cyan to-accent-purple rounded-full transition-all ease-linear" style="width: 100%;"></div>
          </div>
        </div>
      </div>
    `;

    // ── Setup Network Listeners for Multiplayer ──
    setupMultiplayerListeners(isHost, myPeerId);

    return container;
  });

  // Mount DualPlayer stage to viewport
  const currentFlowId = ++activeFlowId;
  queueMicrotask(() => {
    const viewport = document.getElementById('media-viewport');
    if (viewport) {
      dualPlayerManager.mountToGameScreen(viewport);
    }
    handleFlowState(currentFlowId);
  });
}

/**
 * Handle initial state machine dispatch after DOM mount
 */
function handleFlowState(flowId: number): void {
  if (activeFlowId !== flowId) return;

  const currentPhase = gameController.phase;
  const isHost = peerManager.isHost;
  const myPeerId = peerManager.peerId || 'local';

  if (currentPhase === 'INITIAL_BUFFERING') {
    startInitialBuffering(flowId, isHost, myPeerId);
  } else if (currentPhase === 'INTERMEDIATE_LEADERBOARD') {
    showIntermediateLeaderboard();
  } else {
    // Standard question flow
    const question = gameController.currentQuestion;
    if (question) {
      startQuestionFlow(question, flowId);
    }
  }
}

/**
 * ─────────────────────────────────────────────────────────────
 * INITIAL BUFFERING PHASE (10s Hard Timeout & Force Start)
 * ─────────────────────────────────────────────────────────────
 */
async function startInitialBuffering(flowId: number, isHost: boolean, myPeerId: string): Promise<void> {
  const overlay = document.getElementById('initial-buffering-overlay');
  if (overlay) overlay.classList.remove('hidden');

  dualPlayerManager.syncActiveSlot(0);
  dualPlayerManager.setStageVisible(false);

  const question = gameController.currentQuestion;
  if (!question) return;

  const hardTimeoutText = document.getElementById('hard-timeout-text');
  const forceStartBtn = document.getElementById('btn-force-start') as HTMLButtonElement | null;

  isForceStarted = false;
  let hasSignaledReady = false;

  // 1. Preload & Burn Pre-roll for Slot A
  const bufferTask = async () => {
    try {
      await dualPlayerManager.preload('A', question.youtubeId, question.startTime);
    } catch (err) {
      console.warn('[InitialBuffering] Slot A preload error:', err);
    } finally {
      if (!hasSignaledReady && activeFlowId === flowId) {
        hasSignaledReady = true;
        signalBufferReady(0, myPeerId, isHost);
      }
    }
  };

  bufferTask();

  // 2. Hard Timeout (10 seconds) on Host
  if (isHost) {
    let timeLeft = 10;
    if (hardTimeoutTimer) clearInterval(hardTimeoutTimer);

    hardTimeoutTimer = setInterval(() => {
      if (activeFlowId !== flowId) {
        clearInterval(hardTimeoutTimer!);
        return;
      }

      timeLeft--;
      if (hardTimeoutText) {
        hardTimeoutText.textContent = `รอผู้เล่นทุกคนพร้อม... (${timeLeft}s)`;
      }

      if (timeLeft <= 0) {
        clearInterval(hardTimeoutTimer!);
        // If not all players ready, display the Force Start Button prominently
        if (!gameController.isAllPlayersReady(0)) {
          if (hardTimeoutText) {
            hardTimeoutText.innerHTML = '<span class="text-accent-red font-bold">⚠️ มีผู้เล่นที่โหลดช้า สามารถบังคับเริ่มได้</span>';
          }
          if (forceStartBtn) {
            forceStartBtn.classList.remove('hidden');
            forceStartBtn.onclick = () => {
              forceStartBtn.disabled = true;
              isForceStarted = true;
              gameController.forceStart(0);
            };
          }
        }
      }
    }, 1000);
  }
}

/**
 * Signal BUFFER_READY to host or process locally
 */
function signalBufferReady(questionIndex: number, myPeerId: string, isHost: boolean): void {
  updatePlayerReadyStatus(myPeerId, true);

  if (isHost) {
    const allReady = gameController.setPlayerReady(myPeerId, questionIndex);
    updateBufferingUI();
    if (allReady) {
      if (hardTimeoutTimer) clearInterval(hardTimeoutTimer);
      setTimeout(() => {
        gameController.startCountdown(questionIndex);
      }, 350);
    }
  } else {
    peerManager.sendBufferReady(questionIndex);
  }
}

/**
 * Update ready badge on UI for a specific player
 */
function updatePlayerReadyStatus(peerId: string, isReady: boolean): void {
  const badge = document.getElementById(`ready-badge-${peerId.replace(/[^a-zA-Z0-9]/g, '_')}`);
  if (badge) {
    if (isReady) {
      badge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold badge-ready animate-fade-in flex items-center gap-1';
      badge.innerHTML = '<span>✅</span> พร้อมแล้ว';
    } else {
      badge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold badge-preparing flex items-center gap-1';
      badge.innerHTML = '<div class="spinner !w-3 !h-3"></div> <span>กำลังเตรียมสื่อ...</span>';
    }
  }
}

function updateBufferingUI(): void {
  const container = document.getElementById('buffering-players-list');
  if (container) {
    container.innerHTML = renderBufferingPlayersList(gameController.players);
  }
}

/**
 * ─────────────────────────────────────────────────────────────
 * QUESTION FLOW: COUNTDOWN -> SNIPPET -> ANSWERING -> REVEAL
 * ─────────────────────────────────────────────────────────────
 */
function startQuestionFlow(question: QuestionSession, flowId: number): void {
  // Hide buffering & leaderboard overlays
  const bufferingOverlay = document.getElementById('initial-buffering-overlay');
  if (bufferingOverlay) bufferingOverlay.classList.add('hidden');

  const leaderboardOverlay = document.getElementById('intermediate-leaderboard-overlay');
  if (leaderboardOverlay) leaderboardOverlay.classList.add('hidden');

  // Update header indicators
  const currentIdx = gameController.currentIndex;
  const totalQ = gameController.totalQuestions;

  // Deterministically sync active slot for this question index
  dualPlayerManager.syncActiveSlot(currentIdx);
  // Ensure stage is 100% invisible during countdown (zero video leak over countdown)
  dualPlayerManager.setStageVisible(false);
  dualPlayerManager.updateAntiSpoiler(question.type, true);

  const stepEl = document.getElementById('header-question-step');
  const barEl = document.getElementById('header-progress-bar');
  const pointsEl = document.getElementById('header-points');
  if (stepEl) stepEl.textContent = `ข้อ ${currentIdx + 1}/${totalQ}`;
  if (barEl) barEl.style.width = `${((currentIdx + 1) / totalQ) * 100}%`;
  if (pointsEl) pointsEl.textContent = `${question.points}pt`;

  // Update choice options
  const choicesGrid = document.getElementById('choices-grid');
  if (choicesGrid) {
    const labels = ['A', 'B', 'C', 'D'];
    choicesGrid.innerHTML = question.options.map((opt, i) => `
      <button class="choice-btn" id="choice-${i}" data-index="${i}" disabled>
        <span class="choice-label">${labels[i]}</span>
        <span class="flex-1 truncate">${opt}</span>
        <div class="player-badges hidden flex-wrap gap-1 mt-1" id="badges-${i}"></div>
      </button>
    `).join('');
  }

  // Reset timer bar styling
  const timerLabel = document.getElementById('timer-label');
  const timerIcon = document.getElementById('timer-icon');
  const timerSeconds = document.getElementById('timer-seconds');
  const timerContainer = document.getElementById('timer-container');
  const timerTextWrap = document.getElementById('timer-text-wrap');
  const timerProgressBar = document.getElementById('timer-progress-bar');

  if (timerLabel) timerLabel.textContent = 'เวลาตอบ';
  if (timerIcon) timerIcon.textContent = '⏳';
  if (timerSeconds) timerSeconds.textContent = String(gameController.config.guessDuration);
  if (timerContainer) {
    timerContainer.classList.remove('timer-urgent-pulse', 'opacity-40');
  }
  if (timerTextWrap) {
    timerTextWrap.classList.remove('text-accent-red', 'text-accent-green');
    timerTextWrap.classList.add('text-accent-cyan');
  }
  if (timerProgressBar) {
    timerProgressBar.classList.remove('timer-urgent-bar');
    timerProgressBar.style.width = '100%';
    timerProgressBar.style.background = 'linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4)';
  }

  // Ensure media curtain covers the video during countdown
  const curtain = document.getElementById('media-curtain');
  if (curtain) curtain.classList.remove('hidden');

  // Ensure active player is paused and positioned at startTime
  const activeP = dualPlayerManager.getActivePlayer();
  if (activeP) {
    try {
      activeP.pauseVideo();
      activeP.seekTo(question.startTime, true);
    } catch {}
  }

  // Execute countdown 3..2..1
  runCountdown(flowId, () => {
    if (activeFlowId !== flowId) return;
    runSnippetAndAnswering(question, flowId);
  });
}

/**
 * 3..2..1 Countdown
 */
function runCountdown(flowId: number, onComplete: () => void): void {
  const overlay = document.getElementById('countdown-overlay');
  const numberEl = document.getElementById('countdown-number');
  if (overlay) overlay.classList.remove('hidden');

  if (currentCountdownCancel) {
    currentCountdownCancel();
    currentCountdownCancel = null;
  }

  const { cancel } = countdown(3, (n) => {
    if (activeFlowId !== flowId) return;
    if (numberEl) {
      numberEl.textContent = String(n);
      numberEl.style.animation = 'none';
      void numberEl.offsetHeight;
      numberEl.style.animation = 'countdownPulse 0.9s ease-out';
    }
  }, () => {
    if (activeFlowId !== flowId) return;
    if (overlay) overlay.classList.add('hidden');
    onComplete();
  });

  currentCountdownCancel = cancel;
}

/**
 * Play Snippet then unlock Answering Buttons
 * Plus: Background player preloads Question N+1 immediately during snippet!
 */
function runSnippetAndAnswering(question: QuestionSession, flowId: number): void {
  const curtain = document.getElementById('media-curtain');
  const statusText = document.getElementById('status-text');
  const snippetDuration = gameController.config.snippetDuration || 3;
  const answerDuration = gameController.config.guessDuration || 10;
  const buttons = document.querySelectorAll('.choice-btn') as NodeListOf<HTMLButtonElement>;

  hasAnsweredCurrent = false;

  // 1. Start Preloading Question N+1 on Background Slot immediately!
  const nextIdx = gameController.currentIndex + 1;
  const nextQuestion = gameController.questions[nextIdx];
  if (nextQuestion) {
    const bgSlot = dualPlayerManager.getBackgroundSlot();
    console.log(`[DualPlayer] Pre-buffering Question ${nextIdx + 1} on Background Slot ${bgSlot}...`);
    dualPlayerManager.preload(bgSlot, nextQuestion.youtubeId, nextQuestion.startTime).catch(() => {});
  }

  // 2. Lock buttons during snippet playback
  buttons.forEach((btn) => {
    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
  });

  if (statusText) {
    statusText.innerHTML = question.type === 'video'
      ? `🎬 กำลังแสดงคลิปทาย... <span class="text-accent-cyan font-bold">${snippetDuration}s</span> (รอคลิปจบเพื่อตอบ)`
      : `🎧 กำลังเปิดเสียงเพลง... <span class="text-accent-cyan font-bold">${snippetDuration}s</span> (รอเพลงจบเพื่อตอบ)`;
  }

  // Uncover video only if video MV mode
  if (question.type === 'video') {
    if (curtain) curtain.classList.add('hidden');
    dualPlayerManager.setStageVisible(true);
    dualPlayerManager.updateAntiSpoiler('video', true);
  } else {
    if (curtain) curtain.classList.remove('hidden');
    dualPlayerManager.setStageVisible(false);
  }

  // 3. Play snippet on Active Player unmuted
  if (activeSegmentCancel) { activeSegmentCancel(); activeSegmentCancel = null; }
  activeSegmentCancel = dualPlayerManager.playSnippet(snippetDuration).cancel;

  // 4. Snippet Timer completes -> Transition to Answering
  snippetTimeout = setTimeout(() => {
    if (activeFlowId !== flowId) return;

    if (activeSegmentCancel) { activeSegmentCancel(); activeSegmentCancel = null; }
    dualPlayerManager.getActivePlayer()?.pauseVideo();
    dualPlayerManager.setStageVisible(false);

    // Cover video immediately with curtain to prevent visual spoiler while answering
    if (curtain) curtain.classList.remove('hidden');

    // Unlock answer choices
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove('opacity-60', 'cursor-not-allowed');
    });

    // Host triggers guessing state for answer duration
    if (peerManager.isHost) {
      gameController.triggerGuessing();
    }

    if (statusText) {
      statusText.innerHTML = '⏰ <span class="text-accent-cyan font-bold">เลือกคำตอบเร็ว!</span> (ตอบเร็วกว่า = คะแนนเยอะกว่า)';
    }

    const answerStartTime = Date.now();

    // Start Question Timer Progress Bar
    if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
    currentTimerCancel = startTimerBar(answerDuration, () => {
      // Timeout: auto-submit with -1
      if (!hasAnsweredCurrent && activeFlowId === flowId) {
        hasAnsweredCurrent = true;
        buttons.forEach((btn) => { btn.disabled = true; });
        if (statusText) statusText.textContent = '⏰ หมดเวลาตอบ!';
        const myPeerId = peerManager.peerId || 'local';
        gameController.submitAnswer(myPeerId, -1, answerDuration * 1000);
      }
    });

    // Attach click handlers to choices
    buttons.forEach((btn) => {
      btn.onclick = () => {
        if (hasAnsweredCurrent || activeFlowId !== flowId) return;
        hasAnsweredCurrent = true;
        const timeUsedMs = Date.now() - answerStartTime;
        const choiceIndex = parseInt(btn.getAttribute('data-index') || '0', 10);

        if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
        buttons.forEach((b) => { b.disabled = true; });
        btn.classList.add('selected');

        const secUsed = (timeUsedMs / 1000).toFixed(1);
        if (statusText) {
          statusText.textContent = peerManager.role === 'solo'
            ? `⏳ ตอบแล้ว (${secUsed}s) กำลังเฉลย...`
            : `⏳ ตอบแล้ว (${secUsed}s) กำลังรอผู้เล่นอื่น...`;
        }

        const myPeerId = peerManager.peerId || 'local';
        gameController.submitAnswer(myPeerId, choiceIndex, timeUsedMs);
      };
    });
  }, snippetDuration * 1000);
}

/**
 * Timer Progress Bar with Urgent Pulse
 */
function startTimerBar(durationSec: number, onExpire?: () => void): () => void {
  const totalMs = durationSec * 1000;
  const startTime = Date.now();
  let animId: number | null = null;
  let isCancelled = false;

  const tick = () => {
    if (isCancelled) return;
    const elapsed = Date.now() - startTime;
    const remainingMs = Math.max(0, totalMs - elapsed);
    const percent = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
    const remainingSec = Math.ceil(remainingMs / 1000);

    const bar = document.getElementById('timer-progress-bar');
    const secEl = document.getElementById('timer-seconds');
    const container = document.getElementById('timer-container');
    const iconEl = document.getElementById('timer-icon');
    const textWrap = document.getElementById('timer-text-wrap');

    if (bar) bar.style.width = `${percent}%`;
    if (secEl) secEl.textContent = String(remainingSec);

    // Urgent Threshold: <= 3 seconds remaining
    if (remainingSec <= 3 && remainingMs > 0) {
      if (bar) bar.classList.add('timer-urgent-bar');
      if (container) container.classList.add('timer-urgent-pulse');
      if (iconEl) iconEl.textContent = '🚨';
      if (textWrap) {
        textWrap.classList.remove('text-accent-cyan');
        textWrap.classList.add('text-accent-red');
      }
    }

    if (remainingMs <= 0) {
      if (onExpire) onExpire();
      return;
    }

    animId = requestAnimationFrame(tick);
  };

  animId = requestAnimationFrame(tick);

  return () => {
    isCancelled = true;
    if (animId) cancelAnimationFrame(animId);
  };
}

/**
 * ─────────────────────────────────────────────────────────────
 * REVEAL PHASE (5 Seconds Video / Audio Uncovered)
 * Personalized Answer Choice Styling
 * ─────────────────────────────────────────────────────────────
 */
function showReveal(question: QuestionSession): void {
  cleanupTimers();

  const config = gameController.config;
  const answers = gameController.answers;
  const players = gameController.players;
  const curtain = document.getElementById('media-curtain');
  const statusText = document.getElementById('status-text');
  const countdownOverlay = document.getElementById('countdown-overlay');

  // Hide curtain and countdown so reveal video/audio is uncovered
  if (curtain) curtain.classList.add('hidden');
  if (countdownOverlay) countdownOverlay.classList.add('hidden');
  dualPlayerManager.setStageVisible(true);
  dualPlayerManager.updateAntiSpoiler(question.type, false);

  // Update Status Banner
  if (statusText) {
    statusText.innerHTML = `🎬 <span class="text-accent-green font-bold">เฉลยคลิป:</span> <span class="text-text-primary font-bold">${question.title}</span>`;
  }

  // Reveal Timer Progress Bar Countdown
  const timerLabel = document.getElementById('timer-label');
  const timerIcon = document.getElementById('timer-icon');
  const timerContainer = document.getElementById('timer-container');
  const timerTextWrap = document.getElementById('timer-text-wrap');
  const timerProgressBar = document.getElementById('timer-progress-bar');

  if (timerLabel) timerLabel.textContent = 'กำลังเล่นคลิปเฉลย';
  if (timerIcon) timerIcon.textContent = '🎬';
  if (timerContainer) {
    timerContainer.classList.remove('timer-urgent-pulse', 'opacity-40');
  }
  if (timerTextWrap) {
    timerTextWrap.classList.remove('text-accent-red', 'text-accent-cyan');
    timerTextWrap.classList.add('text-accent-green');
  }
  if (timerProgressBar) {
    timerProgressBar.style.background = 'linear-gradient(90deg, #10b981, #06b6d4, #8b5cf6)';
  }

  if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
  currentTimerCancel = startTimerBar(config.revealDuration);

  // Play reveal on Active Player
  const revealStart = (typeof question.revealStartTime === 'number' && question.revealStartTime >= 0)
    ? question.revealStartTime
    : question.startTime;

  if (activeSegmentCancel) { activeSegmentCancel(); activeSegmentCancel = null; }
  activeSegmentCancel = dualPlayerManager.playReveal(revealStart, config.revealDuration).cancel;

  // Personalized highlight logic:
  // - Correct answer is always green
  // - If the current player got it right: all other options dim (opacity-35), no red anywhere
  // - If the current player got it wrong: ONLY their chosen option turns red; others dim (opacity-35)
  const myPeerId = peerManager.peerId || 'local';
  const myChoice = answers[myPeerId] as number | undefined;
  const iAnsweredCorrectly = myChoice === question.correctIndex;

  const buttons = document.querySelectorAll('.choice-btn') as NodeListOf<HTMLButtonElement>;
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    btn.classList.remove('selected');

    if (i === question.correctIndex) {
      btn.classList.add('correct');
      btn.style.opacity = '1';
    } else if (iAnsweredCorrectly) {
      btn.style.opacity = '0.35';
    } else {
      if (i === myChoice) {
        btn.classList.add('wrong');
        btn.style.opacity = '1';
      } else {
        btn.style.opacity = '0.35';
      }
    }

    // Show badges of who picked what
    const playersWhoChose = Object.entries(answers)
      .filter(([, choice]) => choice === i)
      .map(([peerId]) => {
        const p = players.find((pl) => pl.peerId === peerId);
        return p?.name || peerId.substring(0, 5);
      });

    const badgesContainer = document.getElementById(`badges-${i}`);
    if (badgesContainer) {
      if (playersWhoChose.length > 0) {
        badgesContainer.classList.remove('hidden');
        badgesContainer.innerHTML = playersWhoChose.map((name) => `
          <span class="player-badge">${name}</span>
        `).join('');
      } else {
        badgesContainer.classList.add('hidden');
      }
    }
  });

  // Update top scoreboard
  updateScoreboardUI(players);

  // Reveal duration (5 seconds) -> Transition to INTERMEDIATE LEADERBOARD
  revealTimeout = setTimeout(() => {
    if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
    if (activeSegmentCancel) { activeSegmentCancel(); activeSegmentCancel = null; }
    dualPlayerManager.getActivePlayer()?.pauseVideo();
    dualPlayerManager.getActivePlayer()?.mute();

    if (curtain) curtain.classList.remove('hidden');

    if (peerManager.isHost || peerManager.role === 'solo') {
      const nextIdx = gameController.currentIndex + 1;
      if (nextIdx >= gameController.totalQuestions) {
        gameController.gameOver();
        cleanupGameScreen();
        navigate('/results');
      } else {
        gameController.triggerIntermediateLeaderboard();
      }
    }
  }, config.revealDuration * 1000);
}

/**
 * ─────────────────────────────────────────────────────────────
 * INTERMEDIATE LEADERBOARD (FLIP Animation & Ping-Pong Swap)
 * ─────────────────────────────────────────────────────────────
 */
function showIntermediateLeaderboard(): void {
  cleanupTimers();

  const overlay = document.getElementById('intermediate-leaderboard-overlay');
  const titleEl = document.getElementById('intermediate-title');
  const container = document.getElementById('flip-leaderboard-list');
  const progressBar = document.getElementById('intermediate-progress');
  const totalQ = gameController.totalQuestions;
  const currentIdx = gameController.currentIndex;
  const isHost = peerManager.isHost;
  const myPeerId = peerManager.peerId || 'local';

  if (overlay) overlay.classList.remove('hidden');
  if (titleEl) titleEl.textContent = `🏆 สรุปคะแนน (ข้อ ${currentIdx + 1}/${totalQ})`;

  // 1. FLIP ANIMATION: Capture First positions before DOM updates
  if (container) {
    const existingCards = container.querySelectorAll('.flip-card') as NodeListOf<HTMLElement>;
    previousCardTops.clear();
    existingCards.forEach((card) => {
      const id = card.getAttribute('data-peer-id');
      if (id) {
        previousCardTops.set(id, card.getBoundingClientRect().top);
      }
    });

    // Update DOM order with newly sorted players
    container.innerHTML = renderIntermediateCards(gameController.players, gameController.lastScoreDeltas);

    // FLIP: Calculate Last positions, Invert, and Play
    requestAnimationFrame(() => {
      const updatedCards = container.querySelectorAll('.flip-card') as NodeListOf<HTMLElement>;
      updatedCards.forEach((card) => {
        const id = card.getAttribute('data-peer-id');
        if (id && previousCardTops.has(id)) {
          const firstTop = previousCardTops.get(id)!;
          const lastTop = card.getBoundingClientRect().top;
          const deltaY = firstTop - lastTop;

          if (deltaY !== 0) {
            // Invert
            card.style.transform = `translateY(${deltaY}px)`;
            card.style.transition = 'none';

            // Play
            requestAnimationFrame(() => {
              card.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
              card.style.transform = '';
            });
          }
        }
      });
    });
  }

  // Ensure media curtain covers player behind leaderboard & stage is invisible
  const curtain = document.getElementById('media-curtain');
  if (curtain) curtain.classList.remove('hidden');
  dualPlayerManager.setStageVisible(false);
  dualPlayerManager.pauseAll();

  // 2. Ensure Background Player is preloaded with Question N+1
  const nextIdx = currentIdx + 1;
  const nextQuestion = gameController.questions[nextIdx];
  const bgSlot = dualPlayerManager.getBackgroundSlot();

  if (nextQuestion && !isPreparingNext) {
    isPreparingNext = true;
    dualPlayerManager.preload(bgSlot, nextQuestion.youtubeId, nextQuestion.startTime)
      .then(() => {
        if (isHost) {
          gameController.setPlayerReady(myPeerId, nextIdx);
        } else {
          peerManager.sendBufferReady(nextIdx);
        }
      })
      .catch((err) => {
        console.warn('[Leaderboard] Background preload error:', err);
      })
      .finally(() => {
        isPreparingNext = false;
      });
  }

  // 3. Animate progress bar across 4.5 seconds
  if (progressBar) {
    progressBar.style.transition = 'none';
    progressBar.style.width = '100%';
    requestAnimationFrame(() => {
      progressBar.style.transition = 'width 4.5s linear';
      progressBar.style.width = '0%';
    });
  }

  // 4. Advance to next question countdown after 4.5 seconds:
  // Deterministically switch active player slot to match Question N+1
  intermediateTimeout = setTimeout(() => {
    dualPlayerManager.syncActiveSlot(currentIdx + 1);

    if (isHost || peerManager.role === 'solo') {
      gameController.nextQuestion();
    }
  }, 4500);
}

/**
 * ─────────────────────────────────────────────────────────────
 * MULTIPLAYER NETWORK LISTENERS & PROTOCOL
 * ─────────────────────────────────────────────────────────────
 */
function setupMultiplayerListeners(isHost: boolean, myPeerId: string): void {
  if (isHost && peerManager.role === 'host') {
    peerManager.on({
      onReceive: (peerId, packet) => {
        handleHostPacket(peerId, packet);
      },
      onPlayerJoin: () => {
        console.warn('[GameScreen] Player tried to join mid-game, rejecting');
      },
      onPlayerLeave: (peerId) => {
        const departing = gameController.players.find((p) => p.peerId === peerId);
        gameController.removePlayer(peerId);
        peerManager.broadcast({
          type: 'PLAYER_LEAVE',
          peerId,
          remainingPlayers: gameController.players,
        });
        updateScoreboardUI(gameController.players, departing?.name);
      },
    });
  } else if (!isHost) {
    peerManager.on({
      onReceive: (_peerId, packet) => {
        handleClientPacket(packet, myPeerId);
      },
      onPlayerLeave: (peerId) => {
        if (peerId === peerManager.hostPeerId) {
          alert('⚠️ Host ออกจากห้องแล้ว เกมสิ้นสุด');
          navigate('/main');
        }
      },
      onError: (err) => {
        console.warn('[GameScreen] Network error:', err);
      },
    });
  }

  // Local phase change listener
  gameController.onPhaseChange((phase) => {
    if (phase === 'REVEAL') {
      const curQ = gameController.currentQuestion;
      if (curQ) showReveal(curQ);
    } else if (phase === 'COUNTDOWN') {
      const curQ = gameController.currentQuestion;
      if (curQ) startQuestionFlow(curQ, activeFlowId);
    } else if (phase === 'INTERMEDIATE_LEADERBOARD') {
      showIntermediateLeaderboard();
    }
  });
}

function handleHostPacket(peerId: string, packet: NetworkPacket): void {
  switch (packet.type) {
    case 'BUFFER_READY': {
      const allReady = gameController.setPlayerReady(peerId, packet.questionIndex);
      updatePlayerReadyStatus(peerId, true);

      if (gameController.phase === 'INITIAL_BUFFERING' && allReady) {
        if (hardTimeoutTimer) clearInterval(hardTimeoutTimer);
        setTimeout(() => {
          gameController.startCountdown(packet.questionIndex);
        }, 350);
      }
      break;
    }

    case 'SUBMIT_ANSWER':
    case 'PLAYER_SUBMIT': {
      gameController.receiveAnswer(peerId, packet.choiceIndex, packet.timeUsedMs);
      break;
    }
  }
}

function handleClientPacket(packet: NetworkPacket, _myPeerId: string): void {
  switch (packet.type) {
    case 'ALL_READY':
    case 'FORCE_START':
    case 'STATE_COUNTDOWN': {
      if (packet.type === 'FORCE_START') {
        const slowBanner = document.getElementById('slow-network-banner');
        if (slowBanner) slowBanner.classList.remove('hidden');
      }

      if (gameController.currentIndex !== packet.questionIndex) {
        gameController.setQuestionIndex(packet.questionIndex);
      }

      const q = gameController.currentQuestion;
      if (q) {
        startQuestionFlow(q, activeFlowId);
      }
      break;
    }

    case 'TRIGGER_REVEAL': {
      gameController.receiveReveal(
        packet.answers,
        packet.scores,
        packet.correctCounts,
        packet.wrongCounts,
        (packet as any).lastScoreDeltas
      );
      break;
    }

    case 'SHOW_INTERMEDIATE_LEADERBOARD': {
      showIntermediateLeaderboard();
      break;
    }

    case 'PLAYER_LEAVE': {
      const departing = gameController.players.find((p) => p.peerId === packet.peerId);
      gameController.removePlayer(packet.peerId);
      updateScoreboardUI(packet.remainingPlayers, departing?.name);
      break;
    }

    case 'GAME_OVER': {
      gameController.receiveGameOver(
        packet.finalScores,
        packet.correctCounts,
        packet.wrongCounts,
        packet.finalLeaderboard
      );
      cleanupGameScreen();
      navigate('/results');
      break;
    }
  }
}

/**
 * ─────────────────────────────────────────────────────────────
 * UI RENDERING HELPERS
 * ─────────────────────────────────────────────────────────────
 */
function renderScoreboardItems(players: PlayerInfo[]): string {
  const colors = [
    'accent-purple',
    'accent-blue',
    'accent-pink',
    'accent-cyan',
    'accent-green',
    'accent-yellow',
  ];
  return players.map((p, i) => {
    const col = colors[i % colors.length];
    const scoreStr = Number.isInteger(p.score) ? String(p.score) : p.score.toFixed(1);
    return `
      <div class="score-item !py-1 !px-2.5 text-xs flex items-center gap-1.5 glass-card-light rounded-lg" id="score-${p.peerId.replace(/[^a-zA-Z0-9]/g, '_')}">
        <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-${col}/20 text-${col}">${p.name.charAt(0).toUpperCase()}</span>
        <span class="text-text-primary max-w-[80px] truncate font-medium">${p.name}</span>
        <span class="text-${col} font-bold font-mono" id="score-val-${p.peerId.replace(/[^a-zA-Z0-9]/g, '_')}">${scoreStr}</span>
      </div>
    `;
  }).join('');
}

function updateScoreboardUI(players: PlayerInfo[], departedName?: string): void {
  const sb = document.getElementById('scoreboard-container');
  if (sb) sb.innerHTML = renderScoreboardItems(players);

  if (departedName) {
    const alertEl = document.getElementById('player-alert-banner');
    if (alertEl) {
      alertEl.textContent = `⚠️ ผู้เล่น "${departedName}" ออกจากเกมแล้ว`;
      alertEl.classList.remove('hidden');
      setTimeout(() => alertEl.classList.add('hidden'), 3500);
    }
  }
}

function renderBufferingPlayersList(players: PlayerInfo[]): string {
  return players.map((p) => `
    <div class="flex items-center justify-between p-2.5 glass-card-light rounded-xl border border-border-subtle" id="buffering-player-${p.peerId.replace(/[^a-zA-Z0-9]/g, '_')}">
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-7 h-7 rounded-full bg-accent-purple/20 text-accent-purple font-bold text-xs flex items-center justify-center flex-shrink-0">
          ${p.name.charAt(0).toUpperCase()}
        </div>
        <span class="text-text-primary text-xs sm:text-sm font-semibold truncate">${p.name}</span>
      </div>
      <div id="ready-badge-${p.peerId.replace(/[^a-zA-Z0-9]/g, '_')}">
        ${p.isReady ? `
          <span class="text-xs px-2.5 py-0.5 rounded-full font-semibold badge-ready flex items-center gap-1">
            <span>✅</span> พร้อมแล้ว
          </span>
        ` : `
          <span class="text-xs px-2.5 py-0.5 rounded-full font-semibold badge-preparing flex items-center gap-1">
            <div class="spinner !w-3 !h-3"></div> <span>กำลังเตรียมสื่อ...</span>
          </span>
        `}
      </div>
    </div>
  `).join('');
}

function renderIntermediateCards(players: PlayerInfo[], deltas: Record<string, number>): string {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const rankIcons = ['🥇', '🥈', '🥉'];

  return sorted.map((p, rank) => {
    const delta = deltas[p.peerId] || 0;
    const deltaStr = delta > 0 ? `+${delta}` : '+0';
    const rankLabel = rank < 3 ? rankIcons[rank] : `#${rank + 1}`;

    return `
      <div class="flip-card flex items-center justify-between p-3 glass-card-light rounded-xl border border-border-subtle hover:border-accent-cyan/40" data-peer-id="${p.peerId}">
        <div class="flex items-center gap-3 min-w-0">
          <span class="text-base font-bold font-mono w-6 text-center">${rankLabel}</span>
          <div class="w-8 h-8 rounded-full bg-accent-blue/20 text-accent-cyan font-bold text-xs flex items-center justify-center flex-shrink-0">
            ${p.name.charAt(0).toUpperCase()}
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-text-primary text-sm font-semibold truncate">${p.name}</span>
            <span class="text-[10px] text-text-muted">ความแม่นยำ: ${p.correctCount} ถูก / ${p.wrongCount} ผิด</span>
          </div>
        </div>
        
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="text-xs font-bold px-2 py-0.5 rounded-md ${delta > 0 ? 'bg-accent-green/20 text-accent-green border border-accent-green/30' : 'bg-white/5 text-text-muted'} font-mono">
            ${deltaStr} pt
          </span>
          <span class="text-base font-extrabold text-accent-cyan font-mono">${p.score} pt</span>
        </div>
      </div>
    `;
  }).join('');
}

function cleanupTimers(): void {
  if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
  if (currentCountdownCancel) { currentCountdownCancel(); currentCountdownCancel = null; }
  if (snippetTimeout) { clearTimeout(snippetTimeout); snippetTimeout = null; }
  if (revealTimeout) { clearTimeout(revealTimeout); revealTimeout = null; }
  if (intermediateTimeout) { clearTimeout(intermediateTimeout); intermediateTimeout = null; }
  if (hardTimeoutTimer) { clearInterval(hardTimeoutTimer); hardTimeoutTimer = null; }
  if (activeSegmentCancel) { activeSegmentCancel(); activeSegmentCancel = null; }
}

export function cleanupGameScreen(): void {
  cleanupTimers();
  dualPlayerManager.hideFromGameScreen();
  dualPlayerManager.stopAll();
}
