/* ──────────────────────────────────────────────
   Home Screen — "GuessThe?" Landing Page
   ────────────────────────────────────────────── */

import { setScreen } from '../utils/dom';
import { navigate } from '../utils/router';
import { loadPool, loadSampleTracks } from '../engine/track-pool';

const PLAYER_NAME_KEY = 'guessthe_player_name';

function getSavedName(): string {
  return localStorage.getItem(PLAYER_NAME_KEY) || '';
}

function saveName(name: string): void {
  localStorage.setItem(PLAYER_NAME_KEY, name);
}

export function renderHomeScreen(): void {
  setScreen(() => {
    const container = document.createElement('div');
    container.className = 'min-h-[100dvh] flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden';

    // Background glow effects
    container.innerHTML = `
      <!-- Ambient Background Glows -->
      <div class="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-accent-purple/10 blur-[120px] pointer-events-none"></div>
      <div class="absolute bottom-[-15%] right-[-10%] w-[400px] h-[400px] rounded-full bg-accent-blue/8 blur-[100px] pointer-events-none"></div>
      <div class="absolute top-[30%] right-[5%] w-[250px] h-[250px] rounded-full bg-accent-pink/5 blur-[80px] pointer-events-none"></div>

      <!-- Main Content -->
      <div class="relative z-10 flex flex-col items-center gap-6 w-[92%] sm:w-[85%] md:w-[680px] lg:w-[800px] mx-auto">
        
        <!-- Logo Section -->
        <div class="animate-fade-in flex flex-col items-center gap-3 mb-2">
          <!-- Music Icon -->
          <div class="text-5xl sm:text-6xl animate-float">🎵</div>
          
          <!-- Game Title: GuessThe? -->
          <h1 class="logo-text text-5xl sm:text-6xl md:text-7xl lg:text-8xl text-center">
            <span class="gradient-text">Guess</span><span class="gradient-text">The</span><span class="logo-question-mark">?</span>
          </h1>
          
          <!-- Subtitle -->
          <p class="text-text-secondary text-sm sm:text-base text-center max-w-md">
            🎶 เกมทายเพลง & MV สุดมันส์ — เล่นคนเดียวหรือแข่งกับเพื่อนได้ถึง 10 คน!
          </p>
        </div>

        <!-- Player Name Input -->
        <div class="animate-slide-up stagger-1 w-full max-w-sm">
          <label class="block text-text-secondary text-xs font-semibold mb-1.5 uppercase tracking-wider">ชื่อผู้เล่น</label>
          <input
            id="input-player-name"
            type="text"
            class="input-field text-center text-lg font-semibold"
            placeholder="ใส่ชื่อของคุณ..."
            maxlength="20"
            value="${getSavedName()}"
            autocomplete="off"
          />
        </div>

        <!-- Action Buttons -->
        <div class="animate-slide-up stagger-2 flex flex-col gap-3 w-full max-w-sm sm:max-w-lg sm:flex-row sm:justify-center">
          <button id="btn-solo" class="btn-primary flex-1">
            <span class="text-xl">🎵</span>
            <span>เล่นคนเดียว</span>
          </button>
          <button id="btn-create-room" class="btn-primary flex-1" style="background: linear-gradient(135deg, #3b82f6, #06b6d4);">
            <span class="text-xl">🏠</span>
            <span>สร้างห้อง</span>
          </button>
        </div>

        <!-- Join Room Card -->
        <div class="glass-card-light p-3.5 sm:p-4 w-full max-w-sm sm:max-w-lg animate-slide-up stagger-3 flex flex-col gap-2 rounded-2xl">
          <label class="block text-text-secondary text-xs font-semibold uppercase tracking-wider text-center">
            🔢 เข้าร่วมห้องด้วยรหัส 5 หลัก
          </label>
          <div class="flex items-center gap-2 w-full">
            <input
              id="input-room-code"
              type="tel"
              class="input-field text-center text-2xl font-bold tracking-[0.25em] font-heading flex-1 !h-[52px] !py-0 !rounded-xl"
              placeholder="58291"
              maxlength="5"
              autocomplete="off"
              inputmode="numeric"
              pattern="[0-9]*"
            />
            <button id="btn-join-room" type="button" class="btn-primary !w-auto !min-w-[110px] sm:!min-w-[130px] !h-[52px] !py-0 !px-4 sm:!px-6 !rounded-xl flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-bold shadow-none">
              <span class="text-base">🚪</span>
              <span>เข้าห้อง</span>
            </button>
          </div>
          <p class="text-text-muted text-[11px] text-center">พิมพ์รหัสตัวเลข 5 หลักที่ได้จาก Host</p>
        </div>

        <!-- Track Editor Link -->
        <div class="animate-slide-up stagger-4 flex flex-col gap-2 w-full max-w-sm sm:max-w-lg items-center">
          <button id="btn-track-editor" class="btn-secondary max-w-xs">
            <span class="text-xl">📋</span>
            <span>จัดการคลังเพลง</span>
          </button>
          <p id="track-count" class="text-text-muted text-xs"></p>
        </div>

        <!-- Error Message -->
        <div id="home-error" class="hidden text-accent-red text-sm text-center glass-card-light px-4 py-2 w-full max-w-sm"></div>
      </div>
    `;

    // Show track count
    const pool = loadPool();
    const countEl = container.querySelector('#track-count') as HTMLElement;
    if (pool.length === 0) {
      countEl.textContent = '⚠️ ยังไม่มีเพลงในคลัง — กดเพิ่มเพลงหรือโหลดตัวอย่าง';
    } else {
      countEl.textContent = `🎵 มี ${pool.length} เพลงในคลัง`;
    }

    // Event listeners
    setTimeout(() => {
      const nameInput = document.getElementById('input-player-name') as HTMLInputElement;
      const roomInput = document.getElementById('input-room-code') as HTMLInputElement;
      const errorEl = document.getElementById('home-error') as HTMLElement;

      function showError(msg: string): void {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
        setTimeout(() => errorEl.classList.add('hidden'), 4000);
      }

      function getPlayerName(): string {
        const name = nameInput?.value.trim() || '';
        if (name) saveName(name);
        return name;
      }

      function validateName(): boolean {
        const name = getPlayerName();
        if (!name) {
          showError('⚠️ กรุณาใส่ชื่อผู้เล่นก่อน');
          nameInput?.focus();
          return false;
        }
        return true;
      }

      // Solo
      document.getElementById('btn-solo')?.addEventListener('click', () => {
        if (!validateName()) return;
        const pool = loadPool();
        if (pool.length < 4) {
          showError('⚠️ ต้องมีเพลงอย่างน้อย 4 เพลง — ไปเพิ่มเพลงก่อน หรือกด "โหลดเพลงตัวอย่าง" ในคลังเพลง');
          return;
        }
        navigate('/lobby', { mode: 'solo', name: getPlayerName() });
      });

      // Create Room
      document.getElementById('btn-create-room')?.addEventListener('click', () => {
        if (!validateName()) return;
        const pool = loadPool();
        if (pool.length < 4) {
          showError('⚠️ ต้องมีเพลงอย่างน้อย 4 เพลง — ไปเพิ่มเพลงก่อน');
          return;
        }
        navigate('/lobby', { mode: 'host', name: getPlayerName() });
      });

      // Join Room
      document.getElementById('btn-join-room')?.addEventListener('click', () => {
        if (!validateName()) return;
        const code = roomInput?.value.trim().replace(/[^0-9]/g, '') || '';
        if (!code || code.length !== 5) {
          showError('⚠️ กรุณาใส่รหัสห้องตัวเลข 5 หลักให้ครบ');
          roomInput?.focus();
          return;
        }
        navigate('/lobby', { mode: 'client', name: getPlayerName(), room: code });
      });

      // Track Editor
      document.getElementById('btn-track-editor')?.addEventListener('click', () => {
        navigate('/editor');
      });

      // Room code input — strictly allow ONLY digits, max 5 digits
      roomInput?.addEventListener('input', () => {
        roomInput.value = roomInput.value.replace(/[^0-9]/g, '').slice(0, 5);
      });

      roomInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          document.getElementById('btn-join-room')?.click();
        }
      });
    }, 0);

    return container;
  });
}
