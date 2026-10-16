/*! Type Studio — hackable typing-practice engine. MIT-style: do whatever you like with it. */
(function(){
'use strict';

/* =========================================================================
   TYPE STUDIO — a small, hackable typing-practice engine.
   ---------------------------------------------------------------------
   This file is intentionally organized so you can extend it:
     - Add lessons/courses:  window.TypingStudio.addLesson(lesson)
     - React to progress:    window.TypingStudio.on('checkpoint', fn)
     - Build gamification on top of the event bus below.
   See the "PUBLIC API" block at the very end for the full surface.
   ========================================================================= */

/* ---------------------------- helpers ---------------------------- */
const qs = (sel, root) => (root||document).querySelector(sel);
const qsa = (sel, root) => Array.from((root||document).querySelectorAll(sel));
const prefersReducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const collapseWhitespace = (str) => str.normalize('NFC').replace(/\s+/g, ' ').trim();
const normalizeLessonText = (str) => str.normalize('NFC').replace(/\r\n?/g, '\n').trim();
const slugify = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'lesson';
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
function formatTime(ms){
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60);
  const rem = s%60;
  return `${m}:${String(rem).padStart(2,'0')}`;
}

// Merge overlapping / touching [start, end) ranges so a mark inside a marked sentence
// paints as one continuous band with a single pair of rounded ends.
function mergeRanges(ranges){
  const rs = ranges.map(r => [r[0], r[1]]).filter(r => r[1] > r[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for(const r of rs){
    const last = out[out.length - 1];
    if(last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

// Length of the shared start of two strings (where an edit first changes the text).
function commonPrefix(a, b){
  const n = Math.min(a.length, b.length);
  let i = 0;
  while(i < n && a[i] === b[i]) i++;
  return i;
}

/* ---------------------------- tunables ---------------------------- */
// Auto-pause after this many ms without a keystroke while the clock is running
// (0 disables it). The pause is back-dated to the last keystroke, so the idle
// stretch never counts against your speed.
const IDLE_PAUSE_MS = 30000;

// What a dead key (´ ` ¨ ^ ~) leaves in the typing field while it waits for its vowel.
const ACCENT_ONLY = /^[´`¨^~˜¸¯˘˙˚˝ˇ'"\u0300-\u036F]+$/u;
const SESSION_VISITS_KEY = 'typingStudio.lessonVisits.v1';
const TEMPLATE_HISTORY_LIMIT = 20;
const TEMPLATE_HISTORY_MAX_CHARS = 500000;

/* ---------------------------- lesson data ---------------------------- */
// Each lesson: { id, title, text, targetWPM, targetAccuracy, objectives?, topics? }
// Objectives are plain data (see evaluateObjective) so custom lessons stay JSON-serializable.
function defaultObjectives(targetWPM, targetAccuracy){
  return [
    { type:'minWpm', value: targetWPM, label: `Reach ${targetWPM} wpm` },
    { type:'minAccuracy', value: targetAccuracy, label: `Keep accuracy at ${targetAccuracy}% or higher` },
    { type:'maxErrors', value: 5, label: 'Fewer than 5 mistakes' }
  ];
}
function evaluateObjective(spec, stats){
  switch(spec.type){
    case 'minWpm': return stats.wpm >= spec.value;
    case 'minAccuracy': return stats.accuracy >= spec.value;
    case 'maxErrors': return stats.errors <= spec.value;
    default: return true; // unknown types pass silently — extend this switch for your own objective types
  }
}

// The lesson opened on first visit (and on any visit with no remembered last
// lesson). Lives in a static pack (lessons/programmers-practice.json), not in
// DEFAULT_COURSES below — change this id to point at any lesson, built-in or
// packed, to change what greets a new visitor. If the pack it points to can't
// be fetched (offline, local file:// preview, or the id doesn't exist), init()
// falls back to the first built-in lesson automatically.
const DEFAULT_LESSON_ID = 'prog-js-basics';

const DEFAULT_COURSES = [
  {
    title: 'Foundations',
    lessons: [
      {
        id:'home-row', title:'Home Row Warm-Up',
        text:"ask a lad; a sad flask falls; glass jars fall as a lad asks dad; add a flag; salsa lasts all day",
        targetWPM:25, targetAccuracy:95
      },
      {
        id:'number-fun', title:'Number Fun',
        text:"There are infinite numbers out there, and you could keep counting forever without ever reaching the end. For now, let's warm up your fingers on the number row: 1 2 3 4 5 6 7 8 9 0, then back down again: 9 8 7 6 5 4 3 2 1 0.",
        targetWPM:28, targetAccuracy:95
      }
    ]
  },
  {
    title:'Classics',
    lessons:[
      {
        id:'quick-fox', title:'Quick Brown Fox',
        text:"The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump!",
        targetWPM:40, targetAccuracy:96
      }
    ]
  },
  {
    title:'Speed Drills',
    lessons:[
      {
        id:'common-words', title:'Common Words',
        text:"the of and a to in is you that it he was for on are as with his they at be this from I have not but had what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water",
        targetWPM:45, targetAccuracy:96
      }
    ]
  }
];

/* ---------------------------- storage ---------------------------- */
const Storage = {
  LESSONS_KEY:'typingStudio.customLessons.v1',
  STATS_KEY:'typingStudio.stats.v1',
  PREFS_KEY:'typingStudio.prefs.v1',
  MARKS_KEY:'typingStudio.marks.v1',
  OVERRIDES_KEY:'typingStudio.overrides.v1',
  DELETED_KEY:'typingStudio.deletedLessons.v1',
  POSITIONS_KEY:'typingStudio.positions.v1',
  loadLessons(){ try{ const raw = localStorage.getItem(this.LESSONS_KEY); return raw ? JSON.parse(raw) : []; }catch(e){ console.warn('TypeStudio: could not read custom lessons', e); return []; } },
  saveLessons(list){ try{ localStorage.setItem(this.LESSONS_KEY, JSON.stringify(list)); }catch(e){ console.warn('TypeStudio: could not save custom lessons', e); } },
  loadStats(){ try{ const raw = localStorage.getItem(this.STATS_KEY); return raw ? JSON.parse(raw) : {}; }catch(e){ return {}; } },
  saveStats(stats){ try{ localStorage.setItem(this.STATS_KEY, JSON.stringify(stats)); }catch(e){ console.warn('TypeStudio: could not save stats', e); } },
  loadOverrides(){ try{ const raw = localStorage.getItem(this.OVERRIDES_KEY); const v = raw ? JSON.parse(raw) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }catch(e){ return {}; } },
  saveOverrides(map){ try{ localStorage.setItem(this.OVERRIDES_KEY, JSON.stringify(map)); }catch(e){ console.warn('TypeStudio: could not save edits', e); } },
  loadMarks(){ try{ const raw = localStorage.getItem(this.MARKS_KEY); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }catch(e){ return []; } },
  saveMarks(list){ try{ localStorage.setItem(this.MARKS_KEY, JSON.stringify(list)); }catch(e){ console.warn('TypeStudio: could not save marks', e); } },
  loadPrefs(){ try{ const raw = localStorage.getItem(this.PREFS_KEY); return raw ? JSON.parse(raw) : {}; }catch(e){ return {}; } },
  savePrefs(prefs){ try{ localStorage.setItem(this.PREFS_KEY, JSON.stringify(prefs)); }catch(e){ /* ignore */ } },
  loadDeletedLessons(){ try{ const raw = localStorage.getItem(this.DELETED_KEY); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }catch(e){ console.warn('TypeStudio: could not read deleted lessons', e); return []; } },
  saveDeletedLessons(ids){ try{ localStorage.setItem(this.DELETED_KEY, JSON.stringify(ids)); }catch(e){ console.warn('TypeStudio: could not save deleted lessons', e); } },
  loadPositions(){ try{ const raw = localStorage.getItem(this.POSITIONS_KEY); const v = raw ? JSON.parse(raw) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }catch(e){ console.warn('TypeStudio: could not read lesson positions', e); return {}; } },
  savePositions(positions){ try{ localStorage.setItem(this.POSITIONS_KEY, JSON.stringify(positions)); }catch(e){ console.warn('TypeStudio: could not save lesson positions', e); } }
};

/* ---------------------------- sound engine ---------------------------- */
class SoundEngine{
  constructor(){ this.ctx = null; this.noiseBuffer = null; this.enabled = true; }
  ensureContext(){
    if(!this.ctx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(!Ctx) return false;
      this.ctx = new Ctx();
      this.noiseBuffer = this._makeNoiseBuffer();
    }
    if(this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }
  _makeNoiseBuffer(){
    const len = Math.floor(this.ctx.sampleRate * 0.05);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<len;i++) data[i] = Math.random()*2-1;
    return buf;
  }
  playKey({error=false, space=false} = {}){
    if(!this.enabled || !this.ensureContext()) return;
    const t = this.ctx.currentTime;
    // percussive noise "click"
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = (error ? 900 : (space ? 1500 : 2500)) + (Math.random()*400-200);
    filter.Q.value = 1.1;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(error?0.16:0.24, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t+0.045);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t); src.stop(t+0.06);
    // low tonal "thock"
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const base = error ? 130 : (space ? 85 : 210);
    osc.frequency.setValueAtTime(base + (Math.random()*16-8), t);
    osc.frequency.exponentialRampToValueAtTime(base*0.6, t+0.07);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(error?0.11:0.15, t);
    og.gain.exponentialRampToValueAtTime(0.001, t+0.09);
    osc.connect(og).connect(this.ctx.destination);
    osc.start(t); osc.stop(t+0.1);
  }
  playMark(kind){
    if(!this.enabled || !this.ensureContext()) return;
    const t = this.ctx.currentTime;
    // a mark chimes upward, a mask settles downward (like tape being laid down)
    (kind === 'mask' ? [440, 311] : [660, 990]).forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = f;
      const g = this.ctx.createGain();
      const s = t + i*0.07;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.1, s+0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s+0.22);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(s); osc.stop(s+0.25);
    });
  }
  playComplete(){
    if(!this.enabled || !this.ensureContext()) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f,i)=>{
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      const start = t + i*0.08;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.2, start+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start+0.35);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(start); osc.stop(start+0.4);
    });
  }
}

/* ---------------------------- typing engine ---------------------------- */
class TypingEngine extends EventTarget{
  constructor(lesson){
    super();
    this.lesson = lesson;
    this.text = lesson.text.normalize('NFC'); // "a" + combining acute -> "á": one visible letter, one character
    const wordCount = this.text.trim().split(/\s+/).filter(Boolean).length;
    this.checkpointInterval = Math.max(4, Math.ceil(wordCount/4));
    this.reset();
  }
  reset(){
    this.pos = 0;
    this.startTime = null;
    this.endTime = null;
    this.pausedAt = null;
    this.pausedDuration = 0;
    this.keystrokes = 0;
    this.correctKeystrokes = 0;
    this.errorEvents = 0;
    this.finished = false;
    this.wordsCompleted = 0;
    this.lastCheckpointWords = 0;
    this.lastCheckpointTime = null;
    this.lastCheckpointChars = 0;
    this.lastCheckpointPausedDuration = 0;
  }
  start(){
    if(this.startTime === null){
      this.startTime = performance.now();
      this.lastCheckpointTime = this.startTime;
      this.dispatchEvent(new CustomEvent('start'));
    }
  }
  pause(at){
    // `at` lets a caller back-date the pause (e.g. to the last keystroke when
    // auto-pausing for inactivity) so away time is never counted as typing time.
    if(this.pausedAt === null && this.startTime !== null && !this.finished){
      const t = (typeof at === 'number') ? at : performance.now();
      this.pausedAt = Math.min(performance.now(), Math.max(this.startTime, t));
    }
  }
  resume(){
    if(this.pausedAt !== null){
      this.pausedDuration += performance.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }
  typeChar(ch){
    if(this.finished || this.pos >= this.text.length) return;
    this.start();
    const expected = this.text[this.pos];
    const correct = ch === expected;
    const index = this.pos;
    this.keystrokes++;
    if(correct) this.correctKeystrokes++; else this.errorEvents++;
    this.pos++;
    this.dispatchEvent(new CustomEvent('keystroke', { detail:{ index, correct, char:ch } }));
    if(!correct){
      this.dispatchEvent(new CustomEvent('error', { detail:{ index, expected, actual:ch } }));
    }
    if(expected === ' ' || this.pos >= this.text.length){
      this.wordsCompleted++;
      this.dispatchEvent(new CustomEvent('wordComplete', { detail:{ charIndex:index } }));
      this._maybeCheckpoint();
    }
    if(this.pos >= this.text.length) this._finish();
  }
  backspace(){
    if(this.pos <= 0 || this.finished) return;
    this.pos--;
    this.dispatchEvent(new CustomEvent('backspace', { detail:{ index:this.pos } }));
  }
  skipToNextWord(){
    if(this.finished) return this.pos;
    let next = this.pos;
    while(next < this.text.length && !/\s/.test(this.text[next])) next++;
    while(next < this.text.length && /\s/.test(this.text[next])) next++;
    const previous = this.pos;
    this.pos = next;
    return next - previous;
  }
  _maybeCheckpoint(){
    if(this.wordsCompleted - this.lastCheckpointWords >= this.checkpointInterval){
      const now = performance.now();
      // Time spent paused since the last checkpoint must not drag this segment's speed down.
      const pausedSince = this.pausedDuration - this.lastCheckpointPausedDuration;
      const elapsedMin = Math.max(0, now - this.lastCheckpointTime - pausedSince) / 60000;
      const charsSince = this.pos - this.lastCheckpointChars;
      const wpm = elapsedMin > 0 ? Math.round((charsSince/5)/elapsedMin) : 0;
      this.lastCheckpointWords = this.wordsCompleted;
      this.lastCheckpointTime = now;
      this.lastCheckpointChars = this.pos;
      this.lastCheckpointPausedDuration = this.pausedDuration;
      this.dispatchEvent(new CustomEvent('checkpoint', { detail:{ wpm, charIndex:this.pos-1 } }));
    }
  }
  replaceText(text, pos){
    // Swap the passage mid-run (inline edit). `pos` is how much of it still counts as typed.
    this.text = text;
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    this.checkpointInterval = Math.max(4, Math.ceil(wordCount/4));
    this.pos = Math.max(0, Math.min(pos, text.length));
    this.wordsCompleted = (text.slice(0, this.pos).match(/ /g) || []).length;
    this.lastCheckpointWords = Math.min(this.lastCheckpointWords, this.wordsCompleted);
    this.lastCheckpointChars = Math.min(this.lastCheckpointChars, this.pos);
  }
  _finish(){
    this.finished = true;
    this.endTime = performance.now();
    this.dispatchEvent(new CustomEvent('complete', { detail:this.getStats() }));
  }
  getStats(){
    if(this.startTime === null) return { wpm:0, accuracy:100, elapsedMs:0, keystrokes:0, errors:0 };
    const now = this.finished ? this.endTime : (this.pausedAt !== null ? this.pausedAt : performance.now());
    const elapsedMs = Math.max(0, now - this.startTime - this.pausedDuration);
    const minutes = elapsedMs/60000;
    const wpm = minutes > 0 ? Math.round((this.correctKeystrokes/5)/minutes) : 0;
    const accuracy = this.keystrokes > 0 ? Math.round((this.correctKeystrokes/this.keystrokes)*100) : 100;
    return { wpm, accuracy, elapsedMs, keystrokes:this.keystrokes, errors:this.errorEvents };
  }
}

/* ---------------------------- text view ---------------------------- */
class TextView{
  constructor(container, caretEl){
    this.container = container;
    this.caret = caretEl;
    this.charEls = [];
    this.wordEls = [];
    this.wordRanges = [];
    this.wordIndexForChar = [];
    this.badges = [];
    this.strikes = new Map(); // char index -> { ghost, anim, el } for in-flight stroke animations
    this.markedEls = [];      // chars currently carrying a mark class
    this.maskedEls = [];      // chars currently carrying a mask class
    this.badgeData = [];      // checkpoint badges as data, so an inline edit can redraw them
    this.selEls = [];         // chars inside the edit selection
    this.composingEl = null;  // the char showing the "dead key is down" preview
  }
  build(text, keepScroll){
    this.strikes.forEach(s => { s.anim.onfinish = s.anim.oncancel = null; s.anim.cancel(); });
    this.strikes.clear();
    qsa('.word, .char.space, .char.whitespace, .checkpoint-badge, .strike-ghost', this.container).forEach(n=>n.remove());
    this.badges = [];
    this.badgeData = [];
    this.selEls = [];
    this.markedEls = [];
    this.maskedEls = [];
    this.composingEl = null;
    this.charEls = new Array(text.length);
    this.wordIndexForChar = new Array(text.length).fill(-1);
    this.wordEls = [];
    this.wordRanges = [];
    const frag = document.createDocumentFragment();
    let currentWord = null, wordStart = -1, wIdx = -1;
    for(let i=0;i<text.length;i++){
      const ch = text[i];
      if(ch === ' ' || ch === '\n' || ch === '\t'){
        if(currentWord){ this.wordRanges.push([wordStart, i-1]); currentWord = null; }
        const sp = document.createElement('span');
        sp.className = ch === ' ' ? 'char space' : ch === '\t' ? 'char whitespace tab-char' : 'char whitespace newline-char';
        sp.dataset.idx = String(i);
        if(ch === '\t'){
          sp.textContent = '\t';
          sp.setAttribute('aria-label', 'tab character');
          sp.title = 'Tab character';
        } else if(ch === '\n') {
          sp.textContent = '\n';
          sp.setAttribute('aria-label', 'newline character');
          sp.title = 'Newline character';
        } else {
          sp.textContent = '\u00A0';
        }
        this.charEls[i] = sp;
        frag.appendChild(sp);
        continue;
      }
      if(!currentWord){
        currentWord = document.createElement('span');
        currentWord.className = 'word';
        wIdx++;
        currentWord.dataset.windex = String(wIdx);
        this.wordEls.push(currentWord);
        wordStart = i;
        frag.appendChild(currentWord);
      }
      const cs = document.createElement('span');
      cs.className = 'char';
      cs.dataset.idx = String(i);
      cs.textContent = ch;
      this.charEls[i] = cs;
      this.wordIndexForChar[i] = wIdx;
      currentWord.appendChild(cs);
    }
    if(currentWord) this.wordRanges.push([wordStart, text.length-1]);
    this.container.appendChild(frag);
    // keepScroll: an inline edit rebuilds the text on every keystroke and must not jump back to the top.
    if(keepScroll) this.caret.style.transform = 'translate(0px, 0px)';
    else { this.container.scrollTop = 0; this.moveCaret(0); }
    this.caret.classList.add('idle');
  }
  setCharState(idx, state){
    const el = this.charEls[idx];
    if(!el) return;
    el.classList.remove('correct','incorrect');
    if(state) el.classList.add(state);
  }
  refreshWord(charIdx){
    // Feedback is per-character now (see .char.correct / .char.incorrect) —
    // word-level correctness is still tracked and tagged here as
    // .word-correct / .word-error for anyone who wants to key off it (e.g.
    // style it, or read it in your own code), it's just unstyled by default.
    const wIdx = this.wordIndexForChar[charIdx];
    if(wIdx === undefined || wIdx === -1) return;
    const [s,e] = this.wordRanges[wIdx];
    let hasError = false, allDone = true;
    for(let i=s;i<=e;i++){
      const el = this.charEls[i];
      if(el.classList.contains('incorrect')) hasError = true;
      if(!el.classList.contains('correct') && !el.classList.contains('incorrect')) allDone = false;
    }
    const wordEl = this.wordEls[wIdx];
    wordEl.classList.toggle('word-error', hasError && allDone);
    wordEl.classList.toggle('word-correct', allDone && !hasError);
  }
  moveCaret(pos){
    let left, top;
    if(pos < this.charEls.length && this.charEls[pos]){
      const el = this.charEls[pos];
      left = el.offsetLeft; top = el.offsetTop;
    } else if(this.charEls.length){
      const el = this.charEls[this.charEls.length-1];
      left = el.offsetLeft + el.offsetWidth; top = el.offsetTop;
    } else { left = 0; top = 0; }
    this.caret.style.transform = `translate(${left}px, ${top}px)`;
    // Pass the real character position in — the caret element itself moves
    // via CSS transform, never via top/left, so reading it back off the
    // caret's own offsetTop (as an earlier version did) always reports 0:
    // transforms don't affect offsetTop. That was the "jumps to the top on
    // every keystroke" bug — once scrolled down at all, 0 always looked like
    // it was above the fold.
    this.scrollCaretIntoView(top);
  }
  scrollCaretIntoView(caretTop){
    // Biased toward what's still ahead: stays put while the current line
    // still fits in the box (no premature scrolling), but as soon as the
    // caret would run past an edge, it pins the current line near the TOP
    // of the box instead of centering it — keeping only ~1 finished line
    // for continuity and handing the rest of the limited space to upcoming
    // lines, since those matter far more than ones already typed.
    const el = this.container;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || (this.caret.offsetHeight * 1.3) || 24;
    const caretBottom = caretTop + (this.caret.offsetHeight || lineHeight);
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    const edgeMargin = lineHeight * 0.15;
    const lookBack = lineHeight; // ~1 already-typed line stays visible above the current one, no more
    const smooth = prefersReducedMotion() ? 'auto' : 'smooth';
    if(caretBottom > viewBottom - edgeMargin || caretTop < viewTop + edgeMargin){
      el.scrollTo({ top: Math.max(0, caretTop - lookBack), behavior: smooth });
    }
  }
  addCheckpoint(data, silent){
    const { charIndex, wpm, label, good } = data;
    const wIdx = this.wordIndexForChar[charIndex];
    const anchor = (wIdx !== undefined && wIdx !== -1) ? this.wordEls[wIdx] : this.charEls[charIndex];
    if(!anchor) return;
    this.badgeData.push({ charIndex, wpm, label, good });
    const badge = document.createElement('div');
    badge.className = 'checkpoint-badge' + (good ? ' good' : '');
    badge.style.left = anchor.offsetLeft + 'px';
    badge.style.top = (anchor.offsetTop - 24) + 'px';
    const starSpan = good ? '<span class="cb-star">★ </span>' : '';
    const labelSpan = label ? `<span class="cb-label">${label}</span>` : '';
    badge.innerHTML = `${starSpan}${wpm}<small>wpm</small> ${labelSpan}`;
    this.container.appendChild(badge);
    this.badges.push(badge);
    if(!silent && !prefersReducedMotion()){
      badge.animate(
        [{ opacity:0, transform:'translateY(6px)' }, { opacity:1, transform:'translateY(0)' }],
        { duration:260, easing:'cubic-bezier(.2,.8,.2,1)' }
      );
    }
  }
  snapshot(upto){
    // What the first `upto` characters looked like (green / red) plus the checkpoint badges: an inline
    // edit rebuilds the spans from scratch and puts this back for whatever part of it is still valid.
    const states = [];
    for(let i = 0; i < upto; i++){
      const el = this.charEls[i];
      states.push(!el ? null : el.classList.contains('correct') ? 'correct' : el.classList.contains('incorrect') ? 'incorrect' : null);
    }
    return { states, badges: this.badgeData.filter(b => b.charIndex < upto).map(b => ({ ...b })) };
  }
  restore(snap, keep){
    const n = Math.min(keep, snap.states.length, this.charEls.length);
    for(let i = 0; i < n; i++){ if(snap.states[i]) this.charEls[i].classList.add(snap.states[i]); }
    for(let i = 0; i < n; i++) this.refreshWord(i);
    snap.badges.filter(b => b.charIndex < n).forEach(b => this.addCheckpoint(b, true));
  }
  setSelection(s, e){
    this.selEls.forEach(el => el.classList.remove('sel'));
    this.selEls = [];
    for(let i = s; i < e; i++){
      const el = this.charEls[i];
      if(el){ el.classList.add('sel'); this.selEls.push(el); }
    }
  }
  setMarks(ranges, live){
    // ranges: saved marks as [start, end) pairs; live: the mark currently being captured.
    // Overlaps are merged first so a word inside a marked sentence doesn't grow rounded caps mid-band.
    this.markedEls.forEach(el => el.classList.remove('mk', 'mk-s', 'mk-e', 'mk-live'));
    this.markedEls = [];
    const paint = (list, cls) => list.forEach(([s, e]) => {
      for(let i = s; i < e; i++){
        const el = this.charEls[i];
        if(!el) continue;
        el.classList.add(cls);
        if(i === s) el.classList.add('mk-s');
        if(i === e - 1) el.classList.add('mk-e');
        this.markedEls.push(el);
      }
    });
    paint(mergeRanges(ranges), 'mk');
    if(live) paint(mergeRanges([live]), 'mk-live');
  }
  setMasks(active, soon, live, hinted){
    // active: masks hidden behind tape this run. soon: masks made this run (already typed): dotted underline.
    // live: the mask span currently being captured. hinted: masked indexes showing a faint hint.
    this.maskedEls.forEach(el => el.classList.remove('masked', 'ms-s', 'ms-e', 'soon', 'soon-live', 'hint'));
    this.maskedEls = [];
    const paint = (list, cls, caps) => list.forEach(([s, e]) => {
      for(let i = s; i < e; i++){
        const el = this.charEls[i];
        if(!el) continue;
        el.classList.add(cls);
        if(caps){
          if(i === s) el.classList.add('ms-s');
          if(i === e - 1) el.classList.add('ms-e');
        }
        this.maskedEls.push(el);
      }
    });
    paint(mergeRanges(active), 'masked', true);
    paint(mergeRanges(soon), 'soon', false);
    if(live) paint(mergeRanges([live]), 'soon-live', false);
    if(hinted) hinted.forEach(i => { const el = this.charEls[i]; if(el && el.classList.contains('masked')) el.classList.add('hint'); });
  }
  setComposing(idx, on){
    if(this.composingEl){ this.composingEl.classList.remove('composing'); this.composingEl = null; }
    if(on){
      const el = this.charEls[idx];
      if(el){ el.classList.add('composing'); this.composingEl = el; }
    }
  }
  strike(idx, correct, typedChar){
    // The "stamp": a big, blurred copy of the glyph falls onto its slot — scale
    // 2.6 -> 1 with a tiny squash on impact — while its drop-shadow tightens from
    // far/soft to nothing. It's an overlay ghost (not a transform on the real
    // character) because inline text can't be transformed, and because the real
    // layout, caret math and scroll logic must stay untouched.
    if(prefersReducedMotion() || typeof this.container.animate !== 'function') return;
    const el = this.charEls[idx];
    if(!el || el.classList.contains('space')) return;
    if(!correct && el.classList.contains('masked')) return; // don't leak the answer
    this.cancelStrike(idx);
    const c = this.container;
    const cr = c.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const ghost = document.createElement('span');
    ghost.className = 'strike-ghost ' + (correct ? 'correct' : 'incorrect');
    ghost.textContent = typedChar === '\t' ? '⇥' : typedChar === '\n' ? '↵' : typedChar;
    ghost.style.left = (r.left - cr.left + c.scrollLeft) + 'px';
    ghost.style.top = (r.top - cr.top + c.scrollTop) + 'px';
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    ghost.style.lineHeight = r.height + 'px';
    c.appendChild(ghost);
    el.classList.add('landing'); // hide the real glyph until the ghost has landed on it
    const sh = (getComputedStyle(c).getPropertyValue('--strike-shadow') || '').trim() || 'rgba(0,0,0,.35)';
    const tilt = correct ? 0 : -12; // a miss lands crooked
    const anim = ghost.animate([
      { offset:0,   opacity:0, filter:'blur(3px)',   transform:`translateY(-.2em) scale(2.6) rotate(${tilt}deg)`, textShadow:`0 .6em .75em ${sh}`, easing:'cubic-bezier(.45,0,.9,.55)' },
      { offset:.3,  opacity:1 },
      { offset:.62, filter:'blur(0px)',   transform:'translateY(0) scale(1.06) rotate(0deg)',    textShadow:`0 .12em .2em ${sh}`,  easing:'ease-out' },
      { offset:.8,                        transform:'translateY(.03em) scale(.95) rotate(0deg)', textShadow:`0 .03em .05em ${sh}`, easing:'ease-out' },
      { offset:1,   opacity:1, filter:'blur(0px)', transform:'translateY(0) scale(1) rotate(0deg)',   textShadow:'0 0 0 transparent' }
    ], { duration:250, fill:'both' });
    const entry = { ghost, anim, el };
    this.strikes.set(idx, entry);
    const done = () => {
      if(this.strikes.get(idx) !== entry) return; // a newer strike on this char owns it now
      this.strikes.delete(idx);
      ghost.remove();
      el.classList.remove('landing');
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }
  cancelStrike(idx){
    const s = this.strikes.get(idx);
    if(!s) return;
    this.strikes.delete(idx);
    s.anim.onfinish = s.anim.oncancel = null;
    s.anim.cancel();
    s.ghost.remove();
    s.el.classList.remove('landing');
  }
  reveal(){
    // Words rise in with a short stagger when typing starts.
    // capped so even a long lesson is fully visible within about half a second.
    if(prefersReducedMotion() || typeof this.container.animate !== 'function') return;
    this.wordEls.forEach((w, i) => {
      w.animate(
        [{ opacity:0, transform:'translateY(.45em)' }, { opacity:1, transform:'translateY(0)' }],
        { duration:380, delay:Math.min(i*16, 480), easing:'cubic-bezier(.2,.8,.2,1)', fill:'backwards' }
      );
    });
  }
  popWord(charIdx){
    const wIdx = this.wordIndexForChar[charIdx];
    if(wIdx === undefined || wIdx === -1 || prefersReducedMotion()) return;
    const el = this.wordEls[wIdx];
    el.animate([{ transform:'scale(1)' }, { transform:'scale(1.04)' }, { transform:'scale(1)' }], { duration:180, easing:'ease-out' });
  }
  shake(){
    if(prefersReducedMotion()) return;
    this.container.animate(
      [{ transform:'translateX(0)' }, { transform:'translateX(-3px)' }, { transform:'translateX(3px)' }, { transform:'translateX(0)' }],
      { duration:160, easing:'ease-in-out' }
    );
  }
}

/* ---------------------------- keyboard layout + view ---------------------------- */
const KEY_ROWS = [
  [
    {k:'`', s:'~', finger:'pinky', hand:'left'},
    {k:'1', s:'!', finger:'pinky', hand:'left'},
    {k:'2', s:'@', finger:'ring', hand:'left'},
    {k:'3', s:'#', finger:'middle', hand:'left'},
    {k:'4', s:'$', finger:'index', hand:'left'},
    {k:'5', s:'%', finger:'index', hand:'left'},
    {k:'6', s:'^', finger:'index', hand:'right'},
    {k:'7', s:'&', finger:'index', hand:'right'},
    {k:'8', s:'*', finger:'middle', hand:'right'},
    {k:'9', s:'(', finger:'ring', hand:'right'},
    {k:'0', s:')', finger:'pinky', hand:'right'},
    {k:'-', s:'_', finger:'pinky', hand:'right'},
    {k:'=', s:'+', finger:'pinky', hand:'right'},
    {k:'Backspace', finger:'pinky', hand:'right', action:true, w:1.6, label:'⌫'}
  ],
  [
    {k:'Tab', finger:'pinky', hand:'left', action:true, w:1.4, label:'tab'},
    {k:'q', finger:'pinky', hand:'left'},
    {k:'w', finger:'ring', hand:'left'},
    {k:'e', finger:'middle', hand:'left'},
    {k:'r', finger:'index', hand:'left'},
    {k:'t', finger:'index', hand:'left'},
    {k:'y', finger:'index', hand:'right'},
    {k:'u', finger:'index', hand:'right'},
    {k:'i', finger:'middle', hand:'right'},
    {k:'o', finger:'ring', hand:'right'},
    {k:'p', finger:'pinky', hand:'right'},
    {k:'[', s:'{', finger:'pinky', hand:'right'},
    {k:']', s:'}', finger:'pinky', hand:'right'},
    {k:'\\', s:'|', finger:'pinky', hand:'right', w:1.2}
  ],
  [
    {k:'CapsLock', finger:'pinky', hand:'left', action:true, w:1.7, label:'caps'},
    {k:'a', finger:'pinky', hand:'left'},
    {k:'s', finger:'ring', hand:'left'},
    {k:'d', finger:'middle', hand:'left'},
    {k:'f', finger:'index', hand:'left'},
    {k:'g', finger:'index', hand:'left'},
    {k:'h', finger:'index', hand:'right'},
    {k:'j', finger:'index', hand:'right'},
    {k:'k', finger:'middle', hand:'right'},
    {k:'l', finger:'ring', hand:'right'},
    {k:';', s:':', finger:'pinky', hand:'right'},
    {k:"'", s:'"', finger:'pinky', hand:'right'},
    {k:'Enter', finger:'pinky', hand:'right', action:true, w:1.9, label:'enter'}
  ],
  [
    {k:'ShiftLeft', finger:'pinky', hand:'left', action:true, w:2.2, label:'shift'},
    {k:'z', finger:'pinky', hand:'left'},
    {k:'x', finger:'ring', hand:'left'},
    {k:'c', finger:'middle', hand:'left'},
    {k:'v', finger:'index', hand:'left'},
    {k:'b', finger:'index', hand:'left'},
    {k:'n', finger:'index', hand:'right'},
    {k:'m', finger:'index', hand:'right'},
    {k:',', s:'<', finger:'middle', hand:'right'},
    {k:'.', s:'>', finger:'ring', hand:'right'},
    {k:'/', s:'?', finger:'pinky', hand:'right'},
    {k:'ShiftRight', finger:'pinky', hand:'right', action:true, w:2.4, label:'shift'}
  ],
  [
    {k:'ControlLeft', finger:'thumb', hand:'left', action:true, w:1.3, label:'ctrl'},
    {k:'AltLeft', finger:'thumb', hand:'left', action:true, w:1.1, label:'alt'},
    {k:' ', finger:'thumb', hand:'both', w:6.4, label:''},
    {k:'AltRight', finger:'thumb', hand:'right', action:true, w:1.1, label:'alt'},
    {k:'ControlRight', finger:'thumb', hand:'right', action:true, w:1.3, label:'ctrl'}
  ]
];

// Combining marks -> the US-International dead key that produces them (a hint, not a requirement).
const DEAD_KEYS = { '\u0301':"'", '\u0300':'`', '\u0308':'"', '\u0303':'~', '\u0302':'^' };

class KeyboardView{
  constructor(container){
    this.container = container;
    this.baseMap = {};
    this.shiftMap = {};
    this.spaceEl = null;
    this.leftShiftEl = null;
    this.rightShiftEl = null;
    this.nextEl = null;
    this.nextShiftEl = null;
    this._build();
  }
  _build(){
    this.container.innerHTML = '';
    KEY_ROWS.forEach(row=>{
      const rowEl = document.createElement('div');
      rowEl.className = 'krow';
      row.forEach(def=>{
        const keyEl = document.createElement('div');
        keyEl.className = 'key' + (def.action ? ' action' : '');
        keyEl.style.flexGrow = String(def.w || 1);
        keyEl.dataset.finger = def.finger;
        keyEl.dataset.hand = def.hand || '';
        keyEl.textContent = def.label !== undefined ? def.label : def.k.toUpperCase();
        if(def.k === ' '){ keyEl.textContent = ''; this.spaceEl = keyEl; }
        if(def.label === 'shift' && def.hand === 'left') this.leftShiftEl = keyEl;
        if(def.label === 'shift' && def.hand === 'right') this.rightShiftEl = keyEl;
        if(!def.action){
          this.baseMap[def.k] = keyEl;
          if(def.s) this.shiftMap[def.s] = keyEl;
        }
        rowEl.appendChild(keyEl);
      });
      this.container.appendChild(rowEl);
    });
  }
  resolve(ch, stage){
    if(ch === ' ') return { el:this.spaceEl, shift:false };
    if(!ch) return null;
    if(this.baseMap[ch]) return { el:this.baseMap[ch], shift:false };
    const lower = ch.toLowerCase();
    if(lower !== ch && this.baseMap[lower]) return { el:this.baseMap[lower], shift:true };
    if(this.shiftMap[ch]) return { el:this.shiftMap[ch], shift:true };
    // Accented letters (á ñ ü …): point at the dead key first (US-International style), then the
    // base letter. stage === 'base' means the dead key is already down.
    const nfd = ch.normalize ? ch.normalize('NFD') : ch;
    if(nfd.length > 1 && nfd !== ch){
      const base = nfd[0], dead = DEAD_KEYS[nfd.slice(1)];
      if(stage === 'base' || !dead) return this.resolve(base);
      return this.resolve(dead);
    }
    return null;
  }
  highlightNext(ch, stage){
    this.clearNext();
    const r = this.resolve(ch, stage);
    if(!r || !r.el) return;
    r.el.classList.add('next');
    this.nextEl = r.el;
    if(r.shift){
      const shiftEl = r.el.dataset.hand === 'left' ? this.rightShiftEl : this.leftShiftEl;
      if(shiftEl){ shiftEl.classList.add('next-shift'); this.nextShiftEl = shiftEl; }
    }
  }
  clearNext(){
    if(this.nextEl) this.nextEl.classList.remove('next');
    if(this.nextShiftEl) this.nextShiftEl.classList.remove('next-shift');
    this.nextEl = null; this.nextShiftEl = null;
  }
  flashPressed(ch, correct){
    const r = this.resolve(ch, 'base');
    if(!r || !r.el) return;
    const el = r.el;
    el.classList.add('pressed');
    if(!correct) el.classList.add('error-press');
    setTimeout(()=>{ el.classList.remove('pressed','error-press'); }, 110);
  }
}

/* ---------------------------- stats view ---------------------------- */
class StatsView{
  constructor(els){ this.els = els; this.lastWpm = 0; }
  reset(){
    this.els.wpm.textContent = '0';
    this.els.acc.textContent = '100%';
    this.els.time.textContent = '0:00';
    this.els.errors.textContent = '0';
    this.els.position.textContent = '0/0';
    this.lastWpm = 0;
  }
  update(stats){
    this.els.wpm.textContent = String(stats.wpm);
    this.els.acc.textContent = stats.accuracy + '%';
    this.els.time.textContent = formatTime(stats.elapsedMs);
    this.els.errors.textContent = String(stats.errors);
    if(stats.wpm > this.lastWpm && !prefersReducedMotion()){
      this.els.wpm.animate([{transform:'scale(1)'},{transform:'scale(1.16)'},{transform:'scale(1)'}], {duration:220, easing:'ease-out'});
    }
    this.lastWpm = stats.wpm;
  }
  updatePosition(pos, length){ this.els.position.textContent = `${pos}/${length}`; }
}

/* ---------------------------- confetti ---------------------------- */
function spawnConfetti(container){
  if(prefersReducedMotion()) return;
  const colors = ['var(--brass)','var(--moss)','var(--ribbon)','var(--pinky)','var(--ring)'];
  for(let i=0;i<26;i++){
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = (50 + (Math.random()*46-23)) + '%';
    p.style.background = colors[i % colors.length];
    container.appendChild(p);
    const dx = Math.random()*160-80;
    const rot = Math.random()*720-360;
    const dur = 850 + Math.random()*450;
    const anim = p.animate(
      [{ transform:'translate(0,0) rotate(0deg)', opacity:1 },
       { transform:`translate(${dx}px, 240px) rotate(${rot}deg)`, opacity:0 }],
      { duration:dur, easing:'cubic-bezier(.2,.6,.4,1)' }
    );
    anim.onfinish = () => p.remove();
  }
}

/* =========================================================================
   APP CONTROLLER
   ========================================================================= */
const App = {
  bus: new EventTarget(), // stable, app-level event bus for external hooks (see PUBLIC API)
  sound: new SoundEngine(),
  engine: null,
  textView: null,
  keyboardView: null,
  statsView: null,
  customLessons: [],
  staticPackCourses: [], // courses fetched from ./lessons/*.json — see fetchStaticPacks()
  state: 'idle', // idle | ready | running | paused | finished
  pauseReason: null, // 'command' | 'edit' | 'blur' | 'window' | 'hidden' | 'idle'
  commandMode: false,
  pendingCommand: '',
  commandTimer: null,
  lastKeyAt: 0,      // performance.now() of the last keystroke, for the idle watchdog
  shadowValue: '',   // what the hidden input should currently contain
  marks: [],         // saved annotations: { id, kind:'mark'|'mask', lessonId, lessonTitle, course, text, start, end, createdAt, attempts?, clean? }
  deletedLessons: new Set(),
  markRanges: [],    // the current lesson's marks, resolved to { id, s, e }
  maskRanges: [],    // masks that are ACTIVE this run (hidden behind tape)
  soonRanges: [],    // masks created during this run: already typed, they take effect next run
  maskSet: new Set(),   // character indexes currently hidden behind tape
  freshMasks: new Set(),// ids of masks created during this run
  maskSlips: new Set(), // masked character indexes you got wrong (or needed a hint for) this run
  maskMiss: new Map(),  // masked index -> wrong guesses so far
  hinted: new Set(),    // masked indexes showing a faint hint
  masksOn: true,        // pref: actually hide masked passages
  captures: { mark:null, mask:null }, // one open span per shortcut family: { start }. Both can be open at once.
  pillTimers: { mark:null, mask:null, edit:null },
  editing: false,    // template editing mode is active
  editStart: null,   // what the run looked like when the edit began: { text, pos, typed, wasState, states, badges }
  overrides: {},     // visitor's edits to built-in / static-pack lessons: lessonId -> text
  templateUndo: [],
  templateRedo: [],
  editRenderFrame: null,
  positions: {},     // unfinished cursor positions: lessonId -> { position, text }
  sessionLessonVisits: new Set(),
  lessonIntro: false,
  _editShown: '',    // the text currently drawn while editing
  _vx: null,         // remembered column for repeated Up / Down
  _lines: null,      // cached visible line geometry while editing
  _drag: null,       // mouse selection in progress
  composing: false,  // a dead key / IME composition is open in the typing field
  escapeCommands: true, // when enabled, Escape enters command mode and handles app Escape actions
  currentLesson: null,
  currentCourseTitle: '',
  timerHandle: null,
  dom: {},

  async init(){
    this.customLessons = Storage.loadLessons();
    const prefs = Storage.loadPrefs();
    this.marks = Storage.loadMarks();
    this.deletedLessons = new Set(Storage.loadDeletedLessons());
    this.overrides = Storage.loadOverrides();
    this.positions = Storage.loadPositions();
    try{
      const visits = JSON.parse(sessionStorage.getItem(SESSION_VISITS_KEY) || '[]');
      if(Array.isArray(visits)) this.sessionLessonVisits = new Set(visits);
    }catch(e){ /* sessionStorage may be unavailable in private or embedded contexts */ }
    this.masksOn = prefs.masksOn !== false;
    this.escapeCommands = prefs.escapeCommands !== false;

    this.dom = {
      menuBtn: qs('#menuBtn'), drawer: qs('#drawer'), drawerScrim: qs('#drawerScrim'), drawerCloseBtn: qs('#drawerCloseBtn'),
      courseList: qs('#courseList'), newLessonBtn: qs('#newLessonBtn'),
      lessonTitle: qs('#lessonTitle'), courseTag: qs('#courseTag'), lessonGoal: qs('#lessonGoal'),
      escapeSwitch: qs('#escapeSwitch'),
      soundBtn: qs('#soundBtn'), themeBtn: qs('#themeBtn'),
      restartBtn: qs('#restartBtn'), typeBtn: qs('#typeBtn'),
      textDisplay: qs('#textDisplay'), caret: qs('#caret'), startCue: qs('#startCue'), startCueText: qs('#startCueText'),
      progressFill: qs('#progressFill'), captureInput: qs('#captureInput'),
      textShell: qs('#textShell'), readyPill: qs('#readyPill'), startCueSub: qs('#startCueSub'),
      markPill: qs('#markPill'), marksScrim: qs('#marksScrim'), marksCloseBtn: qs('#marksCloseBtn'),
      maskPill: qs('#maskPill'), maskToggleBtn: qs('#maskToggleBtn'),
      marksList: qs('#marksList'), marksCopyBtn: qs('#marksCopyBtn'), marksPracticeBtn: qs('#marksPracticeBtn'),
      marksOpenBtn: qs('#marksOpenBtn'), marksCount: qs('#marksCount'),
      editPill: qs('#editPill'),
      statWpm: qs('#statWpm'), statAcc: qs('#statAcc'), statTime: qs('#statTime'), statErrors: qs('#statErrors'), statPosition: qs('#statPosition'),
      keyboardToggleBtn: qs('#keyboardToggleBtn'), keyboardPanel: qs('#keyboardPanel'), keyboard: qs('#keyboard'),
      modalScrim: qs('#modalScrim'), modalCloseBtn: qs('#modalCloseBtn'), lessonForm: qs('#lessonForm'),
      lfTitle: qs('#lfTitle'), lfCourse: qs('#lfCourse'), lfText: qs('#lfText'), lfWpm: qs('#lfWpm'), lfAcc: qs('#lfAcc'), lfCancel: qs('#lfCancel'),
      courseNames: qs('#courseNames'),
      completeOverlay: qs('#completeOverlay'), completeLessonTitle: qs('#completeLessonTitle'),
      completeWpm: qs('#completeWpm'), completeAcc: qs('#completeAcc'), completeTime: qs('#completeTime'),
      objectivesList: qs('#objectivesList'), retryBtn: qs('#retryBtn'), nextLessonBtn: qs('#nextLessonBtn'), closeCompleteBtn: qs('#closeCompleteBtn'),
      confettiLayer: qs('#confettiLayer'),
      exportLessonsBtn: qs('#exportLessonsBtn'), importLessonsBtn: qs('#importLessonsBtn'), importFileInput: qs('#importFileInput')
    };

    this.textView = new TextView(this.dom.textDisplay, this.dom.caret);
    this.keyboardView = new KeyboardView(this.dom.keyboard);
    this.statsView = new StatsView({ wpm:this.dom.statWpm, acc:this.dom.statAcc, time:this.dom.statTime, errors:this.dom.statErrors, position:this.dom.statPosition });

    // theme
    if(prefs.theme === 'light' || prefs.theme === 'dark') this.setTheme(prefs.theme, false);
    // sound
    if(prefs.sound === false) this.sound.enabled = false;
    this.dom.soundBtn.classList.toggle('is-muted', !this.sound.enabled);
    // keyboard visibility
    if(prefs.keyboardHidden){ this.dom.keyboardPanel.style.display = 'none'; this.dom.keyboardToggleBtn.textContent = 'Show keyboard'; }

    this.wireEvents();
    this.updateMaskToggleBtn();
    this.updateMarksCount();
    this.updateEscapeSwitch();

    // Load the manifest before rendering or selecting the first lesson. The
    // default lesson may live in a static pack, and rendering first would
    // leave Firefox showing the built-in courses if the network is a little
    // slower than the old startup timeout.
    await this.fetchStaticPacks();
    this.renderSidebar();

    const defaultPackLesson = this.findLesson(DEFAULT_LESSON_ID);
    const startId = prefs.lastLessonId;
    const startLesson = startId ? this.findLesson(startId) : null;
    const firstAvailable = this.getAllCourses()
      .flatMap(course => course.lessons.map(lesson => ({ lesson, courseTitle:course.title })))[0];
    const toLoad = defaultPackLesson || startLesson || firstAvailable;
    if(toLoad) this.loadLesson(toLoad.lesson, toLoad.courseTitle);
  },

  /* ----- static lesson packs (git-managed, same-origin JSON under ./lessons/) -----
     These are YOUR curated content: commit JSON files under lessons/, list their
     filenames in lessons/index.json, push, and every visitor sees them on next
     load — no code changes needed. If the fetch fails (no lessons/ folder deployed,
     or the page is opened as a local file:// instead of served over http), the app
     just falls back to the built-in DEFAULT_COURSES above; nothing breaks. */
  async fetchStaticPacks(){
    try{
      const manifestUrl = new URL('lessons/index.json', document.baseURI);
      const res = await fetch(manifestUrl, { cache:'no-store' });
      if(!res.ok) throw new Error(`manifest request failed (${res.status})`);
      const files = await res.json();
      if(!Array.isArray(files)) throw new Error('manifest is not an array');
      const packs = await Promise.all(files.map(async (name) => {
        try{
          const packUrl = new URL(`lessons/${encodeURIComponent(name)}`, document.baseURI);
          const r = await fetch(packUrl, { cache:'no-store' });
          if(!r.ok) return null;
          const pack = await r.json();
          if(!pack || typeof pack !== 'object' || !Array.isArray(pack.lessons)) return null;
          return pack;
        }catch(e){ return null; }
      }));
      this.staticPackCourses = packs.filter(Boolean).map(p => ({
        title: p.course || 'More Lessons',
        lessons: p.lessons
          .filter(l => l && typeof l === 'object' && l.text && l.title)
          .map(l => ({
            ...l,
            id: l.id || uid('pack'),
            course: l.course || p.course || 'More Lessons'
          }))
      }));
    }catch(e){
      this.staticPackCourses = [];
      console.info('TypeStudio: no static lesson packs loaded —', e.message);
    }
  },

  /* ----- data access ----- */
  withOverride(l){
    // Built-in and static-pack lessons are never mutated. A visitor's inline edit is stored as an
    // override by lesson id (same id => marks and best scores stay attached) and applied here.
    if(l.custom) return l;
    const ov = this.overrides[l.id];
    return ov === undefined ? l : { ...l, text: ov, edited: true, originalText: l.text };
  },
  getAllCourses(){
    const map = new Map();
    DEFAULT_COURSES.forEach(c => map.set(c.title.toLowerCase(), { title:c.title, lessons:[...c.lessons] }));
    this.staticPackCourses.forEach(c => {
      const key = c.title.toLowerCase();
      if(!map.has(key)) map.set(key, { title:c.title, lessons:[] });
      map.get(key).lessons.push(...c.lessons);
    });
    this.customLessons.forEach(l => {
      const title = l.course || 'My Lessons';
      const key = title.toLowerCase();
      if(!map.has(key)) map.set(key, { title, lessons:[] });
      map.get(key).lessons.push(l);
    });
    return Array.from(map.values())
      .map(c => ({ title: c.title, lessons: c.lessons.filter(l => !this.deletedLessons.has(l.id)).map(l => this.withOverride(l)) }))
      .filter(c => c.lessons.length);
  },
  findLesson(id){
    for(const course of this.getAllCourses()){
      const lesson = course.lessons.find(l => l.id === id);
      if(lesson) return { lesson, courseTitle:course.title };
    }
    return null;
  },

  /* ----- sidebar ----- */
  renderSidebar(){
    const courses = this.getAllCourses();
    const stats = Storage.loadStats();
    this.dom.courseList.innerHTML = '';
    this.dom.courseNames.innerHTML = '';
    const seenCourseNames = new Set();
    courses.forEach(course => {
      if(!seenCourseNames.has(course.title)){
        seenCourseNames.add(course.title);
        const opt = document.createElement('option');
        opt.value = course.title;
        this.dom.courseNames.appendChild(opt);
      }
      const group = document.createElement('div');
      group.className = 'course-group';
      const h3 = document.createElement('h3');
      h3.textContent = course.title;
      group.appendChild(h3);
      const ul = document.createElement('ul');
      course.lessons.forEach(lesson => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'lesson-item';
        btn.dataset.id = lesson.id;
        if(this.currentLesson && this.currentLesson.id === lesson.id) btn.classList.add('active');
        const titleSpan = document.createElement('span');
        titleSpan.className = 'lt-title';
        titleSpan.textContent = lesson.title;
        btn.appendChild(titleSpan);
        const best = stats[lesson.id];
        if(best && best.bestWpm){
          const meta = document.createElement('span');
          meta.className = 'lesson-meta';
          meta.textContent = `★ ${best.bestWpm}`;
          btn.appendChild(meta);
        }
        const del = document.createElement('span');
        del.className = 'lesson-delete';
        del.dataset.deleteId = lesson.id;
        del.title = 'Delete this lesson';
        del.innerHTML = '<svg viewBox="0 0 20 20"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>';
        btn.appendChild(del);
        if(lesson.edited){
          const rs = document.createElement('span');
          rs.className = 'lesson-restore';
          rs.dataset.restoreId = lesson.id;
          rs.title = 'Restore the original text';
          rs.innerHTML = '<svg viewBox="0 0 20 20"><path d="M4.5 10a5.5 5.5 0 1 1 1.7 3.97"/><path d="M4.5 16v-3.6h3.6"/></svg>';
          btn.appendChild(rs);
        }
        li.appendChild(btn);
        ul.appendChild(li);
      });
      group.appendChild(ul);
      this.dom.courseList.appendChild(group);
    });
  },

  /* ----- lesson lifecycle ----- */
  loadLesson(lesson, courseTitle, opts = {}){
    if(this.editing) this.endInlineEdit(true); // switching lessons keeps what you edited
    this.currentLesson = lesson;
    this.lessonIntro = !this.sessionLessonVisits.has(lesson.id);
    if(this.lessonIntro){
      this.sessionLessonVisits.add(lesson.id);
      try{ sessionStorage.setItem(SESSION_VISITS_KEY, JSON.stringify([...this.sessionLessonVisits])); }catch(e){ /* continue without session persistence */ }
    }
    this.commandMode = false;
    this.clearCommandBuffer();
    this.templateUndo = [];
    this.templateRedo = [];
    this.currentCourseTitle = courseTitle || lesson.course || '';
    this.engine = new TypingEngine(lesson);
    this.engine.addEventListener('start', () => this.onStart());
    this.engine.addEventListener('keystroke', (e) => this.onKeystroke(e));
    this.engine.addEventListener('backspace', (e) => this.onBackspace(e));
    this.engine.addEventListener('error', (e) => this.onError(e));
    this.engine.addEventListener('wordComplete', (e) => this.onWordComplete(e));
    this.engine.addEventListener('checkpoint', (e) => this.onCheckpoint(e));
    this.engine.addEventListener('complete', (e) => this.onComplete(e));

    const saved = this.positions[lesson.id];
    const savedPosition = saved && saved.text === this.engine.text
      ? clamp(Number(saved.position) || 0, 0, this.engine.text.length)
      : 0;
    this.engine.pos = savedPosition;
    this.engine.wordsCompleted = (this.engine.text.slice(0, savedPosition).match(/ /g) || []).length;
    this.textView.build(this.engine.text);
    for(let i = 0; i < savedPosition; i++) this.textView.setCharState(i, 'correct');
    this.textView.moveCaret(savedPosition);
    this.keyboardView.clearNext();
    this.keyboardView.highlightNext(lesson.text[0]);
    this.statsView.reset();
    this.updateTypingPosition();
    this.state = 'idle';
    this.updateOverlay();
    this.hideCompletion();
    this.dom.lessonTitle.textContent = lesson.title;
    this.dom.courseTag.textContent = this.currentCourseTitle;
    this.dom.lessonGoal.textContent = `Goal: ${lesson.targetWPM} wpm · ${lesson.targetAccuracy}% accuracy`;
    this.dom.progressFill.style.width = '0%';
    this.dom.captureInput.value = this.engine.text.slice(0, savedPosition);
    this.shadowValue = this.dom.captureInput.value;
    this.pauseReason = null;
    this.resetRunState();
    this.applyAnnotations();
    this.hintNext();
    this.updateProgress();
    this.stopTicker();
    this.savePref('lastLessonId', lesson.id);
    this.renderSidebar();
    this.bus.dispatchEvent(new CustomEvent('lessonLoaded', { detail:{ lessonId:lesson.id } }));
    if(!this.lessonIntro && (opts.ready || savedPosition > 0)) this.beginReady(); // resume unfinished lessons without requiring the first key to wake the app
  },

  restart(){
    if(!this.engine) return;
    if(this.editing) this.endInlineEdit(true);
    this.commandMode = false;
    this.clearCommandBuffer();
    this.templateUndo = [];
    this.templateRedo = [];
    this.engine.reset();
    delete this.positions[this.currentLesson.id];
    Storage.savePositions(this.positions);
    this.textView.build(this.engine.text);
    this.keyboardView.clearNext();
    this.statsView.reset();
    this.updateTypingPosition();
    this.state = 'idle';
    this.pauseReason = null;
    this.resetRunState();
    this.applyAnnotations(); // masks made last run are active now
    this.hintNext();
    this.hideCompletion();
    this.dom.progressFill.style.width = '0%';
    this.dom.progressFill.style.background = 'var(--brass)';
    this.dom.captureInput.value = '';
    this.shadowValue = '';
    this.stopTicker();
    this.beginReady(); // a retry skips the veil: you've already seen the text
  },

  /* ----- engine event handlers ----- */
  onStart(){
    this.state = 'running';
    this.pauseReason = null;
    this.lastKeyAt = performance.now();
    this.updateOverlay();
    this.startTicker();
  },
  onKeystroke(e){
    const { index, correct, char } = e.detail;
    this.lastKeyAt = performance.now();
    this.textView.setCharState(index, correct ? 'correct' : 'incorrect');
    this.textView.moveCaret(this.engine.pos);
    this.updateTypingPosition();
    this.textView.strike(index, correct, char);
    this.textView.refreshWord(index);
    this.keyboardView.flashPressed(char, correct);
    this.sound.playKey({ error:!correct, space: char === ' ' });
    this.statsView.update(this.engine.getStats());
    if(!correct && this.maskSet.has(index)){
      // Typing from memory: a slip is remembered (it counts against that passage's recall score),
      // and a second miss on the same letter lets a faint hint show through the tape.
      this.maskSlips.add(index);
      const n = (this.maskMiss.get(index) || 0) + 1;
      this.maskMiss.set(index, n);
      if(n >= 2 && !this.hinted.has(index)){ this.hinted.add(index); this.refreshOverlays(); }
    }
    this.hintNext();
    this.updateProgress();
    if(this.captures.mark || this.captures.mask) this.refreshOverlays();
    this.bus.dispatchEvent(new CustomEvent('keystroke', { detail:e.detail }));
  },
  onBackspace(e){
    const { index } = e.detail;
    this.lastKeyAt = performance.now();
    this.textView.cancelStrike(index);
    this.textView.setCharState(index, null);
    this.textView.moveCaret(this.engine.pos);
    this.updateTypingPosition();
    this.textView.refreshWord(index);
    this.sound.playKey({});
    this.statsView.update(this.engine.getStats());
    this.hintNext();
    this.updateProgress();
    if(this.captures.mark || this.captures.mask) this.refreshOverlays();
  },
  skipWord(){
    if(!this.engine || (this.state !== 'ready' && this.state !== 'running' && !(this.commandMode && this.state === 'paused')) || this.editing) return;
    const moved = this.engine.skipToNextWord();
    if(!moved) return;
    this.dom.captureInput.value = this.engine.text.slice(0, this.engine.pos);
    this.shadowValue = this.dom.captureInput.value;
    this.textView.moveCaret(this.engine.pos);
    this.updateTypingPosition();
    this.updateProgress();
    this.saveCursorPosition();
    this.hintNext();
  },
  previousWord(){
    if(!this.engine || (this.state !== 'ready' && this.state !== 'running' && !(this.commandMode && this.state === 'paused')) || this.editing) return;
    let target = this.engine.pos;
    while(target > 0 && /\s/.test(this.engine.text[target - 1])) target--;
    while(target > 0 && !/\s/.test(this.engine.text[target - 1])) target--;
    if(target === this.engine.pos) return;
    for(let i = target; i < this.engine.pos; i++) this.textView.setCharState(i, null);
    this.engine.pos = target;
    this.dom.captureInput.value = this.engine.text.slice(0, target);
    this.shadowValue = this.dom.captureInput.value;
    this.textView.moveCaret(target);
    this.updateTypingPosition();
    this.updateProgress();
    this.saveCursorPosition();
    this.hintNext();
  },
  recordTemplateUndo(text, pos){
    this.templateUndo.push({ lessonId:this.currentLesson.id, text, pos });
    this.templateRedo = [];
    this.trimTemplateHistory(this.templateUndo);
  },
  trimTemplateHistory(history){
    while(history.length > TEMPLATE_HISTORY_LIMIT || history.reduce((total, entry) => total + entry.text.length, 0) > TEMPLATE_HISTORY_MAX_CHARS){
      history.shift();
    }
  },
  applyTemplateHistoryEntry(entry){
    const snapshot = this.textView.snapshot(this.engine.pos);
    const pos = Math.min(entry.pos, entry.text.length);
    this.persistEdit(entry.text);
    this.engine.replaceText(entry.text, pos);
    this.textView.build(this.engine.text, true);
    this.textView.restore(snapshot, Math.min(pos, snapshot.states.length));
    this.dom.captureInput.value = this.engine.text.slice(0, pos);
    this.shadowValue = this.dom.captureInput.value;
    this.textView.moveCaret(pos);
    this.updateTypingPosition();
    this.updateProgress();
    this.saveCursorPosition();
    this.hintNext();
    this.bus.dispatchEvent(new CustomEvent('lessonEdited', { detail:{ lessonId:this.currentLesson.id } }));
  },
  undoTemplateEdit(){
    const entry = this.templateUndo.pop();
    if(!entry || entry.lessonId !== this.currentLesson.id) return;
    this.templateRedo.push({ lessonId:this.currentLesson.id, text:this.engine.text, pos:this.engine.pos });
    this.trimTemplateHistory(this.templateRedo);
    this.applyTemplateHistoryEntry(entry);
  },
  redoTemplateEdit(){
    const entry = this.templateRedo.pop();
    if(!entry || entry.lessonId !== this.currentLesson.id) return;
    this.templateUndo.push({ lessonId:this.currentLesson.id, text:this.engine.text, pos:this.engine.pos });
    this.trimTemplateHistory(this.templateUndo);
    this.applyTemplateHistoryEntry(entry);
  },
  clearCommandBuffer(){
    this.pendingCommand = '';
    if(this.commandTimer !== null){
      clearTimeout(this.commandTimer);
      this.commandTimer = null;
    }
  },
  queueCommandBuffer(command){
    this.clearCommandBuffer();
    this.pendingCommand = command;
    this.commandTimer = setTimeout(() => {
      this.commandTimer = null;
      if(this.pendingCommand === 'r') this.redoTemplateEdit();
      this.pendingCommand = '';
    }, 800);
  },
  enterCommandMode(){
    if(this.editing || this.commandMode || !this.engine || (this.state !== 'running' && this.state !== 'ready')) return;
    this.commandMode = true;
    this.clearCommandBuffer();
    if(this.state === 'running') this.pauseTyping('command');
    this.updateOverlay();
    this.showPill('edit', 'COMMAND mode · t for typing mode · i to edit');
  },
  leaveCommandMode(){
    if(!this.commandMode) return;
    this.commandMode = false;
    this.clearCommandBuffer();
    this.hidePill('edit');
    if(this.state === 'paused' && this.pauseReason === 'command') this.resumeTyping();
    else this.updateOverlay();
  },
  activateTyping(){
    if(this.commandMode){
      this.leaveCommandMode();
      return;
    }
    if(this.state === 'running' || this.state === 'ready'){
      this.enterCommandMode();
      return;
    }
    this.activate();
  },
  handleCommandKeydown(e){
    if(!this.commandMode) return false;
    if(e.key === 'Escape' && !this.escapeCommands) return false;
    e.preventDefault();
    const key = e.key;
    if(key === 'Escape'){ this.clearCommandBuffer(); return true; }
    if(this.pendingCommand.startsWith(':')){
      if(/^\d$/.test(key)){
        this.pendingCommand += key;
        this.showPill('edit', `Jump to position: ${this.pendingCommand}`);
      } else if(key === 'Enter'){
        const position = Number(this.pendingCommand.slice(1));
        this.clearCommandBuffer();
        this.jumpToPosition(position);
      } else if(key === 'Backspace' && this.pendingCommand.length > 1){
        this.pendingCommand = this.pendingCommand.slice(0, -1);
        this.showPill('edit', `Jump to position: ${this.pendingCommand}`);
      } else {
        this.clearCommandBuffer();
      }
      return true;
    }
    if(key === 'Backspace'){
      this.deletePreviousWord();
      return true;
    }
    if(this.pendingCommand === 'm'){
      const candidate = 'm' + key.toLowerCase();
      if(candidate === 'mw'){
        this.clearCommandBuffer();
        this.markWordAtCaret('mark');
      } else if(key === 't'){
        this.clearCommandBuffer();
        this.toggleCapture('mark');
        this.leaveCommandMode();
      } else {
        this.clearCommandBuffer();
      }
      return true;
    }
    if(this.pendingCommand === 'd'){
      this.clearCommandBuffer();
      if(key === 'w') this.deleteCurrentWord();
      return true;
    }
    const restartCommand = 'restart';
    if(this.pendingCommand){
      const candidate = this.pendingCommand + key.toLowerCase();
      if(restartCommand === candidate){
        this.clearCommandBuffer();
        this.restart();
        return true;
      }
      if(restartCommand.startsWith(candidate)){
        this.queueCommandBuffer(candidate);
        return true;
      }
      if(this.pendingCommand === 'r'){
        this.clearCommandBuffer();
        this.redoTemplateEdit();
        return true;
      } else {
        this.clearCommandBuffer();
      }
    }
    if(key === 't'){ this.leaveCommandMode(); return true; }
    if(key.toLowerCase() === 'r'){
      this.queueCommandBuffer('r');
      return true;
    }
    if(key === 'd'){ this.queueCommandBuffer('d'); return true; }
    if(key === 'n'){ this.skipWord(); return true; }
    if(key === 'b'){ this.previousWord(); return true; }
    if(key === 'u'){ this.undoTemplateEdit(); return true; }
    if(key === 'm'){
      this.clearCommandBuffer();
      this.pendingCommand = 'm';
      this.commandTimer = setTimeout(() => {
        this.commandTimer = null;
        if(this.pendingCommand === 'm') this.toggleCapture('mark');
        this.pendingCommand = '';
      }, 800);
      return true;
    }
    if(key === ':'){
      this.clearCommandBuffer();
      this.pendingCommand = ':';
      this.showPill('edit', 'Jump to position: :');
      return true;
    }
    if(key === 'M'){ this.markWordAtCaret('mask'); return true; }
    if(key === 'i'){
      this.commandMode = false;
      this.clearCommandBuffer();
      this.hidePill('edit');
      this.toggleInlineEdit();
      return true;
    }
    this.pendingCommand = '';
    return true;
  },
  deleteCurrentWord(){
    if(!this.engine || (this.state !== 'ready' && this.state !== 'running' && !(this.commandMode && this.state === 'paused')) || this.editing) return;
    const eng = this.engine;
    const text = eng.text;
    const pos = eng.pos;
    let start = pos;
    while(start < text.length && /\s/.test(text[start])) start++;
    let end = start;
    while(end < text.length && !/\s/.test(text[end])) end++;
    if(start === text.length){
      end = pos;
      start = pos;
      while(start > 0 && /\s/.test(text[start - 1])) start--;
      while(start > 0 && !/\s/.test(text[start - 1])) start--;
    } else if(end < text.length){
      while(end < text.length && /\s/.test(text[end])) end++;
    }
    const newText = normalizeLessonText(text.slice(0, start) + text.slice(end));
    if(!newText || newText === text) return;
    const snapshot = this.textView.snapshot(pos);
    this.recordTemplateUndo(text, pos);
    this.persistEdit(newText);
    this.adjustCapturesForDeletion(start, end);
    eng.replaceText(newText, Math.min(pos, newText.length));
    this.textView.build(eng.text, true);
    this.textView.restore(snapshot, eng.pos);
    this.dom.captureInput.value = eng.text.slice(0, eng.pos);
    this.shadowValue = this.dom.captureInput.value;
    this.textView.moveCaret(eng.pos);
    this.updateTypingPosition();
    this.updateProgress();
    this.saveCursorPosition();
    this.hintNext();
    this.refreshOverlays();
    this.bus.dispatchEvent(new CustomEvent('lessonEdited', { detail:{ lessonId:this.currentLesson.id } }));
  },
  deletePreviousWord(){
    if(!this.engine || (this.state !== 'ready' && this.state !== 'running' && !(this.commandMode && this.state === 'paused')) || this.editing) return;
    const eng = this.engine;
    const text = eng.text;
    const pos = eng.pos;
    let end = pos;
    while(end > 0 && /\s/.test(text[end - 1])) end--;
    let start = end;
    while(start > 0 && !/\s/.test(text[start - 1])) start--;
    if(start === pos) return;
    const newText = normalizeLessonText(text.slice(0, start) + text.slice(pos));
    if(!newText || newText === text) return;
    const snapshot = this.textView.snapshot(pos);
    this.recordTemplateUndo(text, pos);
    this.persistEdit(newText);
    this.adjustCapturesForDeletion(start, pos);
    eng.replaceText(newText, Math.min(start, newText.length));
    this.textView.build(eng.text, true);
    this.textView.restore(snapshot, eng.pos);
    this.dom.captureInput.value = eng.text.slice(0, eng.pos);
    this.shadowValue = this.dom.captureInput.value;
    this.textView.moveCaret(eng.pos);
    this.updateTypingPosition();
    this.updateProgress();
    this.saveCursorPosition();
    this.hintNext();
    this.refreshOverlays();
    this.bus.dispatchEvent(new CustomEvent('lessonEdited', { detail:{ lessonId:this.currentLesson.id } }));
  },
  adjustCapturesForDeletion(start, end){
    const removed = end - start;
    if(removed <= 0) return;
    ['mark', 'mask'].forEach(kind => {
      const capture = this.captures[kind];
      if(!capture) return;
      if(capture.start >= end) capture.start -= removed;
      else if(capture.start > start) capture.start = start;
    });
  },
  updateTypingPosition(){
    if(this.engine) this.statsView.updatePosition(this.engine.pos, this.engine.text.length);
  },
  jumpToPosition(position){
    if(!this.engine || !Number.isInteger(position)) return;
    const target = Math.max(0, Math.min(position, this.engine.text.length));
    const current = this.engine.pos;
    if(target < current){
      for(let i = target; i < current; i++) this.textView.setCharState(i, null);
    }
    this.engine.pos = target;
    this.dom.captureInput.value = this.engine.text.slice(0, target);
    this.shadowValue = this.dom.captureInput.value;
    this.textView.moveCaret(target);
    this.updateTypingPosition();
    this.updateProgress();
    this.saveCursorPosition();
    this.hintNext();
    this.refreshOverlays();
    this.showPill('edit', target === position ? `Position ${target}` : `Position ${position} → ${target}`, 1200);
  },
  onError(e){
    this.textView.shake();
    this.bus.dispatchEvent(new CustomEvent('error', { detail:e.detail }));
  },
  onWordComplete(e){
    this.textView.popWord(e.detail.charIndex);
    this.bus.dispatchEvent(new CustomEvent('wordComplete', { detail:e.detail }));
  },
  onCheckpoint(e){
    const { wpm, charIndex } = e.detail;
    const target = this.currentLesson.targetWPM || 30;
    let label = '', good = false;
    if(wpm >= target*1.2){ label = 'Great!'; good = true; }
    else if(wpm >= target){ label = 'Nice!'; good = true; }
    this.textView.addCheckpoint({ charIndex, wpm, label, good });
    this.bus.dispatchEvent(new CustomEvent('checkpoint', { detail:e.detail }));
  },
  onComplete(e){
    // a span still open at the last character closes there
    if(this.captures.mark) this.commitCapture('mark');
    if(this.captures.mask) this.commitCapture('mask');
    this.state = 'finished';
    delete this.positions[this.currentLesson.id];
    Storage.savePositions(this.positions);
    this.stopTicker();
    this.keyboardView.clearNext();
    this.sound.playComplete();
    this.saveBestStats(e.detail);
    const recall = this.recordRecall();
    this.showCompletion(e.detail);
    if(recall) this.appendRecallLine(recall);
    this.renderSidebar();
    this.bus.dispatchEvent(new CustomEvent('lessonComplete', { detail:{ lessonId:this.currentLesson.id, stats:e.detail, recall } }));
  },

  updateProgress(){
    const pct = clamp(Math.round((this.engine.pos/this.engine.text.length)*100), 0, 100);
    this.dom.progressFill.style.width = pct + '%';
    const acc = this.engine.getStats().accuracy;
    const hue = clamp((acc-70)*4, 0, 130); // 70%acc -> red-ish, 100%acc -> green-ish, feeding the brass baseline otherwise
    if(acc < 90){
      this.dom.progressFill.style.background = `hsl(${hue}, 55%, 45%)`;
    } else {
      this.dom.progressFill.style.background = 'var(--brass)';
    }
  },

  /* ----- overlay / pause / focus ----- */
  updateOverlay(){
    const d = this.dom, s = this.state;
    // First lesson visits and typing pauses show the veil. Editing and Command
    // mode remain visible so the lesson can be worked with.
    const veiled = (s === 'idle' && this.lessonIntro) ||
      (s === 'paused' && this.pauseReason !== 'edit' && this.pauseReason !== 'command');
    d.startCue.classList.toggle('hidden', !veiled);
    d.readyPill.classList.toggle('show', !this.editing && (s === 'ready' || s === 'idle'));
    d.readyPill.textContent = s === 'ready' ? 'Start typing' : 'Type to begin';
    d.caret.classList.toggle('idle', s === 'idle' || s === 'ready' || s === 'paused');
    const typingActive = s === 'running' || s === 'ready';
    d.typeBtn.classList.toggle('is-typing', typingActive);
    d.typeBtn.setAttribute('aria-label', typingActive ? 'Pause and enter Command mode' : 'Type');
    d.typeBtn.title = typingActive ? 'Pause and enter Command mode' : 'Type';
    if(s === 'idle'){
      d.startCueText.textContent = 'Type to reveal the text';
      d.startCueSub.textContent = 'or hit any key';
    } else if(s === 'paused'){
      const lead = {
        hidden: 'You switched tabs',
        window: 'You left the window',
        idle: "You've been idle for a while",
        blur: 'Typing focus was lost',
        command: 'Command mode'
      }[this.pauseReason];
      d.startCueText.textContent = 'Paused';
      d.startCueSub.textContent = this.pauseReason === 'command'
        ? 'Command mode — press t or click to return to typing'
        : lead ? `${lead} — press any key or click to continue` : 'Press any key or click to continue';
    }
  },

  /* ----- typing state machine -----
       idle      text is veiled; nothing can be typed yet
       ready     typing activated: text revealed, waiting for the first key (clock NOT running)
       running   clock running
       paused    clock stopped — by Command mode or automatically (below)
       finished  lesson complete

     Auto-pause fires on: tab hidden (visibilitychange / pagehide), window blur
     (alt-tab, clicking another app, devtools, the parent page of an embed),
     typing-field blur (clicking elsewhere on the page), and an idle watchdog
     (IDLE_PAUSE_MS without a keystroke). Away/idle time is excluded from the
     clock. Resuming is ALWAYS explicit — a click or a key — so coming back to
     the tab never restarts the clock under your hands, and the key that wakes
     it is swallowed rather than typed into text you can't see yet. */
  focusInput(){ this.dom.captureInput.focus({ preventScroll:true }); },
  activate(){
    if(this.editing){ this.focusInput(); return; } // a click while editing places the caret; it never resumes typing
    if(this.commandMode && this.state === 'paused' && this.pauseReason === 'command'){
      this.leaveCommandMode();
      return;
    }
    switch(this.state){
      case 'idle': this.beginReady(); break;
      case 'paused': this.resumeTyping(); break;
      case 'finished': this.restart(); break;
      default: this.focusInput();
    }
  },
  beginReady(){
    if(this.state !== 'idle') return;
    this.state = 'ready';
    this.updateOverlay();
    this.focusInput();
    this.bus.dispatchEvent(new CustomEvent('ready'));
  },
  pauseTyping(reason, at){
    if(this.state === 'paused'){
      // Blur and window-leave events arrive in either order; keep the more specific reason.
      if(this.pauseReason === 'blur' && (reason === 'window' || reason === 'hidden')){
        this.pauseReason = reason;
        this.updateOverlay();
      }
      return;
    }
    if(this.state !== 'running') return;
    this.engine.pause(at);
    this.state = 'paused';
    this.pauseReason = reason;
    this.stopTicker();
    this.statsView.update(this.engine.getStats());
    this.updateOverlay();
    this.bus.dispatchEvent(new CustomEvent('paused', { detail:{ reason } }));
  },
  resumeTyping(){
    if(this.state !== 'paused' || this.editing || this.commandMode) return;
    this.engine.resume();
    this.state = 'running';
    this.pauseReason = null;
    this.lastKeyAt = performance.now(); // fresh start for the idle watchdog
    this.startTicker();
    this.updateOverlay();
    this.focusInput();
    this.bus.dispatchEvent(new CustomEvent('resumed'));
  },
  onGlobalKeydown(e){
    if(e.defaultPrevented || e.isComposing || typeof e.key !== 'string') return;
    const d = this.dom;
    const t = e.target;
    const inField = t !== d.captureInput && t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]');
    if(e.key === 'Escape' && !this.escapeCommands) return;
    if(e.key === 'Escape'){
      if(d.marksScrim.classList.contains('open')){ this.closeMarks(); return; }
      if(d.modalScrim.classList.contains('open')){ this.closeModal(); return; }
      if(d.completeOverlay.classList.contains('open')){ this.hideCompletion(); return; }
      if(d.drawer.classList.contains('open')){ this.closeDrawer(); return; }
    }
    if(this.editing){
      if(e.key === 'Escape'){
        if(t !== d.captureInput && t && t.closest && t.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
        e.preventDefault();
        this.endInlineEdit(true);
        return;
      }
      // focus drifted (a click elsewhere): any plain key brings it back, and lands in the text
      if(t !== d.captureInput && !(t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], button, a'))) this.focusInput();
      return;
    }
    if(this.commandMode && inField){ this.handleCommandKeydown(e); return; }
    if(this.state === 'running'){
      if(e.key === 'Escape'){
        if(t !== d.captureInput && t && t.closest && t.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
        e.preventDefault();
        this.enterCommandMode();
      }
      return;
    }
    if(this.state === 'ready' && e.key === 'Escape'){
      if(t !== d.captureInput && t && t.closest && t.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      this.enterCommandMode();
      return;
    }
    if(this.state === 'finished') return;
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    if(d.modalScrim.classList.contains('open') || d.marksScrim.classList.contains('open') ||
       d.completeOverlay.classList.contains('open') || d.drawer.classList.contains('open')) return;
    if(t !== d.captureInput && t && t.closest){
      if(inField) return;
      if(t.closest('button, a') && (e.key === ' ' || e.key === 'Enter')) return; // focused buttons keep their Space/Enter
    }
    if(!(e.key.length === 1 || e.key === 'Enter' || e.key === 'Dead')) return; // printable keys (and dead keys) only
    if(this.state === 'idle'){
      if(e.key === 'Enter') e.preventDefault();
      this.beginReady();
    }
    else if(this.state === 'paused'){ e.preventDefault(); this.resumeTyping(); }
    else if(this.state === 'ready' && t !== d.captureInput){
      if(e.key === 'Enter') e.preventDefault();
      this.focusInput(); // the key itself falls through into the field
    }
  },
  onBlurInput(){
    this.composing = false;
    this.textView.setComposing(null, false);
    this.pauseTyping('blur');
  },
  startTicker(){
    this.stopTicker();
    this.timerHandle = setInterval(() => {
      if(this.state !== 'running') return;
      // Idle watchdog: walked away without leaving the window? Pause, back-dated to the last keystroke.
      if(IDLE_PAUSE_MS > 0 && performance.now() - this.lastKeyAt > IDLE_PAUSE_MS){
        this.pauseTyping('idle', this.lastKeyAt);
        return;
      }
      this.statsView.update(this.engine.getStats());
    }, 250);
  },
  stopTicker(){
    if(this.timerHandle){ clearInterval(this.timerHandle); this.timerHandle = null; }
  },

  /* ----- input handling ----- */
  handleChar(ch){ this.engine.typeChar(ch); },
  handleBackspace(){ this.engine.backspace(); },

  /* ----- completion overlay ----- */
  showCompletion(stats){
    this.dom.completeLessonTitle.textContent = this.currentLesson.title;
    this.dom.completeWpm.textContent = '0';
    this.dom.completeAcc.textContent = stats.accuracy + '%';
    this.dom.completeTime.textContent = formatTime(stats.elapsedMs);
    // count up wpm for a little juice
    const target = stats.wpm;
    const start = performance.now();
    const dur = prefersReducedMotion() ? 0 : 500;
    const step = (now) => {
      const t = dur ? clamp((now-start)/dur, 0, 1) : 1;
      this.dom.completeWpm.textContent = String(Math.round(target*t));
      if(t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    const objectives = this.currentLesson.objectives || defaultObjectives(this.currentLesson.targetWPM, this.currentLesson.targetAccuracy);
    this.dom.objectivesList.innerHTML = '';
    objectives.forEach(spec => {
      const met = evaluateObjective(spec, stats);
      const li = document.createElement('li');
      li.className = met ? 'obj-met' : 'obj-missed';
      li.textContent = spec.label;
      this.dom.objectivesList.appendChild(li);
    });

    this.dom.completeOverlay.classList.add('open');
    this.dom.confettiLayer.innerHTML = '';
    spawnConfetti(this.dom.confettiLayer);
  },
  hideCompletion(){
    this.dom.completeOverlay.classList.remove('open');
    this.dom.confettiLayer.innerHTML = '';
  },
  saveBestStats(stats){
    const all = Storage.loadStats();
    const prev = all[this.currentLesson.id] || { bestWpm:0, bestAccuracy:0, attempts:0 };
    all[this.currentLesson.id] = {
      bestWpm: Math.max(prev.bestWpm, stats.wpm),
      bestAccuracy: Math.max(prev.bestAccuracy, stats.accuracy),
      attempts: prev.attempts + 1,
      lastAt: Date.now()
    };
    Storage.saveStats(all);
  },

  /* ----- reading the hidden typing field -----
     Diffs the field against engine.pos (the single source of truth). Dead keys
     are the subtle part: pressing ´ leaves a bare accent in the field until its
     vowel arrives. Judging that now flashes a red mistake which turns green a
     beat later, so while a composition is open and all that's pending is an
     accent, we hold off and show a neutral "pending" mark on the letter. */
  syncFromInput(isComposing){
    const d = this.dom;
    if(this.editing){ this.onEditInput(); return; } // the field holds the lesson text right now, not typing
    if(this.engine.finished){ d.captureInput.value = ''; this.shadowValue = ''; return; }
    // Not accepting keystrokes (text still veiled, or paused): put the field back as it was.
    if(this.state === 'idle' || this.state === 'paused'){ d.captureInput.value = this.shadowValue; return; }
    const raw = d.captureInput.value;
    const val = raw.normalize('NFC'); // "a" + combining acute -> "á": one visible letter, one character
    if(val !== raw) d.captureInput.value = val;
    const current = this.engine.pos;
    const tail = val.slice(current);
    if(isComposing && tail && ACCENT_ONLY.test(tail)){
      if(!this.textView.composingEl) this.sound.playKey({}); // the dead key is a real keypress: it should click
      this.textView.setComposing(current, true);
      this.hintNext('base'); // now point at the vowel
      return;
    }
    this.textView.setComposing(null, false);
    const target = val.length;
    if(target > current){
      for(const ch of tail) this.handleChar(ch);
    } else if(target < current){
      for(let i = 0; i < current - target; i++) this.handleBackspace();
    }
    this.shadowValue = d.captureInput.value;
    this.saveCursorPosition();
    this.hintNext();
  },

  saveCursorPosition(){
    if(!this.currentLesson || !this.engine || this.engine.finished) return;
    if(this.engine.pos <= 0){
      delete this.positions[this.currentLesson.id];
    } else {
      this.positions[this.currentLesson.id] = { position:this.engine.pos, text:this.engine.text };
    }
    Storage.savePositions(this.positions);
  },

  /* ----- marks: keep a word or passage while you type -----
     Command-mode m starts and ends a mark. Marks are stored per lesson
     (localStorage) and drawn back onto the text next time. */
  resolveMarkRange(m, text){
    if(text.slice(m.start, m.end) === m.text) return [m.start, m.end];
    const i = text.indexOf(m.text); // the lesson was edited since: find the passage again
    return i >= 0 ? [i, i + m.text.length] : null;
  },
  displayText(){
    // what's on screen: the lesson, or — while editing — whatever the field currently holds
    return this.editing ? this.dom.captureInput.value : (this.engine ? this.engine.text : '');
  },
  applyAnnotations(){
    // Resolve this lesson's marks and masks to character ranges. A mask made during THIS run is
    // already typed, so it only takes effect from the next run ("soon"). Masks lift while editing.
    const text = this.displayText();
    const lesson = this.currentLesson;
    const mine = lesson ? this.marks.filter(m => m.lessonId === lesson.id) : [];
    const resolve = (m) => { const r = this.resolveMarkRange(m, text); return r ? { id:m.id, s:r[0], e:r[1] } : null; };
    this.markRanges = mine.filter(m => m.kind !== 'mask').map(resolve).filter(Boolean);
    const masks = mine.filter(m => m.kind === 'mask').map(resolve).filter(Boolean);
    this.maskRanges = masks.filter(r => !this.freshMasks.has(r.id));
    this.soonRanges = masks.filter(r => this.freshMasks.has(r.id));
    this.maskSet = new Set();
    if(this.masksOn && !this.editing) this.maskRanges.forEach(r => { for(let i = r.s; i < r.e; i++) this.maskSet.add(i); });
    this.refreshOverlays();
  },
  refreshOverlays(){
    const live = (kind) => {
      if(this.editing) return null;
      const c = this.captures[kind];
      return c ? [c.start, Math.max(c.start, this.engine.pos)] : null;
    };
    const masking = this.masksOn && !this.editing;
    this.textView.setMarks(this.markRanges.map(r => [r.s, r.e]), live('mark'));
    this.textView.setMasks(masking ? this.maskRanges.map(r => [r.s, r.e]) : [], this.soonRanges.map(r => [r.s, r.e]), live('mask'), this.hinted);
  },
  hintNext(stage){
    // The on-screen keyboard points at the next key — unless that character is masked (that would give the
    // answer away), or you're editing (there is no "next key" then).
    if(this.editing){ this.keyboardView.clearNext(); return; }
    const i = this.engine.pos;
    if(this.maskSet.has(i) && !this.hinted.has(i)) this.keyboardView.clearNext();
    else this.keyboardView.highlightNext(this.engine.text[i], stage);
  },
  resetRunState(){
    this.captures = { mark:null, mask:null };
    this.composing = false;
    this.hidePill('mark');
    this.hidePill('mask');
    this.freshMasks.clear();
    this.maskSlips.clear();
    this.maskMiss.clear();
    this.hinted.clear();
  },
  recordRecall(){
    // Typing from memory is scored per masked passage: clean = no wrong guess and no hint inside it.
    if(!this.masksOn || !this.maskRanges.length) return null;
    let clean = 0;
    this.maskRanges.forEach(r => {
      let slipped = false;
      for(let i = r.s; i < r.e; i++){ if(this.maskSlips.has(i)){ slipped = true; break; } }
      const m = this.marks.find(x => x.id === r.id);
      if(m){ m.attempts = (m.attempts || 0) + 1; if(!slipped) m.clean = (m.clean || 0) + 1; m.lastRecallAt = Date.now(); }
      if(!slipped) clean++;
    });
    Storage.saveMarks(this.marks);
    return { total: this.maskRanges.length, clean };
  },
  appendRecallLine(recall){
    const li = document.createElement('li');
    li.className = recall.clean === recall.total ? 'obj-met' : 'obj-missed';
    li.textContent = `From memory: ${recall.clean} of ${recall.total} masked passage${recall.total === 1 ? '' : 's'} without a slip`;
    this.dom.objectivesList.appendChild(li);
  },
  toggleCapture(kind){
    if(this.state !== 'running' && !(this.commandMode && this.state === 'paused' && this.pauseReason === 'command')) return;
    if(this.captures[kind]){ this.commitCapture(kind); return; }
    this.captures[kind] = { start: this.engine.pos };
    this.showPill(kind, this.captureText(kind));
    this.refreshOverlays();
  },
  cancelCapture(kind){
    if(!this.captures[kind]) return;
    this.captures[kind] = null;
    this.hidePill(kind);
    this.refreshOverlays();
  },
  commitCapture(kind){
    const cap = this.captures[kind];
    if(!cap) return;
    const end = this.engine.pos;
    const text = this.engine.text;
    this.cancelCapture(kind);
    let s = cap.start, e = end;
    while(s < e && /\s/.test(text[s])) s++;
    while(e > s && /\s/.test(text[e - 1])) e--;
    if(e <= s){ this.showPill(kind, kind === 'mask' ? 'Mask cancelled' : 'Mark cancelled', 1200); return; }
    this.addMark(kind, s, e);
  },
  markWordAtCaret(kind){
    if(this.state !== 'running' && !(this.commandMode && this.state === 'paused')) return;
    const text = this.engine.text, tv = this.textView;
    let i = this.engine.pos;
    if(i >= text.length || /\s/.test(text[i])) i--;  // at whitespace, use the word just completed
    if(i < 0) i = 0;
    const w = tv.wordIndexForChar[i];
    if(w === undefined || w < 0) return;
    let [s, e] = tv.wordRanges[w];
    e += 1;
    const isWordChar = (c) => /[\p{L}\p{N}]/u.test(c); // you want the word, not its comma
    while(s < e && !isWordChar(text[s])) s++;
    while(e > s && !isWordChar(text[e - 1])) e--;
    if(e <= s) return;
    this.addMark(kind, s, e, { toggle:true });
  },
  addMark(kind, s, e, opts = {}){
    const lesson = this.currentLesson;
    const label = kind === 'mask' ? 'masked' : 'marked';
    const existing = this.marks.find(m => (m.kind || 'mark') === kind && m.lessonId === lesson.id && m.start === s && m.end === e);
    if(existing){
      if(opts.toggle){ this.removeMark(existing.id); this.showPill(kind, kind === 'mask' ? 'Unmasked' : 'Unmarked', 1200); }
      else this.showPill(kind, 'Already ' + label, 1200);
      return;
    }
    const text = this.engine.text.slice(s, e);
    const rec = {
      id: uid(kind), kind, lessonId: lesson.id, lessonTitle: lesson.title, course: this.currentCourseTitle,
      text, start: s, end: e, createdAt: Date.now()
    };
    if(kind === 'mask'){ rec.attempts = 0; rec.clean = 0; this.freshMasks.add(rec.id); }
    this.marks.push(rec);
    Storage.saveMarks(this.marks);
    this.applyAnnotations();
    this.updateMarksCount();
    this.sound.playMark(kind);
    const preview = text.length > 24 ? text.slice(0, 23) + '…' : text;
    this.showPill(kind, kind === 'mask' ? `Masked “${preview}” — hidden next time` : `Marked “${preview}”`, 2000);
    this.bus.dispatchEvent(new CustomEvent('markAdded', { detail:rec }));
  },
  removeMark(id){
    const i = this.marks.findIndex(m => m.id === id);
    if(i < 0) return;
    const [m] = this.marks.splice(i, 1);
    this.freshMasks.delete(id);
    Storage.saveMarks(this.marks);
    this.applyAnnotations();
    this.hintNext();
    this.updateMarksCount();
    this.renderMarks();
    this.bus.dispatchEvent(new CustomEvent('markRemoved', { detail:m }));
  },
  importMarks(list){
    const have = new Set(this.marks.map(m => m.id));
    let added = 0;
    list.forEach(m => {
      if(!m || typeof m.text !== 'string' || !m.text || !m.lessonId) return;
      if(m.id && have.has(m.id)) return;
      const kind = m.kind === 'mask' ? 'mask' : 'mark';
      const id = m.id || uid(kind);
      have.add(id);
      const start = Number(m.start) || 0;
      const rec = {
        id, kind, lessonId:String(m.lessonId), lessonTitle:String(m.lessonTitle || ''), course:String(m.course || ''),
        text:m.text, start, end:Number(m.end) || start + m.text.length, createdAt:Number(m.createdAt) || Date.now()
      };
      if(kind === 'mask'){ rec.attempts = Number(m.attempts) || 0; rec.clean = Number(m.clean) || 0; }
      this.marks.push(rec);
      added++;
    });
    Storage.saveMarks(this.marks);
    this.applyAnnotations();
    this.updateMarksCount();
    return added;
  },
  /* ----- capture pills: one per shortcut family, so both can be on screen together ----- */
  pillFor(kind){ return kind === 'edit' ? this.dom.editPill : kind === 'mask' ? this.dom.maskPill : this.dom.markPill; },
  captureText(kind){ return kind === 'edit' ? 'EDIT mode · Esc to save · Command mode follows' : kind === 'mask' ? 'Masking — use Command mode M' : 'Marking — use Command mode m'; },
  isOpen(kind){ return kind === 'edit' ? this.editing : !!this.captures[kind]; },
  showPill(kind, text, ms){
    const p = this.pillFor(kind);
    p.textContent = text;
    p.classList.add('show');
    clearTimeout(this.pillTimers[kind]);
    if(ms) this.pillTimers[kind] = setTimeout(() => {
      // A flash ("Marked …") must not clobber an open span's indicator: fall back to it if one is still open.
      if(this.isOpen(kind)) p.textContent = this.captureText(kind);
      else p.classList.remove('show');
    }, ms);
  },
  hidePill(kind){
    clearTimeout(this.pillTimers[kind]);
    this.pillFor(kind).classList.remove('show');
  },
  updateMarksCount(){
    const c = this.dom.marksCount;
    c.textContent = String(this.marks.length);
    c.classList.toggle('empty', !this.marks.length);
  },
  toggleMasks(){
    this.masksOn = !this.masksOn;
    this.savePref('masksOn', this.masksOn);
    this.updateMaskToggleBtn();
    this.applyAnnotations();
    this.hintNext();
  },
  updateMaskToggleBtn(){
    const b = this.dom.maskToggleBtn;
    b.textContent = `Hide masked passages: ${this.masksOn ? 'on' : 'off'}`;
    b.setAttribute('aria-pressed', String(this.masksOn));
  },

  /* ----- the digest: everything you've marked, in one place ----- */
  openMarks(){
    this.closeDrawer();
    this.renderMarks();
    this.dom.marksScrim.classList.add('open');
  },
  closeMarks(){ this.dom.marksScrim.classList.remove('open'); },
  renderMarks(){
    const d = this.dom, ul = d.marksList;
    ul.innerHTML = '';
    const empty = !this.marks.length;
    d.marksCopyBtn.disabled = empty;
    d.marksPracticeBtn.disabled = !this.marks.some(m => m.kind !== 'mask');
    if(empty){
      const li = document.createElement('li');
      li.className = 'marks-empty';
      li.textContent = 'Nothing here yet. In Command mode, m marks a passage to keep and M masks one for memory practice.';
      ul.appendChild(li);
      return;
    }
    this.marks.slice().reverse().forEach(m => {
      const kind = m.kind === 'mask' ? 'mask' : 'mark';
      const li = document.createElement('li');
      li.className = 'mark-item';
      li.dataset.id = m.id;
      li.dataset.kind = kind;
      const q = document.createElement('p');
      q.className = 'mark-text';
      q.textContent = m.text; // textContent, never innerHTML: marks are text from lessons you may have pasted
      const meta = document.createElement('p');
      meta.className = 'mark-meta';
      const chip = document.createElement('span');
      chip.className = 'kind-chip ' + kind;
      chip.textContent = kind;
      let info = `${m.lessonTitle || 'Lesson'} · ${new Date(m.createdAt).toLocaleDateString()}`;
      if(kind === 'mask' && m.attempts) info += ` · recalled cleanly ${m.clean || 0} of ${m.attempts}`;
      meta.append(chip, document.createTextNode(info));
      const actions = document.createElement('div');
      actions.className = 'mark-actions';
      [['copy', 'Copy'], ['del', 'Remove']].forEach(([act, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'text-btn';
        b.dataset.act = act;
        b.textContent = label;
        actions.appendChild(b);
      });
      li.append(q, meta, actions);
      ul.appendChild(li);
    });
  },
  async copyText(text){
    try{ await navigator.clipboard.writeText(text); return true; }catch(e){ /* fall through to the legacy path */ }
    try{
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    }catch(e){ return false; }
  },
  practiceMarks(){
    const src = this.marks.filter(m => m.kind !== 'mask'); // masks are practised in their own lesson, hidden
    if(!src.length) return;
    let text = collapseWhitespace(src.map(m => m.text).join(' '));
    if(text.length > 1500) text = text.slice(0, 1500).replace(/\s+\S*$/, '');
    const id = 'custom-marks-digest';
    let lesson = this.customLessons.find(l => l.id === id);
    if(lesson){ lesson.text = text; }
    else {
      lesson = { id, title:'My marked passages', course:'My Marks', text, targetWPM:30, targetAccuracy:95, custom:true };
      this.customLessons.push(lesson);
    }
    Storage.saveLessons(this.customLessons);
    this.closeMarks();
    this.renderSidebar();
    this.loadLesson(lesson, lesson.course, { ready:true });
  },

  /* ----- template edit mode (Command mode: i): the text itself becomes editable, right where it is -----
     The hidden typing field stays focused the whole time — it just holds the lesson text
     instead of what you've typed — and the visible spans mirror its value and selection, so
     the font, wrapping, colours and caret are the very ones you were typing in; nothing swaps
     out. The clock pauses without a veil. Esc commits and returns to Command mode. Typing resumes at the
     same character (or, if you changed something inside what you'd already typed, at the first
     changed character). */
  canEdit(){
    const d = this.dom, s = this.state;
    if(!this.engine || s === 'finished' || (s === 'paused' && this.pauseReason !== 'command')) return false;
    return !(d.modalScrim.classList.contains('open') || d.marksScrim.classList.contains('open') || d.completeOverlay.classList.contains('open'));
  },
  toggleInlineEdit(){
    if(this.editing) this.endInlineEdit(true);
    else if(this.canEdit()) this.beginInlineEdit();
  },
  beginInlineEdit(){
    const d = this.dom, eng = this.engine;
    this.editStart = {
      text: eng.text, pos: eng.pos, typed: d.captureInput.value,
      wasState: this.state,
      wasPauseReason: this.pauseReason,
      wasCommandMode: this.commandMode || (this.state === 'paused' && this.pauseReason === 'command'),
      ...this.textView.snapshot(eng.pos)
    };
    this.editing = true;
    if(this.state === 'running'){ // the clock stops while you edit — but there's no veil: the text stays exactly where it is
      eng.pause();
      this.state = 'paused';
      this.pauseReason = 'edit';
      this.stopTicker();
      this.statsView.update(eng.getStats());
    }
    this.composing = false;
    this.textView.setComposing(null, false);
    d.captureInput.value = eng.text;                       // the field now holds the lesson, caret where your typing caret was
    d.captureInput.setSelectionRange(eng.pos, eng.pos);
    this._editShown = eng.text;
    this._vx = null;
    this._lines = null;
    this.applyAnnotations();                               // masks lift while editing, so you can see what you're changing
    this.hintNext();
    this.updateOverlay();
    this.showPill('edit', this.captureText('edit'));
    this.focusInput();
    this.renderEdit();
    this.bus.dispatchEvent(new CustomEvent('editStart'));
  },
  endInlineEdit(accept){
    if(!this.editing) return;
    const d = this.dom, eng = this.engine, tv = this.textView, es = this.editStart;
    const newText = normalizeLessonText(d.captureInput.value);
    if(accept && !newText){ this.showPill('edit', "The lesson text can't be empty", 1800); return; }
    const changed = accept && newText !== es.text;
    this.editing = false;
    this.composing = false;
    this.hidePill('edit');
    let pos = es.pos;
    if(changed){
      if(this._editShown !== newText) this.remapCapturesForTextChange(this._editShown, newText);
      pos = Math.min(es.pos, commonPrefix(es.text, newText)); // changed something you'd already typed: resume at the first changed character
      this.recordTemplateUndo(es.text, es.pos);
      this.persistEdit(newText);
      eng.replaceText(newText, pos);
    }
    tv.build(eng.text, true);
    tv.restore(es, pos);
    tv.setSelection(0, 0);
    const typed = es.typed.slice(0, pos);                   // the typing field goes back to exactly what was typed
    d.captureInput.value = typed;
    d.captureInput.setSelectionRange(typed.length, typed.length);
    this.shadowValue = typed;
    this._lines = null;
    this.editStart = null;
    this.applyAnnotations();
    tv.moveCaret(pos);
    this.statsView.update(eng.getStats());
    this.updateProgress();
    this.hintNext();
    if(es.wasCommandMode && es.wasState === 'paused'){
      this.commandMode = true;
      this.state = 'paused';
      this.pauseReason = 'command';
      this.showPill('edit', 'COMMAND mode · t for typing mode · i to edit');
    } else if(es.wasState === 'running'){
      eng.resume();
      this.commandMode = es.wasCommandMode;
      this.state = 'running';
      this.pauseReason = es.wasPauseReason;
      this.lastKeyAt = performance.now();
      this.startTicker();
    } else {
      this.commandMode = es.wasCommandMode;
      this.state = es.wasState;
      this.pauseReason = es.wasPauseReason;
      if(this.commandMode) this.showPill('edit', 'COMMAND mode · t for typing mode · i to edit');
    }
    this.updateOverlay();
    this.focusInput();
    if(changed){
      this.bus.dispatchEvent(new CustomEvent('lessonEdited', { detail:{ lessonId:this.currentLesson.id } }));
    }
  },
  persistEdit(text){
    const lesson = this.currentLesson;
    if(lesson.custom){
      lesson.text = text;
      Storage.saveLessons(this.customLessons);
    } else {
      // Built-in / static-pack lessons are code- or git-managed, so the edit is an override keyed by
      // lesson id: best scores and marks stay attached, and the original is one click away.
      const original = lesson.edited ? lesson.originalText : lesson.text;
      if(text === original) delete this.overrides[lesson.id]; else this.overrides[lesson.id] = text;
      Storage.saveOverrides(this.overrides);
      const found = this.findLesson(lesson.id);
      if(found) this.currentLesson = found.lesson;
    }
    this.relocateMarks(text);
    this.renderSidebar();
  },
  relocateMarks(text){
    let touched = false;
    this.marks.forEach(m => {
      if(m.lessonId !== this.currentLesson.id) return;
      const r = this.resolveMarkRange(m, text);
      if(r && (r[0] !== m.start || r[1] !== m.end)){ m.start = r[0]; m.end = r[1]; touched = true; }
    });
    if(touched) Storage.saveMarks(this.marks);
  },
  importOverrides(obj){
    // edits to built-in / static-pack lessons, from an export file: only non-empty strings are accepted
    let n = 0;
    if(obj && typeof obj === 'object' && !Array.isArray(obj)){
      Object.entries(obj).forEach(([id, v]) => {
        if(typeof v === 'string' && v.trim()){ this.overrides[id] = normalizeLessonText(v); n++; }
      });
    }
    Storage.saveOverrides(this.overrides);
    this.renderSidebar();
    return n;
  },
  restoreLesson(id){
    if(this.overrides[id] === undefined) return;
    const found = this.findLesson(id);
    if(!window.confirm(`Restore the original text of "${found ? found.lesson.title : 'this lesson'}"?`)) return;
    delete this.overrides[id];
    Storage.saveOverrides(this.overrides);
    this.renderSidebar();
    if(this.currentLesson && this.currentLesson.id === id){
      const f = this.findLesson(id);
      if(f) this.loadLesson(f.lesson, f.courseTitle);
    }
  },
  renderEdit(){
    // Mirror the hidden field (text, caret, selection) onto the visible spans.
    if(!this.editing) return;
    const ta = this.dom.captureInput;
    const val = ta.value;
    if(val !== this._editShown){
      this._editShown = val;
      this.rebuildForEdit(val);
    }
    const s = ta.selectionStart, e = ta.selectionEnd;
    this.textView.moveCaret(ta.selectionDirection === 'backward' ? s : e);
    this.textView.setSelection(s, e);
  },
  rebuildForEdit(val){
    const es = this.editStart, tv = this.textView;
    const previous = this._editShown;
    if(previous !== val) this.remapCapturesForTextChange(previous, val);
    this._editShown = val;
    // The typed prefix keeps its green / red only up to the first character that differs from where
    // the edit began — so undoing the change brings every colour back.
    const keep = Math.min(es.pos, commonPrefix(es.text, val));
    tv.build(val, true);
    tv.restore(es, keep);
    this._lines = null;
    this.applyAnnotations();
  },
  remapCapturesForTextChange(previous, next){
    let prefix = 0;
    const maxPrefix = Math.min(previous.length, next.length);
    while(prefix < maxPrefix && previous[prefix] === next[prefix]) prefix++;
    let suffix = 0;
    const maxSuffix = Math.min(previous.length - prefix, next.length - prefix);
    while(suffix < maxSuffix &&
      previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
    const oldChangedEnd = previous.length - suffix;
    const delta = next.length - previous.length;
    ['mark', 'mask'].forEach(kind => {
      const capture = this.captures[kind];
      if(!capture) return;
      if(capture.start <= prefix) return;
      if(capture.start >= oldChangedEnd) capture.start += delta;
      else capture.start = prefix;
      capture.start = Math.max(0, Math.min(capture.start, next.length));
    });
  },
  onEditInput(){
    this.scheduleEditRender();
  },
  scheduleEditRender(){
    if(this.editRenderFrame !== null) return;
    this.editRenderFrame = requestAnimationFrame(() => {
      this.editRenderFrame = null;
      this.renderEdit();
    });
  },
  onEditKeydown(e){
    if(e.key === 'Escape' && !this.escapeCommands) return;
    if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); this.endInlineEdit(true); return; }
    if(e.key === 'Tab'){
      e.preventDefault();
      const start = this.dom.captureInput.selectionStart, end = this.dom.captureInput.selectionEnd;
      this.dom.captureInput.setRangeText('\t', start, end, 'end');
      this.onEditInput();
      return;
    }
    if(e.isComposing || this.composing) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    // The hidden field is 1px wide, so its own idea of a "line" is useless. Up / Down / Page and the line
    // edges are computed from the visible layout; everything else — arrows, word jumps, select, undo,
    // clipboard, dead keys — is the browser's native editing, untouched.
    const step = { ArrowUp:-1, ArrowDown:1, PageUp:-4, PageDown:4 }[k];
    if(step && !(mod && k.startsWith('Arrow'))){ e.preventDefault(); this.editVertical(step, e.shiftKey); return; }
    const edge = ((k === 'Home' && !mod) || (k === 'ArrowLeft' && e.metaKey)) ? 'start'
               : ((k === 'End' && !mod) || (k === 'ArrowRight' && e.metaKey)) ? 'end' : null;
    if(edge){ e.preventDefault(); this.editLineEdge(edge, e.shiftKey); return; }
    this._vx = null;
    this.scheduleEditRender();
  },
  editLines(){
    // The visible lines, from the rendered spans: [{ top, first, last }] (cached until the next rebuild).
    if(this._lines) return this._lines;
    const lines = [];
    this.textView.charEls.forEach((el, i) => {
      const top = el.offsetTop, last = lines[lines.length - 1];
      if(last && last.top === top) last.last = i; else lines.push({ top, first:i, last:i });
    });
    return (this._lines = lines);
  },
  editEnds(){
    const ta = this.dom.captureInput, s = ta.selectionStart, e = ta.selectionEnd;
    return ta.selectionDirection === 'backward' ? [e, s] : [s, e]; // [anchor, focus]
  },
  editSelect(anchor, focus){
    this.dom.captureInput.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus), focus < anchor ? 'backward' : 'forward');
    this.renderEdit();
  },
  editVertical(step, extend){
    const lines = this.editLines(), els = this.textView.charEls, n = els.length;
    if(!n) return;
    const [anchor, focus] = this.editEnds();
    const at = Math.min(focus, n - 1);
    let li = lines.findIndex(l => at >= l.first && at <= l.last);
    if(li < 0) li = 0;
    if(this._vx == null) this._vx = focus >= n ? els[n - 1].offsetLeft + els[n - 1].offsetWidth : els[focus].offsetLeft;
    const ti = li + step;
    let target;
    if(ti < 0) target = 0;                  // above the first line: the start of the text
    else if(ti >= lines.length) target = n; // below the last line: the end
    else {
      const l = lines[ti];
      target = l.first;
      let best = Infinity;
      for(let i = l.first; i <= l.last; i++){ // keep the column you were in
        const dist = Math.abs(els[i].offsetLeft - this._vx);
        if(dist < best){ best = dist; target = i; }
      }
    }
    this.editSelect(extend ? anchor : target, target);
  },
  editLineEdge(edge, extend){
    const lines = this.editLines(), n = this.textView.charEls.length;
    if(!n) return;
    const [anchor, focus] = this.editEnds();
    const at = Math.min(focus, n - 1);
    const l = lines.find(x => at >= x.first && at <= x.last) || lines[0];
    const target = edge === 'start' ? l.first : Math.min(l.last + 1, n);
    this._vx = null;
    this.editSelect(extend ? anchor : target, target);
  },
  editIndexFromEvent(e){
    const el = e.target && e.target.closest && e.target.closest('.char');
    if(!el) return null;
    const r = el.getBoundingClientRect();
    return Number(el.dataset.idx) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
  },
  onEditMouseDown(e){
    const pos = this.editIndexFromEvent(e);
    if(pos === null) return;
    const [anchor] = this.editEnds();
    this._vx = null;
    this._drag = { anchor: e.shiftKey ? anchor : pos };
    this.editSelect(this._drag.anchor, pos);
  },
  onEditMouseMove(e){
    if(!(e.buttons & 1)){ this._drag = null; return; }
    const pos = this.editIndexFromEvent(e);
    if(pos !== null) this.editSelect(this._drag.anchor, pos);
  },
  onEditDblClick(e){
    const pos = this.editIndexFromEvent(e);
    if(pos === null) return;
    const tv = this.textView, i = Math.min(pos, tv.charEls.length - 1);
    const w = tv.wordIndexForChar[i];
    if(w === undefined || w < 0) return;
    const [s, en] = tv.wordRanges[w];
    this.editSelect(s, en + 1);
  },

  /* ----- lesson editor modal ----- */
  openModal(){
    this.dom.lessonForm.reset();
    this.dom.lfWpm.value = '30';
    this.dom.lfAcc.value = '95';
    this.dom.modalScrim.classList.add('open');
    setTimeout(() => { if(this.dom.modalScrim.classList.contains('open')) this.dom.lfTitle.focus(); }, 50);
  },
  closeModal(){ this.dom.modalScrim.classList.remove('open'); },
  submitLessonForm(e){
    e.preventDefault();
    const title = this.dom.lfTitle.value.trim();
    const courseTitle = this.dom.lfCourse.value.trim() || 'My Lessons';
    const text = normalizeLessonText(this.dom.lfText.value);
    const targetWPM = clamp(parseInt(this.dom.lfWpm.value, 10) || 30, 5, 200);
    const targetAccuracy = clamp(parseInt(this.dom.lfAcc.value, 10) || 95, 50, 100);
    if(!title || !text) return;
    const lesson = {
      id: uid('custom'), title, course: courseTitle, text, targetWPM, targetAccuracy, custom:true
    };
    this.customLessons.push(lesson);
    Storage.saveLessons(this.customLessons);
    this.closeModal();
    this.renderSidebar();
    this.loadLesson(lesson, courseTitle, { ready:true });
    this.bus.dispatchEvent(new CustomEvent('lessonAdded', { detail:{ lessonId:lesson.id } }));
  },
  deleteLesson(id){
    const found = this.findLesson(id);
    const lesson = found && found.lesson;
    if(!lesson) return;
    if(!window.confirm(`Delete "${lesson.title}"?`)) return;
    this.customLessons = this.customLessons.filter(l => l.id !== id);
    this.deletedLessons.add(id);
    Storage.saveDeletedLessons(Array.from(this.deletedLessons));
    Storage.saveLessons(this.customLessons);
    this.renderSidebar();
    if(this.currentLesson && this.currentLesson.id === id){
      const next = this.getAllCourses().flatMap(course => course.lessons.map(lesson => ({ lesson, courseTitle:course.title })))[0];
      if(next) this.loadLesson(next.lesson, next.courseTitle);
    }
  },

  /* ----- export / import of a visitor's own custom lessons -----
     GitHub Pages has no backend, so a visitor's custom lessons live only
     in their own browser's localStorage — private to them, never seen by you or
     other visitors. This is the escape hatch: a visitor who wants to hand you a
     lesson they wrote can export it to a plain JSON file and send it to you
     however they like (email, a GitHub issue, a PR adding it to lessons/). You
     decide whether to fold it into a static pack in a future commit. */
  exportLessons(){
    if(!this.customLessons.length && !this.marks.length && !Object.keys(this.overrides).length && !this.deletedLessons.size){ window.alert('Nothing to export yet — add a lesson, mark a passage, edit a lesson or delete a lesson first.'); return; }
    const payload = JSON.stringify({ exportedAt:new Date().toISOString(), lessons:this.customLessons, marks:this.marks, overrides:this.overrides, deletedLessons:Array.from(this.deletedLessons) }, null, 2);
    const blob = new Blob([payload], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'type-studio-lessons.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  importLessonsFromFile(file){
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const data = JSON.parse(String(reader.result));
        const list = Array.isArray(data) ? data : (Array.isArray(data.lessons) ? data.lessons : []);
        const markList = Array.isArray(data.marks) ? data.marks : [];
        const ovr = data.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides) ? data.overrides : {};
        const deletedList = Array.isArray(data.deletedLessons) ? data.deletedLessons : [];
        if(!list.length && !markList.length && !Object.keys(ovr).length && !deletedList.length) throw new Error('Expected "lessons", "marks", "overrides" and/or "deletedLessons"');
        list.forEach(l => { if(!l.id) l.id = uid('custom'); l.custom = true; });
        this.customLessons = this.customLessons.concat(list);
        deletedList.forEach(id => { if(typeof id === 'string' && id) this.deletedLessons.add(id); });
        Storage.saveDeletedLessons(Array.from(this.deletedLessons));
        Storage.saveLessons(this.customLessons);
        const marksAdded = markList.length ? this.importMarks(markList) : 0;
        this.importOverrides(ovr);
        this.renderSidebar();
        window.alert(`Imported ${list.length} lesson${list.length===1?'':'s'} and ${marksAdded} mark${marksAdded===1?'':'s'}.`);
      }catch(err){
        console.warn('TypeStudio: import failed', err);
        window.alert('That file did not look like a Type Studio lessons export.');
      }
    };
    reader.readAsText(file);
  },

  /* ----- drawer ----- */
  openDrawer(){ this.dom.drawer.classList.add('open'); this.dom.drawerScrim.classList.add('open'); },
  closeDrawer(){ this.dom.drawer.classList.remove('open'); this.dom.drawerScrim.classList.remove('open'); },

  /* ----- theme / sound / keyboard toggle ----- */
  setTheme(theme, persist=true){
    if(theme === 'system'){
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.dataset.theme = theme;
    }
    const isDark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    this.dom.themeBtn.classList.toggle('is-dark', isDark);
    this.dom.themeBtn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    if(persist) this.savePref('theme', theme);
  },
  toggleTheme(){
    const current = document.documentElement.dataset.theme ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    this.setTheme(current === 'dark' ? 'light' : 'dark');
  },
  toggleSound(){
    this.sound.enabled = !this.sound.enabled;
    this.savePref('sound', this.sound.enabled);
  },
  toggleKeyboard(){
    const hidden = this.dom.keyboardPanel.style.display === 'none';
    this.dom.keyboardPanel.style.display = hidden ? '' : 'none';
    this.dom.keyboardToggleBtn.textContent = hidden ? 'Hide keyboard' : 'Show keyboard';
    this.savePref('keyboardHidden', !hidden);
  },
  savePref(key, value){
    const prefs = Storage.loadPrefs();
    prefs[key] = value;
    Storage.savePrefs(prefs);
  },
  toggleEscapeCommands(){
    this.escapeCommands = !this.escapeCommands;
    this.savePref('escapeCommands', this.escapeCommands);
    this.updateEscapeSwitch();
    if(!this.escapeCommands) this.clearCommandBuffer();
  },
  updateEscapeSwitch(){
    const button = this.dom.escapeSwitch;
    button.setAttribute('aria-checked', String(this.escapeCommands));
    button.title = this.escapeCommands
      ? 'Escape controls Study Typing commands; turn off to leave Escape to the browser'
      : 'Escape is left to the browser; turn on to use Study Typing commands';
  },

  /* ----- wiring ----- */
  wireEvents(){
    const d = this.dom;

    d.menuBtn.addEventListener('click', () => this.openDrawer());
    d.escapeSwitch.addEventListener('click', () => this.toggleEscapeCommands());
    d.drawerCloseBtn.addEventListener('click', () => this.closeDrawer());
    d.drawerScrim.addEventListener('click', () => this.closeDrawer());

    d.courseList.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.lesson-delete');
      if(delBtn){ e.stopPropagation(); this.deleteLesson(delBtn.dataset.deleteId); return; }
      const rsBtn = e.target.closest('.lesson-restore');
      if(rsBtn){ e.stopPropagation(); this.restoreLesson(rsBtn.dataset.restoreId); return; }
      const item = e.target.closest('.lesson-item');
      if(item){
        const found = this.findLesson(item.dataset.id);
        if(found){ this.loadLesson(found.lesson, found.courseTitle); this.closeDrawer(); }
      }
    });

    d.newLessonBtn.addEventListener('click', () => this.openModal());
    d.exportLessonsBtn.addEventListener('click', () => this.exportLessons());
    d.importLessonsBtn.addEventListener('click', () => d.importFileInput.click());
    d.importFileInput.addEventListener('change', () => {
      const file = d.importFileInput.files[0];
      if(file) this.importLessonsFromFile(file);
      d.importFileInput.value = '';
    });
    d.modalCloseBtn.addEventListener('click', () => this.closeModal());
    d.lfCancel.addEventListener('click', () => this.closeModal());
    d.modalScrim.addEventListener('click', (e) => { if(e.target === d.modalScrim) this.closeModal(); });
    d.lessonForm.addEventListener('submit', (e) => this.submitLessonForm(e));

    d.typeBtn.addEventListener('mousedown', (e) => e.preventDefault());
    d.restartBtn.addEventListener('mousedown', (e) => e.preventDefault());
    d.typeBtn.addEventListener('click', () => this.activateTyping());
    d.restartBtn.addEventListener('click', () => this.restart());
    d.soundBtn.addEventListener('click', () => this.toggleSound());
    d.themeBtn.addEventListener('click', () => this.toggleTheme());
    d.maskToggleBtn.addEventListener('click', () => this.toggleMasks());
    d.marksOpenBtn.addEventListener('click', () => this.openMarks());
    d.marksCloseBtn.addEventListener('click', () => this.closeMarks());
    d.marksScrim.addEventListener('click', (e) => { if(e.target === d.marksScrim) this.closeMarks(); });
    d.marksPracticeBtn.addEventListener('click', () => this.practiceMarks());
    d.marksCopyBtn.addEventListener('click', async () => {
      const ok = await this.copyText(this.marks.map(m => m.text).join('\n'));
      d.marksCopyBtn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { d.marksCopyBtn.textContent = 'Copy all'; }, 1300);
    });
    d.marksList.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if(!btn) return;
      const li = btn.closest('.mark-item');
      const m = li && this.marks.find(x => x.id === li.dataset.id);
      if(!m) return;
      if(btn.dataset.act === 'del'){ this.removeMark(m.id); return; }
      const ok = await this.copyText(m.text);
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    });
    d.keyboardToggleBtn.addEventListener('click', () => this.toggleKeyboard());

    // Clicking the text/veil must not steal focus from the typing field (that would
    // read as "focus lost" and pause), so cancel the mousedown and let click() decide.
    d.textShell.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if(this.editing) this.onEditMouseDown(e); // click / shift-click / drag to place the caret and select
    });
    d.textShell.addEventListener('mousemove', (e) => { if(this.editing && this._drag) this.onEditMouseMove(e); });
    document.addEventListener('mouseup', () => { this._drag = null; });
    d.textShell.addEventListener('dblclick', (e) => { if(this.editing) this.onEditDblClick(e); });
    d.textShell.addEventListener('click', () => this.activate());

    d.captureInput.addEventListener('blur', () => this.onBlurInput());

    // "Press any key" works from anywhere on the page, not just once the field has focus.
    document.addEventListener('keydown', (e) => this.onGlobalKeydown(e));
    // Auto-pause: anything that takes the typist's attention off the practice area.
    // Resuming is always explicit (see pauseTyping) — returning never restarts the clock by itself.
    document.addEventListener('visibilitychange', () => { if(document.hidden) this.pauseTyping('hidden'); });
    window.addEventListener('blur', () => this.pauseTyping('window'));
    window.addEventListener('pagehide', () => this.pauseTyping('hidden'));
    window.addEventListener('pagehide', () => this.saveCursorPosition());
    // The shadow field's value is left in place (not cleared) and diffed against
    // engine.pos, which is the single source of truth for "how far typed". This
    // matters: if we cleared the field after every keystroke, pressing Backspace
    // would land on an already-empty field — browsers fire no 'input' event when
    // there's nothing to delete, so Backspace would silently do nothing. Diffing
    // also makes held-Backspace, Ctrl+Backspace (word delete), and selecting a
    // range of already-typed text and deleting it all behave correctly, since the
    // length delta — not the event count — drives how many chars we undo.
    d.captureInput.addEventListener('compositionstart', () => { this.composing = true; });
    d.captureInput.addEventListener('compositionend', () => {
      this.composing = false;
      this.syncFromInput(false);
      // Browsers disagree on whether the final input event lands before or after compositionend: settle once more.
      setTimeout(() => { if(!this.composing) this.syncFromInput(false); }, 0);
    });
    d.captureInput.addEventListener('input', (e) => this.syncFromInput(this.composing || e.isComposing));
    d.captureInput.addEventListener('keydown', (e) => {
      if(this.editing){ this.onEditKeydown(e); return; }
      if(this.commandMode){ this.handleCommandKeydown(e); return; }
      // Two inline shortcut families that work together, one per hand:
      //   Tab   = MARK  (keep it for the digest)
      //   Enter = MASK  (hide it next time: you type it from memory)
      // Plain key starts / ends a span; with Shift it marks the word you're on. Each family has its
      // own open span, so a mark and a mask can be open at the same time and end in either order.
      if((e.key === 'Enter' || e.key === 'Tab') &&
         (this.state === 'running' || this.state === 'ready') &&
         !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey){
        e.preventDefault();
        this.dom.captureInput.value = this.shadowValue + (e.key === 'Enter' ? '\n' : '\t');
        this.syncFromInput(false);
      }
    });
    d.captureInput.addEventListener('paste', (e) => { if(!this.editing) e.preventDefault(); }); // no pasting your way through a lesson — but editing the lesson is fine
    // While editing, mirror the hidden field's caret + selection onto the visible text.
    ['keyup', 'select', 'mouseup'].forEach(t => d.captureInput.addEventListener(t, () => { if(this.editing) this.scheduleEditRender(); }));
    document.addEventListener('selectionchange', () => { if(this.editing && document.activeElement === d.captureInput) this.renderEdit(); });

    d.retryBtn.addEventListener('click', () => this.restart());
    d.closeCompleteBtn.addEventListener('click', () => this.hideCompletion());
    d.nextLessonBtn.addEventListener('click', () => {
      const courses = this.getAllCourses();
      const flat = courses.flatMap(c => c.lessons.map(l => ({ lesson:l, courseTitle:c.title })));
      const idx = flat.findIndex(x => x.lesson.id === this.currentLesson.id);
      const next = flat[(idx+1) % flat.length];
      this.loadLesson(next.lesson, next.courseTitle, { ready:true });
    });

  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

