/* ──────────────────────────────────────────────
   Track Pool Manager (localStorage)
   ────────────────────────────────────────────── */

import type { TrackItem } from '../types/index';
import { extractYouTubeId } from './youtube-player';

const STORAGE_KEY = 'guessthe_track_pool';

export function loadPool(): TrackItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as any[];
    if (!Array.isArray(parsed)) return [];

    // If user has old broken or outdated sample tracks, auto-upgrade to the user requested timestamps
    const hasOutdatedSamples = parsed.some(
      (t) => (t.id === 'sample02' && t.startTime !== 41) || (t.id === 'sample01' && (t.youtubeId === 'dGx9mDpVBdw' || t.title?.includes('PALMY')))
    );
    if (hasOutdatedSamples) {
      return loadSampleTracks();
    }

    let modified = false;
    const sanitized: TrackItem[] = parsed.map((t, idx) => {
      const cleanId = extractYouTubeId(t.youtubeId || t.url || '');
      const cleanType: 'audio' | 'video' = (t.type === 'audio') ? 'audio' : 'video';
      if (cleanId !== t.youtubeId || cleanType !== t.type) {
        modified = true;
      }
      return {
        id: String(t.id || `track_${Date.now()}_${idx}`),
        title: String(t.title || 'เพลงไม่มีชื่อ'),
        youtubeId: cleanId,
        startTime: typeof t.startTime === 'number' ? t.startTime : (parseInt(t.startTime || '0') || 0),
        revealStartTime: typeof t.revealStartTime === 'number' ? t.revealStartTime : (t.revealStartTime ? parseInt(t.revealStartTime) : undefined),
        type: cleanType,
        points: typeof t.points === 'number' ? t.points : (parseInt(t.points || '10') || 10),
      };
    }).filter((t) => t.youtubeId.length > 0);

    // Auto-update localStorage with sanitized data if cleaned
    if (modified) {
      savePool(sanitized);
    }
    return sanitized;
  } catch {
    return [];
  }
}

export function savePool(tracks: TrackItem[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks));
}

export function addTrack(track: TrackItem): TrackItem[] {
  const pool = loadPool();
  track.youtubeId = extractYouTubeId(track.youtubeId);
  if (track.type !== 'audio') track.type = 'video';
  pool.push(track);
  savePool(pool);
  return pool;
}

export function removeTrack(id: string): TrackItem[] {
  const pool = loadPool().filter((t) => t.id !== id);
  savePool(pool);
  return pool;
}

export function updateTrack(id: string, updates: Partial<TrackItem>): TrackItem[] {
  const pool = loadPool().map((t) => {
    if (t.id === id) {
      const merged = { ...t, ...updates };
      if (updates.youtubeId) merged.youtubeId = extractYouTubeId(updates.youtubeId);
      if (updates.type && updates.type !== 'audio') merged.type = 'video';
      return merged;
    }
    return t;
  });
  savePool(pool);
  return pool;
}

/** Set type for all tracks in pool (e.g. all 'video' or all 'audio') */
export function setAllTrackTypes(type: 'video' | 'audio'): TrackItem[] {
  const pool = loadPool().map((t) => ({ ...t, type }));
  savePool(pool);
  return pool;
}

export function clearPool(): TrackItem[] {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
  } catch (e) {
    console.error('Failed to clear pool:', e);
  }
  return [];
}

export function importFromJSON(jsonString: string): TrackItem[] {
  try {
    const data = JSON.parse(jsonString);
    const tracks: any[] = Array.isArray(data) ? data : data.tracks || [];
    
    // Validate & Normalize
    const valid: TrackItem[] = tracks
      .filter((t: any) => t && t.title && (t.youtubeId || t.url))
      .map((t: any, idx: number) => ({
        id: String(t.id || `imported_${Date.now()}_${idx}`),
        title: String(t.title),
        youtubeId: extractYouTubeId(t.youtubeId || t.url || ''),
        startTime: typeof t.startTime === 'number' ? t.startTime : (parseInt(t.startTime || '0') || 0),
        revealStartTime: typeof t.revealStartTime === 'number' ? t.revealStartTime : (t.revealStartTime ? parseInt(t.revealStartTime) : undefined),
        type: (t.type === 'audio' ? 'audio' : 'video') as 'audio' | 'video',
        points: typeof t.points === 'number' ? t.points : (parseInt(t.points || '10') || 10),
      }))
      .filter((t) => t.youtubeId.length > 0);

    // Merge with existing
    const existing = loadPool();
    const existingIds = new Set(existing.map((e) => e.id));
    const newTracks = valid.filter((t) => !existingIds.has(t.id));
    const merged = [...existing, ...newTracks];
    savePool(merged);
    return merged;
  } catch (e) {
    throw new Error('ไฟล์ JSON ไม่ถูกต้อง: ' + (e as Error).message);
  }
}

export function exportToJSON(tracks?: TrackItem[]): string {
  const pool = tracks || loadPool();
  return JSON.stringify(pool, null, 2);
}

/** Load sample tracks for first-time users (10 verified Thai hits with exact requested timestamps) */
export function loadSampleTracks(): TrackItem[] {
  const samples: TrackItem[] = [
    {
      id: "sample01",
      title: "The Richman Toy - ธิดาประจำอำเภอ",
      youtubeId: "Hq_pjxRmn-g",
      startTime: 145,
      revealStartTime: 145,
      type: "video",
      points: 10
    },
    {
      id: "sample02",
      title: "ฤดูกาล - 25hours",
      youtubeId: "VtUS__tF2EA",
      startTime: 41,
      revealStartTime: 162,
      type: "video",
      points: 10
    },
    {
      id: "sample03",
      title: "อะไรก็ยอม - LOSO",
      youtubeId: "c31LQOCmLVU",
      startTime: 28,
      revealStartTime: 86,
      type: "video",
      points: 10
    },
    {
      id: "sample04",
      title: "คืนจันทร์ - LOSO",
      youtubeId: "G2JFOEFmnnI",
      startTime: 21,
      revealStartTime: 106,
      type: "video",
      points: 10
    },
    {
      id: "sample05",
      title: "ใจสั่งมา - LOSO",
      youtubeId: "RXZ5X_LGX9Q",
      startTime: 35,
      revealStartTime: 91,
      type: "video",
      points: 10
    },
    {
      id: "sample06",
      title: "ฤดูร้อน - Paradox",
      youtubeId: "PCmpeFoPzwY",
      startTime: 9,
      revealStartTime: 59,
      type: "video",
      points: 10
    },
    {
      id: "sample07",
      title: "ยินดีที่ไม่รู้จัก - 25hours",
      youtubeId: "5SZByn3eik0",
      startTime: 0,
      revealStartTime: 49,
      type: "video",
      points: 10
    },
    {
      id: "sample08",
      title: "ไม่ต่างกัน - 25hours",
      youtubeId: "mSWNvFaYrXY",
      startTime: 3,
      revealStartTime: 52,
      type: "video",
      points: 10
    },
    {
      id: "sample09",
      title: "TATTOO COLOUR - Cinderella",
      youtubeId: "4J-cyby36g4",
      startTime: 10,
      revealStartTime: 45,
      type: "video",
      points: 10
    },
    {
      id: "sample10",
      title: "เพ้อเจ้อ - Alarm 9",
      youtubeId: "SqKJOgFTIjc",
      startTime: 7,
      revealStartTime: 47,
      type: "video",
      points: 10
    }
  ];
  savePool(samples);
  return samples;
}
