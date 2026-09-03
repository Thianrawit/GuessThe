/* ──────────────────────────────────────────────
   Track Editor Screen — With Interactive Video Preview, Custom Reveal Start Time & Play Testing
   ────────────────────────────────────────────── */

import { setScreen, generateId } from '../utils/dom';
import { navigate } from '../utils/router';
import {
  loadPool,
  savePool,
  addTrack,
  updateTrack,
  setAllTrackTypes,
  removeTrack,
  clearPool,
  importFromJSON,
  exportToJSON,
  loadSampleTracks,
} from '../engine/track-pool';
import {
  extractYouTubeId,
  fetchYouTubeTitle,
  createPreviewPlayer,
} from '../engine/youtube-player';
import type { TrackItem } from '../types/index';

export function renderTrackEditorScreen(): void {
  let currentPreviewPlayer: YT.Player | null = null;
  let previewTimer: number | null = null;
  let editingTrackId: string | null = null;

  function stopPreview(): void {
    if (previewTimer) {
      clearInterval(previewTimer);
      previewTimer = null;
    }
    if (currentPreviewPlayer) {
      try {
        currentPreviewPlayer.destroy();
      } catch {
        /* ignore */
      }
      currentPreviewPlayer = null;
    }
  }

  setScreen(() => {
    const container = document.createElement('div');
    container.className = 'min-h-[100dvh] flex flex-col px-4 py-6';

    function render(): void {
      stopPreview();
      const pool = loadPool();
      const editingTrack = editingTrackId ? pool.find((t) => t.id === editingTrackId) : null;

      container.innerHTML = `
        <div class="w-[92%] sm:w-[85%] md:w-[680px] lg:w-[800px] mx-auto flex flex-col gap-5">
          
          <!-- Header -->
          <div class="flex items-center gap-3 animate-fade-in">
            <button id="btn-back" class="flex items-center justify-center w-10 h-10 rounded-xl bg-glass-light border border-border-subtle hover:bg-bg-card-hover transition-colors cursor-pointer">
              <span class="text-lg">←</span>
            </button>
            <div class="flex-1">
              <h1 class="font-heading text-xl sm:text-2xl font-bold gradient-text">📋 คลังเพลง</h1>
              <p class="text-text-muted text-xs mt-0.5">${pool.length} เพลงในคลัง</p>
            </div>
          </div>

          <!-- Add / Edit Track Form -->
          <div class="glass-card p-4 sm:p-5 animate-slide-up stagger-1" id="track-form-card">
            <div class="flex items-center justify-between mb-3">
              <h2 id="form-header-title" class="font-heading text-base font-bold text-text-primary">
                ${editingTrack ? `✏️ แก้ไขเพลง: ${editingTrack.title}` : '➕ เพิ่มเพลงใหม่'}
              </h2>
              <button id="btn-cancel-edit" type="button" class="${editingTrack ? '' : 'hidden'} text-xs text-text-muted hover:text-accent-red cursor-pointer bg-transparent border-none flex items-center gap-1">
                ✕ ยกเลิกการแก้ไข
              </button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <!-- YouTube Link / ID with Fetch & Preview Button -->
              <div class="sm:col-span-2">
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-text-secondary text-xs font-semibold uppercase tracking-wider">YouTube ID หรือ ลิงก์คลิป</label>
                  <span id="fetch-status" class="text-xs text-accent-purple font-medium hidden"></span>
                </div>
                <div class="flex gap-2">
                  <input
                    id="input-youtube-id"
                    type="text"
                    class="input-field flex-1"
                    placeholder="วางลิงก์ เช่น https://youtu.be/Hq_pjxRmn-g"
                    value="${editingTrack ? editingTrack.youtubeId : ''}"
                    autocomplete="off"
                  />
                  <button
                    id="btn-fetch-title"
                    type="button"
                    class="btn-secondary !w-auto !min-h-[44px] !py-2 !px-3.5 text-xs whitespace-nowrap flex items-center gap-1.5 cursor-pointer font-semibold"
                    title="โหลดคลิปและดึงชื่อเพลงจาก YouTube"
                  >
                    <span id="btn-fetch-icon">🔍</span>
                    <span>โหลดคลิป & ชื่อเพลง</span>
                  </button>
                </div>
              </div>

              <!-- Interactive Video Preview Wrapper -->
              <div id="preview-wrapper" class="hidden sm:col-span-2 rounded-2xl overflow-hidden glass-card-light p-3.5 border border-accent-purple/30 animate-fade-in">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-accent-purple animate-pulse"></span>
                    <span class="text-xs font-bold text-text-primary font-heading">📺 ตัวอย่างคลิป (Preview)</span>
                    <span id="preview-current-time" class="text-xs text-accent-cyan font-mono font-bold ml-1">⏱️ 0:00</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <button
                      id="btn-use-current-time"
                      type="button"
                      class="btn-secondary !w-auto !min-h-[28px] !py-1 !px-2.5 text-[11px] font-semibold text-accent-cyan hover:text-white cursor-pointer"
                      title="ใช้วินาทีปัจจุบันในคลิปนี้เป็นจุดเริ่มทาย"
                    >
                      📍 ตั้งเริ่มทาย (<span id="btn-time-val">0</span>s)
                    </button>
                    <button
                      id="btn-use-reveal-time"
                      type="button"
                      class="btn-secondary !w-auto !min-h-[28px] !py-1 !px-2.5 text-[11px] font-semibold text-accent-purple hover:text-white cursor-pointer"
                      title="ใช้วินาทีปัจจุบันในคลิปนี้เป็นจุดเริ่มเฉลย"
                    >
                      📍 ตั้งเริ่มเฉลย (<span id="btn-reveal-time-val">0</span>s)
                    </button>
                  </div>
                </div>
                <div class="relative w-full aspect-video rounded-xl overflow-hidden bg-black/60 shadow-inner">
                  <div id="preview-player-container" class="w-full h-full"></div>
                </div>
                <p class="text-text-muted text-[11px] mt-2 text-center">
                  💡 <strong>วิธีตั้งเวลา:</strong> กดเล่นหรือเลื่อนหาท่อนที่ต้องการ แล้วกดปุ่ม <strong>"📍 ตั้งเริ่มทาย"</strong> หรือ <strong>"📍 ตั้งเริ่มเฉลย"</strong>
                </p>
              </div>

              <!-- Song Title -->
              <div class="sm:col-span-2">
                <label class="block text-text-secondary text-xs font-semibold mb-1 uppercase tracking-wider">ชื่อเพลง (ดึงอัตโนมัติ หรือแก้ไขได้)</label>
                <input
                  id="input-title"
                  type="text"
                  class="input-field"
                  placeholder="กดโหลดคลิป & ชื่อเพลง หรือพิมพ์เองได้เลย"
                  value="${editingTrack ? editingTrack.title : ''}"
                  autocomplete="off"
                />
              </div>

              <!-- Start Time (Guessing) with Play button -->
              <div>
                <label class="block text-text-secondary text-xs font-semibold mb-1 uppercase tracking-wider">เริ่มที่วินาที (ฟังตอนทาย)</label>
                <div class="flex items-center gap-1.5">
                  <input
                    id="input-start-time"
                    type="number"
                    class="input-field flex-1"
                    placeholder="0"
                    min="0"
                    value="${editingTrack ? editingTrack.startTime : '30'}"
                  />
                  <button
                    id="btn-play-start-time"
                    type="button"
                    class="btn-secondary !w-auto !min-h-[44px] !py-2 !px-3 text-xs whitespace-nowrap flex items-center gap-1 cursor-pointer font-semibold text-accent-cyan hover:text-white"
                    title="ทดลองเล่นจากวินาทีนี้ในคลิป Preview"
                  >
                    <span>▶️</span>
                    <span>ฟัง</span>
                  </button>
                </div>
              </div>

              <!-- Reveal Start Time with Play button -->
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-text-secondary text-xs font-semibold uppercase tracking-wider">เริ่มที่วินาที (ตอนเฉลย)</label>
                  <span class="text-[10px] text-text-muted">ไม่ใส่ = ใช้วินาทีทาย</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <input
                    id="input-reveal-start-time"
                    type="number"
                    class="input-field flex-1"
                    placeholder="${editingTrack ? (editingTrack.revealStartTime ?? editingTrack.startTime) : 'เช่น 60'}"
                    min="0"
                    value="${editingTrack && typeof editingTrack.revealStartTime === 'number' ? editingTrack.revealStartTime : ''}"
                  />
                  <button
                    id="btn-play-reveal-time"
                    type="button"
                    class="btn-secondary !w-auto !min-h-[44px] !py-2 !px-3 text-xs whitespace-nowrap flex items-center gap-1 cursor-pointer font-semibold text-accent-purple hover:text-white"
                    title="ทดลองเล่นจากวินาทีเฉลยนี้ในคลิป Preview"
                  >
                    <span>▶️</span>
                    <span>ฟัง</span>
                  </button>
                </div>
              </div>

              <!-- Type -->
              <div>
                <label class="block text-text-secondary text-xs font-semibold mb-1 uppercase tracking-wider">ประเภท</label>
                <select id="input-type" class="select-field">
                  <option value="video" ${editingTrack?.type === 'video' ? 'selected' : ''}>🎬 MV Video</option>
                  <option value="audio" ${editingTrack?.type === 'audio' ? 'selected' : ''}>🎵 Audio Only</option>
                </select>
              </div>

              <!-- Points -->
              <div>
                <label class="block text-text-secondary text-xs font-semibold mb-1 uppercase tracking-wider">คะแนน</label>
                <select id="input-points" class="select-field">
                  <option value="10" ${editingTrack?.points === 10 ? 'selected' : ''}>10 แต้ม</option>
                  <option value="15" ${editingTrack?.points === 15 ? 'selected' : ''}>15 แต้ม</option>
                  <option value="20" ${editingTrack?.points === 20 ? 'selected' : ''}>20 แต้ม</option>
                  <option value="25" ${editingTrack?.points === 25 ? 'selected' : ''}>25 แต้ม</option>
                  <option value="30" ${editingTrack?.points === 30 ? 'selected' : ''}>30 แต้ม</option>
                </select>
              </div>
            </div>

            <div class="mt-4 flex flex-col sm:flex-row gap-2">
              <button id="btn-add-track" class="btn-primary sm:flex-1 cursor-pointer">
                <span>${editingTrack ? '💾' : '➕'}</span>
                <span>${editingTrack ? 'บันทึกการแก้ไข' : 'เพิ่มเพลง'}</span>
              </button>
            </div>
            <div id="add-error" class="hidden text-accent-red text-xs mt-2"></div>
          </div>

          <!-- Import / Export / Sample Toolbar -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 animate-slide-up stagger-2">
            <label class="btn-secondary !min-h-[44px] !py-2.5 !px-2 text-xs sm:text-sm font-semibold cursor-pointer text-center flex items-center justify-center whitespace-nowrap">
              นำเข้าไฟล์
              <input id="input-import-json" type="file" accept=".json,application/json" class="hidden" />
            </label>
            <button id="btn-open-paste-modal" type="button" class="btn-secondary !min-h-[44px] !py-2.5 !px-2 text-xs sm:text-sm font-semibold cursor-pointer text-center flex items-center justify-center whitespace-nowrap" title="วางข้อความ JSON โดยตรง">
              วางโค้ด
            </button>
            <button id="btn-export-json" type="button" class="btn-secondary !min-h-[44px] !py-2.5 !px-2 text-xs sm:text-sm font-semibold cursor-pointer text-center flex items-center justify-center whitespace-nowrap" title="ส่งออกข้อมูลเพลง">
              Export
            </button>
            <button id="btn-load-samples" type="button" class="btn-secondary !min-h-[44px] !py-2.5 !px-2 text-xs sm:text-sm font-semibold cursor-pointer text-center flex items-center justify-center whitespace-nowrap" style="background: linear-gradient(135deg, rgba(245,158,11,0.15), rgba(236,72,153,0.15));" title="โหลดเพลงตัวอย่าง">
              โหลดเพลงตัวอย่าง
            </button>
          </div>

          ${pool.length > 0 ? `
          <!-- Clear All -->
          <div class="flex justify-end items-center gap-2 animate-slide-up stagger-2">
            <button id="btn-clear-all" class="text-accent-red text-xs hover:underline cursor-pointer bg-transparent border-none">
              🗑️ ลบเพลงทั้งหมด
            </button>
            <div id="clear-confirm-box" class="hidden items-center gap-2 bg-accent-red/15 border border-accent-red/30 px-3 py-1.5 rounded-xl">
              <span class="text-xs text-accent-red font-medium">ลบเพลงทั้งหมดจริงไหม?</span>
              <button id="btn-clear-yes" class="px-2.5 py-1 rounded-lg bg-accent-red text-white text-xs font-bold hover:bg-accent-red/80 border-none cursor-pointer transition-colors">
                ลบเลย!
              </button>
              <button id="btn-clear-no" class="px-2 py-1 rounded-lg bg-glass-light text-text-secondary text-xs hover:bg-bg-card-hover border-none cursor-pointer transition-colors">
                ยกเลิก
              </button>
            </div>
          </div>
          ` : ''}

          ${pool.length > 0 ? `
          <!-- Batch Type Actions & Track List Header -->
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 pt-2 border-t border-border-subtle/50 animate-slide-up stagger-3">
            <div>
              <h3 class="font-heading text-sm font-bold text-text-primary">รายการเพลงทั้งหมด (${pool.length})</h3>
              <p class="text-text-muted text-[11px]">เลือกปรับประเภทเพลงทุกข้อพร้อมกัน:</p>
            </div>
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <button
                id="btn-set-all-video"
                type="button"
                class="btn-secondary !w-auto !min-h-[36px] !py-1.5 !px-3 text-xs font-semibold hover:border-accent-blue hover:text-accent-blue cursor-pointer flex-1 sm:flex-none text-center whitespace-nowrap"
                title="เปลี่ยนทุกเพลงในคลังเป็นโหมด ทาย MV (ดูคลิป)"
              >
                ทาย MV ทั้งหมด
              </button>
              <button
                id="btn-set-all-audio"
                type="button"
                class="btn-secondary !w-auto !min-h-[36px] !py-1.5 !px-3 text-xs font-semibold hover:border-accent-purple hover:text-accent-purple cursor-pointer flex-1 sm:flex-none text-center whitespace-nowrap"
                title="เปลี่ยนทุกเพลงในคลังเป็นโหมด ทายเพลง (ฟังเสียง)"
              >
                ทายเพลงทั้งหมด
              </button>
            </div>
          </div>
          ` : ''}

          <!-- Track List -->
          <div class="flex flex-col gap-2 animate-slide-up stagger-3">
            ${pool.length === 0 ? `
              <div class="glass-card p-8 text-center">
                <p class="text-text-muted text-lg mb-2">🎵</p>
                <p class="text-text-secondary text-sm">ยังไม่มีเพลงในคลัง</p>
                <p class="text-text-muted text-xs mt-1">เพิ่มเพลงด้านบน หรือกดโหลดเพลงตัวอย่าง</p>
              </div>
            ` : pool.map((track) => `
              <div class="track-item flex items-center gap-3 p-3 glass-card-light rounded-xl group transition-all hover:border-accent-purple/40 ${editingTrackId === track.id ? 'border-2 !border-accent-purple' : ''}" data-id="${track.id}">
                <div class="flex items-center justify-center w-9 h-9 rounded-lg ${track.type === 'video' ? 'bg-accent-blue/20 text-accent-blue' : 'bg-accent-purple/20 text-accent-purple'} text-sm font-bold flex-shrink-0">
                  ${track.type === 'video' ? '🎬' : '🎵'}
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-text-primary text-sm font-semibold truncate">${track.title}</p>
                  <p class="text-text-muted text-xs truncate">
                    ID: ${track.youtubeId} · ทาย ${track.startTime}s${typeof track.revealStartTime === 'number' && track.revealStartTime !== track.startTime ? ` · เฉลย ${track.revealStartTime}s` : ''} · ${track.points}pt
                  </p>
                </div>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  <button class="btn-preview-track flex items-center justify-center w-8 h-8 rounded-lg bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/30 text-xs transition-colors cursor-pointer border-none" data-id="${track.id}" title="ดูพรีวิวคลิปนี้">
                    ▶️
                  </button>
                  <button class="btn-edit-track flex items-center justify-center w-8 h-8 rounded-lg bg-accent-purple/15 text-accent-purple hover:bg-accent-purple/30 text-xs transition-colors cursor-pointer border-none" data-id="${track.id}" title="แก้ไขเพลงนี้">
                    ✏️
                  </button>
                  <button class="btn-delete-track flex items-center justify-center w-8 h-8 rounded-lg bg-accent-red/15 text-accent-red hover:bg-accent-red/30 text-xs transition-colors cursor-pointer border-none" data-id="${track.id}" title="ลบเพลงนี้">
                    🗑️
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Export Modal (Fix for Chrome download & 1-click clipboard copy) -->
        <div id="export-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 hidden items-center justify-center p-4 animate-fade-in">
          <div class="glass-card max-w-lg w-full p-5 flex flex-col gap-3.5 border border-accent-purple/40 shadow-2xl">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-xl">📤</span>
                <h3 class="font-heading font-bold text-base text-text-primary">Export คลังเพลง (${pool.length} เพลง)</h3>
              </div>
              <button id="btn-close-export-modal" type="button" class="text-text-muted hover:text-text-primary text-xl cursor-pointer bg-transparent border-none">
                ✕
              </button>
            </div>

            <div class="flex flex-col gap-1 text-xs text-text-secondary">
              <p>💡 ระบบส่งคำสั่งดาวน์โหลดไฟล์ <strong>guessthe-tracks.json</strong> แล้ว</p>
              <p>หากเบราว์เซอร์ไม่เซฟไฟล์ สามารถกดปุ่ม <strong>"📋 คัดลอกโค้ด JSON"</strong> ด้านล่างนี้ไปเซฟเองได้ทันที:</p>
            </div>

            <!-- Action Buttons -->
            <div class="flex flex-col sm:flex-row gap-2">
              <button id="btn-modal-copy" type="button" class="btn-primary flex-1 !py-2.5 text-xs font-bold flex items-center justify-center !bg-accent-purple cursor-pointer">
                คัดลอกโค้ด JSON
              </button>
              <button id="btn-modal-download" type="button" class="btn-secondary flex-1 !py-2.5 text-xs font-bold flex items-center justify-center text-accent-cyan cursor-pointer">
                ดาวน์โหลดไฟล์อีกครั้ง
              </button>
            </div>

            <!-- JSON Preview Box -->
            <div class="relative">
              <textarea
                id="export-json-textarea"
                readonly
                class="w-full h-44 font-mono text-[11px] p-3 rounded-xl bg-black/60 border border-border-subtle text-text-primary focus:outline-none resize-none select-all"
              ></textarea>
              <span id="copy-toast" class="absolute bottom-3 right-3 text-[11px] bg-accent-green/30 text-accent-green px-2.5 py-1 rounded-lg border border-accent-green/40 font-semibold hidden animate-fade-in">
                ✓ คัดลอกลงคลิปบอร์ดแล้ว!
              </span>
            </div>

            <div class="flex justify-end">
              <button id="btn-modal-done" type="button" class="btn-secondary !w-auto !py-1.5 !px-4 text-xs cursor-pointer">
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>

        <!-- Paste Import Modal -->
        <div id="paste-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 hidden items-center justify-center p-4 animate-fade-in">
          <div class="glass-card max-w-lg w-full p-5 flex flex-col gap-3.5 border border-accent-purple/40 shadow-2xl">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-xl">📋</span>
                <h3 class="font-heading font-bold text-base text-text-primary">นำเข้าเพลงด้วยข้อความ JSON</h3>
              </div>
              <button id="btn-close-paste-modal" type="button" class="text-text-muted hover:text-text-primary text-xl cursor-pointer bg-transparent border-none">
                ✕
              </button>
            </div>

            <p class="text-xs text-text-secondary">
              วางโค้ด JSON ที่คัดลอกมาลงในช่องด้านล่าง แล้วกดปุ่ม "นำเข้าเพลง":
            </p>

            <textarea
              id="paste-json-textarea"
              class="w-full h-44 font-mono text-[11px] p-3 rounded-xl bg-black/60 border border-border-subtle text-text-primary focus:outline-none resize-none"
              placeholder="วางโค้ด JSON ที่นี่..."
            ></textarea>
            <div id="paste-error" class="hidden text-accent-red text-xs"></div>

            <div class="flex justify-end gap-2">
              <button id="btn-cancel-paste" type="button" class="btn-secondary !w-auto !py-1.5 !px-4 text-xs cursor-pointer">
                ยกเลิก
              </button>
              <button id="btn-submit-paste" type="button" class="btn-primary !w-auto !py-1.5 !px-4 text-xs font-bold cursor-pointer">
                นำเข้าเพลง
              </button>
            </div>
          </div>
        </div>
      `;

      // Form Elements
      const ytInput = container.querySelector('#input-youtube-id') as HTMLInputElement | null;
      const titleInput = container.querySelector('#input-title') as HTMLInputElement | null;
      const startTimeInput = container.querySelector('#input-start-time') as HTMLInputElement | null;
      const revealStartTimeInput = container.querySelector('#input-reveal-start-time') as HTMLInputElement | null;
      const typeInput = container.querySelector('#input-type') as HTMLSelectElement | null;
      const pointsInput = container.querySelector('#input-points') as HTMLSelectElement | null;
      const fetchBtn = container.querySelector('#btn-fetch-title') as HTMLButtonElement | null;
      const fetchStatus = container.querySelector('#fetch-status') as HTMLElement | null;
      const fetchIcon = container.querySelector('#btn-fetch-icon') as HTMLElement | null;
      const previewWrapper = container.querySelector('#preview-wrapper') as HTMLElement | null;
      const previewTimeEl = container.querySelector('#preview-current-time') as HTMLElement | null;
      const btnTimeVal = container.querySelector('#btn-time-val') as HTMLElement | null;
      const btnRevealTimeVal = container.querySelector('#btn-reveal-time-val') as HTMLElement | null;
      const btnUseTime = container.querySelector('#btn-use-current-time') as HTMLButtonElement | null;
      const btnUseRevealTime = container.querySelector('#btn-use-reveal-time') as HTMLButtonElement | null;
      const btnPlayStartTime = container.querySelector('#btn-play-start-time') as HTMLButtonElement | null;
      const btnPlayRevealTime = container.querySelector('#btn-play-reveal-time') as HTMLButtonElement | null;
      const btnCancelEdit = container.querySelector('#btn-cancel-edit') as HTMLButtonElement | null;
      const formTitleEl = container.querySelector('#form-header-title') as HTMLElement | null;
      const btnAddTrack = container.querySelector('#btn-add-track') as HTMLButtonElement | null;
      const errorEl = container.querySelector('#add-error') as HTMLElement | null;

      // Load YouTube Video Preview
      async function loadVideoPreview(rawUrlOrId: string, startTime: number = 0, autoPlay: boolean = false): Promise<void> {
        const vid = extractYouTubeId(rawUrlOrId);
        if (!vid || vid.length !== 11) return;

        if (previewWrapper) {
          previewWrapper.classList.remove('hidden');
        }

        stopPreview();

        const previewContainer = container.querySelector('#preview-player-container');
        if (!previewContainer) return;
        previewContainer.innerHTML = '<div id="preview-player-embed" class="w-full h-full"></div>';

        try {
          currentPreviewPlayer = await createPreviewPlayer('preview-player-embed', vid, startTime);

          if (autoPlay) {
            try {
              currentPreviewPlayer.seekTo(startTime, true);
              currentPreviewPlayer.playVideo();
            } catch { /* ignore */ }
          }

          // Track current playback time continuously
          previewTimer = window.setInterval(() => {
            try {
              if (currentPreviewPlayer && typeof currentPreviewPlayer.getCurrentTime === 'function') {
                const cur = currentPreviewPlayer.getCurrentTime();
                if (typeof cur === 'number' && !isNaN(cur)) {
                  const sec = Math.floor(cur);
                  const m = Math.floor(sec / 60);
                  const s = sec % 60;
                  if (previewTimeEl) {
                    previewTimeEl.textContent = `⏱️ ${m}:${s < 10 ? '0' : ''}${s}`;
                  }
                  if (btnTimeVal) {
                    btnTimeVal.textContent = String(sec);
                  }
                  if (btnRevealTimeVal) {
                    btnRevealTimeVal.textContent = String(sec);
                  }
                }
              }
            } catch {
              /* ignore while scrubbing or destroyed */
            }
          }, 250);
        } catch (e) {
          console.warn('Preview player load error:', e);
          if (previewContainer) {
            previewContainer.innerHTML = `
              <div class="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
                <span class="text-2xl">⚠️</span>
                <p class="text-accent-yellow text-xs font-semibold">ไม่สามารถแสดงพรีวิววิดีโอนี้ได้</p>
                <p class="text-text-muted text-[10px]">แต่วิดีโอยังสามารถใช้เล่นในเกมได้ตามปกติ</p>
              </div>
            `;
          }
        }
      }

      // Play testing helper: seeks and plays from target second
      async function testPlayAtSeconds(targetSec: number, targetBtn: HTMLElement | null): Promise<void> {
        const raw = ytInput?.value.trim() || '';
        const vid = extractYouTubeId(raw);
        if (!vid || vid.length !== 11) {
          if (fetchStatus) {
            fetchStatus.textContent = '⚠️ วางลิงก์คลิปก่อนกดฟัง';
            fetchStatus.className = 'text-xs text-accent-red font-medium';
            fetchStatus.classList.remove('hidden');
            setTimeout(() => fetchStatus.classList.add('hidden'), 3000);
          }
          return;
        }

        if (targetBtn) {
          const origText = targetBtn.innerHTML;
          targetBtn.innerHTML = '<span>⏳</span> <span>โหลด...</span>';
          setTimeout(() => { targetBtn.innerHTML = origText; }, 1500);
        }

        // If player already exists and loaded for same video, seek & play directly
        if (currentPreviewPlayer && typeof currentPreviewPlayer.seekTo === 'function') {
          try {
            currentPreviewPlayer.seekTo(targetSec, true);
            currentPreviewPlayer.playVideo();
            if (previewWrapper) previewWrapper.classList.remove('hidden');
            return;
          } catch {
            /* reload if player errored */
          }
        }

        // Otherwise, initialize preview player at this timestamp and autoplay
        await loadVideoPreview(vid, targetSec, true);
      }

      // "▶️ ฟัง" button for Start Time
      btnPlayStartTime?.addEventListener('click', () => {
        const sec = parseInt(startTimeInput?.value || '0') || 0;
        testPlayAtSeconds(sec, btnPlayStartTime);
      });

      // "▶️ ฟัง" button for Reveal Start Time
      btnPlayRevealTime?.addEventListener('click', () => {
        const revealVal = revealStartTimeInput?.value.trim();
        const sec = revealVal ? (parseInt(revealVal) || 0) : (parseInt(startTimeInput?.value || '0') || 0);
        testPlayAtSeconds(sec, btnPlayRevealTime);
      });

      // "📍 ตั้งเริ่มทาย" button
      btnUseTime?.addEventListener('click', () => {
        try {
          if (currentPreviewPlayer && typeof currentPreviewPlayer.getCurrentTime === 'function') {
            const cur = Math.floor(currentPreviewPlayer.getCurrentTime() || 0);
            if (startTimeInput) {
              startTimeInput.value = String(cur);
              startTimeInput.classList.add('ring-2', 'ring-accent-green');
              setTimeout(() => startTimeInput.classList.remove('ring-2', 'ring-accent-green'), 1000);
            }
            if (btnUseTime) {
              btnUseTime.textContent = `✓ เริ่มทาย ${cur}s!`;
              setTimeout(() => {
                btnUseTime.innerHTML = `📍 ตั้งเริ่มทาย (<span id="btn-time-val">${cur}</span>s)`;
              }, 1500);
            }
          }
        } catch {
          /* ignore */
        }
      });

      // "📍 ตั้งเริ่มเฉลย" button
      btnUseRevealTime?.addEventListener('click', () => {
        try {
          if (currentPreviewPlayer && typeof currentPreviewPlayer.getCurrentTime === 'function') {
            const cur = Math.floor(currentPreviewPlayer.getCurrentTime() || 0);
            if (revealStartTimeInput) {
              revealStartTimeInput.value = String(cur);
              revealStartTimeInput.classList.add('ring-2', 'ring-accent-purple');
              setTimeout(() => revealStartTimeInput.classList.remove('ring-2', 'ring-accent-purple'), 1000);
            }
            if (btnUseRevealTime) {
              btnUseRevealTime.textContent = `✓ เริ่มเฉลย ${cur}s!`;
              setTimeout(() => {
                btnUseRevealTime.innerHTML = `📍 ตั้งเริ่มเฉลย (<span id="btn-reveal-time-val">${cur}</span>s)`;
              }, 1500);
            }
          }
        } catch {
          /* ignore */
        }
      });

      // Handle "โหลดคลิป & ดึงชื่อเพลง"
      async function handleFetchAndPreview(): Promise<void> {
        const raw = ytInput?.value.trim() || '';
        if (!raw) return;
        const vid = extractYouTubeId(raw);
        if (!vid || vid.length !== 11) {
          if (fetchStatus) {
            fetchStatus.textContent = '⚠️ ลิงก์ไม่ถูกต้อง';
            fetchStatus.className = 'text-xs text-accent-red font-medium';
            fetchStatus.classList.remove('hidden');
            setTimeout(() => fetchStatus.classList.add('hidden'), 3000);
          }
          return;
        }

        if (fetchStatus) {
          fetchStatus.textContent = '⏳ กำลังดึงข้อมูล & โหลดคลิป...';
          fetchStatus.className = 'text-xs text-accent-purple font-medium';
          fetchStatus.classList.remove('hidden');
        }
        if (fetchIcon) fetchIcon.textContent = '⏳';
        if (fetchBtn) fetchBtn.disabled = true;

        const startSec = parseInt(startTimeInput?.value || '0') || 0;

        // Load preview immediately in parallel
        loadVideoPreview(vid, startSec);

        try {
          const { cleanTitle } = await fetchYouTubeTitle(raw);
          if (titleInput) {
            titleInput.value = cleanTitle;
          }
          if (fetchStatus) {
            fetchStatus.textContent = '✓ โหลดสำเร็จ!';
            fetchStatus.className = 'text-xs text-accent-green font-medium';
            setTimeout(() => fetchStatus.classList.add('hidden'), 3000);
          }
        } catch (err) {
          if (fetchStatus) {
            fetchStatus.textContent = `⚠️ ${(err as Error).message}`;
            fetchStatus.className = 'text-xs text-accent-red font-medium';
            setTimeout(() => fetchStatus.classList.add('hidden'), 4000);
          }
        } finally {
          if (fetchIcon) fetchIcon.textContent = '🔍';
          if (fetchBtn) fetchBtn.disabled = false;
        }
      }

      fetchBtn?.addEventListener('click', handleFetchAndPreview);
      ytInput?.addEventListener('paste', () => {
        setTimeout(handleFetchAndPreview, 50);
      });

      // Cancel Edit
      btnCancelEdit?.addEventListener('click', () => {
        editingTrackId = null;
        render();
      });

      // Back navigation
      container.querySelector('#btn-back')?.addEventListener('click', () => {
        stopPreview();
        navigate('/main');
      });

      // Add or Update Track
      btnAddTrack?.addEventListener('click', () => {
        const title = titleInput?.value.trim() || '';
        const rawYoutubeId = ytInput?.value.trim() || '';
        const startTime = parseInt(startTimeInput?.value || '0') || 0;
        const revealRaw = (revealStartTimeInput?.value || '').trim();
        const revealStartTime = revealRaw ? (parseInt(revealRaw) || 0) : undefined;
        const type = (typeInput?.value as 'audio' | 'video') || 'video';
        const points = parseInt(pointsInput?.value || '10') || 10;

        if (!title || !rawYoutubeId) {
          if (errorEl) {
            errorEl.textContent = '⚠️ กรุณากรอกชื่อเพลงและ YouTube ID หรือ ลิงก์คลิป';
            errorEl.classList.remove('hidden');
          }
          return;
        }

        const youtubeId = extractYouTubeId(rawYoutubeId);
        if (!youtubeId || youtubeId.length !== 11) {
          if (errorEl) {
            errorEl.textContent = '⚠️ ลิงก์หรือ Video ID ไม่ถูกต้อง (ต้องเป็น ID 11 หลัก เช่น Hq_pjxRmn-g หรือลิงก์ https://youtu.be/...)';
            errorEl.classList.remove('hidden');
          }
          return;
        }

        if (editingTrackId) {
          updateTrack(editingTrackId, {
            title,
            youtubeId,
            startTime: isNaN(startTime) ? 0 : startTime,
            revealStartTime: revealStartTime !== undefined && !isNaN(revealStartTime) ? revealStartTime : undefined,
            type,
            points,
          });
          editingTrackId = null;
        } else {
          addTrack({
            id: generateId(),
            title,
            youtubeId,
            startTime: isNaN(startTime) ? 0 : startTime,
            revealStartTime: revealStartTime !== undefined && !isNaN(revealStartTime) ? revealStartTime : undefined,
            type,
            points,
          });
        }

        render();
      });

      // Edit track button
      container.querySelectorAll('.btn-edit-track').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
          if (!id) return;
          const track = pool.find((t) => t.id === id);
          if (!track) return;

          editingTrackId = id;
          if (titleInput) titleInput.value = track.title;
          if (ytInput) ytInput.value = track.youtubeId;
          if (startTimeInput) startTimeInput.value = String(track.startTime);
          if (revealStartTimeInput) {
            revealStartTimeInput.value = typeof track.revealStartTime === 'number' ? String(track.revealStartTime) : '';
          }
          if (typeInput) typeInput.value = track.type;
          if (pointsInput) pointsInput.value = String(track.points);

          if (formTitleEl) formTitleEl.textContent = `✏️ แก้ไขเพลง: ${track.title}`;
          if (btnCancelEdit) btnCancelEdit.classList.remove('hidden');
          if (btnAddTrack) {
            btnAddTrack.innerHTML = '<span>💾</span> <span>บันทึกการแก้ไข</span>';
          }

          loadVideoPreview(track.youtubeId, track.startTime);

          // Scroll to form smoothly
          container.querySelector('#track-form-card')?.scrollIntoView({ behavior: 'smooth' });
        });
      });

      // Quick Preview button in track list
      container.querySelectorAll('.btn-preview-track').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
          if (!id) return;
          const track = pool.find((t) => t.id === id);
          if (!track) return;

          if (ytInput) ytInput.value = track.youtubeId;
          if (startTimeInput) startTimeInput.value = String(track.startTime);
          if (revealStartTimeInput) {
            revealStartTimeInput.value = typeof track.revealStartTime === 'number' ? String(track.revealStartTime) : '';
          }
          loadVideoPreview(track.youtubeId, track.startTime);

          container.querySelector('#preview-wrapper')?.scrollIntoView({ behavior: 'smooth' });
        });
      });

      // Delete track button
      container.querySelectorAll('.btn-delete-track').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
          if (id) {
            if (editingTrackId === id) editingTrackId = null;
            removeTrack(id);
            render();
          }
        });
      });

      // Clear all
      const clearBtn = container.querySelector('#btn-clear-all') as HTMLElement | null;
      const confirmBox = container.querySelector('#clear-confirm-box') as HTMLElement | null;
      const confirmYes = container.querySelector('#btn-clear-yes') as HTMLElement | null;
      const confirmNo = container.querySelector('#btn-clear-no') as HTMLElement | null;

      clearBtn?.addEventListener('click', () => {
        clearBtn.classList.add('hidden');
        confirmBox?.classList.remove('hidden');
        confirmBox?.classList.add('flex');
      });

      confirmYes?.addEventListener('click', () => {
        clearPool();
        editingTrackId = null;
        render();
      });

      confirmNo?.addEventListener('click', () => {
        confirmBox?.classList.add('hidden');
        confirmBox?.classList.remove('flex');
        clearBtn?.classList.remove('hidden');
      });

      // Import JSON
      container.querySelector('#input-import-json')?.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            importFromJSON(ev.target?.result as string);
            render();
          } catch (err) {
            alert((err as Error).message);
          }
        };
        reader.readAsText(file);
      });

      // Robust JSON Download via Data URI (Chrome-safe, prevents UUID filename)
      function downloadJSONFile(filename: string, text: string): void {
        try {
          const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(text);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = dataUri;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
          }, 1000);
          return;
        } catch (e) {
          console.warn('Data URI download failed, fallback to blob:', e);
        }

        // Fallback to blob
        try {
          const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 10000);
        } catch (err) {
          console.error('All download methods failed:', err);
        }
      }

      // Export JSON — Auto-download & open copy modal
      const exportModal = container.querySelector('#export-modal') as HTMLElement | null;
      const exportTextarea = container.querySelector('#export-json-textarea') as HTMLTextAreaElement | null;
      const copyToast = container.querySelector('#copy-toast') as HTMLElement | null;

      container.querySelector('#btn-export-json')?.addEventListener('click', () => {
        const json = exportToJSON();
        downloadJSONFile('guessthe-tracks.json', json);

        if (exportTextarea) exportTextarea.value = json;
        if (exportModal) {
          exportModal.classList.remove('hidden');
          exportModal.classList.add('flex');
        }
      });

      // Modal Download again
      container.querySelector('#btn-modal-download')?.addEventListener('click', () => {
        const json = exportToJSON();
        downloadJSONFile('guessthe-tracks.json', json);
      });

      // Modal 1-Click Copy
      container.querySelector('#btn-modal-copy')?.addEventListener('click', async () => {
        const json = exportToJSON();
        try {
          await navigator.clipboard.writeText(json);
        } catch {
          if (exportTextarea) {
            exportTextarea.select();
            document.execCommand('copy');
          }
        }
        if (copyToast) {
          copyToast.classList.remove('hidden');
          setTimeout(() => copyToast.classList.add('hidden'), 3000);
        }
      });

      // Close Export Modal
      const closeExportModal = () => {
        if (exportModal) {
          exportModal.classList.add('hidden');
          exportModal.classList.remove('flex');
        }
      };
      container.querySelector('#btn-close-export-modal')?.addEventListener('click', closeExportModal);
      container.querySelector('#btn-modal-done')?.addEventListener('click', closeExportModal);

      // Paste Import Modal
      const pasteModal = container.querySelector('#paste-modal') as HTMLElement | null;
      const pasteTextarea = container.querySelector('#paste-json-textarea') as HTMLTextAreaElement | null;
      const pasteError = container.querySelector('#paste-error') as HTMLElement | null;

      container.querySelector('#btn-open-paste-modal')?.addEventListener('click', () => {
        if (pasteTextarea) pasteTextarea.value = '';
        if (pasteError) pasteError.classList.add('hidden');
        if (pasteModal) {
          pasteModal.classList.remove('hidden');
          pasteModal.classList.add('flex');
        }
      });

      const closePasteModal = () => {
        if (pasteModal) {
          pasteModal.classList.add('hidden');
          pasteModal.classList.remove('flex');
        }
      };
      container.querySelector('#btn-close-paste-modal')?.addEventListener('click', closePasteModal);
      container.querySelector('#btn-cancel-paste')?.addEventListener('click', closePasteModal);

      container.querySelector('#btn-submit-paste')?.addEventListener('click', () => {
        const val = pasteTextarea?.value.trim() || '';
        if (!val) {
          if (pasteError) {
            pasteError.textContent = '⚠️ กรุณาวางข้อความ JSON ก่อน';
            pasteError.classList.remove('hidden');
          }
          return;
        }

        try {
          importFromJSON(val);
          closePasteModal();
          render();
        } catch (e) {
          if (pasteError) {
            pasteError.textContent = `⚠️ ${(e as Error).message}`;
            pasteError.classList.remove('hidden');
          }
        }
      });

      // Load samples
      container.querySelector('#btn-load-samples')?.addEventListener('click', () => {
        loadSampleTracks();
        editingTrackId = null;
        render();
      });

      // Batch Type Change handlers
      container.querySelector('#btn-set-all-video')?.addEventListener('click', () => {
        setAllTrackTypes('video');
        render();
      });

      container.querySelector('#btn-set-all-audio')?.addEventListener('click', () => {
        setAllTrackTypes('audio');
        render();
      });

      // Auto-preview if editingTrack was already set on initial render
      if (editingTrack) {
        loadVideoPreview(editingTrack.youtubeId, editingTrack.startTime);
      }
    }

    render();
    return container;
  });
}
