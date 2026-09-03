/* ──────────────────────────────────────────────
   Lobby Screen — Room Setup & Waiting
   ────────────────────────────────────────────── */

import { setScreen, generateRoomCode } from '../utils/dom';
import { navigate, getCurrentRoute } from '../utils/router';
import { peerManager } from '../network/peer-manager';
import { gameController } from '../game/game-controller';
import type { PlayerInfo, NetworkPacket } from '../types/index';

export function renderLobbyScreen(): void {
  const { params } = getCurrentRoute();
  const mode = params.mode || 'solo'; // 'solo' | 'host' | 'client'
  const playerName = params.name || 'Player';
  const roomCodeParam = params.room || '';

  setScreen(() => {
    const container = document.createElement('div');
    container.className = 'min-h-[100dvh] flex flex-col items-center justify-center px-4 py-8';

    let roomCode = '';
    let players: PlayerInfo[] = [];
    let isConnecting = mode === 'host' || mode === 'client';
    let errorMsg = '';

    function renderLobbyContent(): void {
      const isSoloOrHost = mode === 'solo' || mode === 'host';
      
      container.innerHTML = `
        <div class="w-[92%] sm:w-[85%] md:w-[680px] lg:w-[800px] mx-auto flex flex-col items-center gap-5">
          
          <!-- Back Button -->
          <div class="self-start animate-fade-in">
            <button id="btn-back-lobby" class="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors bg-transparent border-none cursor-pointer text-sm">
              <span>←</span> กลับหน้าหลัก
            </button>
          </div>

          <!-- Room Card -->
          <div class="glass-card p-5 sm:p-8 w-full animate-slide-up">
            
            <!-- Mode Title -->
            <div class="text-center mb-5">
              <h1 class="font-heading text-2xl sm:text-3xl font-bold gradient-text mb-1">
                ${mode === 'solo' ? '🎵 โหมดเดี่ยว' : mode === 'host' ? '🏠 สร้างห้อง' : '🚪 เข้าห้อง'}
              </h1>
              ${isConnecting ? `
                <div class="flex items-center justify-center gap-2 mt-3">
                  <div class="spinner"></div>
                  <span class="text-text-secondary text-sm">${mode === 'host' ? 'กำลังสร้างห้อง...' : 'กำลังเชื่อมต่อ...'}</span>
                </div>
              ` : ''}
              ${errorMsg ? `
                <div class="mt-3 text-accent-red text-sm glass-card-light px-4 py-2 rounded-xl">${errorMsg}</div>
              ` : ''}
            </div>

            ${roomCode && mode !== 'solo' ? `
            <!-- Room Code Display -->
            <div class="text-center mb-5 p-4 glass-card-light rounded-2xl">
              <p class="text-text-secondary text-xs uppercase tracking-wider mb-2 font-semibold">รหัสห้อง (5 หลัก)</p>
              <div class="room-code select-all cursor-pointer font-mono text-3xl sm:text-4xl font-extrabold tracking-[0.25em]" id="room-code-display" title="คลิกเพื่อคัดลอก">${roomCode}</div>
              <p class="text-text-muted text-xs mt-2">แตะเพื่อคัดลอก — แชร์ให้เพื่อนเข้าร่วม</p>
            </div>
            ` : !roomCode && mode === 'client' ? `
            <!-- Client Enter Room Code directly in Lobby if not set -->
            <div class="text-center mb-5 p-4 glass-card-light rounded-2xl flex flex-col items-center gap-3">
              <p class="text-text-secondary text-xs uppercase tracking-wider font-semibold">🔢 ใส่รหัสห้อง 5 หลักเพื่อเข้าร่วม</p>
              <div class="flex items-center gap-2 w-full max-w-xs">
                <input
                  id="lobby-input-room-code"
                  type="tel"
                  class="input-field text-center text-2xl font-bold tracking-[0.25em] font-heading flex-1 !h-[50px] !py-0 !rounded-xl"
                  placeholder="58291"
                  maxlength="5"
                  autocomplete="off"
                  inputmode="numeric"
                  pattern="[0-9]*"
                />
                <button id="lobby-btn-join-room" type="button" class="btn-primary !w-auto !min-w-[100px] !h-[50px] !py-0 !px-4 !rounded-xl text-sm font-bold shadow-none">
                  เข้าห้อง
                </button>
              </div>
            </div>
            ` : ''}

            <!-- Players List -->
            <div class="mb-5">
              <h2 class="text-text-secondary text-xs uppercase tracking-wider mb-2 font-semibold">
                ผู้เล่น (${players.length}/${mode === 'solo' ? '1' : '10'})
              </h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${players.map((p, i) => {
                  const avatarColors = [
                    'bg-accent-purple/20 text-accent-purple',
                    'bg-accent-blue/20 text-accent-blue',
                    'bg-accent-pink/20 text-accent-pink',
                    'bg-accent-cyan/20 text-accent-cyan',
                    'bg-accent-green/20 text-accent-green',
                    'bg-accent-yellow/20 text-accent-yellow',
                    'bg-orange-500/20 text-orange-400',
                    'bg-rose-500/20 text-rose-400',
                    'bg-indigo-500/20 text-indigo-400',
                    'bg-teal-500/20 text-teal-400',
                  ];
                  const col = avatarColors[i % avatarColors.length];
                  return `
                  <div class="flex items-center gap-3 p-3 glass-card-light rounded-xl">
                    <div class="w-9 h-9 rounded-full flex items-center justify-center text-lg font-bold ${col} flex-shrink-0">
                      ${p.name.charAt(0).toUpperCase()}
                    </div>
                    <div class="flex-1 min-w-0">
                      <span class="text-text-primary text-sm font-semibold truncate block">${p.name}</span>
                      ${p.isHost ? '<span class="text-xs text-accent-yellow">👑 Host</span>' : '<span class="text-xs text-text-muted">ผู้เล่น #' + (i + 1) + '</span>'}
                    </div>
                    <span class="text-accent-green text-xs flex-shrink-0">● Online</span>
                  </div>
                `}).join('')}
                ${!isConnecting && players.length < 10 && mode === 'host' ? `
                  <div class="flex items-center justify-center p-3 glass-card-light rounded-xl border-2 border-dashed border-border-subtle">
                    <span class="text-text-muted text-xs sm:text-sm">⏳ รอผู้เล่นเข้าร่วม (${players.length}/10)...</span>
                  </div>
                ` : ''}
              </div>
            </div>

            ${isSoloOrHost && !isConnecting ? `
            <!-- Host / Solo Settings -->
            <div class="mb-5 p-4 glass-card-light rounded-xl">
              <h2 class="text-text-secondary text-xs uppercase tracking-wider mb-3 font-semibold">⚙️ ตั้งค่าเกม</h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label class="block text-text-muted text-xs mb-1">จำนวนข้อ</label>
                  <select id="select-question-count" class="select-field text-sm">
                    <option value="all" selected>ทั้งหมด (ตามคลังเพลง)</option>
                    <option value="5">5 ข้อ</option>
                    <option value="10">10 ข้อ</option>
                    <option value="15">15 ข้อ</option>
                    <option value="20">20 ข้อ</option>
                  </select>
                </div>
                <div>
                  <label class="block text-text-muted text-xs mb-1">เวลาแสดงเพลงทาย</label>
                  <select id="select-snippet-duration" class="select-field text-sm">
                    <option value="1">1 วินาที</option>
                    <option value="2">2 วินาที</option>
                    <option value="3" selected>3 วินาที (มาตรฐาน)</option>
                    <option value="5">5 วินาที</option>
                    <option value="8">8 วินาที</option>
                    <option value="10">10 วินาที</option>
                  </select>
                </div>
                <div>
                  <label class="block text-text-muted text-xs mb-1">เวลาจับเวลาตอบ</label>
                  <select id="select-guess-duration" class="select-field text-sm">
                    <option value="5">5 วินาที (เร็วมาก)</option>
                    <option value="10" selected>10 วินาที (มาตรฐาน)</option>
                    <option value="15">15 วินาที</option>
                    <option value="20">20 วินาที</option>
                    <option value="30">30 วินาที (ชิลๆ)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-text-muted text-xs mb-1">เวลาแสดงตอนเฉลย</label>
                  <select id="select-reveal-duration" class="select-field text-sm">
                    <option value="3">3 วินาที</option>
                    <option value="5" selected>5 วินาที (มาตรฐาน)</option>
                    <option value="7">7 วินาที</option>
                    <option value="10">10 วินาที</option>
                    <option value="15">15 วินาที (ดูคลิปยาว)</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Start Game Button -->
            <button id="btn-start-game" class="btn-primary w-full text-lg">
              <span class="text-xl">🎮</span>
              <span>เริ่มเกม!</span>
            </button>
            ` : !isSoloOrHost && !isConnecting ? `
            <!-- Client waiting -->
            <div class="text-center p-4">
              <div class="flex items-center justify-center gap-2">
                <div class="spinner"></div>
                <span class="text-text-secondary text-sm">รอ Host เริ่มเกม...</span>
              </div>
            </div>
            ` : ''}
          </div>
        </div>
      `;

      // Event listeners
      setTimeout(() => {
        document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
          peerManager.destroy();
          gameController.destroy();
          navigate('/main');
        });

        // Copy room code
        document.getElementById('room-code-display')?.addEventListener('click', () => {
          navigator.clipboard.writeText(roomCode).then(() => {
            const el = document.getElementById('room-code-display');
            if (el) {
              el.textContent = 'คัดลอกแล้ว!';
              setTimeout(() => { el.textContent = roomCode; }, 1500);
            }
          });
        });

        // Start game
        document.getElementById('btn-start-game')?.addEventListener('click', () => {
          // Read config
          const questionCount = (document.getElementById('select-question-count') as HTMLSelectElement)?.value;
          const snippetDuration = parseInt((document.getElementById('select-snippet-duration') as HTMLSelectElement)?.value || '3');
          const guessDuration = parseInt((document.getElementById('select-guess-duration') as HTMLSelectElement)?.value || '10');
          const revealDuration = parseInt((document.getElementById('select-reveal-duration') as HTMLSelectElement)?.value || '5');

          gameController.setConfig({
            questionCount: questionCount === 'all' ? 'all' : parseInt(questionCount),
            snippetDuration,
            guessDuration,
            revealDuration,
          });

          try {
            gameController.startGame();
            navigate('/game');
          } catch (e) {
            errorMsg = (e as Error).message;
            renderLobbyContent();
          }
        });

        // Direct lobby room join for clients
        const lobbyRoomInput = document.getElementById('lobby-input-room-code') as HTMLInputElement | null;
        lobbyRoomInput?.addEventListener('input', () => {
          lobbyRoomInput.value = lobbyRoomInput.value.replace(/[^0-9]/g, '').slice(0, 5);
        });
        lobbyRoomInput?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            document.getElementById('lobby-btn-join-room')?.click();
          }
        });
        document.getElementById('lobby-btn-join-room')?.addEventListener('click', async () => {
          const code = lobbyRoomInput?.value.trim().replace(/[^0-9]/g, '') || '';
          if (code.length !== 5) {
            errorMsg = '⚠️ กรุณาใส่รหัสห้องตัวเลข 5 หลักให้ครบ';
            renderLobbyContent();
            return;
          }
          isConnecting = true;
          errorMsg = '';
          renderLobbyContent();
          try {
            await peerManager.joinRoom(code, playerName);
            roomCode = code;
            isConnecting = false;
            renderLobbyContent();
          } catch (e) {
            errorMsg = (e as Error).message;
            isConnecting = false;
            renderLobbyContent();
          }
        });
      }, 0);
    }

    // Initialize based on mode
    async function init(): Promise<void> {
      if (mode === 'solo') {
        isConnecting = false;
        gameController.destroy();
        gameController.addPlayer('local', playerName, true);
        players = gameController.players;
        renderLobbyContent();
      } else if (mode === 'host') {
        roomCode = generateRoomCode();
        gameController.addPlayer(peerManager.peerId || 'host', playerName, true);

        peerManager.on({
          onOpen: (peerId) => {
            gameController.removePlayer('host');
            gameController.addPlayer(peerId, playerName, true);
            isConnecting = false;
            players = gameController.players;
            renderLobbyContent();
          },
          onPlayerJoin: (peerId, name) => {
            if (gameController.players.length >= 10) return;
            gameController.addPlayer(peerId, name, false);
            players = gameController.players;
            // Send player list to all
            peerManager.broadcast({
              type: 'PLAYER_LIST',
              players: gameController.players,
            });
            renderLobbyContent();
          },
          onPlayerLeave: (peerId) => {
            gameController.removePlayer(peerId);
            players = gameController.players;
            peerManager.broadcast({
              type: 'PLAYER_LIST',
              players: gameController.players,
            });
            renderLobbyContent();
          },
          onReceive: (_peerId, packet) => {
            handlePacket(packet);
          },
          onError: (err) => {
            errorMsg = err;
            isConnecting = false;
            renderLobbyContent();
          },
        });

        try {
          await peerManager.createRoom(roomCode);
        } catch (e) {
          errorMsg = (e as Error).message;
          isConnecting = false;
          renderLobbyContent();
        }
      } else if (mode === 'client') {
        peerManager.on({
          onReceive: (_peerId, packet) => {
            handlePacket(packet);
          },
          onError: (err) => {
            errorMsg = err;
            isConnecting = false;
            renderLobbyContent();
          },
        });

        if (!roomCodeParam) {
          isConnecting = false;
          renderLobbyContent();
          return;
        }

        try {
          await peerManager.joinRoom(roomCodeParam, playerName);
          roomCode = roomCodeParam;
          isConnecting = false;
          renderLobbyContent();
        } catch (e) {
          errorMsg = (e as Error).message;
          isConnecting = false;
          renderLobbyContent();
        }
      }
    }

    function handlePacket(packet: NetworkPacket): void {
      switch (packet.type) {
        case 'PLAYER_LIST':
          players = packet.players;
          gameController.destroy();
          packet.players.forEach((p) => {
            gameController.addPlayer(p.peerId, p.name, p.isHost);
          });
          renderLobbyContent();
          break;
        case 'ROOM_INIT':
          gameController.receiveGameInit(packet.questions, packet.config, packet.players);
          navigate('/game');
          break;
      }
    }

    renderLobbyContent();
    init();

    return container;
  });
}