/* =========================================================================
   PUBLIC API — window.TypingStudio
   ---------------------------------------------------------------------
   Use this surface to feed your own content and hook your own gamification
   logic in without touching the internals above.

     TypingStudio.addLesson({
       title: 'My Drill', course: 'My Lessons', text: '...',
       targetWPM: 40, targetAccuracy: 96,
       objectives: [{ type:'minWpm', value:40, label:'Reach 40 wpm' }] // optional
     })
     TypingStudio.loadLesson(lessonId)
     TypingStudio.courses()                 // -> [{ title, lessons:[...] }]
     TypingStudio.getState()                // -> { lessonId, state, stats }
     TypingStudio.on('checkpoint', fn)      // events: start, keystroke, error,
     TypingStudio.off('checkpoint', fn)     //   wordComplete, checkpoint, lessonLoaded,
                                             //   lessonComplete, lessonAdded, lessonEdited,
                                             //   ready, paused, resumed, markAdded, markRemoved
     TypingStudio.setSoundEnabled(bool)
     TypingStudio.setTheme('light'|'dark'|'system')
     TypingStudio.exportData() / importData(json)
   ========================================================================= */
window.TypingStudio = {
  addLesson(lesson){
    const full = {
      id: lesson.id || uid('custom'),
      title: lesson.title,
      course: lesson.course || 'My Lessons',
      text: normalizeLessonText(lesson.text),
      targetWPM: lesson.targetWPM || 30,
      targetAccuracy: lesson.targetAccuracy || 95,
      objectives: lesson.objectives,
      topics: lesson.topics,
      custom: true
    };
    App.customLessons.push(full);
    Storage.saveLessons(App.customLessons);
    App.renderSidebar();
    App.bus.dispatchEvent(new CustomEvent('lessonAdded', { detail:{ lessonId:full.id } }));
    return full.id;
  },
  loadLesson(lessonId){
    const found = App.findLesson(lessonId);
    if(found) App.loadLesson(found.lesson, found.courseTitle);
  },
  courses(){ return App.getAllCourses(); },
  marks(){ return App.marks.map(m => ({ ...m })); },
  getState(){
    return {
      lessonId: App.currentLesson ? App.currentLesson.id : null,
      state: App.state,
      pauseReason: App.pauseReason,
      stats: App.engine ? App.engine.getStats() : null
    };
  },
  on(evt, fn){ App.bus.addEventListener(evt, fn); },
  off(evt, fn){ App.bus.removeEventListener(evt, fn); },
  setSoundEnabled(v){
    App.sound.enabled = !!v;
    App.dom.soundBtn.classList.toggle('is-muted', !App.sound.enabled);
    App.savePref('sound', App.sound.enabled);
  },
  setTheme(t){ App.setTheme(t); },
  exportData(){
    return JSON.stringify({ lessons: App.customLessons, stats: Storage.loadStats(), marks: App.marks, overrides: App.overrides, deletedLessons:Array.from(App.deletedLessons) }, null, 2);
  },
  importData(json){
    try{
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      if(Array.isArray(data.lessons)){
        App.customLessons = App.customLessons.concat(data.lessons);
        Storage.saveLessons(App.customLessons);
      }
      if(data.stats){
        const merged = Object.assign({}, Storage.loadStats(), data.stats);
        Storage.saveStats(merged);
      }
      if(Array.isArray(data.marks)) App.importMarks(data.marks);
      if(data.overrides) App.importOverrides(data.overrides);
      if(Array.isArray(data.deletedLessons)){
        data.deletedLessons.forEach(id => { if(typeof id === 'string' && id) App.deletedLessons.add(id); });
        Storage.saveDeletedLessons(Array.from(App.deletedLessons));
      }
      App.renderSidebar();
      return true;
    }catch(e){
      console.warn('TypeStudio: importData failed', e);
      return false;
    }
  }
};

})();
