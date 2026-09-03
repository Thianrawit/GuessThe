/* ──────────────────────────────────────────────
   GuessThe? — Main Entry Point
   ────────────────────────────────────────────── */

import './style.css';
import { registerRoute, onNotFound, initRouter } from './utils/router';
import { renderHomeScreen } from './screens/home-screen';
import { renderTrackEditorScreen } from './screens/track-editor-screen';
import { renderLobbyScreen } from './screens/lobby-screen';
import { renderGameScreen } from './screens/game-screen';
import { renderLeaderboardScreen } from './screens/leaderboard-screen';

import { gameController } from './game/game-controller';
import { navigate } from './utils/router';

// ── Clear session on reload to cleanly return to /main ──
gameController.clearSession();

// ── Register Routes ──
registerRoute('/', () => navigate('/main'));
registerRoute('/main', () => renderHomeScreen());
registerRoute('/lobby', () => renderLobbyScreen());
registerRoute('/editor', () => renderTrackEditorScreen());
registerRoute('/game', () => {
  if (!gameController.currentQuestion) {
    navigate('/main');
    return;
  }
  renderGameScreen();
});
registerRoute('/results', () => renderLeaderboardScreen());

// ── 404 Fallback ──
onNotFound(() => navigate('/main'));

// ── Initialize Router ──
initRouter();

// ── PWA-like: prevent pull-to-refresh on mobile ──
document.addEventListener('touchmove', (e) => {
  if (document.scrollingElement?.scrollTop === 0) {
    // Allow normal scrolling when not at top
  }
}, { passive: true });

// ── Console branding ──
console.log(
  '%c🎵 GuessThe? %c— Music & MV Guessing Battle',
  'color: #8b5cf6; font-size: 18px; font-weight: bold;',
  'color: #94a3b8; font-size: 14px;'
);
