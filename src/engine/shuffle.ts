/* ──────────────────────────────────────────────
   Fisher-Yates Shuffle & Question Generator
   ────────────────────────────────────────────── */

import type { TrackItem, QuestionSession } from '../types/index';
import { generateId } from '../utils/dom';

/** In-place Fisher-Yates shuffle — returns a new shuffled array */
export function fisherYatesShuffle<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** Generate quiz questions from a track pool */
export function generateQuestions(
  pool: TrackItem[],
  count: number | 'all'
): QuestionSession[] {
  if (pool.length < 4) {
    throw new Error('ต้องมีเพลงในคลังอย่างน้อย 4 เพลง เพื่อสร้างตัวเลือก A-D');
  }

  const shuffledPool = fisherYatesShuffle(pool);
  const questionCount = count === 'all' ? shuffledPool.length : Math.min(count, shuffledPool.length);
  const selectedTracks = shuffledPool.slice(0, questionCount);

  return selectedTracks.map((track) => {
    // Get 3 random decoys from the rest of the pool (not the answer)
    const otherTitles = pool
      .filter((t) => t.id !== track.id)
      .map((t) => t.title);
    
    const shuffledDecoys = fisherYatesShuffle(otherTitles).slice(0, 3);
    
    // Create options array with correct answer + 3 decoys
    const allOptions = [track.title, ...shuffledDecoys];
    const shuffledOptions = fisherYatesShuffle(allOptions);
    const correctIndex = shuffledOptions.indexOf(track.title);

    return {
      id: generateId(),
      title: track.title,
      youtubeId: track.youtubeId,
      startTime: track.startTime,
      revealStartTime: typeof track.revealStartTime === 'number' ? track.revealStartTime : track.startTime,
      type: track.type,
      points: track.points,
      options: shuffledOptions,
      correctIndex,
    };
  });
}
