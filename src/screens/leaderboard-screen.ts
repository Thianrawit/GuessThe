/* ──────────────────────────────────────────────
   Leaderboard Screen — Game Over Results
   ────────────────────────────────────────────── */

import { setScreen } from '../utils/dom';
import { navigate } from '../utils/router';
import { gameController } from '../game/game-controller';
import { peerManager } from '../network/peer-manager';
import { destroyPlayer } from '../engine/youtube-player';
import type { NetworkPacket } from '../types/index';

export function renderLeaderboardScreen(): void {
  destroyPlayer();

  setScreen(() => {
    const container = document.createElement('div');
    container.className = 'min-h-[100dvh] flex flex-col items-center justify-center px-4 py-8';

    const players = gameController.players
      .slice()
      .sort((a, b) => b.score - a.score);

    const isHost = peerManager.isHost;
    const totalQuestions = gameController.totalQuestions;

    const trophyIcons = ['🥇', '🥈', '🥉', '4️⃣'];
    const trophyClasses = ['trophy-gold', 'trophy-silver', 'trophy-bronze', ''];
    const bgGradients = [
      'from-yellow-500/10 to-orange-500/10 border-yellow-500/20',
      'from-gray-400/10 to-gray-500/10 border-gray-400/20',
      'from-orange-600/10 to-amber-700/10 border-orange-600/20',
      'from-bg-card to-bg-card border-border-subtle',
    ];

    container.innerHTML = `
      <div class="w-[92%] sm:w-[85%] md:w-[680px] lg:w-[800px] mx-auto flex flex-col items-center gap-5">
        
        <!-- Title -->
        <div class="animate-fade-in text-center">
          <div class="text-5xl mb-3 animate-float">🏆</div>
          <h1 class="font-heading text-3xl sm:text-4xl font-bold gradient-text-warm">ผลการแข่งขัน</h1>
          <p class="text-text-secondary text-sm mt-1">${totalQuestions} ข้อ · จบเกมแล้ว!</p>
        </div>

        <!-- Leaderboard -->
        <div class="flex flex-col gap-3 w-full animate-slide-up stagger-1">
          ${players.map((player, index) => {
            const isSolo = peerManager.role === 'solo' || players.length === 1;
            const isFirst = index === 0;

            // Crown symbols in front of player name (Multiplayer only)
            let crownBadge = '';
            if (!isSolo) {
              if (index === 0) {
                crownBadge = '<span class="inline-flex items-center justify-center text-xl drop-shadow-[0_0_10px_rgba(250,204,21,0.9)] animate-bounce mr-1.5" title="อันดับ 1 (มงกุฎทอง)">👑</span>';
              } else if (index === 1) {
                crownBadge = '<span class="inline-flex items-center justify-center text-xl drop-shadow-[0_0_10px_rgba(203,213,225,0.9)] mr-1.5" style="filter: grayscale(1) brightness(1.45);" title="อันดับ 2 (มงกุฎเงิน)">👑</span>';
              } else if (index === 2) {
                crownBadge = '<span class="inline-flex items-center justify-center text-xl drop-shadow-[0_0_10px_rgba(180,83,9,0.8)] mr-1.5" style="filter: sepia(1) hue-rotate(-25deg) saturate(3.5) brightness(0.85);" title="อันดับ 3 (มงกุฎทองแดง)">👑</span>';
              } else {
                crownBadge = `<span class="text-text-muted text-xs font-bold mr-1.5">#${index + 1}</span>`;
              }
            }

            const trophyIcon = isSolo ? '🎵' : (trophyIcons[index] || `${index + 1}`);
            const trophyClass = isSolo ? '' : (trophyClasses[index] || '');
            const bgGrad = isSolo ? 'from-accent-purple/10 to-accent-blue/10 border-accent-purple/20' : (bgGradients[index] || bgGradients[3]);
            const accuracy = totalQuestions > 0 ? Math.round((player.correctCount / totalQuestions) * 100) : 0;
            const formattedScore = Number.isInteger(player.score) ? String(player.score) : player.score.toFixed(1);

            return `
              <div class="glass-card p-4 sm:p-5 bg-gradient-to-r ${bgGrad} ${isFirst && !isSolo ? 'ring-2 ring-yellow-500/30' : ''}">
                <div class="flex items-center gap-4">
                  <!-- Rank or Music Icon -->
                  <div class="text-3xl sm:text-4xl ${trophyClass} flex-shrink-0">
                    ${trophyIcon}
                  </div>
                  
                  <!-- Player Info -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 mb-1">
                      ${crownBadge}
                      <span class="text-text-primary font-bold text-lg sm:text-xl truncate">${player.name}</span>
                      ${player.isHost && !isSolo ? '<span class="text-xs text-accent-yellow bg-accent-yellow/15 border border-accent-yellow/30 px-2 py-0.5 rounded-full font-semibold">Host</span>' : ''}
                    </div>
                    <div class="flex items-center gap-3 text-xs text-text-secondary">
                      <span class="text-accent-green">✓ ${player.correctCount} ถูก</span>
                      <span class="text-accent-red">✕ ${player.wrongCount} ผิด</span>
                      <span class="text-text-muted">${accuracy}% แม่นยำ</span>
                    </div>
                    <!-- Accuracy Bar -->
                    <div class="mt-2 h-1.5 bg-bg-card rounded-full overflow-hidden">
                      <div class="h-full rounded-full transition-all duration-1000 ${index === 0 && !isSolo ? 'bg-gradient-to-r from-yellow-500 to-orange-500' : 'bg-gradient-to-r from-accent-purple to-accent-blue'}" style="width: ${accuracy}%"></div>
                    </div>
                  </div>
                  
                  <!-- Score -->
                  <div class="text-right flex-shrink-0">
                    <div class="text-2xl sm:text-3xl font-bold ${isFirst && !isSolo ? 'gradient-text-warm' : 'gradient-text'}">${formattedScore}</div>
                    <div class="text-text-muted text-xs">แต้ม</div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Action Buttons -->
        <div class="flex flex-col gap-3 w-full max-w-sm sm:max-w-lg sm:flex-row sm:justify-center animate-slide-up stagger-3">
          ${isHost ? `
            <button id="btn-rematch" class="btn-primary flex-1">
              <span class="text-xl">🔄</span>
              <span>เล่นอีกรอบ (Rematch)</span>
            </button>
          ` : `
            <div class="text-center p-3 glass-card-light rounded-xl w-full">
              <span class="text-text-secondary text-sm">⏳ รอ Host เริ่มรอบใหม่...</span>
            </div>
          `}
          <button id="btn-go-home" class="btn-secondary flex-1">
            <span class="text-xl">🏠</span>
            <span>กลับหน้าหลัก</span>
          </button>
        </div>
      </div>
    `;

    // Network listener for rematch
    if (!isHost) {
      peerManager.on({
        onReceive: (_peerId, packet) => {
          if (packet.type === 'REMATCH') {
            gameController.receiveGameInit(packet.questions, packet.config, packet.players);
            navigate('/game');
          }
        },
      });
    }

    // Event listeners
    setTimeout(() => {
      document.getElementById('btn-rematch')?.addEventListener('click', () => {
        try {
          gameController.rematch();
          navigate('/game');
        } catch (e) {
          alert((e as Error).message);
        }
      });

      document.getElementById('btn-go-home')?.addEventListener('click', () => {
        peerManager.destroy();
        gameController.destroy();
        navigate('/');
      });
    }, 0);

    return container;
  });
}
