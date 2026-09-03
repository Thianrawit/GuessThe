/* ──────────────────────────────────────────────
   Game Screen — Main Gameplay
   ────────────────────────────────────────────── */

import { setScreen } from '../utils/dom';
import { navigate, getCurrentRoute } from '../utils/router';
import { gameController } from '../game/game-controller';
import { peerManager } from '../network/peer-manager';
import { mediaEngine } from '../engine/media-engine';
import { countdown } from '../engine/timer';
import type { NetworkPacket, QuestionSession, PlayerInfo } from '../types/index';

let currentSegmentCancel: (() => void) | null = null;
let countdownCancel: (() => void) | null = null;
let currentTimerCancel: (() => void) | null = null;
let hasRevealedCurrentQuestion = false;
let activeFlowId = 0;

function startQuestionTimer(
  durationSec: number,
  onExpire?: () => void
): () => void {
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

    // Urgent Threshold: <= 3 seconds remaining (or <= 25%)
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

function renderScoreboardItems(players: PlayerInfo[]): string {
  const colors = [
    'accent-purple',
    'accent-blue',
    'accent-pink',
    'accent-cyan',
    'accent-green',
    'accent-yellow',
    'orange-400',
    'rose-400',
    'indigo-400',
    'teal-400',
  ];
  return players.map((p, i) => {
    const color = colors[i % colors.length];
    const formattedScore = Number.isInteger(p.score) ? String(p.score) : p.score.toFixed(1);
    return `
      <div class="score-item !py-1 !px-2 text-xs flex items-center gap-1.5" id="score-${p.peerId.replace(/[^a-zA-Z0-9]/g, '_')}">
        <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-${color}/20 text-${color}">${p.name.charAt(0).toUpperCase()}</span>
        <span class="text-text-primary max-w-[80px] truncate">${p.name}</span>
        <span class="text-${color} font-bold" id="score-val-${p.peerId.replace(/[^a-zA-Z0-9]/g, '_')}">${formattedScore}</span>
      </div>
    `;
  }).join('');
}

function updateScoreboardUI(players: PlayerInfo[], departedName?: string): void {
  const sb = document.getElementById('scoreboard-container');
  if (sb) {
    sb.innerHTML = renderScoreboardItems(players);
  }
  if (departedName) {
    const alertEl = document.getElementById('player-disconnect-alert');
    if (alertEl) {
      alertEl.textContent = `⚠️ ผู้เล่น "${departedName}" ออกจากเกมแล้ว`;
      alertEl.classList.remove('hidden');
      setTimeout(() => alertEl.classList.add('hidden'), 3500);
    }
  }
}

export function renderGameScreen(): void {
  // Clean up previous
  if (currentSegmentCancel) { currentSegmentCancel(); currentSegmentCancel = null; }
  if (countdownCancel) { countdownCancel(); countdownCancel = null; }
  if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
  mediaEngine.stop();
  hasRevealedCurrentQuestion = false;

  setScreen(() => {
    const container = document.createElement('div');
    container.className = 'min-h-[100dvh] flex flex-col px-3 py-3 sm:px-4 sm:py-4';

    const question = gameController.currentQuestion;
    const totalQ = gameController.totalQuestions;
    const currentIdx = gameController.currentIndex;
    const players = gameController.players;
    const config = gameController.config;
    const isHost = peerManager.isHost;

    if (!question) {
      container.innerHTML = '<div class="flex-1 flex items-center justify-center text-text-secondary">ไม่พบคำถาม</div>';
      return container;
    }

    container.innerHTML = `
      <!-- Header: Progress + Scoreboard -->
      <div class="w-full max-w-3xl mx-auto mb-3 animate-fade-in">
        <!-- Progress Bar -->
        <div class="flex items-center gap-2 mb-2">
          <span class="text-text-secondary text-xs font-semibold">ข้อ ${currentIdx + 1}/${totalQ}</span>
          <div class="flex-1 h-1.5 bg-bg-card rounded-full overflow-hidden">
            <div class="h-full bg-gradient-to-r from-accent-purple to-accent-blue rounded-full transition-all duration-500" style="width: ${((currentIdx + 1) / totalQ) * 100}%"></div>
          </div>
          <span class="text-text-muted text-xs">${question.points}pt</span>
        </div>
        
        <!-- Scoreboard -->
        <div class="flex flex-wrap gap-1.5 justify-center" id="scoreboard-container">
          ${renderScoreboardItems(players)}
        </div>
        <div id="player-disconnect-alert" class="hidden text-center text-xs text-accent-yellow font-semibold mt-1"></div>
      </div>

      <!-- Media Wrapper -->
      <div class="w-full max-w-3xl mx-auto mb-3 animate-slide-up">
        <div class="media-wrapper relative overflow-hidden" id="media-container">
          <!-- Anti-Spoiler Top Mask covering YouTube Title Header -->
          <div class="anti-spoiler-mask" id="anti-spoiler-mask">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${question.type === 'video' ? 'bg-accent-blue' : 'bg-accent-purple'} animate-pulse"></span>
              <span class="font-heading font-bold text-xs sm:text-sm text-text-primary tracking-wide">
                GuessThe? <span class="gradient-text font-semibold">${question.type === 'video' ? 'MV' : 'Music'}</span>
              </span>
            </div>
            <span class="text-[10px] sm:text-xs text-accent-purple bg-accent-purple/15 border border-accent-purple/30 px-2.5 py-0.5 rounded-full font-medium">
              ${question.type === 'video' ? '🎬 ทาย MV (ดูคลิป)' : '🎵 ทายเพลง (ฟังเสียง)'}
            </span>
          </div>

          <!-- HTML5 Media Player Container (Zero opacity in audio mode to block any visuals) -->
          <div id="media-player-container" class="w-full h-full pointer-events-none transition-opacity duration-300 ${question.type === 'audio' ? 'opacity-0' : 'opacity-100'}"></div>

          <!-- Curtain Overlay (100% solid pitch black in audio mode to guarantee zero thumbnail bleeding) -->
          <div id="media-curtain" class="absolute inset-0 ${question.type === 'audio' ? 'bg-[#0a0a14] z-20' : 'bg-bg-primary/95 backdrop-blur-md z-20'} flex flex-col items-center justify-center gap-2">
            ${question.type === 'audio' ? `
              <div class="audio-visualizer mb-1" id="audio-viz">
                ${Array.from({ length: 12 }, () => `<div class="audio-bar" style="--bar-height: ${35 + Math.random() * 55}%; height: 30%;"></div>`).join('')}
              </div>
              <p class="font-heading font-bold text-sm sm:text-base text-text-primary" id="curtain-title">🎵 โหมดฟังเสียงเพลง</p>
              <p class="text-text-muted text-xs" id="curtain-sub">รอฟังเพลงให้จบก่อนเริ่มตอบ</p>
            ` : `
              <div class="text-3xl sm:text-4xl animate-float">🎬</div>
              <p class="font-heading font-bold text-sm sm:text-base text-text-primary" id="curtain-title">กำลังเตรียมคลิป...</p>
              <p class="text-text-muted text-xs" id="curtain-sub">รอสัญญาณนับถอยหลัง</p>
            `}
          </div>
        </div>
      </div>

      <!-- Countdown / Loading Overlay -->
      <div id="countdown-overlay" class="countdown-overlay">
        <div id="countdown-content" class="flex flex-col items-center justify-center gap-3">
          <div class="spinner !w-12 !h-12 !border-4"></div>
          <p class="font-heading text-sm sm:text-base font-bold text-text-primary tracking-wider uppercase animate-pulse">
            🎵 กำลังโหลดเพลง...
          </p>
        </div>
      </div>

      <!-- Question Timer Bar with Urgent State -->
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

      <!-- Choice Buttons -->
      <div class="w-full max-w-3xl mx-auto flex-1 flex flex-col justify-end animate-slide-up stagger-2">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 w-full" id="choices-grid">
          ${question.options.map((opt, i) => {
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
          <span class="text-text-muted text-sm" id="status-text">🎵 กำลังเตรียมเพลง...</span>
        </div>
      </div>
    `;

    // Setup network listeners for multiplayer synchronization
    if (isHost && peerManager.role === 'host') {
      peerManager.on({
        onReceive: (peerId, packet) => {
          if (packet.type === 'PLAYER_SUBMIT') {
            gameController.receiveAnswer(packet.peerId || peerId, packet.choiceIndex);
          }
        },
        onPlayerLeave: (peerId) => {
          const departing = gameController.players.find((p) => p.peerId === peerId);
          gameController.removePlayer(peerId);
          // Broadcast to remaining players
          peerManager.broadcast({
            type: 'PLAYER_LEAVE',
            peerId,
            remainingPlayers: gameController.players,
          });
          // Update host scoreboard
          updateScoreboardUI(gameController.players, departing?.name);
        },
      });
    } else if (!isHost) {
      peerManager.on({
        onReceive: (_peerId, packet) => {
          handleGamePacket(packet);
        },
        onPlayerLeave: (peerId) => {
          if (peerId === peerManager.hostPeerId) {
            alert('⚠️ Host ออกจากห้องแล้ว เกมยุติ');
            navigate('/');
          }
        },
        onError: (err) => {
          console.warn('Network error in game:', err);
        },
      });
    }

    // Synchronized Reveal: Trigger showReveal whenever REVEAL phase is emitted
    gameController.onPhaseChange((phase) => {
      if (phase === 'REVEAL') {
        const curQ = gameController.currentQuestion;
        if (curQ) {
          showReveal(curQ);
        }
      }
    });

    // Start the game flow with unique flowId
    const currentFlowId = ++activeFlowId;
    setTimeout(() => initGameFlow(question, currentFlowId), 50);

    return container;
  });
}

async function initGameFlow(question: QuestionSession, flowId: number): Promise<void> {
  const countdownOverlay = document.getElementById('countdown-overlay');

  let playerFailed = false;

  try {
    // 1. Resolve Direct Stream URL & Prebuffer HTML5 Media Player with 6-second timeout
    await Promise.race([
      mediaEngine.initAndPrebuffer(
        'media-player-container',
        question.youtubeId,
        question.type,
        question.startTime
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('โหลดคลิปเกินกำหนด ข้ามไปเล่นต่อทันที')), 6000)
      )
    ]);
    if (activeFlowId !== flowId) return;
  } catch (e) {
    // Media player failed or timed out (> 6s)
    console.warn('HTML5 media player failed or timed out (>6s), continuing without media:', e);
    playerFailed = true;

    // Show error in media container
    const mediaContainer = document.getElementById('media-container');
    if (mediaContainer) {
      mediaContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center gap-2 p-6 text-center">
          <span class="text-3xl">⚠️</span>
          <p class="text-accent-yellow text-sm font-semibold">ข้ามวิดีโอเนื่องจากโหลดเกินเวลาหรือไม่สามารถดึงสตรีมได้</p>
          <p class="text-text-muted text-xs">เลือกคำตอบจากตัวเลือกด้านล่างได้ตามปกติ</p>
        </div>
      `;
    }
  }

  if (activeFlowId !== flowId) return;

  // 2. Start Countdown Phase (3..2..1) ONLY after buffering is complete!
  if (countdownOverlay) {
    countdownOverlay.innerHTML = `<div class="countdown-number" id="countdown-number">3</div>`;
  }
  const countdownNumber = document.getElementById('countdown-number');

  const { cancel } = countdown(3, (n) => {
    if (activeFlowId !== flowId) return;
    if (countdownNumber) {
      countdownNumber.textContent = String(n);
      countdownNumber.style.animation = 'none';
      void countdownNumber.offsetHeight;
      countdownNumber.style.animation = 'countdownPulse 1s ease-out';
    }
  }, () => {
    if (activeFlowId !== flowId) return;
    // Countdown complete → Guessing Phase
    if (countdownOverlay) countdownOverlay.style.display = 'none';
    
    if (playerFailed || !mediaEngine.isReady) {
      // No media — skip to guessing directly, enable buttons
      startGuessingPhaseNoMedia(question);
    } else {
      startGuessingPhase(question);
    }
  });
  countdownCancel = cancel;
}

/** Guessing phase without media (when YouTube embed is blocked or timed out >5s) */
function startGuessingPhaseNoMedia(question: QuestionSession): void {
  const config = gameController.config;
  const snippetSec = config.snippetDuration || 3;
  const answerSec = config.guessDuration || 10;
  const statusText = document.getElementById('status-text');
  const buttons = document.querySelectorAll('.choice-btn') as NodeListOf<HTMLButtonElement>;

  // STAGE 1: Lock buttons during snippet period
  buttons.forEach((btn) => {
    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
  });

  if (statusText) {
    statusText.innerHTML = `⏳ แสดงคำถาม... <span class="text-accent-cyan font-bold">${snippetSec}s</span> (รอเปิดระบบตอบ)`;
  }

  // After snippet duration, transition to STAGE 2: Answering Phase
  setTimeout(() => {
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove('opacity-60', 'cursor-not-allowed');
    });

    if (statusText) {
      statusText.innerHTML = '⏰ <span class="text-accent-cyan font-bold">เลือกคำตอบเร็ว!</span> (ยิ่งตอบเร็วยิ่งได้แต้มเยอะ)';
    }

    const answerStartTime = Date.now();
    let hasAnswered = false;

    // Start question countdown timer
    if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
    currentTimerCancel = startQuestionTimer(answerSec, () => {
      // Timeout expired without answer
      buttons.forEach((btn) => { btn.disabled = true; });
      if (statusText) statusText.textContent = '⏰ หมดเวลาตอบ!';
      const myPeerId = peerManager.peerId || 'local';
      if (!hasAnswered) {
        hasAnswered = true;
        gameController.submitAnswer(myPeerId, -1, answerSec * 1000);
        if (peerManager.role === 'solo') {
          setTimeout(() => showRevealNoMedia(question), 600);
        }
      }
    });

    // Enable choice buttons
    buttons.forEach((btn) => {
      btn.onclick = () => {
        if (hasAnswered) return;
        hasAnswered = true;
        const timeUsedMs = Date.now() - answerStartTime;
        const index = parseInt(btn.getAttribute('data-index') || '0');
        handleChoiceClickNoMedia(index, question, timeUsedMs);
      };
    });
  }, snippetSec * 1000);

  if (peerManager.isHost) {
    gameController.triggerGuessing();
  }
}

function handleChoiceClickNoMedia(choiceIndex: number, question: QuestionSession, timeUsedMs: number = 0): void {
  if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
  const timerContainer = document.getElementById('timer-container');
  if (timerContainer) timerContainer.classList.remove('timer-urgent-pulse');

  const myPeerId = peerManager.peerId || 'local';

  const buttons = document.querySelectorAll('.choice-btn') as NodeListOf<HTMLButtonElement>;
  buttons.forEach((btn) => { btn.disabled = true; });

  const selectedBtn = document.getElementById(`choice-${choiceIndex}`);
  if (selectedBtn) selectedBtn.classList.add('selected');

  const statusText = document.getElementById('status-text');
  const secUsed = (timeUsedMs / 1000).toFixed(1);
  if (peerManager.role === 'solo') {
    if (statusText) statusText.textContent = `⏳ ตอบแล้ว (${secUsed}s) กำลังเฉลย...`;
    gameController.submitAnswer(myPeerId, choiceIndex, timeUsedMs);
    setTimeout(() => showRevealNoMedia(question), 800);
  } else {
    if (statusText) statusText.textContent = `⏳ ตอบแล้ว (${secUsed}s) กำลังรอผู้เล่นอื่น...`;
    gameController.submitAnswer(myPeerId, choiceIndex, timeUsedMs);
  }
}

function showRevealNoMedia(question: QuestionSession): void {
  if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
  const timerContainer = document.getElementById('timer-container');
  if (timerContainer) {
    timerContainer.classList.remove('timer-urgent-pulse');
    timerContainer.classList.add('opacity-40');
  }
  const timerBar = document.getElementById('timer-progress-bar');
  if (timerBar) {
    timerBar.style.width = '0%';
    timerBar.classList.remove('timer-urgent-bar');
  }

  const config = gameController.config;
  const answers = gameController.answers;
  const players = gameController.players;
  const statusText = document.getElementById('status-text');

  if (statusText) statusText.textContent = `🎵 เฉลย: ${question.title}`;

  // Update choice buttons
  const buttons = document.querySelectorAll('.choice-btn') as NodeListOf<HTMLButtonElement>;
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    btn.classList.remove('selected');
    if (i === question.correctIndex) {
      btn.classList.add('correct');
    } else {
      const pickedByAnyone = Object.values(answers).includes(i);
      if (pickedByAnyone) btn.classList.add('wrong');
    }

    const playersWhoChose = Object.entries(answers)
      .filter(([, choice]) => choice === i)
      .map(([peerId]) => {
        const p = players.find((pl) => pl.peerId === peerId);
        return p?.name || peerId.substring(0, 6);
      });

    if (playersWhoChose.length > 0) {
      const badgesContainer = document.getElementById(`badges-${i}`);
      if (badgesContainer) {
        badgesContainer.classList.remove('hidden');
        badgesContainer.innerHTML = playersWhoChose.map((name) => `
          <span class="player-badge">${name}</span>
        `).join('');
        btn.appendChild(badgesContainer);
      }
    }
  });

  // Update scoreboard with formatted scores
  players.forEach((p) => {
    const scoreEl = document.getElementById(`score-val-${p.peerId.replace(/[^a-zA-Z0-9]/g, '_')}`);
    if (scoreEl) {
      const formatted = Number.isInteger(p.score) ? String(p.score) : p.score.toFixed(1);
      scoreEl.textContent = formatted;
      scoreEl.parentElement?.classList.add('score-update');
      setTimeout(() => scoreEl.parentElement?.classList.remove('score-update'), 500);
    }
  });

  setTimeout(() => {
    if (peerManager.isHost || peerManager.role === 'solo') {
      gameController.nextQuestion();
      if (gameController.phase === 'GAME_OVER') {
        navigate('/results');
      } else {
        renderGameScreen();
      }
    }
  }, config.revealDuration * 1000);
}

function startGuessingPhase(question: QuestionSession): void {
  const config = gameController.config;
  const snippetSec = config.snippetDuration || 3;
  const answerSec = config.guessDuration || 10;
  const statusText = document.getElementById('status-text');
  const curtain = document.getElementById('media-curtain');
  const curtainTitle = document.getElementById('curtain-title');
  const curtainSub = document.getElementById('curtain-sub');
  const buttons = document.querySelectorAll('.choice-btn') as NodeListOf<HTMLButtonElement>;

  // STAGE 1: Lock buttons during snippet period
  buttons.forEach((btn) => {
    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
  });

  if (statusText) {
    statusText.innerHTML = question.type === 'video'
      ? `🎬 กำลังแสดงคลิปทาย... <span class="text-accent-cyan font-bold">${snippetSec}s</span> (รอคลิปจบเพื่อเริ่มตอบ)`
      : `🎧 กำลังเปิดเสียงเพลงทาย... <span class="text-accent-cyan font-bold">${snippetSec}s</span> (รอเพลงจบเพื่อเริ่มตอบ)`;
  }

  // MV: uncover video to show the clip. Audio: keep curtain covered in solid black
  if (question.type === 'video') {
    if (curtain) curtain.classList.add('hidden');
    mediaEngine.showVideo();
  } else {
    if (curtain) {
      curtain.classList.remove('hidden');
      if (curtainTitle) curtainTitle.textContent = '🎵 กำลังเล่นเสียงเพลง...';
      if (curtainSub) curtainSub.textContent = `ฟังเสียงเพลง ${snippetSec} วินาที (รอเพลงจบเพื่อเริ่มตอบ)`;
    }
  }

  // Play the snippet for snippetDuration seconds
  const { cancel } = mediaEngine.playSnippet(question.startTime, snippetSec, () => {
    // Snippet completed!
    // Cover video immediately when paused to prevent preview freeze spoiler
    if (curtain) {
      if (curtainTitle) curtainTitle.textContent = 'หมดเวลาฟังเพลงแล้ว!';
      if (curtainSub) curtainSub.textContent = 'เลือกคำตอบจากตัวเลือกด้านล่าง';
      curtain.classList.remove('hidden');
    }

    // STAGE 2: Answering Phase — Unlock buttons & Start Answer Countdown Timer!
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove('opacity-60', 'cursor-not-allowed');
    });

    if (statusText) {
      statusText.innerHTML = '⏰ <span class="text-accent-cyan font-bold">เลือกคำตอบเร็ว!</span> (ยิ่งตอบเร็วยิ่งได้แต้มเยอะ)';
    }

    const answerStartTime = Date.now();
    let hasAnswered = false;

    // Start question countdown timer
    if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
    currentTimerCancel = startQuestionTimer(answerSec, () => {
      // Time expired
      buttons.forEach((btn) => { btn.disabled = true; });
      if (statusText) statusText.textContent = '⏰ หมดเวลาตอบ!';
      const myPeerId = peerManager.peerId || 'local';
      if (!hasAnswered) {
        hasAnswered = true;
        gameController.submitAnswer(myPeerId, -1, answerSec * 1000);
        if (peerManager.role === 'solo') {
          setTimeout(() => showReveal(question), 600);
        }
      }
    });

    // Enable choice button clicks
    buttons.forEach((btn) => {
      btn.onclick = () => {
        if (hasAnswered) return;
        hasAnswered = true;
        const timeUsedMs = Date.now() - answerStartTime;
        const index = parseInt(btn.getAttribute('data-index') || '0');
        handleChoiceClick(index, question, timeUsedMs);
      };
    });
  });
  currentSegmentCancel = cancel;

  // Host triggers guessing state
  if (peerManager.isHost) {
    gameController.triggerGuessing();
  }
}

function handleChoiceClick(choiceIndex: number, question: QuestionSession, timeUsedMs: number = 0): void {
  if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
  const timerContainer = document.getElementById('timer-container');
  if (timerContainer) timerContainer.classList.remove('timer-urgent-pulse');

  const myPeerId = peerManager.peerId || 'local';
  
  // Lock all buttons
  const buttons = document.querySelectorAll('.choice-btn') as NodeListOf<HTMLButtonElement>;
  buttons.forEach((btn) => {
    btn.disabled = true;
  });

  // Highlight selected
  const selectedBtn = document.getElementById(`choice-${choiceIndex}`);
  if (selectedBtn) selectedBtn.classList.add('selected');

  // Update status
  const statusText = document.getElementById('status-text');
  const secUsed = (timeUsedMs / 1000).toFixed(1);
  if (peerManager.role === 'solo') {
    if (statusText) statusText.textContent = `⏳ ตอบแล้ว (${secUsed}s) กำลังเฉลย...`;
    gameController.submitAnswer(myPeerId, choiceIndex, timeUsedMs);
    setTimeout(() => showReveal(question), 800);
  } else {
    if (statusText) statusText.textContent = `⏳ ตอบแล้ว (${secUsed}s) กำลังรอผู้เล่นอื่น...`;
    gameController.submitAnswer(myPeerId, choiceIndex, timeUsedMs);
  }
}

function showReveal(question: QuestionSession): void {
  if (hasRevealedCurrentQuestion) return;
  hasRevealedCurrentQuestion = true;

  if (currentTimerCancel) { currentTimerCancel(); currentTimerCancel = null; }
  const timerContainer = document.getElementById('timer-container');
  if (timerContainer) {
    timerContainer.classList.remove('timer-urgent-pulse');
    timerContainer.classList.add('opacity-40');
  }
  const timerBar = document.getElementById('timer-progress-bar');
  if (timerBar) {
    timerBar.style.width = '0%';
    timerBar.classList.remove('timer-urgent-bar');
  }

  const config = gameController.config;
  const answers = gameController.answers;
  const players = gameController.players;
  const statusText = document.getElementById('status-text');
  const curtain = document.getElementById('media-curtain');

  if (statusText) statusText.textContent = `🎵 เฉลย: ${question.title}`;

  // Uncover video during reveal
  mediaEngine.showVideo();
  const playerContainer = document.getElementById('media-player-container');
  if (playerContainer) {
    playerContainer.classList.remove('opacity-0');
    playerContainer.classList.add('opacity-100');
  }
  if (curtain) {
    curtain.classList.add('hidden');
  }

  // Play reveal audio/video continuously for revealDuration
  const revealStart = (typeof question.revealStartTime === 'number' && question.revealStartTime >= 0)
    ? question.revealStartTime
    : question.startTime;
  const { cancel } = mediaEngine.playReveal(revealStart, config.revealDuration);
  currentSegmentCancel = cancel;

  // Update choice buttons — correct/wrong + player badges
  const buttons = document.querySelectorAll('.choice-btn') as NodeListOf<HTMLButtonElement>;
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    btn.classList.remove('selected');

    if (i === question.correctIndex) {
      btn.classList.add('correct');
    } else {
      // Only mark wrong if someone picked it
      const pickedByAnyone = Object.values(answers).includes(i);
      if (pickedByAnyone) {
        btn.classList.add('wrong');
      }
    }

    // Show player badges under each choice
    const playersWhoChose = Object.entries(answers)
      .filter(([, choice]) => choice === i)
      .map(([peerId]) => {
        const p = players.find((pl) => pl.peerId === peerId);
        return p?.name || peerId.substring(0, 6);
      });

    if (playersWhoChose.length > 0) {
      const badgesContainer = document.getElementById(`badges-${i}`);
      if (badgesContainer) {
        badgesContainer.classList.remove('hidden');
        badgesContainer.innerHTML = playersWhoChose.map((name) => `
          <span class="player-badge">${name}</span>
        `).join('');
        // Move badges after the button text
        btn.appendChild(badgesContainer);
      }
    }
  });

  // Update scoreboard
  players.forEach((p) => {
    const scoreEl = document.getElementById(`score-val-${p.peerId.replace(/[^a-zA-Z0-9]/g, '_')}`);
    if (scoreEl) {
      scoreEl.textContent = String(p.score);
      scoreEl.parentElement?.classList.add('score-update');
      setTimeout(() => scoreEl.parentElement?.classList.remove('score-update'), 500);
    }
  });

  // After reveal duration, move to next question
  setTimeout(() => {
    if (currentSegmentCancel) { currentSegmentCancel(); currentSegmentCancel = null; }
    mediaEngine.stop();
    
    if (peerManager.isHost || peerManager.role === 'solo') {
      gameController.nextQuestion();
      
      if (gameController.phase === 'GAME_OVER') {
        mediaEngine.destroy();
        navigate('/results');
      } else {
        // Re-render for next question
        renderGameScreen();
      }
    }
    // Client will receive STATE_COUNTDOWN or GAME_OVER packet from Host and navigate / re-render
  }, config.revealDuration * 1000);
}

function handleGamePacket(packet: NetworkPacket): void {
  switch (packet.type) {
    case 'STATE_COUNTDOWN':
      // Client: only re-render if transitioning to a NEW question!
      if (gameController.currentIndex !== packet.questionIndex) {
        gameController.setQuestionIndex(packet.questionIndex);
        renderGameScreen();
      }
      break;

    case 'TRIGGER_GUESS':
      break;

    case 'TRIGGER_REVEAL': {
      gameController.receiveReveal(
        packet.answers,
        packet.scores,
        packet.correctCounts,
        packet.wrongCounts
      );
      break;
    }

    case 'PLAYER_LEAVE': {
      const departing = gameController.players.find((p) => p.peerId === packet.peerId);
      gameController.removePlayer(packet.peerId);
      updateScoreboardUI(packet.remainingPlayers, departing?.name);
      break;
    }

    case 'GAME_OVER':
      mediaEngine.destroy();
      gameController.receiveGameOver(
        packet.finalScores,
        packet.correctCounts,
        packet.wrongCounts
      );
      navigate('/results');
      break;

    case 'REMATCH':
      gameController.receiveGameInit(packet.questions, packet.config, packet.players);
      renderGameScreen();
      break;
  }
}
