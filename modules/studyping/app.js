/*! Studyping — hackable typing-practice engine. MIT-style: do whatever you like with it. */
(function(){
'use strict';

/* =========================================================================
   STUDYPING — a small, hackable typing-practice engine.
   ---------------------------------------------------------------------
   This file is intentionally organized so you can extend it:
     - Add lessons/courses:  window.Studyping.addLesson(lesson)
     - React to progress:    window.Studyping.on('checkpoint', fn)
     - Build gamification on top of the event bus below.
   See the "PUBLIC API" block at the very end for the full surface.
   ========================================================================= */

/* ---------------------------- helpers ---------------------------- */
const qs = (sel, root) => (root||document).querySelector(sel);
const qsa = (sel, root) => Array.from((root||document).querySelectorAll(sel));
const prefersReducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const prefersSlowUpdates = () => window.matchMedia && window.matchMedia('(update: slow)').matches;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const collapseWhitespace = (str) => str.normalize('NFC').replace(/\s+/g, ' ').trim();
const normalizeLessonText = (str) => str.normalize('NFC').replace(/\r\n?/g, '\n').trim();
function markdownLessonText(markdown, title){
  const lines = markdown.split('\n');
  const output = [];
  let inCodeBlock = false;
  let skippedTitle = false;
  lines.forEach(rawLine => {
    const fence = rawLine.match(/^\s*(```+|~~~+)/);
    if(fence){
      inCodeBlock = !inCodeBlock;
      return;
    }
    if(inCodeBlock){
      output.push(rawLine);
      return;
    }
    if(/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(rawLine)) return;
    let line = rawLine;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if(heading){
      if(!skippedTitle && title && heading[1].trim().toLowerCase() === title.trim().toLowerCase()){
        skippedTitle = true;
        return;
      }
      line = line.replace(/^\s{0,3}#{1,6}\s+/, '');
    }
    if(/^\s*\|.*\|\s*$/.test(line)){
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
      if(cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell))) return;
      line = cells.join(' ');
    } else {
      line = line.replace(/^\s{0,3}>\s?/, '');
      line = line.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '');
    }
    output.push(line);
  });
  return normalizeLessonText(output.join('\n'));
}
function parseMarkdownLessonFile(source, filename){
  const normalized = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const frontmatter = normalized.match(/^\n*---\n([\s\S]*?)\n---(?:\n|$)/);
  const metadata = {};
  let body = normalized;
  if(frontmatter){
    frontmatter[1].split('\n').forEach(line => {
      const field = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*$/);
      if(!field) return;
      const value = field[2];
      metadata[field[1]] = /^(['"]).*\1$/.test(value)
        ? value.slice(1, -1).replace(/''/g, "'")
        : value;
    });
    body = normalized.slice(frontmatter[0].length);
  }
  const firstHeading = body.match(/^\s{0,3}#\s+(.+)$/m);
  const title = String(metadata.title || (firstHeading && firstHeading[1]) || filename.replace(/\.(?:md|txt)$/i, '')).trim();
  const text = markdownLessonText(body, metadata.title ? title : '');
  if(!title || !text) throw new Error(`Markdown lesson "${filename}" needs a title and body`);
  const lesson = {
    id:String(metadata.id || slugify(filename.replace(/\.(?:md|txt)$/i, ''))),
    title,
    course:String(metadata.course || 'More Lessons').trim(),
    text,
    targetWPM:optionalInt(metadata.targetWPM, 5, 200) ?? 30,
    targetAccuracy:optionalInt(metadata.targetAccuracy, 50, 100) ?? 95
  };
  const order = optionalOrder(metadata.order);
  const courseOrder = optionalOrder(metadata.courseOrder);
  if(order !== null) lesson.order = order;
  if(courseOrder !== null) lesson.courseOrder = courseOrder;
  return lesson;
}
function parseInlineMarkdown(source){
  const text = [];
  const sourceIndices = [];
  const formats = [];
  const marks = [
    ['**', 'md-strong'], ['__', 'md-strong'], ['~~', 'md-strike'],
    ['`', 'md-code'], ['*', 'md-em'], ['_', 'md-em']
  ];
  const append = (value, start) => {
    for(let i = 0; i < value.length; i++){
      text.push(value[i]);
      sourceIndices.push(start + i);
    }
  };
  for(let i = 0; i < source.length;){
    const mark = marks.find(([token]) => source.startsWith(token, i));
    const underscore = mark && mark[0][0] === '_';
    const validUnderscoreStart = !underscore || i === 0 || !/[A-Za-z0-9]/.test(source[i - 1]);
    if(mark && validUnderscoreStart && (i === 0 || source[i - 1] !== '\\')){
      const [token, style] = mark;
      const contentStart = i + token.length;
      const close = source.indexOf(token, contentStart);
      if(close > contentStart && !/\s/.test(source[contentStart]) &&
         !/\s/.test(source[close - 1]) && !source.slice(contentStart, close).includes('\n') &&
         (!underscore || close + token.length === source.length || !/[A-Za-z0-9]/.test(source[close + token.length]))){
        const formatStart = text.length;
        append(source.slice(contentStart, close), contentStart);
        formats.push({ start:formatStart, end:text.length, style });
        i = close + token.length;
        continue;
      }
    }
    append(source[i], i);
    i++;
  }
  return { text:text.join(''), sourceIndices, formats, sourceLength:source.length };
}
function sourcePositionForRendered(parsed, position){
  return position < parsed.sourceIndices.length
    ? parsed.sourceIndices[Math.max(0, position)]
    : parsed.sourceLength;
}
const slugify = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'lesson';
const courseKey = (title) => String(title || '').trim().toLowerCase();
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
function formatTime(ms){
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60);
  const rem = s%60;
  return `${m}:${String(rem).padStart(2,'0')}`;
}

// Stats are written one lesson at a time and older/imported data can be partial.
// Read each value defensively so a missing field becomes a gap, never a zero.
function finiteStat(value){
  if(typeof value === 'number') return Number.isFinite(value) ? value : null;
  if(typeof value === 'string' && value.trim() !== ''){
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function collectGlobalStats(raw){
  const entries = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  let wpmTotal = 0, wpmSamples = 0;
  let accTotal = 0, accSamples = 0;
  let runs = 0, lessons = 0;
  let bestWpm = null, lastAt = null;
  entries.forEach(entry => {
    if(!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const wpm = finiteStat(entry.bestWpm !== undefined ? entry.bestWpm : entry.wpm);
    const acc = finiteStat(entry.bestAccuracy !== undefined ? entry.bestAccuracy : entry.accuracy);
    const attempts = finiteStat(entry.attempts);
    const last = finiteStat(entry.lastAt);
    const completed = attempts !== null && attempts > 0 ? Math.round(attempts) : 0;
    const hasWpm = wpm !== null && (wpm > 0 || completed > 0);
    const hasAcc = acc !== null && acc >= 0 && acc <= 100;
    const hasLast = last !== null && last > 0;
    if(!hasWpm && !hasAcc && completed <= 0 && !hasLast) return;
    lessons++;
    runs += completed;
    if(hasWpm){
      wpmTotal += wpm;
      wpmSamples++;
      if(bestWpm === null || wpm > bestWpm) bestWpm = wpm;
    }
    if(hasAcc){ accTotal += acc; accSamples++; }
    if(hasLast && (lastAt === null || last > lastAt)) lastAt = last;
  });
  return {
    lessons,
    runs,
    avgWpm: wpmSamples ? Math.round(wpmTotal / wpmSamples) : null,
    avgAccuracy: accSamples ? Math.round(accTotal / accSamples) : null,
    bestWpm,
    lastAt
  };
}
function describeGlobalStats(stats){
  if(!stats.lessons) return 'No completed runs yet. Finish a lesson to start your global stats.';
  const parts = [
    `Saved results across ${stats.lessons} lesson${stats.lessons === 1 ? '' : 's'}`,
    `${stats.runs} completed run${stats.runs === 1 ? '' : 's'}`
  ];
  if(stats.bestWpm !== null) parts.push(`best ${stats.bestWpm} wpm`);
  if(stats.lastAt){
    const date = new Date(stats.lastAt);
    if(!Number.isNaN(date.getTime())) parts.push(`last ${date.toLocaleDateString()}`);
  }
  return `${parts.join(' · ')}. Averages include only saved speed and accuracy values; missing values are skipped.`;
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
// Length of the shared end of two strings, used with commonPrefix to isolate a change.
function commonSuffix(a, b){
  const n = Math.min(a.length, b.length);
  let i = 0;
  while(i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
function optionalInt(value, min, max){
  if(value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? clamp(Math.round(n), min, max) : null;
}
function optionalOrder(value){
  return optionalInt(value, -1000000000, 1000000000);
}
function compareOrdered(a, b){
  const aOrder = a.order === null || a.order === undefined ? Infinity : a.order;
  const bOrder = b.order === null || b.order === undefined ? Infinity : b.order;
  return aOrder - bOrder || a.sourceOrder - b.sourceOrder;
}
function countWords(str){
  return (str.match(/\S+/g) || []).length;
}
function countLines(str){
  return str ? str.split('\n').length : 0;
}
function clampExcerpt(str, max = 240){
  const value = String(str || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
function signed(n){
  return n > 0 ? `+${n}` : String(n);
}
function plural(n, one, many){
  return `${n} ${n === 1 ? one : (many || `${one}s`)}`;
}

// Imported JSON is untrusted and may be a hand-written file. Keep only the fields a
// lesson actually uses, fill in defaults, and require the two things a lesson cannot
// work without: a title and some text.
function normalizeImportedLesson(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const text = typeof raw.text === 'string' ? normalizeLessonText(raw.text) : '';
  if(!title || !text) return null;
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : uid('custom'),
    title,
    text,
    // `course` / targets are optional in an export: null means "leave the existing
    // value alone" when this lesson conflicts with one already in the app.
    course: typeof raw.course === 'string' && raw.course.trim() ? raw.course.trim() : null,
    order: optionalOrder(raw.order),
    courseOrder: optionalOrder(raw.courseOrder),
    targetWPM: optionalInt(raw.targetWPM, 5, 200),
    targetAccuracy: optionalInt(raw.targetAccuracy, 50, 100),
    objectives: Array.isArray(raw.objectives) ? raw.objectives : null,
    topics: Array.isArray(raw.topics) ? raw.topics : null
  };
}

// A compact, human-readable summary of one text change: size delta, the first
// changed character, and the removed / added chunks around it. This is deliberately
// not a full line diff — it is what the import dialog needs to show quickly.
function summarizeTextChange(before, after){
  const a = normalizeLessonText(String(before || ''));
  const b = normalizeLessonText(String(after || ''));
  const prefix = commonPrefix(a, b);
  const suffix = commonSuffix(a, b);
  const removed = a.slice(prefix, Math.max(prefix, a.length - suffix));
  const added = b.slice(prefix, Math.max(prefix, b.length - suffix));
  return {
    beforeChars: a.length,
    afterChars: b.length,
    deltaChars: b.length - a.length,
    beforeWords: countWords(a),
    afterWords: countWords(b),
    beforeLines: countLines(a),
    afterLines: countLines(b),
    firstChange: prefix,
    removed,
    added,
    removedWords: countWords(removed),
    addedWords: countWords(added),
    removedLines: countLines(removed),
    addedLines: countLines(added)
  };
}

// What differs between the saved copy and the incoming one. Text, title and (when
// the file specifies it) course/targets are compared; the app-level `custom` flag,
// export bookkeeping, and id are not content.
function compareImportedLesson(existing, existingCourseTitle, incoming){
  const changes = [];
  const oldText = normalizeLessonText(String(existing.text || ''));
  if(oldText !== incoming.text){
    changes.push({ field:'Text', kind:'text', ...summarizeTextChange(oldText, incoming.text) });
  }
  if((existing.title || '') !== incoming.title){
    changes.push({ field:'Title', kind:'value', before:existing.title || '', after:incoming.title });
  }
  const existingCourse = existing.course || existingCourseTitle || 'My Lessons';
  if(incoming.course && incoming.course !== existingCourse){
    changes.push({ field:'Course', kind:'value', before:existingCourse, after:incoming.course });
  }
  if(incoming.courseOrder !== null && incoming.courseOrder !== (existing.courseOrder ?? null)){
    changes.push({ field:'Course order', kind:'value', before:String(existing.courseOrder ?? 'automatic'), after:String(incoming.courseOrder) });
  }
  const existingWpm = existing.targetWPM != null ? existing.targetWPM : 30;
  if(incoming.targetWPM !== null && incoming.targetWPM !== existingWpm){
    changes.push({ field:'Target WPM', kind:'value', before:String(existingWpm), after:String(incoming.targetWPM) });
  }
  const existingAcc = existing.targetAccuracy != null ? existing.targetAccuracy : 95;
  if(incoming.targetAccuracy !== null && incoming.targetAccuracy !== existingAcc){
    changes.push({ field:'Target accuracy', kind:'value', before:`${existingAcc}%`, after:`${incoming.targetAccuracy}%` });
  }
  if(incoming.order !== null && incoming.order !== (existing.order ?? null)){
    changes.push({ field:'Lesson order', kind:'value', before:String(existing.order ?? 'automatic'), after:String(incoming.order) });
  }
  return { same: changes.length === 0, changes };
}

// Figures attached to a mark. Remote or relative image URLs and data:image URLs
// are allowed (data URLs are what file uploads become); other schemes such as
// javascript: or blob: are rejected before they reach an <img src>.
function normalizeMediaSrc(src){
  const s = String(src || '').trim();
  if(!s) return '';
  if(/^data:image\//i.test(s)) return s;
  if(/^https?:\/\//i.test(s)) return s;
  if(/^[a-z][a-z0-9+.-]*:/i.test(s)) return ''; // any other explicit scheme
  return s; // relative path, e.g. figures/plate-01.png
}
function normalizeMediaItem(raw, fallbackAlt = ''){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = normalizeMediaSrc(raw.src || raw.url || '');
  if(!src) return null;
  const caption = typeof raw.caption === 'string' ? raw.caption.trim().slice(0, 240) : '';
  const altText = typeof raw.alt === 'string' ? raw.alt.trim() : '';
  const alt = (altText || caption || fallbackAlt || '').slice(0, 240);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('fig'),
    src, alt, caption
  };
}
function normalizeMediaList(list, fallbackAlt = ''){
  return (Array.isArray(list) ? list : [])
    .map(item => normalizeMediaItem(item, fallbackAlt))
    .filter(Boolean);
}
// A mark with figures is a media anchor, not a highlighted/digest mark. It
// still participates in figure positioning, but it is not painted and is not
// included when turning marks into a practice digest.
function markHasFigures(mark){
  return !!(mark && Array.isArray(mark.media) && mark.media.length);
}

/* ---------------------------- tunables ---------------------------- */
// Auto-pause after this many ms without a keystroke while the clock is running
// (0 disables it). The pause is back-dated to the last keystroke, so the idle
// stretch never counts against your speed.
const IDLE_PAUSE_MS = 30000;

// What a dead key (´ ` ¨ ^ ~) leaves in the typing field while it waits for its vowel.
const ACCENT_ONLY = /^[´`¨^~˜¸¯˘˙˚˝ˇ'"\u0300-\u036F]+$/u;
const SESSION_VISITS_KEY = 'studyping.lessonVisits.v1';
const LEGACY_SESSION_VISITS_KEY = 'typingStudio.lessonVisits.v1';
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
// lesson). It can point to any built-in lesson or static JSON/Markdown lesson;
// change this id to choose what greets a new visitor. If the pack it points to
// can't be fetched (offline, local file:// preview, or the id doesn't exist),
// init() falls back to an available lesson automatically.
const DEFAULT_LESSON_ID = 'evolving-crisis-code-intro';

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
  LESSONS_KEY:'studyping.customLessons.v1',
  STATS_KEY:'studyping.stats.v1',
  PREFS_KEY:'studyping.prefs.v1',
  MARKS_KEY:'studyping.marks.v1',
  OVERRIDES_KEY:'studyping.overrides.v1',
  DELETED_KEY:'studyping.deletedLessons.v1',
  POSITIONS_KEY:'studyping.positions.v1',
  migrateLegacyData(){
    try{
      const keys = [this.LESSONS_KEY, this.STATS_KEY, this.PREFS_KEY, this.MARKS_KEY,
        this.OVERRIDES_KEY, this.DELETED_KEY, this.POSITIONS_KEY];
      keys.forEach(key => {
        const legacyKey = key.replace(/^studyping\./, 'typingStudio.');
        if(localStorage.getItem(key) === null){
          const legacyValue = localStorage.getItem(legacyKey);
          if(legacyValue !== null) localStorage.setItem(key, legacyValue);
        }
      });
    }catch(e){ console.warn('Studyping: could not migrate saved data', e); }
    try{
      if(sessionStorage.getItem(SESSION_VISITS_KEY) === null){
        const legacyVisits = sessionStorage.getItem(LEGACY_SESSION_VISITS_KEY);
        if(legacyVisits !== null) sessionStorage.setItem(SESSION_VISITS_KEY, legacyVisits);
      }
    }catch(e){ /* sessionStorage may be unavailable in private or embedded contexts */ }
  },
  loadLessons(){ try{ const raw = localStorage.getItem(this.LESSONS_KEY); return raw ? JSON.parse(raw) : []; }catch(e){ console.warn('Studyping: could not read custom lessons', e); return []; } },
  saveLessons(list){ try{ localStorage.setItem(this.LESSONS_KEY, JSON.stringify(list)); }catch(e){ console.warn('Studyping: could not save custom lessons', e); } },
  loadStats(){ try{ const raw = localStorage.getItem(this.STATS_KEY); return raw ? JSON.parse(raw) : {}; }catch(e){ return {}; } },
  saveStats(stats){ try{ localStorage.setItem(this.STATS_KEY, JSON.stringify(stats)); }catch(e){ console.warn('Studyping: could not save stats', e); } },
  loadOverrides(){ try{ const raw = localStorage.getItem(this.OVERRIDES_KEY); const v = raw ? JSON.parse(raw) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }catch(e){ return {}; } },
  saveOverrides(map){ try{ localStorage.setItem(this.OVERRIDES_KEY, JSON.stringify(map)); }catch(e){ console.warn('Studyping: could not save edits', e); } },
  loadMarks(){ try{ const raw = localStorage.getItem(this.MARKS_KEY); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }catch(e){ return []; } },
  saveMarks(list){ try{ localStorage.setItem(this.MARKS_KEY, JSON.stringify(list)); }catch(e){ console.warn('Studyping: could not save marks', e); } },
  loadPrefs(){ try{ const raw = localStorage.getItem(this.PREFS_KEY); return raw ? JSON.parse(raw) : {}; }catch(e){ return {}; } },
  savePrefs(prefs){ try{ localStorage.setItem(this.PREFS_KEY, JSON.stringify(prefs)); }catch(e){ /* ignore */ } },
  loadDeletedLessons(){ try{ const raw = localStorage.getItem(this.DELETED_KEY); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }catch(e){ console.warn('Studyping: could not read deleted lessons', e); return []; } },
  saveDeletedLessons(ids){ try{ localStorage.setItem(this.DELETED_KEY, JSON.stringify(ids)); }catch(e){ console.warn('Studyping: could not save deleted lessons', e); } },
  loadPositions(){ try{ const raw = localStorage.getItem(this.POSITIONS_KEY); const v = raw ? JSON.parse(raw) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }catch(e){ console.warn('Studyping: could not read lesson positions', e); return {}; } },
  savePositions(positions){ try{ localStorage.setItem(this.POSITIONS_KEY, JSON.stringify(positions)); }catch(e){ console.warn('Studyping: could not save lesson positions', e); } }
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
    this.slowStrikeEl = null;
    this.markedEls = [];      // chars currently carrying a mark class
    this.maskedEls = [];      // chars currently carrying a mask class
    this.deletePreviewEls = [];
    this.badgeData = [];      // checkpoint badges as data, so an inline edit can redraw them
    this.selEls = [];         // chars inside the edit selection
    this.composingEl = null;  // the char showing the "dead key is down" preview
  }
  build(text, keepScroll, formats = []){
    this.strikes.forEach(s => { s.anim.onfinish = s.anim.oncancel = null; s.anim.cancel(); });
    this.strikes.clear();
    this.slowStrikeEl = null;
    qsa('.word, .char.space, .char.whitespace, .checkpoint-badge, .strike-ghost', this.container).forEach(n=>n.remove());
    this.badges = [];
    this.badgeData = [];
    this.selEls = [];
    this.markedEls = [];
    this.maskedEls = [];
    this.deletePreviewEls = [];
    this.composingEl = null;
    this.charEls = new Array(text.length);
    this.wordIndexForChar = new Array(text.length).fill(-1);
    this.wordEls = [];
    this.wordRanges = [];
    const frag = document.createDocumentFragment();
    let formatIndex = 0;
    const addFormat = (el, index) => {
      while(formatIndex < formats.length && formats[formatIndex].end <= index) formatIndex++;
      const format = formats[formatIndex];
      if(format && index >= format.start) el.classList.add(format.style);
    };
    let currentWord = null, wordStart = -1, wIdx = -1;
    for(let i=0;i<text.length;i++){
      const ch = text[i];
      if(ch === ' ' || ch === '\n' || ch === '\t'){
        if(currentWord){ this.wordRanges.push([wordStart, i-1]); currentWord = null; }
        const sp = document.createElement('span');
        sp.className = ch === ' ' ? 'char space' : ch === '\t' ? 'char whitespace tab-char' : 'char whitespace newline-char';
        sp.dataset.idx = String(i);
        addFormat(sp, i);
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
          sp.setAttribute('aria-label', 'space character');
          sp.title = 'Space character';
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
      addFormat(cs, i);
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
  setDeletePreviews(ranges){
    this.clearDeletePreviews();
    ranges.forEach(({ start, end }) => {
      for(let i = start; i < end; i++){
        const el = this.charEls[i];
        if(el){ el.classList.add('delete-pending'); this.deletePreviewEls.push(el); }
      }
    });
  }
  clearDeletePreviews(){
    this.deletePreviewEls.forEach(el => el.classList.remove('delete-pending'));
    this.deletePreviewEls = [];
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
  restore(snap, keep, indexMap){
    const n = Math.min(keep, snap.states.length, this.charEls.length);
    for(let i = 0; i < n; i++){
      const displayIndex = indexMap ? indexMap[i] : i;
      if(snap.states[i] && this.charEls[displayIndex]) this.charEls[displayIndex].classList.add(snap.states[i]);
      this.refreshWord(displayIndex);
    }
    snap.badges.filter(b => b.charIndex < n).forEach(b => {
      this.addCheckpoint(indexMap ? { ...b, charIndex:indexMap[b.charIndex] } : b, true);
    });
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
    if(prefersReducedMotion()) return;
    const el = this.charEls[idx];
    if(!el || el.classList.contains('space')) return;
    if(!correct && el.classList.contains('masked')) return; // don't leak the answer
    if(prefersSlowUpdates()){
      if(this.slowStrikeEl) this.slowStrikeEl.classList.remove('slow-stamp');
      el.classList.add('slow-stamp');
      this.slowStrikeEl = el;
      return;
    }
    if(typeof this.container.animate !== 'function') return;
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
    this.els.modeSplit.textContent = '— / —';
    this.els.remaining.textContent = '—';
    this.lastWpm = 0;
  }
  update(stats, timing){
    this.els.wpm.textContent = String(stats.wpm);
    this.els.acc.textContent = stats.accuracy + '%';
    this.els.time.textContent = formatTime(stats.elapsedMs);
    this.els.errors.textContent = String(stats.errors);
    this.els.modeSplit.textContent = timing.typingPercent === null
      ? '— / —'
      : `${timing.typingPercent}% / ${timing.readingPercent}%`;
    this.els.modeSplit.title = timing.engagedMs > 0
      ? `Typing ${formatTime(stats.elapsedMs)} · reading ${formatTime(timing.readingMs)}`
      : 'Typing time compared with time spent in Command mode';
    this.els.remaining.textContent = timing.remainingMs === null ? '—' : formatTime(timing.remainingMs);
    this.els.remaining.title = timing.remainingMs === 0
      ? 'Lesson complete'
      : timing.estimateWpm
      ? `Estimated at ${timing.estimateWpm} wpm; excludes reading and pauses`
      : 'Type a little or complete a lesson to establish a pace estimate';
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
  staticPackMarks: [],   // default marks fetched from the same static lesson directory
  state: 'idle', // idle | ready | running | paused | finished
  pauseReason: null, // 'command' | 'edit' | 'blur' | 'window' | 'hidden' | 'idle'
  commandMode: false,
  pendingCommand: '',
  commandTimer: null,
  pendingDeletions: [],
  lastKeyAt: 0,      // performance.now() of the last keystroke, for the idle watchdog
  shadowValue: '',   // what the hidden input should currently contain
  marks: [],         // saved annotations: { id, kind:'mark'|'mask', lessonId, lessonTitle, course, text, start, end, createdAt, attempts?, clean? }
  deletedLessons: new Set(),
  exportSelection: new Set(),
  importConflict: null, // pending { info, resolve, previousFocus } while the import dialog is open
  importing: false,     // one file import at a time (each conflict waits for a click)
  markRanges: [],    // the current lesson's marks, resolved to { id, s, e }
  maskRanges: [],    // masks that are ACTIVE this run (hidden behind tape)
  soonRanges: [],    // masks created during this run: already typed, they take effect next run
  maskSet: new Set(),   // character indexes currently hidden behind tape
  freshMasks: new Set(),// ids of masks created during this run
  maskSlips: new Set(), // masked character indexes you got wrong (or needed a hint for) this run
  maskMiss: new Map(),  // masked index -> wrong guesses so far
  hinted: new Set(),    // masked indexes showing a faint hint
  masksOn: true,        // pref: actually hide masked passages
  figuresOn: true,      // pref: show the floating figure deck
  mediaDeckSlides: [],  // figures active at the current caret position
  mediaDeckIndex: 0,
  mediaDeckKey: '',
  mediaDeckHideTimer: null,
  mediaDeckCollapsed: false,
  figureFocusActive: false, // stage moved to the PiP and figure deck moved to the main stage
  figureTransitioning: false, // a view transition is currently morphing the swap
  mediaMarkId: null,    // mark currently open in the figure editor
  mediaPendingSrc: '',  // data URL chosen from a file but not added yet
  mediaReturnToMarks: false,
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
  shortcutsCollapsed: false, // pref: hide the Shortcuts list so Courses gets the full drawer height
  collapsedCourses: new Set(),
  courseSequence: [],
  keyboardHidden: true,
  currentLesson: null,
  currentCourseTitle: '',
  timerHandle: null,
  readingTimeMs: 0,
  readingStartedAt: null,
  globalAvgWpm: null,
  dom: {},

  async init(){
    Storage.migrateLegacyData();
    this.customLessons = Storage.loadLessons();
    const prefs = Storage.loadPrefs();
    this.marks = Storage.loadMarks().map(m => {
      if(!m || typeof m !== 'object') return m;
      if(!Array.isArray(m.media)) return m;
      const media = normalizeMediaList(m.media, m.text);
      const next = { ...m };
      if(media.length) next.media = media; else delete next.media;
      return next;
    });
    this.deletedLessons = new Set(Storage.loadDeletedLessons());
    this.overrides = Storage.loadOverrides();
    this.positions = Storage.loadPositions();
    try{
      const visits = JSON.parse(sessionStorage.getItem(SESSION_VISITS_KEY) || '[]');
      if(Array.isArray(visits)) this.sessionLessonVisits = new Set(visits);
    }catch(e){ /* sessionStorage may be unavailable in private or embedded contexts */ }
    this.masksOn = prefs.masksOn !== false;
    this.figuresOn = prefs.figuresOn !== false;
    this.mediaDeckCollapsed = prefs.mediaDeckCollapsed === true;
    this.escapeCommands = prefs.escapeCommands !== false;
    this.keyboardHidden = prefs.keyboardHidden !== false;
    this.shortcutsCollapsed = prefs.shortcutsCollapsed === true;
    this.collapsedCourses = new Set(
      Array.isArray(prefs.collapsedCourses) ? prefs.collapsedCourses.map(courseKey).filter(Boolean) : []
    );
    this.courseSequence = Array.isArray(prefs.courseSequence)
      ? Array.from(new Set(prefs.courseSequence.map(courseKey).filter(Boolean)))
      : [];

    this.dom = {
      menuBtn: qs('#menuBtn'), drawer: qs('#drawer'), drawerScrim: qs('#drawerScrim'), drawerCloseBtn: qs('#drawerCloseBtn'),
      shortcutPanel: qs('.shortcut-panel'), shortcutToggle: qs('#shortcutToggle'), shortcutHint: qs('#shortcutHint'),
      courseList: qs('#courseList'), newLessonBtn: qs('#newLessonBtn'),
      lessonTitle: qs('#lessonTitle'), courseTag: qs('#courseTag'), lessonGoal: qs('#lessonGoal'),
      escapeSwitch: qs('#escapeSwitch'),
      globalStats: qs('#globalStats'), globalWpm: qs('#gStatWpm'), globalAcc: qs('#gStatAcc'), globalRuns: qs('#gStatRuns'),
      sessionProgress: qs('#sessionProgress'), sessionProgressFill: qs('#sessionProgressFill'), sessionProgressPct: qs('#sessionProgressPct'),
      soundBtn: qs('#soundBtn'), themeBtn: qs('#themeBtn'),
      restartBtn: qs('#restartBtn'), typeBtn: qs('#typeBtn'),
      textDisplay: qs('#textDisplay'), caret: qs('#caret'), startCue: qs('#startCue'), startCueText: qs('#startCueText'),
      progressFill: qs('#progressFill'), captureInput: qs('#captureInput'),
      textShell: qs('#textShell'), readyPill: qs('#readyPill'), startCueSub: qs('#startCueSub'),
      stageWrap: qs('.stage-wrap'), stage: qs('#stage'),
      stagePip: qs('#stagePip'), stagePipBody: qs('#stagePipBody'),
      markPill: qs('#markPill'), marksScrim: qs('#marksScrim'), marksCloseBtn: qs('#marksCloseBtn'),
      maskPill: qs('#maskPill'), maskToggleBtn: qs('#maskToggleBtn'), figuresToggleBtn: qs('#figuresToggleBtn'),
      marksList: qs('#marksList'), marksCopyBtn: qs('#marksCopyBtn'), marksPracticeBtn: qs('#marksPracticeBtn'),
      marksExportBtn: qs('#marksExportBtn'), marksImportBtn: qs('#marksImportBtn'), marksImportFileInput: qs('#marksImportFileInput'),
      marksOpenBtn: qs('#marksOpenBtn'), marksCount: qs('#marksCount'),
      mediaDeck: qs('#mediaDeck'), mediaDeckCount: qs('#mediaDeckCount'),
      mediaDeckPrev: qs('#mediaDeckPrev'), mediaDeckNext: qs('#mediaDeckNext'),
      mediaDeckCollapse: qs('#mediaDeckCollapse'), mediaDeckBody: qs('#mediaDeckBody'),
      mediaDeckImage: qs('#mediaDeckImage'), mediaDeckCaption: qs('#mediaDeckCaption'),
      mediaDeckFallback: qs('#mediaDeckFallback'),
      mediaScrim: qs('#mediaScrim'), mediaCloseBtn: qs('#mediaCloseBtn'), mediaDone: qs('#mediaDone'),
      mediaMarkText: qs('#mediaMarkText'), mediaList: qs('#mediaList'), mediaForm: qs('#mediaForm'),
      mediaUrl: qs('#mediaUrl'), mediaCaption: qs('#mediaCaption'), mediaAlt: qs('#mediaAlt'),
      mediaFile: qs('#mediaFile'), mediaHint: qs('#mediaHint'),
      editPill: qs('#editPill'),
      statWpm: qs('#statWpm'), statAcc: qs('#statAcc'), statTime: qs('#statTime'), statErrors: qs('#statErrors'), statPosition: qs('#statPosition'),
      statModeSplit: qs('#statModeSplit'), statRemaining: qs('#statRemaining'),
      keyboardToggleRow: qs('.keyboard-toggle-row'), keyboardToggleBtn: qs('#keyboardToggleBtn'), keyboardPanel: qs('#keyboardPanel'), keyboard: qs('#keyboard'),
      modalScrim: qs('#modalScrim'), modalCloseBtn: qs('#modalCloseBtn'), modalTitle: qs('#modalTitle'), lessonForm: qs('#lessonForm'),
      actionModalScrim: qs('#actionModalScrim'), actionModalTitle: qs('#actionModalTitle'), actionModalMessage: qs('#actionModalMessage'),
      actionModalField: qs('#actionModalField'), actionModalLabel: qs('#actionModalLabel'), actionModalInput: qs('#actionModalInput'),
      actionModalClose: qs('#actionModalClose'), actionModalCancel: qs('#actionModalCancel'), actionModalConfirm: qs('#actionModalConfirm'),
      lfTitle: qs('#lfTitle'), lfCourse: qs('#lfCourse'), lfOrder: qs('#lfOrder'), lfText: qs('#lfText'), lfWpm: qs('#lfWpm'), lfAcc: qs('#lfAcc'), lfCancel: qs('#lfCancel'),
      courseNames: qs('#courseNames'),
      completeOverlay: qs('#completeOverlay'), completeLessonTitle: qs('#completeLessonTitle'),
      completeWpm: qs('#completeWpm'), completeAcc: qs('#completeAcc'), completeTime: qs('#completeTime'),
      objectivesList: qs('#objectivesList'), retryBtn: qs('#retryBtn'), nextLessonBtn: qs('#nextLessonBtn'), closeCompleteBtn: qs('#closeCompleteBtn'),
      confettiLayer: qs('#confettiLayer'),
      exportLessonsBtn: qs('#exportLessonsBtn'), selectAllLessonsBtn: qs('#selectAllLessonsBtn'),
      importLessonsBtn: qs('#importLessonsBtn'), importFileInput: qs('#importFileInput'),
      importConflictScrim: qs('#importConflictScrim'), importConflictIntro: qs('#importConflictIntro'),
      importConflictBody: qs('#importConflictBody'), importConflictApplyAll: qs('#importConflictApplyAll'),
      importConflictSkip: qs('#importConflictSkip'), importConflictNew: qs('#importConflictNew'),
      importConflictUpdate: qs('#importConflictUpdate'),
    };

    this.mediaDeckHome = this.dom.mediaDeck
      ? { parent: this.dom.mediaDeck.parentNode, nextSibling: this.dom.mediaDeck.nextSibling }
      : null;
    // Keep the invisible typing field outside .stage: the stage is reparented
    // into the PiP when a figure appears, and moving a focused field would blur
    // it (and auto-pause the clock).
    if(this.dom.captureInput && this.dom.stageWrap) this.dom.stageWrap.appendChild(this.dom.captureInput);
    this.textView = new TextView(this.dom.textDisplay, this.dom.caret);
    this.keyboardView = new KeyboardView(this.dom.keyboard);
    this.statsView = new StatsView({
      wpm:this.dom.statWpm, acc:this.dom.statAcc, time:this.dom.statTime, errors:this.dom.statErrors,
      position:this.dom.statPosition, modeSplit:this.dom.statModeSplit, remaining:this.dom.statRemaining
    });

    // theme
    this.setTheme(
      prefs.theme === 'light' || prefs.theme === 'dark' || prefs.theme === 'gray' ? prefs.theme : 'system',
      false
    );
    // sound
    if(prefs.sound === false) this.sound.enabled = false;
    this.updateSoundButton();
    this.applyKeyboardCollapsed();

    this.wireEvents();
    this.updateMaskToggleBtn();
    this.updateFiguresToggleBtn();
    this.applyMediaDeckCollapsed();
    this.updateMarksCount();
    this.updateEscapeSwitch();
    this.applyShortcutCollapsed();
    this.updateGlobalStats();

    // Load the manifest before rendering or selecting the first lesson. The
    // default lesson may live in a static pack, and rendering first would
    // leave Firefox showing the built-in courses if the network is a little
    // slower than the old startup timeout.
    await this.fetchStaticPacks();

    const defaultPackLesson = this.findLesson(DEFAULT_LESSON_ID);
    const startId = prefs.lastLessonId;
    const startLesson = startId ? this.findLesson(startId) : null;
    const firstAvailable = this.getAllCourses()
      .flatMap(course => course.lessons.map(lesson => ({ lesson, courseTitle:course.title })))[0];
    const toLoad = startLesson || defaultPackLesson || firstAvailable;
    // Apply the collapsed-by-default behavior once, preserving later user toggles.
    if(prefs.courseCollapseVersion !== 1){
      const activeCourse = toLoad ? courseKey(toLoad.courseTitle) : '';
      this.collapsedCourses = new Set(
        this.getAllCourses().map(course => courseKey(course.title)).filter(key => key && key !== activeCourse)
      );
      this.savePref('collapsedCourses', Array.from(this.collapsedCourses));
      this.savePref('courseCollapseVersion', 1);
    }else if(toLoad && this.collapsedCourses.delete(courseKey(toLoad.courseTitle))){
      this.savePref('collapsedCourses', Array.from(this.collapsedCourses));
    }
    this.renderSidebar();
    if(toLoad) this.loadLesson(toLoad.lesson, toLoad.courseTitle);
    if(this.staticPackMarks.length) this.importMarks(this.staticPackMarks, { fresh:false });
  },

  /* ----- static lesson packs (git-managed files under ./lessons/) -----
     These are YOUR curated content: commit JSON or Markdown files under lessons/,
     list their filenames in lessons/index.json, push, and every visitor sees them
     on next load — no code changes needed. If the fetch fails, the app just falls
     back to the built-in DEFAULT_COURSES above; nothing breaks. */
  async fetchStaticPacks(){
    this.staticPackMarks = [];
    try{
      const manifestUrl = new URL('lessons/index.json', document.baseURI);
      const res = await fetch(manifestUrl, { cache:'no-store' });
      if(!res.ok) throw new Error(`manifest request failed (${res.status})`);
      const files = await res.json();
      if(!Array.isArray(files)) throw new Error('manifest is not an array');
      const packs = await Promise.all(files.map(async (name) => {
        if(typeof name !== 'string') return null;
        try{
          const packUrl = new URL(`lessons/${encodeURIComponent(name)}`, document.baseURI);
          const r = await fetch(packUrl, { cache:'no-store' });
          if(!r.ok) throw new Error(`request failed (${r.status})`);
          if(/\.(?:md|txt)$/i.test(name)){
            const lesson = parseMarkdownLessonFile(await r.text(), name);
            return { course:lesson.course, order:lesson.courseOrder, lessons:[lesson] };
          }
          const pack = await r.json();
          if(!pack || typeof pack !== 'object' ||
             (!Array.isArray(pack.lessons) && !Array.isArray(pack.marks))) return null;
          return pack;
        }catch(e){
          console.warn(`Studyping: unable to load "${name}" —`, e.message);
          return null;
        }
      }));
      this.staticPackCourses = packs.filter(p => p && Array.isArray(p.lessons)).map(p => ({
        title: p.course || 'More Lessons',
        order: optionalOrder(p.order),
        lessons: p.lessons
          .filter(l => l && typeof l === 'object' && l.text && l.title)
          .map(l => ({
            ...l,
            id: l.id || uid('pack'),
            course: l.course || p.course || 'More Lessons',
            order: optionalOrder(l.order)
          }))
      }));
      this.staticPackMarks = packs
        .filter(p => p && Array.isArray(p.marks))
        .flatMap(p => p.marks);
    }catch(e){
      this.staticPackCourses = [];
      console.info('Studyping: no static lesson packs loaded —', e.message);
    }
  },

  /* ----- data access ----- */
  withOverride(l){
    // Built-in and static-pack lessons are never mutated. Visitor edits and metadata
    // changes are stored by lesson id so marks and best scores stay attached.
    if(l.custom) return l;
    const ov = this.overrides[l.id];
    if(ov === undefined) return l;
    if(typeof ov === 'string') return { ...l, text:ov, edited:true, originalText:l.text };
    if(!ov || typeof ov !== 'object' || Array.isArray(ov)) return l;
    return {
      ...l,
      ...(typeof ov.text === 'string' ? { text:ov.text, edited:true, originalText:l.text } : {}),
      ...(typeof ov.title === 'string' ? { title:ov.title } : {}),
      ...(typeof ov.course === 'string' ? { course:ov.course } : {}),
      ...(Number.isFinite(ov.targetWPM) ? { targetWPM:ov.targetWPM } : {}),
      ...(Number.isFinite(ov.targetAccuracy) ? { targetAccuracy:ov.targetAccuracy } : {}),
      ...(Number.isFinite(ov.order) ? { order:ov.order } : {}),
      ...(Number.isFinite(ov.courseOrder) ? { courseOrder:ov.courseOrder } : {}),
      metadataEdited: typeof ov.title === 'string' || typeof ov.course === 'string' ||
        Number.isFinite(ov.targetWPM) || Number.isFinite(ov.targetAccuracy) ||
        Number.isFinite(ov.order) || Number.isFinite(ov.courseOrder)
    };
  },
  // One canonical entry per lesson id. Sources overlap on purpose — an export can be
  // dropped into lessons/ next to the pack it came from, and older imports are still
  // in localStorage — so the same id must never be rendered twice. Priority is
  // custom > static pack > built-in (the visitor's own copy wins), and within the
  // same tier the later source wins (a newly appended pack supersedes an older one).
  getCanonicalLessons(){
    const chosen = new Map();
    let order = 0;
    const consider = (kind, priority, raw, sourceCourseTitle, sourceCourseOrder = null) => {
      const lesson = this.withOverride(raw);
      if(!lesson || !lesson.id) return;
      const entry = {
        kind, priority, raw, lesson, sourceCourseTitle,
        courseTitle: lesson.course || sourceCourseTitle || 'My Lessons',
        courseOrder: lesson.courseOrder ?? sourceCourseOrder,
        order: order++
      };
      const previous = chosen.get(lesson.id);
      if(!previous || priority > previous.priority ||
         (priority === previous.priority && entry.order > previous.order)){
        chosen.set(lesson.id, entry);
      }
    };
    DEFAULT_COURSES.forEach(course => course.lessons.forEach(l => consider('builtin', 1, l, course.title, optionalOrder(course.order))));
    this.staticPackCourses.forEach(course => course.lessons.forEach(l => consider('static', 2, l, course.title, course.order)));
    this.customLessons.forEach(l => consider('custom', 3, l, l.course || 'My Lessons', optionalOrder(l.courseOrder)));
    return Array.from(chosen.values()).sort((a, b) => a.order - b.order);
  },
  getAllCourses(){
    const map = new Map();
    this.getCanonicalLessons().forEach(entry => {
      const lesson = entry.lesson;
      if(this.deletedLessons.has(lesson.id)) return;
      const title = lesson.course || entry.courseTitle || 'My Lessons';
      const key = title.toLowerCase();
      if(!map.has(key)) map.set(key, { title, order:entry.courseOrder, sourceOrder:entry.order, lessons:[] });
      const group = map.get(key);
      if(group.order === null && entry.courseOrder !== null) group.order = entry.courseOrder;
      group.lessons.push({ lesson, order:lesson.order ?? null, sourceOrder:entry.order });
    });
    return Array.from(map.values()).filter(c => c.lessons.length)
      .sort((a, b) => {
        const ai = this.courseSequence.indexOf(courseKey(a.title));
        const bi = this.courseSequence.indexOf(courseKey(b.title));
        if(ai >= 0 && bi >= 0) return ai - bi;
        if(ai >= 0) return -1;
        if(bi >= 0) return 1;
        return compareOrdered(a, b);
      })
      .map(course => ({
        title:course.title,
        order:course.order,
        lessons:course.lessons
          .sort((a, b) => compareOrdered(a, b))
          .map(item => item.lesson)
      }));
  },
  findLesson(id){
    const entry = this.getCanonicalLessons().find(e => e.lesson.id === id);
    if(!entry || this.deletedLessons.has(entry.lesson.id)) return null;
    return { lesson:entry.lesson, courseTitle:entry.courseTitle };
  },
  findLessonEntry(id){
    // Unlike findLesson(), this also sees a deleted lesson and ignores the deletion:
    // an import of that id should resolve the conflict and can restore it.
    return this.getCanonicalLessons().find(e => e.lesson.id === id) || null;
  },

  /* ----- sidebar ----- */
  closeLessonMenu(menu){
    const menuList = Array.from(document.querySelectorAll('.lesson-menu-list'))
      .find(list => list.dataset.menuId === menu.dataset.menuId);
    if(menuList){
      menuList.hidePopover?.();
      menuList.classList.remove('open');
      menu.appendChild(menuList);
    }
    menu.classList.remove('open');
  },
  closeOpenLessonMenus(){
    this.dom.courseList.querySelectorAll('.lesson-menu.open').forEach(menu => this.closeLessonMenu(menu));
  },
  positionLessonMenu(menuList, trigger){
    const anchor = trigger.getBoundingClientRect();
    const gap = 4;
    const edge = 8;
    menuList.style.maxHeight = '';
    const { width, height } = menuList.getBoundingClientRect();
    const left = Math.max(edge, Math.min(anchor.right - width, window.innerWidth - width - edge));
    const spaceAbove = Math.max(0, anchor.top - gap - edge);
    const spaceBelow = Math.max(0, window.innerHeight - anchor.bottom - gap - edge);
    const placeBelow = height <= spaceBelow || spaceBelow >= spaceAbove;
    const availableHeight = placeBelow ? spaceBelow : spaceAbove;
    menuList.style.maxHeight = `${availableHeight}px`;
    const fittedHeight = menuList.getBoundingClientRect().height;
    const top = placeBelow ? anchor.bottom + gap : anchor.top - fittedHeight - gap;
    menuList.style.left = `${left}px`;
    menuList.style.top = `${Math.max(edge, Math.min(top, window.innerHeight - fittedHeight - edge))}px`;
  },
  renderSidebar(){
    this.closeOpenLessonMenus();
    const courses = this.getAllCourses();
    const stats = Storage.loadStats();
    this.dom.courseList.innerHTML = '';
    this.dom.courseNames.innerHTML = '';
    const seenCourseNames = new Set();
    courses.forEach((course, courseIndex) => {
      if(!seenCourseNames.has(course.title)){
        seenCourseNames.add(course.title);
        const opt = document.createElement('option');
        opt.value = course.title;
        this.dom.courseNames.appendChild(opt);
      }
      const group = document.createElement('div');
      group.className = 'course-group';
      group.draggable = true;
      group.dataset.courseDrag = course.title;
      const collapsed = this.collapsedCourses.has(courseKey(course.title));
      const head = document.createElement('div');
      head.className = 'course-head';
      const h3 = document.createElement('h3');
      h3.textContent = course.title;
      const listId = `course-lessons-${slugify(course.title)}-${courseIndex}`;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'course-toggle';
      toggle.dataset.courseToggle = course.title;
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-controls', listId);
      toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${course.title}`);
      toggle.title = `${collapsed ? 'Expand' : 'Collapse'} ${course.title}`;
      toggle.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>';
      const summary = document.createElement('div');
      summary.className = 'course-summary';
      summary.dataset.courseSummary = course.title;
      const summaryText = document.createElement('span');
      summaryText.className = 'course-summary-text';
      const progress = document.createElement('span');
      progress.className = 'course-progress';
      progress.setAttribute('role', 'progressbar');
      progress.setAttribute('aria-valuemin', '0');
      progress.setAttribute('aria-valuemax', String(course.lessons.length));
      const progressFill = document.createElement('span');
      progressFill.className = 'course-progress-fill';
      progress.appendChild(progressFill);
      summary.append(summaryText, progress);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'course-add';
      add.dataset.courseNew = course.title;
      add.title = `New lesson in ${course.title}`;
      add.setAttribute('aria-label', `New lesson in ${course.title}`);
      add.innerHTML = '<svg viewBox="0 0 20 20"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>';
      head.append(h3, toggle, summary, add);
      this.updateCourseSummary(summary, course, stats);
      group.appendChild(head);
      const lessonList = document.createElement('div');
      lessonList.className = 'course-lessons';
      lessonList.id = listId;
      lessonList.setAttribute('aria-hidden', String(collapsed));
      lessonList.inert = collapsed;
      const ul = document.createElement('ul');
      group.classList.toggle('collapsed', collapsed);
      course.lessons.forEach(lesson => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'lesson-item';
        btn.draggable = true;
        btn.dataset.id = lesson.id;
        if(this.currentLesson && this.currentLesson.id === lesson.id) btn.classList.add('active');
        const exportBox = document.createElement('input');
        exportBox.type = 'checkbox';
        exportBox.className = 'lesson-export';
        exportBox.checked = this.exportSelection.has(lesson.id);
        exportBox.dataset.exportId = lesson.id;
        exportBox.title = 'Select this lesson for export';
        exportBox.setAttribute('aria-label', `Select ${lesson.title} for export`);
        btn.appendChild(exportBox);
        const titleSpan = document.createElement('span');
        titleSpan.className = 'lt-title';
        titleSpan.textContent = lesson.title;
        titleSpan.title = lesson.title;
        btn.appendChild(titleSpan);
        {
          const menu = document.createElement('span');
          menu.className = 'lesson-menu';
          menu.dataset.menuId = lesson.id;
          const trigger = document.createElement('span');
          trigger.className = 'lesson-menu-trigger';
          trigger.title = 'Lesson actions';
          trigger.setAttribute('role', 'button');
          trigger.setAttribute('aria-label', `Actions for ${lesson.title}`);
          trigger.innerHTML = '<svg viewBox="0 0 20 20"><circle cx="4" cy="10" r="1.25"/><circle cx="10" cy="10" r="1.25"/><circle cx="16" cy="10" r="1.25"/></svg>';
          menu.appendChild(trigger);
          const menuList = document.createElement('span');
          menuList.className = 'lesson-menu-list';
          menuList.setAttribute('popover', 'manual');
          menuList.dataset.menuId = lesson.id;
          const rename = document.createElement('span');
          rename.className = 'lesson-menu-action';
          rename.dataset.action = 'rename';
          rename.textContent = 'Rename lesson';
          const assign = document.createElement('span');
          assign.className = 'lesson-menu-action';
          assign.dataset.action = 'assign-course';
          assign.textContent = 'Assign to course';
          const setOrder = document.createElement('span');
          setOrder.className = 'lesson-menu-action';
          setOrder.dataset.action = 'set-order';
          setOrder.textContent = 'Set lesson order';
          menuList.append(rename, assign, setOrder);
          // Restore only exists when an override is actually stored. Pack exports
          // can carry an `edited` flag of their own, but there is nothing to restore
          // until this browser has saved an edit.
          if(this.overrides[lesson.id] !== undefined){
            const restore = document.createElement('span');
            restore.className = 'lesson-menu-action';
            restore.dataset.action = 'restore';
            restore.textContent = 'Restore original';
            menuList.appendChild(restore);
          }
          const del = document.createElement('span');
          del.className = 'lesson-menu-action danger';
          del.dataset.action = 'delete';
          del.textContent = 'Delete lesson';
          menuList.appendChild(del);
          menu.appendChild(menuList);
          btn.appendChild(menu);
        }
        const best = stats[lesson.id];
        if(best && best.bestWpm){
          const meta = document.createElement('span');
          meta.className = 'lesson-meta';
          meta.textContent = `★ ${best.bestWpm}`;
          btn.appendChild(meta);
        }
        li.appendChild(btn);
        ul.appendChild(li);
      });
      lessonList.appendChild(ul);
      group.appendChild(lessonList);
      this.dom.courseList.appendChild(group);
    });
    this.updateExportButton();
  },
  updateCourseSummary(node, course, stats){
    const results = course.lessons
      .map(lesson => stats[lesson.id])
      .filter(result => {
        if(!result || typeof result !== 'object' || Array.isArray(result)) return false;
        const attempts = finiteStat(result.attempts) || 0;
        const wpm = finiteStat(result.bestWpm);
        const accuracy = finiteStat(result.bestAccuracy);
        const lastAt = finiteStat(result.lastAt);
        return attempts > 0 || (wpm !== null && wpm > 0) ||
          (accuracy !== null && accuracy >= 0 && accuracy <= 100) ||
          (lastAt !== null && lastAt > 0);
      });
    const average = key => {
      const values = results.map(result => finiteStat(result[key])).filter(value =>
        value !== null && (key !== 'bestAccuracy' || (value >= 0 && value <= 100)) &&
        (key !== 'bestWpm' || value > 0 || (finiteStat(result.attempts) || 0) > 0)
      );
      return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    };
    const completed = results.length;
    const avgWpm = average('bestWpm');
    const avgAccuracy = average('bestAccuracy');
    const total = course.lessons.length;
    const text = node.querySelector('.course-summary-text');
    const progress = node.querySelector('.course-progress');
    const fill = node.querySelector('.course-progress-fill');
    const label = `${completed}/${total} complete · Avg ${avgWpm === null ? '—' : `${avgWpm} WPM`} · ${avgAccuracy === null ? '—' : `${avgAccuracy}% acc`}`;
    text.textContent = label;
    progress.setAttribute('aria-valuenow', String(completed));
    progress.setAttribute('aria-label', `${course.title}: ${completed} of ${total} lessons completed`);
    fill.style.width = `${total ? completed / total * 100 : 0}%`;
    node.title = `${course.title}: ${completed} of ${total} lessons completed. Average per-lesson best: ${avgWpm === null ? 'no speed yet' : `${avgWpm} WPM`}, ${avgAccuracy === null ? 'no accuracy yet' : `${avgAccuracy}% accuracy`}.`;
  },
  updateCourseSummaries(){
    const stats = Storage.loadStats();
    const courses = new Map(this.getAllCourses().map(course => [courseKey(course.title), course]));
    this.dom.courseList.querySelectorAll('.course-summary').forEach(node => {
      const course = courses.get(courseKey(node.dataset.courseSummary));
      if(course) this.updateCourseSummary(node, course, stats);
    });
  },
  renderSidebarBest(id){
    // Mirrors the ★ span renderSidebar() builds, without rebuilding the list.
    // Updating in place keeps the drawer's scroll and focus exactly where they
    // were when the lesson finished.
    const stats = Storage.loadStats();
    const best = stats[id];
    const rows = Array.from(this.dom.courseList.querySelectorAll('.lesson-item'))
      .filter(row => row.dataset.id === id);
    rows.forEach(row => {
      let meta = Array.from(row.children).find(el => el.classList && el.classList.contains('lesson-meta'));
      if(best && best.bestWpm){
        if(!meta){
          meta = document.createElement('span');
          meta.className = 'lesson-meta';
          row.appendChild(meta);
        }
        meta.textContent = `★ ${best.bestWpm}`;
      } else if(meta){
        meta.remove();
      }
    });
    this.updateCourseSummaries();
  },
  saveOrderedLessons(courseTitle, lessons){
    lessons.forEach((lesson, index) => {
      const order = (index + 1) * 10;
      const entry = this.findLessonEntry(lesson.id);
      if(!entry) return;
      if(entry.kind === 'custom'){
        const target = this.customLessons.slice().reverse().find(item => item.id === lesson.id);
        if(target) target.order = order;
      }else{
        const current = this.overrides[lesson.id];
        const override = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
        override.order = order;
        this.overrides[lesson.id] = override;
      }
    });
    Storage.saveLessons(this.customLessons);
    Storage.saveOverrides(this.overrides);
    this.renderSidebar();
  },
  saveOrderedCourses(courseTitles){
    this.courseSequence = courseTitles.map(courseKey).filter(Boolean);
    this.savePref('courseSequence', this.courseSequence);
    this.renderSidebar();
  },
  handleSidebarDrop(e){
    e.preventDefault();
    const drag = this._drag;
    this._drag = null;
    this.dom.courseList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if(!drag) return;
    const lessonTarget = e.target.closest('.lesson-item');
    if(drag.type === 'lesson' && lessonTarget){
      const source = this.getAllCourses().find(course => course.lessons.some(lesson => lesson.id === drag.id));
      const target = this.getAllCourses().find(course => course.lessons.some(lesson => lesson.id === lessonTarget.dataset.id));
      if(!source || !target || source.title.toLowerCase() !== target.title.toLowerCase()) return;
      const lessons = source.lessons.filter(lesson => lesson.id !== drag.id);
      const targetIndex = lessons.findIndex(lesson => lesson.id === lessonTarget.dataset.id);
      lessons.splice(targetIndex < 0 ? lessons.length : targetIndex, 0, source.lessons.find(lesson => lesson.id === drag.id));
      this.saveOrderedLessons(source.title, lessons);
      return;
    }
    if(drag.type === 'course'){
      const target = e.target.closest('.course-group');
      if(!target) return;
      const titles = Array.from(this.dom.courseList.querySelectorAll('.course-group')).map(group => group.dataset.courseDrag);
      const from = titles.indexOf(drag.title);
      const to = titles.indexOf(target.dataset.courseDrag);
      if(from < 0 || to < 0 || from === to) return;
      titles.splice(from, 1);
      titles.splice(to, 0, drag.title);
      this.saveOrderedCourses(titles);
    }
  },
  renderSidebarActive(){
    // Switching lessons only changes which row is highlighted. Rebuilding the
    // whole drawer here reset its scroll position and made any duplicate rows
    // visible all over again, so move the .active class instead.
    const id = this.currentLesson ? this.currentLesson.id : null;
    this.dom.courseList.querySelectorAll('.lesson-item').forEach(row => {
      row.classList.toggle('active', row.dataset.id === id);
    });
  },
  updateExportButton(){
    const lessons = this.getAllCourses().flatMap(course => course.lessons);
    const lessonIds = new Set(lessons.map(l => l.id));
    const selected = Array.from(lessonIds).filter(id => this.exportSelection.has(id)).length;
    this.dom.exportLessonsBtn.textContent = selected ? `Export selected (${selected})` : 'Export selected';
    this.dom.selectAllLessonsBtn.textContent = selected === lessonIds.size && selected ? 'Clear selection' : 'Select all';
  },
  toggleAllLessonSelection(){
    const ids = Array.from(new Set(this.getAllCourses().flatMap(course => course.lessons).map(l => l.id)));
    const allSelected = ids.length > 0 && ids.every(id => this.exportSelection.has(id));
    ids.forEach(id => {
      if(allSelected) this.exportSelection.delete(id);
      else this.exportSelection.add(id);
    });
    this.renderSidebar();
  },

  /* ----- lesson lifecycle ----- */
  loadLesson(lesson, courseTitle, opts = {}){
    if(this.editing) this.endInlineEdit(true); // switching lessons keeps what you edited
    this.clearPendingDeletions();
    const nextCourseTitle = courseTitle || lesson.course || '';
    const openedCourse = this.collapsedCourses.delete(courseKey(nextCourseTitle));
    if(openedCourse) this.savePref('collapsedCourses', Array.from(this.collapsedCourses));
    this.currentLesson = lesson;
    this.readingTimeMs = 0;
    this.readingStartedAt = null;
    this.lessonIntro = !this.sessionLessonVisits.has(lesson.id);
    if(this.lessonIntro){
      this.sessionLessonVisits.add(lesson.id);
      try{ sessionStorage.setItem(SESSION_VISITS_KEY, JSON.stringify([...this.sessionLessonVisits])); }catch(e){ /* continue without session persistence */ }
    }
    this.commandMode = false;
    this.clearCommandBuffer();
    this.templateUndo = [];
    this.templateRedo = [];
    this.currentCourseTitle = nextCourseTitle;
    this.lessonSource = normalizeLessonText(lesson.text);
    this.lessonMarkdown = parseInlineMarkdown(this.lessonSource);
    this.engine = new TypingEngine({ ...lesson, text:this.lessonMarkdown.text });
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
    this.textView.build(this.engine.text, false, this.lessonMarkdown.formats);
    for(let i = 0; i < savedPosition; i++) this.textView.setCharState(i, 'correct');
    this.textView.moveCaret(savedPosition);
    this.keyboardView.clearNext();
    this.keyboardView.highlightNext(this.engine.text[0]);
    this.statsView.reset();
    this.state = 'idle';
    this.updateTypingPosition();
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
    this.syncCourseCollapse(this.currentCourseTitle);
    this.renderSidebarActive();
    this.bus.dispatchEvent(new CustomEvent('lessonLoaded', { detail:{ lessonId:lesson.id } }));
    if(!this.lessonIntro && (opts.ready || savedPosition > 0)) this.beginReady(); // resume unfinished lessons without requiring the first key to wake the app
  },

  restart(){
    if(!this.engine) return;
    if(this.editing) this.endInlineEdit(true);
    this.readingTimeMs = 0;
    this.readingStartedAt = null;
    this.clearPendingDeletions();
    this.commandMode = false;
    this.clearCommandBuffer();
    this.templateUndo = [];
    this.templateRedo = [];
    this.engine.reset();
    delete this.positions[this.currentLesson.id];
    Storage.savePositions(this.positions);
    this.textView.build(this.engine.text, false, this.lessonMarkdown.formats);
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
    this.updateSessionProgress(0);
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
    this.updateStats();
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
  moveCaretTo(position){
    const target = clamp(position, 0, this.engine.text.length);
    this.engine.pos = target;
    this.dom.captureInput.value = this.engine.text.slice(0, target);
    this.shadowValue = this.dom.captureInput.value;
    this.textView.moveCaret(target);
    this.updateTypingPosition();
    this.updateProgress();
    this.saveCursorPosition();
    this.hintNext();
  },
  countWordsInRange(start, end){
    let words = 0, previousWord = -1;
    for(let i = start; i < end; i++){
      const word = this.textView.wordIndexForChar[i];
      if(word >= 0 && word !== previousWord){ words++; previousWord = word; }
    }
    return words;
  },
  countPendingDeletionWords(){
    return this.pendingDeletions.reduce((total, range) => total + this.countWordsInRange(range.start, range.end), 0);
  },
  remapPendingDeletions(before, after){
    if(!this.pendingDeletions.length || before === after) return;
    const prefix = commonPrefix(before, after);
    const sharedLength = Math.min(before.length, after.length);
    const suffix = Math.min(commonSuffix(before, after), sharedLength - prefix);
    const oldChangedEnd = before.length - suffix;
    const delta = after.length - before.length;
    const remapped = [];
    this.pendingDeletions.forEach(range => {
      if(range.start < prefix){
        const end = Math.min(range.end, prefix);
        if(range.start < end) remapped.push({ start:range.start, end });
      }
      if(range.end > oldChangedEnd){
        const start = Math.max(range.start, oldChangedEnd) + delta;
        const end = range.end + delta;
        if(start < end) remapped.push({ start, end });
      }
    });
    this.pendingDeletions = [];
    remapped.sort((a, b) => a.start - b.start).forEach(range => {
      const previous = this.pendingDeletions[this.pendingDeletions.length - 1];
      if(previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else this.pendingDeletions.push(range);
    });
  },
  renderPendingDeletions(){
    if(this.textView && this.pendingDeletions.length) this.textView.setDeletePreviews(this.pendingDeletions);
  },
  addPendingDeletion(start, end){
    if(start >= end) return;
    const ranges = [...this.pendingDeletions, { start, end }]
      .sort((a, b) => a.start - b.start);
    this.pendingDeletions = [];
    ranges.forEach(range => {
      const previous = this.pendingDeletions[this.pendingDeletions.length - 1];
      if(previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else this.pendingDeletions.push({ ...range });
    });
    this.textView.setDeletePreviews(this.pendingDeletions);
  },
  stageWordDeletion(direction){
    if(!this.engine || (this.state !== 'ready' && this.state !== 'running' && !(this.commandMode && this.state === 'paused')) || this.editing) return;
    const text = this.engine.text;
    const current = this.engine.pos;
    let target = current;
    if(direction === 'forward'){
      while(target < text.length && /\s/.test(text[target])) target++;
      while(target < text.length && !/\s/.test(text[target])) target++;
      while(target < text.length && /\s/.test(text[target])) target++;
    } else {
      while(target > 0 && /\s/.test(text[target - 1])) target--;
      while(target > 0 && !/\s/.test(text[target - 1])) target--;
    }
    if(target === current) return;
    const start = direction === 'forward' ? current : target;
    const end = direction === 'forward' ? target : current;
    this.addPendingDeletion(start, end);
    this.moveCaretTo(target);
    this.showPendingDeletionStatus();
  },
  showPendingDeletionStatus(){
    const words = this.countPendingDeletionWords();
    if(words) this.showPill('edit', `${words} word${words === 1 ? '' : 's'} queued · D commits · q clears · Esc returns`);
  },
  clearPendingDeletions(){
    if(!this.pendingDeletions.length) return;
    this.pendingDeletions = [];
    this.textView.clearDeletePreviews();
  },
  commitPendingDeletions(){
    if(!this.pendingDeletions.length) return;
    const ranges = this.pendingDeletions.map(range => ({ ...range }));
    const words = this.countPendingDeletionWords();
    const text = this.engine.text;
    const snapshot = this.textView.snapshot(text.length);
    const originalPosition = this.engine.pos;
    const removedAt = (index) => ranges.some(range => index >= range.start && index < range.end);
    const adjustedIndex = (index) => {
      let removed = 0;
      ranges.forEach(range => {
        if(range.end <= index) removed += range.end - range.start;
      });
      return index - removed;
    };
    const states = [];
    let position = originalPosition;
    for(let i = 0; i < text.length; i++){
      if(removedAt(i)){
        if(i < originalPosition) position--;
        continue;
      }
      states[adjustedIndex(i)] = snapshot.states[i];
    }
    const badges = snapshot.badges
      .filter(badge => !removedAt(badge.charIndex))
      .map(badge => ({ ...badge, charIndex:adjustedIndex(badge.charIndex) }));
    let newText = text;
    [...ranges].reverse().forEach(range => {
      newText = newText.slice(0, range.start) + newText.slice(range.end);
    });
    newText = normalizeLessonText(newText);
    if(!newText){
      this.showPill('edit', 'Cannot delete the entire lesson', 1600);
      return;
    }
    this.clearPendingDeletions();
    this.recordTemplateUndo(text, originalPosition, { pendingDeletions:ranges });
    ranges.slice().reverse().forEach(range => this.adjustCapturesForDeletion(range.start, range.end));
    this.persistEdit(newText);
    const nextPosition = clamp(position, 0, newText.length);
    this.engine.replaceText(newText, nextPosition);
    this.textView.build(newText, true, this.lessonMarkdown.formats);
    this.textView.restore({ states, badges }, newText.length);
    this.renderPendingDeletions();
    this.dom.captureInput.value = newText.slice(0, nextPosition);
    this.shadowValue = this.dom.captureInput.value;
    this.textView.moveCaret(nextPosition);
    this.updateTypingPosition();
    this.updateProgress();
    this.saveCursorPosition();
    this.hintNext();
    this.refreshOverlays();
    this.bus.dispatchEvent(new CustomEvent('lessonEdited', { detail:{ lessonId:this.currentLesson.id } }));
    this.showPill('edit', `${words} word${words === 1 ? '' : 's'} deleted`, 1200);
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
  recordTemplateUndo(text, pos, options = {}){
    this.templateUndo.push({
      lessonId:this.currentLesson.id,
      text,
      sourceText:options.sourceText === undefined ? this.lessonSource : options.sourceText,
      pos,
      pendingDeletions:(options.pendingDeletions || this.pendingDeletions).map(range => ({ ...range }))
    });
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
    const sourceText = entry.sourceText === undefined ? entry.text : entry.sourceText;
    const parsed = parseInlineMarkdown(sourceText);
    const pos = Math.min(entry.pos, parsed.text.length);
    this.persistEdit(parsed.text, { sourceText });
    this.engine.replaceText(parsed.text, pos);
    this.textView.build(this.engine.text, true, this.lessonMarkdown.formats);
    this.textView.restore(snapshot, Math.min(pos, snapshot.states.length));
    if(entry.pendingDeletions) this.pendingDeletions = entry.pendingDeletions.map(range => ({ ...range }));
    this.renderPendingDeletions();
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
    this.templateRedo.push({
      lessonId:this.currentLesson.id,
      text:this.engine.text,
      sourceText:this.lessonSource,
      pos:this.engine.pos,
      pendingDeletions:this.pendingDeletions.map(range => ({ ...range }))
    });
    this.trimTemplateHistory(this.templateRedo);
    this.applyTemplateHistoryEntry(entry);
  },
  redoTemplateEdit(){
    const entry = this.templateRedo.pop();
    if(!entry || entry.lessonId !== this.currentLesson.id) return;
    this.templateUndo.push({
      lessonId:this.currentLesson.id,
      text:this.engine.text,
      sourceText:this.lessonSource,
      pos:this.engine.pos,
      pendingDeletions:this.pendingDeletions.map(range => ({ ...range }))
    });
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
  enterCommandMode(fromEscapeSwitch = false){
    if(this.editing || this.commandMode || !this.engine ||
       (this.state !== 'running' && this.state !== 'ready' && this.state !== 'finished' &&
        !(fromEscapeSwitch && this.state === 'paused' && this.pauseReason === 'blur'))) return;
    this.commandMode = true;
    this.clearCommandBuffer();
    if(this.state === 'running') this.pauseTyping('command');
    this.updateStats();
    this.updateOverlay();
    this.showPill('edit', this.pendingDeletions.length
      ? `${this.countPendingDeletionWords()} word${this.countPendingDeletionWords() === 1 ? '' : 's'} queued · D commits · q clears · Esc returns`
      : 'COMMAND mode · t for typing mode · i to edit');
    this.focusInput();
  },
  leaveCommandMode(){
    if(!this.commandMode) return;
    this.stopReadingClock();
    this.stopTicker();
    this.commandMode = false;
    this.clearCommandBuffer();
    if(this.pendingDeletions.length){
      const words = this.countPendingDeletionWords();
      this.showPill('edit', `${words} word${words === 1 ? '' : 's'} queued · D commits · q clears`);
    } else {
      this.hidePill('edit');
    }
    if(this.state === 'paused' && this.pauseReason === 'command') this.resumeTyping();
    else {
      this.updateStats();
      this.updateOverlay();
    }
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
  startInlineEdit(){
    // Shared by `i` and `cw`: drop Command-mode chrome, then edit the lesson at the caret.
    this.stopReadingClock();
    this.stopTicker();
    this.commandMode = false;
    this.clearCommandBuffer();
    this.hidePill('edit');
    this.toggleInlineEdit();
  },
  changeCurrentWord(){
    // Vim's `cw` behaves here exactly like `dw` followed by `i`: delete the current word,
    // then start editing in its place.
    this.deleteCurrentWord();
    this.startInlineEdit();
  },
  handleCommandKeydown(e){
    if(!this.commandMode) return false;
    if(e.key === 'Escape' && !this.escapeCommands && !this.pendingDeletions.length) return false;
    e.preventDefault();
    const key = e.key;
    if(key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return true;
    const navigationKey = !this.pendingCommand && (key === 'n' || key === 'b');
    if(!navigationKey){
      const wasReading = this.readingStartedAt !== null;
      this.stopReadingClock();
      this.stopTicker();
      if(wasReading) this.updateStats();
    }
    if(key === 'Escape'){
      if(this.escapeCommands) this.leaveCommandMode();
      else this.clearCommandBuffer();
      return true;
    }
    if(this.pendingCommand.startsWith(':')){
      if(/^\d$/.test(key) || /^[a-z ]$/i.test(key)){
        this.pendingCommand += key;
        this.showPill('edit', /^\d+$/.test(this.pendingCommand.slice(1))
          ? `Jump to position: ${this.pendingCommand}`
          : `Command: ${this.pendingCommand}`);
      } else if(key === 'Enter'){
        const command = this.pendingCommand.slice(1).trim().toLowerCase();
        this.clearCommandBuffer();
        if(/^\d+$/.test(command)) this.jumpToPosition(Number(command));
        else if(command === 'mute'){
          this.setSoundEnabled(false);
          this.showPill('edit', 'Typing sounds muted', 1200);
        } else if(command === 'unmute'){
          this.setSoundEnabled(true);
          this.showPill('edit', 'Typing sounds on', 1200);
        }
        else if(command === 'radio off') this.setRadioPlaying(false);
        else if(command === 'radio on') this.setRadioPlaying(true);
        else this.showPill('edit', `Unknown command: :${command}`, 1800);
      } else if(key === 'Backspace' && this.pendingCommand.length > 1){
        this.pendingCommand = this.pendingCommand.slice(0, -1);
        this.showPill('edit', `Command: ${this.pendingCommand}`);
      } else {
        this.clearCommandBuffer();
      }
      return true;
    }
    if(key === 'D' && this.pendingDeletions.length){
      this.commitPendingDeletions();
      return true;
    }
    if(key === 'q' && this.pendingDeletions.length){
      this.clearPendingDeletions();
      this.clearCommandBuffer();
      this.showPill('edit', 'Queued deletions cleared', 1200);
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
    if(this.pendingCommand === 'c'){
      this.clearCommandBuffer();
      if(key === 'w') this.changeCurrentWord();
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
    if(key === 'c'){ this.queueCommandBuffer('c'); return true; }
    if(key === 'x'){ this.deleteCharacterAtCaret(); return true; }
    if(key === 'n' || key === 'b'){
      const previousPosition = this.engine.pos;
      if(key === 'n') this.skipWord();
      else this.previousWord();
      if(this.engine.pos !== previousPosition){
        this.startReadingClock();
        this.updateStats();
        if(this.readingStartedAt !== null) this.startTicker();
      }
      return true;
    }
    if(key === 'N'){ this.stageWordDeletion('forward'); return true; }
    if(key === 'B'){ this.stageWordDeletion('backward'); return true; }
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
    if(key === 'i'){ this.startInlineEdit(); return true; }
    this.pendingCommand = '';
    return true;
  },
  deleteCharacterAtCaret(){
    if(!this.engine || (this.state !== 'ready' && this.state !== 'running' && !(this.commandMode && this.state === 'paused')) || this.editing) return;
    const eng = this.engine;
    const text = eng.text;
    const pos = eng.pos;
    if(pos >= text.length) return;
    const nextCharacter = text.codePointAt(pos);
    const end = pos + (nextCharacter > 0xFFFF ? 2 : 1);
    const newText = text.slice(0, pos) + text.slice(end);
    if(!newText.trim()) return;
    const snapshot = this.textView.snapshot(pos);
    this.recordTemplateUndo(text, pos);
    this.persistEdit(newText);
    this.adjustCapturesForDeletion(pos, end);
    eng.replaceText(newText, pos);
    this.textView.build(eng.text, true, this.lessonMarkdown.formats);
    this.textView.restore(snapshot, eng.pos);
    this.renderPendingDeletions();
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
    this.deleteTextRange(start, end, pos);
  },
  deleteTextRange(start, end, newPosition){
    if(!this.engine || start >= end) return false;
    const eng = this.engine;
    const text = eng.text;
    const newText = normalizeLessonText(text.slice(0, start) + text.slice(end));
    if(!newText || newText === text) return false;
    const snapshot = this.textView.snapshot(eng.pos);
    this.recordTemplateUndo(text, eng.pos);
    this.persistEdit(newText);
    this.adjustCapturesForDeletion(start, end);
    eng.replaceText(newText, Math.min(newPosition, newText.length));
    this.textView.build(eng.text, true, this.lessonMarkdown.formats);
    this.textView.restore(snapshot, eng.pos);
    this.renderPendingDeletions();
    this.dom.captureInput.value = eng.text.slice(0, eng.pos);
    this.shadowValue = this.dom.captureInput.value;
    this.textView.moveCaret(eng.pos);
    this.updateTypingPosition();
    this.updateProgress();
    this.saveCursorPosition();
    this.hintNext();
    this.refreshOverlays();
    this.bus.dispatchEvent(new CustomEvent('lessonEdited', { detail:{ lessonId:this.currentLesson.id } }));
    return true;
  },
  deletePreviousWord(){
    if(!this.engine || (this.state !== 'ready' && this.state !== 'running' && !(this.commandMode && this.state === 'paused')) || this.editing) return;
    const text = this.engine.text;
    const pos = this.engine.pos;
    let end = pos;
    while(end > 0 && /\s/.test(text[end - 1])) end--;
    let start = end;
    while(start > 0 && !/\s/.test(text[start - 1])) start--;
    if(start === pos) return;
    this.deleteTextRange(start, pos, start);
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
    if(this.engine){
      this.statsView.updatePosition(this.engine.pos, this.engine.text.length);
      this.updateStats();
    }
    this.syncMediaDeck();
  },
  startReadingClock(){
    if(this.commandMode && this.engine && !this.engine.finished &&
       this.engine.startTime !== null && this.readingStartedAt === null){
      this.readingStartedAt = performance.now();
    }
  },
  stopReadingClock(){
    if(this.readingStartedAt !== null){
      this.readingTimeMs += Math.max(0, performance.now() - this.readingStartedAt);
      this.readingStartedAt = null;
    }
  },
  getReadingTimeMs(now = performance.now()){
    return this.readingTimeMs + (this.readingStartedAt === null ? 0 : Math.max(0, now - this.readingStartedAt));
  },
  updateStats(){
    if(!this.engine || !this.statsView) return;
    const stats = this.engine.getStats();
    const readingMs = this.getReadingTimeMs();
    const engagedMs = stats.elapsedMs + readingMs;
    const hasRunPace = stats.elapsedMs >= 10000 && stats.keystrokes >= 10 && stats.wpm > 0;
    const estimateWpm = hasRunPace ? stats.wpm : this.globalAvgWpm;
    const remainingChars = Math.max(0, this.engine.text.length - this.engine.pos);
    const remainingMs = remainingChars === 0 ? 0
      : (estimateWpm > 0 ? Math.ceil((remainingChars / 5 / estimateWpm) * 60000) : null);
    this.statsView.update(stats, {
      engagedMs,
      readingMs,
      typingPercent: engagedMs > 0 ? Math.round((stats.elapsedMs / engagedMs) * 100) : null,
      readingPercent: engagedMs > 0
        ? 100 - Math.round((stats.elapsedMs / engagedMs) * 100)
        : null,
      estimateWpm,
      remainingMs
    });
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
    this.stopReadingClock();
    delete this.positions[this.currentLesson.id];
    Storage.savePositions(this.positions);
    this.stopTicker();
    this.keyboardView.clearNext();
    this.sound.playComplete();
    this.saveBestStats(e.detail);
    const recall = this.recordRecall();
    this.showCompletion(e.detail);
    if(recall) this.appendRecallLine(recall);
    // Update the completed row's ★ in place. Rebuilding the whole drawer here
    // could not add a lesson, but it did reset scroll/focus and made any
    // already-present duplicate rows look like they had just appeared.
    this.renderSidebarBest(this.currentLesson.id);
    this.syncMediaDeck();
    this.bus.dispatchEvent(new CustomEvent('lessonComplete', { detail:{ lessonId:this.currentLesson.id, stats:e.detail, recall } }));
  },

  updateProgress(){
    const pct = clamp(Math.round((this.engine.pos/this.engine.text.length)*100), 0, 100);
    this.dom.progressFill.style.width = pct + '%';
    this.updateSessionProgress(pct);
    const acc = this.engine.getStats().accuracy;
    const hue = clamp((acc-70)*4, 0, 130); // 70%acc -> red-ish, 100%acc -> green-ish, feeding the brass baseline otherwise
    if(acc < 90){
      this.dom.progressFill.style.background = `hsl(${hue}, 55%, 45%)`;
    } else {
      this.dom.progressFill.style.background = 'var(--brass)';
    }
  },
  updateSessionProgress(pct){
    if(!this.dom.sessionProgress) return;
    this.dom.sessionProgressFill.style.width = pct + '%';
    this.dom.sessionProgressPct.textContent = pct + '%';
    this.dom.sessionProgress.setAttribute('aria-valuenow', String(pct));
    this.dom.sessionProgress.title = `Current lesson progress: ${pct}%`;
  },

  /* ----- overlay / pause / focus ----- */
  updateOverlay(){
    const d = this.dom, s = this.state;
    // First lesson visits and typing pauses show the veil. Editing and Command
    // mode remain visible so the lesson can be worked with.
    const veiled = (s === 'idle' && this.lessonIntro) ||
      (s === 'paused' && !this.commandMode && this.pauseReason !== 'edit' && this.pauseReason !== 'command');
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
    this.syncMediaDeck();
    this.bus.dispatchEvent(new CustomEvent('ready'));
  },
  pauseTyping(reason, at){
    if(this.commandMode && this.readingStartedAt !== null &&
       (reason === 'blur' || reason === 'window' || reason === 'hidden')){
      this.stopReadingClock();
      this.stopTicker();
      this.updateStats();
    }
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
    this.updateStats();
    this.updateOverlay();
    this.bus.dispatchEvent(new CustomEvent('paused', { detail:{ reason } }));
  },
  resumeTyping(){
    if(this.state !== 'paused' || this.editing || this.commandMode) return;
    this.engine.resume();
    this.state = 'running';
    this.pauseReason = null;
    this.lastKeyAt = performance.now(); // fresh start for the idle watchdog
    this.updateStats();
    this.startTicker();
    this.updateOverlay();
    this.focusInput();
    this.bus.dispatchEvent(new CustomEvent('resumed'));
  },
  onGlobalKeydown(e){
    if(e.defaultPrevented || e.isComposing || typeof e.key !== 'string') return;
    const d = this.dom;
    const t = e.target;
    const escapeSwitchFocused = t === d.escapeSwitch;
    const inField = t !== d.captureInput && t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]');
    if(e.key === 'Escape' && !this.escapeCommands) return;
    if(e.key === 'Escape'){
      if(d.importConflictScrim.classList.contains('open')){ this.finishImportConflict('skip'); return; }
      if(d.mediaScrim.classList.contains('open')){ this.closeMediaEditor(); return; }
      if(d.marksScrim.classList.contains('open')){ this.closeMarks(); return; }
      if(d.actionModalScrim.classList.contains('open')){ d.actionModalCancel.click(); return; }
      if(d.modalScrim.classList.contains('open')){ this.closeModal(); return; }
      if(d.completeOverlay.classList.contains('open')){ this.hideCompletion(); return; }
      if(d.drawer.classList.contains('open')){ this.closeDrawer(); return; }
    }
    if(this.editing){
      if(e.key === 'Escape'){
        if(!escapeSwitchFocused && t !== d.captureInput && t && t.closest && t.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
        e.preventDefault();
        this.endInlineEdit(true);
        return;
      }
      // focus drifted (a click elsewhere): any plain key brings it back, and lands in the text
      if(t !== d.captureInput && !(t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], button, a'))) this.focusInput();
      return;
    }
    if(this.commandMode && (inField || (e.key === 'Escape' && escapeSwitchFocused))){ this.handleCommandKeydown(e); return; }
    if(e.key === 'Escape' && escapeSwitchFocused && this.state === 'paused' && this.pauseReason === 'blur'){
      e.preventDefault();
      this.enterCommandMode(true);
      return;
    }
    if(this.state === 'running'){
      if(e.key === 'Escape'){
        if(!escapeSwitchFocused && t !== d.captureInput && t && t.closest && t.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
        e.preventDefault();
        this.enterCommandMode();
      }
      return;
    }
    if(this.state === 'ready' && e.key === 'Escape'){
      if(!escapeSwitchFocused && t !== d.captureInput && t && t.closest && t.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      this.enterCommandMode();
      return;
    }
    if(this.state === 'finished' && e.key === 'Escape' && this.pendingDeletions.length){
      e.preventDefault();
      this.enterCommandMode();
      return;
    }
    if(this.state === 'finished') return;
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    if(d.modalScrim.classList.contains('open') || d.actionModalScrim.classList.contains('open') || d.marksScrim.classList.contains('open') ||
       d.importConflictScrim.classList.contains('open') || d.mediaScrim.classList.contains('open') ||
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
      if(this.state === 'running'){
        // Idle watchdog: walked away without leaving the window? Pause, back-dated to the last keystroke.
        if(IDLE_PAUSE_MS > 0 && performance.now() - this.lastKeyAt > IDLE_PAUSE_MS){
          this.pauseTyping('idle', this.lastKeyAt);
          return;
        }
        this.updateStats();
      } else if(this.commandMode && this.state === 'paused'){
        this.updateStats();
      }
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
  updateGlobalStats(){
    if(!this.dom.globalStats) return;
    const stats = collectGlobalStats(Storage.loadStats());
    this.globalAvgWpm = stats.avgWpm;
    this.dom.globalWpm.textContent = stats.avgWpm === null ? '—' : String(stats.avgWpm);
    this.dom.globalAcc.textContent = stats.avgAccuracy === null ? '—' : `${stats.avgAccuracy}%`;
    this.dom.globalRuns.textContent = stats.runs.toLocaleString();
    this.dom.globalStats.classList.toggle('is-empty', !stats.lessons);
    const description = describeGlobalStats(stats);
    this.dom.globalStats.title = description;
    this.dom.globalStats.setAttribute('aria-label', description);
    if(this.engine) this.updateStats();
  },
  saveBestStats(stats){
    const stored = Storage.loadStats();
    const all = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const prev = all[this.currentLesson.id] && typeof all[this.currentLesson.id] === 'object' ? all[this.currentLesson.id] : {};
    const prevWpm = finiteStat(prev.bestWpm) || 0;
    const prevAcc = finiteStat(prev.bestAccuracy) || 0;
    const prevAttempts = finiteStat(prev.attempts) || 0;
    all[this.currentLesson.id] = {
      bestWpm: Math.max(prevWpm, stats.wpm),
      bestAccuracy: Math.max(prevAcc, stats.accuracy),
      attempts: prevAttempts + 1,
      lastAt: Date.now()
    };
    Storage.saveStats(all);
    this.updateGlobalStats();
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
    return this.editing
      ? parseInlineMarkdown(this.dom.captureInput.value).text
      : (this.engine ? this.engine.text : '');
  },
  applyAnnotations(){
    // Resolve this lesson's marks and masks to character ranges. A mask made during THIS run is
    // already typed, so it only takes effect from the next run ("soon"). Masks lift while editing.
    const parsedEdit = this.editing ? parseInlineMarkdown(this.dom.captureInput.value) : null;
    const text = parsedEdit ? parsedEdit.text : this.displayText();
    const lesson = this.currentLesson;
    const mine = lesson ? this.marks.filter(m => m.lessonId === lesson.id) : [];
    const resolve = (m) => {
      const r = this.resolveMarkRange(m, text);
      if(!r) return null;
      if(!parsedEdit) return { id:m.id, s:r[0], e:r[1] };
      return {
        id:m.id,
        s:sourcePositionForRendered(parsedEdit, r[0]),
        e:r[1] < parsedEdit.sourceIndices.length
          ? parsedEdit.sourceIndices[r[1] - 1] + 1
          : parsedEdit.sourceLength
      };
    };
    this.markRanges = mine.filter(m => m.kind !== 'mask').map(resolve).filter(Boolean);
    const masks = mine.filter(m => m.kind === 'mask').map(resolve).filter(Boolean);
    this.maskRanges = masks.filter(r => !this.freshMasks.has(r.id));
    this.soonRanges = masks.filter(r => this.freshMasks.has(r.id));
    this.maskSet = new Set();
    if(this.masksOn && !this.editing) this.maskRanges.forEach(r => { for(let i = r.s; i < r.e; i++) this.maskSet.add(i); });
    this.refreshOverlays();
    this.syncMediaDeck();
  },
  refreshOverlays(){
    const live = (kind) => {
      if(this.editing) return null;
      const c = this.captures[kind];
      return c ? [c.start, Math.max(c.start, this.engine.pos)] : null;
    };
    const masking = this.masksOn && !this.editing;
    const visibleMarks = this.markRanges.filter(range => {
      const mark = this.marks.find(m => m.id === range.id);
      return mark && !markHasFigures(mark);
    });
    this.textView.setMarks(visibleMarks.map(r => [r.s, r.e]), live('mark'));
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
  importMarks(list, options = {}){
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
      if(kind === 'mask'){
        rec.attempts = Number(m.attempts) || 0;
        rec.clean = Number(m.clean) || 0;
        if(options.fresh !== false) this.freshMasks.add(id);
      }
      const media = normalizeMediaList(m.media, m.text);
      if(media.length) rec.media = media;
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
  /* ----- floating figure deck (PiP for marked passages) -----
     Images live on marks, not on the lesson, so they travel with the mark through
     export/import and follow it when the lesson text is edited. The deck shows
     every figure attached to a mark whose range contains the caret; leaving the
     range fades it out. Multiple figures on one mark become a little deck. */
  updateFiguresToggleBtn(){
    const b = this.dom.figuresToggleBtn;
    if(!b) return;
    b.textContent = `Figure deck: ${this.figuresOn ? 'on' : 'off'}`;
    b.setAttribute('aria-pressed', String(this.figuresOn));
  },
  toggleFigures(){
    this.figuresOn = !this.figuresOn;
    this.savePref('figuresOn', this.figuresOn);
    this.updateFiguresToggleBtn();
    this.syncMediaDeck();
  },
  mediaDeckCanShow(){
    return this.figuresOn && this.currentLesson && this.engine && !this.editing &&
      (this.state === 'ready' || this.state === 'running' || this.state === 'paused');
  },
  syncMediaDeck(){
    const d = this.dom;
    if(!d.mediaDeck) return;
    const slides = [];
    if(this.mediaDeckCanShow()){
      const pos = this.engine.pos;
      const seen = new Set();
      this.markRanges.forEach(range => {
        // Inclusive end: the figure stays up while you type the last character
        // of the marked sentence, then disappears on the next keystroke.
        if(pos < range.s || pos > range.e) return;
        const mark = this.marks.find(m => m.id === range.id);
        if(!mark || (mark.kind || 'mark') === 'mask' || !Array.isArray(mark.media)) return;
        mark.media.forEach(media => {
          if(!media || !media.src || seen.has(media.id)) return;
          seen.add(media.id);
          slides.push({
            id:String(media.id || media.src), src:media.src,
            alt:media.alt || '', caption:media.caption || '',
            markId:mark.id, markText:mark.text || ''
          });
        });
      });
    }
    if(!slides.length){ this.hideMediaDeck(); return; }
    const key = slides.map(s => `${s.id}\u0000${s.caption}\u0000${s.alt}`).join('\u0001');
    const changed = key !== this.mediaDeckKey;
    this.mediaDeckSlides = slides;
    this.mediaDeckKey = key;
    if(changed) this.mediaDeckIndex = 0;
    if(this.mediaDeckIndex >= slides.length) this.mediaDeckIndex = 0;
    // Render the figure before snapshotting the new state so the incoming
    // card is not blank during the transition.
    if(changed) this.renderMediaDeck();
    this.showMediaDeck();
  },
  figureTransition(update){
    // A slow view transition morphs the stage between the main area and the
    // PiP while the figure card fades in. Browsers without the API get a short
    // fade-out/swap/fade-in instead; reduced-motion users get an instant swap.
    if(prefersReducedMotion()){
      update();
      return;
    }
    if(this.figureTransitioning){
      update();
      return;
    }
    const wrap = this.dom.stageWrap;
    if(typeof document.startViewTransition !== 'function'){
      this.figureTransitioning = true;
      wrap.classList.add('figure-swapping');
      setTimeout(() => {
        update();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          wrap.classList.remove('figure-swapping');
          this.figureTransitioning = false;
          this.syncMediaDeck();
        }));
      }, 260);
      return;
    }
    this.figureTransitioning = true;
    let transition;
    try{
      transition = document.startViewTransition(update);
    }catch(e){
      this.figureTransitioning = false;
      update();
      return;
    }
    const settle = () => {
      this.figureTransitioning = false;
      // The caret may have moved while the snapshot was playing.
      this.syncMediaDeck();
    };
    transition.finished.then(settle, settle);
  },
  enterFigureFocus(){
    if(this.figureFocusActive) return;
    const d = this.dom;
    if(!d.stagePip || !d.stagePipBody || !d.stage || !d.keyboardToggleRow) return;
    // Interchange: the typing stage becomes the PiP thumbnail; the figure card
    // takes its slot while session stats remain in the top bar.
    d.stagePipBody.appendChild(d.stage);
    d.stageWrap.insertBefore(d.mediaDeck, d.keyboardToggleRow);
    d.stageWrap.classList.add('figure-focus');
    d.mediaDeck.classList.add('is-main');
    d.stagePip.hidden = false;
    this.figureFocusActive = true;
    if(this.textView && this.engine) this.textView.moveCaret(this.engine.pos);
  },
  exitFigureFocus(){
    if(!this.figureFocusActive) return;
    const d = this.dom;
    d.stagePip.hidden = true;
    if(d.stage && d.keyboardToggleRow) d.stageWrap.insertBefore(d.stage, d.keyboardToggleRow);
    if(this.mediaDeckHome && this.mediaDeckHome.parent){
      const next = this.mediaDeckHome.nextSibling;
      if(next && next.parentNode === this.mediaDeckHome.parent) this.mediaDeckHome.parent.insertBefore(d.mediaDeck, next);
      else this.mediaDeckHome.parent.appendChild(d.mediaDeck);
    }
    d.mediaDeck.classList.remove('is-main');
    d.stageWrap.classList.remove('figure-focus');
    this.figureFocusActive = false;
    if(this.textView && this.engine) this.textView.moveCaret(this.engine.pos);
  },
  showMediaDeck(){
    const d = this.dom;
    if(!d.mediaDeck) return;
    clearTimeout(this.mediaDeckHideTimer);
    this.mediaDeckHideTimer = null;
    const entering = !this.figureFocusActive;
    const reveal = () => {
      this.enterFigureFocus();
      d.mediaDeck.hidden = false;
      d.mediaDeck.classList.add('show');
    };
    if(entering) this.figureTransition(reveal);
    else reveal();
  },
  hideMediaDeck(){
    const d = this.dom;
    if(!d.mediaDeck) return;
    const wasFocused = this.figureFocusActive;
    this.mediaDeckSlides = [];
    this.mediaDeckIndex = 0;
    this.mediaDeckKey = '';
    clearTimeout(this.mediaDeckHideTimer);
    this.mediaDeckHideTimer = null;
    const conceal = () => {
      this.exitFigureFocus();
      d.mediaDeck.classList.remove('show');
      d.mediaDeck.hidden = true;
    };
    if(wasFocused) this.figureTransition(conceal);
    else conceal();
  },
  renderMediaDeck(){
    const d = this.dom, slides = this.mediaDeckSlides;
    const slide = slides[this.mediaDeckIndex];
    if(!slide) return;
    d.mediaDeckCount.textContent = `${this.mediaDeckIndex + 1} / ${slides.length}`;
    const many = slides.length > 1;
    d.mediaDeckPrev.hidden = !many;
    d.mediaDeckNext.hidden = !many;
    const different = d.mediaDeckImage.getAttribute('src') !== slide.src;
    if(different){
      d.mediaDeckImage.hidden = false;
      d.mediaDeckFallback.hidden = true;
      d.mediaDeckImage.src = slide.src;
      if(!prefersReducedMotion()){
        d.mediaDeckImage.animate(
          [{ opacity:0, transform:'scale(.985)' }, { opacity:1, transform:'none' }],
          { duration:200, easing:'ease-out' }
        );
      }
    }
    d.mediaDeckImage.alt = slide.alt || slide.caption || 'Figure for the marked passage';
    d.mediaDeckCaption.textContent = slide.caption || '';
    d.mediaDeckCaption.hidden = !slide.caption;
    d.mediaDeck.title = slide.caption || slide.markText || 'Figure';
  },
  stepMediaSlide(delta){
    const count = this.mediaDeckSlides.length;
    if(count < 2) return;
    this.mediaDeckIndex = (this.mediaDeckIndex + delta + count) % count;
    this.renderMediaDeck();
  },
  toggleMediaDeckCollapsed(){
    this.mediaDeckCollapsed = !this.mediaDeckCollapsed;
    this.savePref('mediaDeckCollapsed', this.mediaDeckCollapsed);
    this.applyMediaDeckCollapsed();
  },
  applyMediaDeckCollapsed(){
    const d = this.dom;
    if(!d.mediaDeck) return;
    d.mediaDeck.classList.toggle('is-collapsed', this.mediaDeckCollapsed);
    d.mediaDeckCollapse.setAttribute('aria-expanded', String(!this.mediaDeckCollapsed));
    d.mediaDeckCollapse.setAttribute('aria-label', this.mediaDeckCollapsed ? 'Expand figure deck' : 'Collapse figure deck');
    d.mediaDeckCollapse.title = this.mediaDeckCollapsed ? 'Expand figure deck' : 'Collapse figure deck';
  },

  /* ----- attach figures to a mark ----- */
  mediaMark(){ return this.marks.find(m => m.id === this.mediaMarkId) || null; },
  openMediaEditor(markId){
    const mark = this.marks.find(m => m.id === markId);
    if(!mark) return;
    this.mediaMarkId = markId;
    this.mediaPendingSrc = '';
    this.mediaReturnToMarks = this.dom.marksScrim.classList.contains('open');
    this.closeMarks();
    this.dom.mediaForm.reset();
    this.dom.mediaFile.value = '';
    this.dom.mediaHint.textContent = 'Figures appear in a floating deck while the caret is inside this marked passage.';
    this.renderMediaEditor();
    this.dom.mediaScrim.classList.add('open');
    setTimeout(() => { if(this.dom.mediaScrim.classList.contains('open')) this.dom.mediaUrl.focus(); }, 50);
  },
  closeMediaEditor(){
    if(!this.dom.mediaScrim.classList.contains('open')) return;
    this.dom.mediaScrim.classList.remove('open');
    this.mediaMarkId = null;
    this.mediaPendingSrc = '';
    this.dom.mediaForm.reset();
    this.dom.mediaFile.value = '';
    if(this.mediaReturnToMarks){
      this.mediaReturnToMarks = false;
      this.openMarks();
    } else {
      this.syncMediaDeck();
    }
  },
  renderMediaEditor(){
    const d = this.dom, mark = this.mediaMark();
    if(!mark){ this.closeMediaEditor(); return; }
    d.mediaMarkText.textContent = mark.text;
    d.mediaMarkText.title = mark.text;
    const list = d.mediaList;
    list.innerHTML = '';
    const media = Array.isArray(mark.media) ? mark.media : [];
    if(!media.length){
      const empty = document.createElement('p');
      empty.className = 'media-empty';
      empty.textContent = 'No figures attached to this mark yet. Paste an image URL or choose a file below.';
      list.appendChild(empty);
      return;
    }
    media.forEach(item => {
      const row = document.createElement('div');
      row.className = 'media-edit-item';
      row.dataset.mediaId = item.id;
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = item.alt || '';
      img.loading = 'lazy';
      const fields = document.createElement('div');
      fields.className = 'media-edit-fields';
      const caption = document.createElement('input');
      caption.type = 'text';
      caption.maxLength = 240;
      caption.placeholder = 'Caption';
      caption.dataset.field = 'caption';
      caption.value = item.caption || '';
      const alt = document.createElement('input');
      alt.type = 'text';
      alt.maxLength = 240;
      alt.placeholder = 'Alt text';
      alt.dataset.field = 'alt';
      alt.value = item.alt || '';
      fields.append(caption, alt);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'media-edit-remove';
      remove.dataset.mediaRemove = item.id;
      remove.textContent = 'Remove';
      row.append(img, fields, remove);
      list.appendChild(row);
    });
  },
  saveMediaChanges(){
    Storage.saveMarks(this.marks);
    this.applyAnnotations(); // re-paint: adding/removing figures changes whether the mark is underlined
    this.renderMarks();
  },
  submitMediaForm(e){
    e.preventDefault();
    const mark = this.mediaMark();
    if(!mark) return;
    const src = this.mediaPendingSrc || normalizeMediaSrc(this.dom.mediaUrl.value);
    if(!src){
      this.dom.mediaHint.textContent = 'Paste an image URL or choose an image file first.';
      this.dom.mediaUrl.focus();
      return;
    }
    const caption = this.dom.mediaCaption.value.trim().slice(0, 240);
    const alt = (this.dom.mediaAlt.value.trim() || caption || mark.text || 'Figure').slice(0, 240);
    if(!Array.isArray(mark.media)) mark.media = [];
    mark.media.push({ id:uid('fig'), src, alt, caption });
    this.mediaPendingSrc = '';
    this.dom.mediaForm.reset();
    this.dom.mediaFile.value = '';
    this.dom.mediaHint.textContent = 'Figure added. It will appear while you type this marked passage.';
    this.renderMediaEditor();
    this.saveMediaChanges();
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
    d.marksExportBtn.disabled = empty;
    d.marksPracticeBtn.disabled = !this.marks.some(m => m.kind !== 'mask' && !markHasFigures(m));
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
      const media = Array.isArray(m.media) ? m.media : [];
      let info = `${m.lessonTitle || 'Lesson'} · ${new Date(m.createdAt).toLocaleDateString()}`;
      if(kind === 'mask' && m.attempts) info += ` · recalled cleanly ${m.clean || 0} of ${m.attempts}`;
      meta.append(chip);
      if(kind !== 'mask' && media.length){
        const figureChip = document.createElement('span');
        figureChip.className = 'kind-chip figure';
        figureChip.textContent = 'figure';
        meta.appendChild(figureChip);
      }
      meta.appendChild(document.createTextNode(info));
      const actions = document.createElement('div');
      actions.className = 'mark-actions';
      const actionDefs = [['copy', 'Copy']];
      if(kind !== 'mask') actionDefs.push(['media', media.length ? `Figures (${media.length})` : 'Add figure']);
      actionDefs.push(['del', 'Remove']);
      actionDefs.forEach(([act, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'text-btn';
        b.dataset.act = act;
        b.textContent = label;
        actions.appendChild(b);
      });
      li.append(q, meta);
      if(kind !== 'mask' && media.length){
        const strip = document.createElement('div');
        strip.className = 'mark-media-strip';
        media.slice(0, 3).forEach(item => {
          const img = document.createElement('img');
          img.src = item.src;
          img.alt = item.alt || '';
          img.title = item.caption || item.alt || 'Figure';
          img.loading = 'lazy';
          strip.appendChild(img);
        });
        if(media.length > 3){
          const more = document.createElement('span');
          more.className = 'mark-media-more';
          more.textContent = `+${media.length - 3}`;
          strip.appendChild(more);
        }
        li.appendChild(strip);
      }
      li.appendChild(actions);
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
    // Figure anchors are for the media deck, not the reinforcement digest.
    const src = this.marks.filter(m => m.kind !== 'mask' && !markHasFigures(m));
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
     out. The clock pauses without a veil. Esc commits inline edits and returns to
     the prior mode. Typing resumes at the
     same character (or, if you changed something inside what you'd already typed, at the first
     changed character). */
  canEdit(){
    const d = this.dom, s = this.state;
    if(!this.engine || s === 'finished' || (s === 'paused' && this.pauseReason !== 'command')) return false;
    return !(d.modalScrim.classList.contains('open') || d.actionModalScrim.classList.contains('open') || d.marksScrim.classList.contains('open') ||
      d.importConflictScrim.classList.contains('open') || d.mediaScrim.classList.contains('open') ||
      d.completeOverlay.classList.contains('open'));
  },
  toggleInlineEdit(){
    if(this.editing) this.endInlineEdit(true);
    else if(this.canEdit()) this.beginInlineEdit();
  },
  beginInlineEdit(){
    const d = this.dom, eng = this.engine;
    this.editStart = {
      text: eng.text, sourceText:this.lessonSource, pos: eng.pos, typed: d.captureInput.value,
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
      this.updateStats();
    }
    this.composing = false;
    this.textView.setComposing(null, false);
    const sourcePosition = sourcePositionForRendered(this.lessonMarkdown, eng.pos);
    d.captureInput.value = this.lessonSource;
    d.captureInput.setSelectionRange(sourcePosition, sourcePosition);
    this._editShown = this.lessonSource;
    this._editMarkdown = this.lessonMarkdown;
    this._vx = null;
    this._lines = null;
    this.textView.build(this.lessonSource, true);
    this.textView.restore(this.editStart, eng.pos, this.lessonMarkdown.sourceIndices);
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
    const newSource = normalizeLessonText(d.captureInput.value);
    const parsed = parseInlineMarkdown(newSource);
    if(accept && !parsed.text){ this.showPill('edit', "The lesson text can't be empty", 1800); return; }
    const changed = accept && newSource !== es.sourceText;
    this.editing = false;
    this.composing = false;
    this.hidePill('edit');
    let pos = es.pos;
    if(changed){
      if(this._editShown !== newSource){
        this.remapCapturesForTextChange(this._editMarkdown.text, parsed.text);
        this.remapPendingDeletions(this._editMarkdown.text, parsed.text);
      }
      pos = Math.min(es.pos, commonPrefix(es.text, parsed.text)); // changed something you'd already typed: resume at the first changed character
      this.recordTemplateUndo(es.text, es.pos, { sourceText:es.sourceText });
      this.persistEdit(parsed.text, { sourceText:newSource, remapPending:false });
      eng.replaceText(parsed.text, pos);
    }
    tv.build(eng.text, true, this.lessonMarkdown.formats);
    tv.restore(es, pos);
    this.renderPendingDeletions();
    tv.setSelection(0, 0);
    const typed = es.typed.slice(0, pos);                   // the typing field goes back to exactly what was typed
    d.captureInput.value = typed;
    d.captureInput.setSelectionRange(typed.length, typed.length);
    this.shadowValue = typed;
    this._lines = null;
    this.editStart = null;
    this.applyAnnotations();
    tv.moveCaret(pos);
    this.updateStats();
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
  persistEdit(text, options = {}){
    if(options.remapPending !== false && this.engine) this.remapPendingDeletions(this.engine.text, text);
    const sourceText = normalizeLessonText(options.sourceText === undefined ? text : options.sourceText);
    this.lessonSource = sourceText;
    this.lessonMarkdown = parseInlineMarkdown(sourceText);
    const lesson = this.currentLesson;
    if(lesson.custom){
      lesson.text = sourceText;
      Storage.saveLessons(this.customLessons);
    } else {
      // Built-in / static-pack lessons are code- or git-managed, so the edit is an override keyed by
      // lesson id: best scores and marks stay attached, and the original is one click away.
      const original = lesson.edited ? lesson.originalText : lesson.text;
      const existing = this.overrides[lesson.id];
      // Keep title/course metadata across a restore, but never let an old `text` ride along:
      // otherwise undoing an edit would re-save the text it was supposed to remove.
      const metadata = existing && typeof existing === 'object' && !Array.isArray(existing)
        ? Object.fromEntries(Object.entries(existing).filter(([key]) => key !== 'text'))
        : {};
      if(sourceText === original){
        if(Object.keys(metadata).length) this.overrides[lesson.id] = metadata;
        else delete this.overrides[lesson.id];
      } else {
        this.overrides[lesson.id] = { ...metadata, text:sourceText };
      }
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
    // edits to built-in / static-pack lessons, from an export file: only known,
    // non-empty fields are accepted (text and metadata, plus target goals).
    let n = 0;
    if(obj && typeof obj === 'object' && !Array.isArray(obj)){
      Object.entries(obj).forEach(([id, v]) => {
        if(typeof v === 'string' && v.trim()){ this.overrides[id] = normalizeLessonText(v); n++; }
        else if(v && typeof v === 'object' && !Array.isArray(v)){
          const next = {};
          if(typeof v.text === 'string' && v.text.trim()) next.text = normalizeLessonText(v.text);
          if(typeof v.title === 'string' && v.title.trim()) next.title = v.title.trim();
          if(typeof v.course === 'string' && v.course.trim()) next.course = v.course.trim();
          const order = optionalOrder(v.order);
          if(order !== null) next.order = order;
          const courseOrder = optionalOrder(v.courseOrder);
          if(courseOrder !== null) next.courseOrder = courseOrder;
          const wpm = optionalInt(v.targetWPM, 5, 200);
          const acc = optionalInt(v.targetAccuracy, 50, 100);
          if(wpm !== null) next.targetWPM = wpm;
          if(acc !== null) next.targetAccuracy = acc;
          if(Object.keys(next).length){ this.overrides[id] = next; n++; }
        }
      });
    }
    Storage.saveOverrides(this.overrides);
    this.renderSidebar();
    return n;
  },
  async restoreLesson(id){
    if(this.overrides[id] === undefined) return;
    const found = this.findLesson(id);
    if(!await this.showActionModal({ title:'Restore original?', message:`Restore the original text of "${found ? found.lesson.title : 'this lesson'}"?`, input:false, confirm:'Restore' })) return;
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
    if(val !== this._editShown) this.rebuildForEdit(val);
    const s = ta.selectionStart, e = ta.selectionEnd;
    this.textView.moveCaret(ta.selectionDirection === 'backward' ? s : e);
    this.textView.setSelection(s, e);
  },
  rebuildForEdit(val){
    const es = this.editStart, tv = this.textView;
    const previous = this._editShown;
    if(previous !== val){
      const previousText = parseInlineMarkdown(previous).text;
      const nextMarkdown = parseInlineMarkdown(val);
      this.remapCapturesForTextChange(previousText, nextMarkdown.text);
      this.remapPendingDeletions(previousText, nextMarkdown.text);
      this._editMarkdown = nextMarkdown;
    } else {
      this._editMarkdown = parseInlineMarkdown(val);
    }
    this._editShown = val;
    // The typed prefix keeps its green / red only up to the first character that differs from where
    // the edit began — so undoing the change brings every colour back.
    const keep = Math.min(es.pos, commonPrefix(es.text, this._editMarkdown.text));
    tv.build(val, true);
    tv.restore(es, keep, this._editMarkdown.sourceIndices);
    this.renderPendingDeletions();
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
  openModal(preset = {}){
    this.dom.lessonForm.reset();
    this.dom.lfWpm.value = '30';
    this.dom.lfAcc.value = '95';
    // Opened from a course's + button: pre-fill that course, still editable.
    this.dom.lfCourse.value = preset.course || '';
    this.dom.lfOrder.value = preset.order ?? '';
    this.dom.modalScrim.classList.add('open');
    setTimeout(() => { if(this.dom.modalScrim.classList.contains('open')) this.dom.lfTitle.focus(); }, 50);
  },
  showActionModal({ title, message = '', label = '', value = '', input = true, confirm = 'OK', cancel = 'Cancel' }){
    return new Promise(resolve => {
      const d = this.dom;
      d.actionModalTitle.textContent = title;
      d.actionModalMessage.textContent = message;
      d.actionModalField.hidden = !input;
      d.actionModalLabel.textContent = label;
      d.actionModalInput.value = value;
      d.actionModalConfirm.textContent = confirm;
      d.actionModalCancel.textContent = cancel;
      d.actionModalScrim.classList.add('open');
      const finish = result => {
        d.actionModalScrim.classList.remove('open');
        d.actionModalConfirm.removeEventListener('click', onConfirm);
        d.actionModalCancel.removeEventListener('click', onCancel);
        d.actionModalClose.removeEventListener('click', onCancel);
        d.actionModalScrim.removeEventListener('click', onBackdrop);
        resolve(result);
      };
      const onConfirm = () => finish(input ? d.actionModalInput.value : true);
      const onCancel = () => finish(null);
      const onBackdrop = e => { if(e.target === d.actionModalScrim) onCancel(); };
      d.actionModalConfirm.addEventListener('click', onConfirm);
      d.actionModalCancel.addEventListener('click', onCancel);
      d.actionModalClose.addEventListener('click', onCancel);
      d.actionModalScrim.addEventListener('click', onBackdrop);
      setTimeout(() => (input ? d.actionModalInput : d.actionModalConfirm).focus(), 30);
    });
  },
  showNotice(title, message){
    return this.showActionModal({ title, message, input:false, cancel:'Close' });
  },
  closeModal(){
    this.dom.modalScrim.classList.remove('open');
  },
  submitLessonForm(e){
    e.preventDefault();
    const title = this.dom.lfTitle.value.trim();
    const courseTitle = this.dom.lfCourse.value.trim() || 'My Lessons';
    const order = optionalOrder(this.dom.lfOrder.value);
    const text = normalizeLessonText(this.dom.lfText.value);
    const targetWPM = clamp(parseInt(this.dom.lfWpm.value, 10) || 30, 5, 200);
    const targetAccuracy = clamp(parseInt(this.dom.lfAcc.value, 10) || 95, 50, 100);
    if(!title || !text) return;
    const lesson = {
      id: uid('custom'), title, course: courseTitle, text, targetWPM, targetAccuracy,
      ...(order !== null ? { order } : {}),
      custom:true
    };
    this.customLessons.push(lesson);
    Storage.saveLessons(this.customLessons);
    this.closeModal();
    this.renderSidebar();
    this.loadLesson(lesson, courseTitle, { ready:true });
    this.bus.dispatchEvent(new CustomEvent('lessonAdded', { detail:{ lessonId:lesson.id } }));
  },
  async renameLesson(id){
    const lesson = this.customLessons.find(l => l.id === id);
    const found = this.findLesson(id);
    const target = lesson || (found && found.lesson);
    if(!target) return;
    const title = await this.showActionModal({ title:'Rename lesson', label:'Lesson name', value:target.title });
    if(title === null) return;
    const value = title.trim();
    if(!value || value === target.title) return;
    if(lesson) lesson.title = value;
    else this.saveLessonMetadata(id, { title:value });
    if(this.currentLesson && this.currentLesson.id === id){
      this.dom.lessonTitle.textContent = value;
      const refreshed = this.findLesson(id);
      if(refreshed) this.currentLesson = refreshed.lesson;
    }
    if(lesson) Storage.saveLessons(this.customLessons);
    this.renderSidebar();
  },
  async assignLessonCourse(id){
    const lesson = this.customLessons.find(l => l.id === id);
    const found = this.findLesson(id);
    const target = lesson || (found && found.lesson);
    if(!target) return;
    const course = await this.showActionModal({ title:'Assign to course', label:'Course name', value:target.course || found.courseTitle || 'My Lessons' });
    if(course === null) return;
    const value = course.trim() || 'My Lessons';
    if(value === target.course) return;
    if(lesson) {
      lesson.course = value;
      Storage.saveLessons(this.customLessons);
    } else this.saveLessonMetadata(id, { course:value });
    if(this.currentLesson && this.currentLesson.id === id){
      const refreshed = this.findLesson(id);
      if(refreshed){
        this.currentLesson = refreshed.lesson;
        this.dom.courseTag.textContent = refreshed.courseTitle;
      }
    }
    this.renderSidebar();
  },
  async setLessonOrder(id){
    const found = this.findLessonEntry(id);
    if(!found) return;
    const value = await this.showActionModal({ title:'Set lesson order', message:'Lower numbers come first. Leave blank for automatic order.', label:'Order', value:found.lesson.order ?? '' });
    if(value === null) return;
    const order = value.trim() === '' ? null : optionalOrder(value);
    if(value.trim() !== '' && order === null){
      await this.showNotice('Invalid order', 'Please enter a valid whole number.');
      return;
    }
    if(found.kind === 'custom'){
      const target = this.customLessons.slice().reverse().find(lesson => lesson.id === id);
      if(target){
        if(order === null) delete target.order;
        else target.order = order;
        Storage.saveLessons(this.customLessons);
      }
    }else{
      const current = this.overrides[id];
      const override = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
      if(order === null) delete override.order;
      else override.order = order;
      if(Object.keys(override).length) this.overrides[id] = override;
      else delete this.overrides[id];
      Storage.saveOverrides(this.overrides);
    }
    this.renderSidebar();
  },
  saveLessonMetadata(id, changes){
    const existing = this.overrides[id];
    const metadata = typeof existing === 'string'
      ? { text:existing }
      : existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
    this.overrides[id] = { ...metadata, ...changes };
    Storage.saveOverrides(this.overrides);
  },
  async deleteLesson(id){
    const found = this.findLesson(id);
    const lesson = found && found.lesson;
    if(!lesson) return;
    if(!await this.showActionModal({ title:'Delete lesson?', message:`Delete "${lesson.title}"? This cannot be undone.`, input:false, confirm:'Delete' })) return;
    this.exportSelection.delete(id);
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

  /* ----- export / import of a visitor's own lessons and their marks -----
     GitHub Pages has no backend, so a visitor's custom lessons live only
     in their own browser's localStorage — private to them, never seen by you or
     other visitors. This is the escape hatch: a visitor who wants to hand you a
     lesson they wrote can export it to a plain JSON file and send it to you
     however they like (email, a GitHub issue, a PR adding it to lessons/). You
     decide whether to fold it into a static pack in a future commit.
     Marks and masks are exported/imported through their own file and controls,
     so a digest can move between browsers without carrying lesson content. */
  downloadJson(payload, filename){
    const blob = new Blob([payload], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  async exportLessons(){
    if(this.editing){
      this.endInlineEdit(true);
      if(this.editing) return;
    }
    const selectedById = new Map();
    this.getAllCourses().forEach(course => course.lessons.forEach(lesson => {
      if(this.exportSelection.has(lesson.id) && !selectedById.has(lesson.id)){
        selectedById.set(lesson.id, {
          id:lesson.id,
          title:lesson.title,
          text:lesson.text,
          course:lesson.course || course.title,
          targetWPM:lesson.targetWPM,
          targetAccuracy:lesson.targetAccuracy,
          ...(lesson.order != null ? { order:lesson.order } : {}),
          ...(lesson.courseOrder != null ? { courseOrder:lesson.courseOrder } : {}),
          ...(Array.isArray(lesson.objectives) ? { objectives:lesson.objectives } : {}),
          ...(Array.isArray(lesson.topics) ? { topics:lesson.topics } : {})
        });
      }
    }));
    const selected = Array.from(selectedById.values());
    if(!selected.length){ await this.showNotice('Nothing selected', 'Select at least one lesson to export.'); return; }
    const payload = JSON.stringify({ exportedAt:new Date().toISOString(), format:'studyping-lessons.v1', lessons:selected }, null, 2);
    this.downloadJson(payload, `studyping-lessons-${selected.length}.json`);
  },
  async exportMarks(){
    if(!this.marks.length){ await this.showNotice('Nothing to export', 'No marks or masks to export yet.'); return; }
    const payload = JSON.stringify({ exportedAt:new Date().toISOString(), format:'studyping-marks.v1', marks:this.marks }, null, 2);
    this.downloadJson(payload, `studyping-marks-${this.marks.length}.json`);
  },
  async importMarksFromFile(file){
    const reader = new FileReader();
    reader.onload = async () => {
      try{
        const data = JSON.parse(String(reader.result));
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.marks) ? data.marks : null);
        if(!list || !list.length) throw new Error('That file does not contain a "marks" array.');
        const added = this.importMarks(list);
        this.renderMarks();
        await this.showNotice('Import complete', added
          ? `Imported ${added} mark${added === 1 ? '' : 's'}.`
          : 'No new marks were added — they are already saved or missing required fields.');
      }catch(err){
        console.warn('Studyping: mark import failed', err);
        await this.showNotice('Import failed', err && err.message ? err.message : 'That file did not look like a Studyping marks export.');
      }
    };
    reader.readAsText(file);
  },
  async importLessonsFromFile(file){
    if(this.importing){ await this.showNotice('Import in progress', 'A lesson import is already in progress.'); return; }
    this.importing = true;
    try{
      const data = JSON.parse(await this.readTextFile(file));
      await this.importLessonData(data);
    }catch(err){
      if(this.importConflict) this.finishImportConflict('skip');
      console.warn('Studyping: import failed', err);
      await this.showNotice('Import failed', err && err.message ? err.message : 'That file did not look like a Studyping lessons export.');
    }finally{
      this.importing = false;
    }
  },
  readTextFile(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('That file could not be read.'));
      reader.readAsText(file);
    });
  },
  async importLessonData(data){
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.lessons) ? data.lessons : []);
    const markList = data && Array.isArray(data.marks) ? data.marks : [];
    const ovr = data && data.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides) ? data.overrides : {};
    const deletedList = data && Array.isArray(data.deletedLessons) ? data.deletedLessons : [];
    if(!list.length && !Object.keys(ovr).length && !deletedList.length){
      throw new Error(markList.length
        ? 'That file contains marks, not lessons. Use Import marks to add them.'
        : 'That file did not look like a Studyping lessons export.');
    }
    // Restore deletions from the file before adding lessons, so a lesson in the
    // same file is not hidden by an id that the export also lists as deleted.
    deletedList.forEach(id => { if(typeof id === 'string' && id) this.deletedLessons.add(id); });
    if(deletedList.length) Storage.saveDeletedLessons(Array.from(this.deletedLessons));

    const result = await this.processImportedLessons(list, (info) => this.promptImportConflict(info));
    const overrideCount = Object.keys(ovr).length ? this.importOverrides(ovr) : 0;
    this.renderSidebar();

    const markNote = markList.length
      ? ` This file also contains ${plural(markList.length, 'mark')}; use Import marks to add ${markList.length === 1 ? 'it' : 'them'}.`
      : '';
    let message;
    if(list.length){
      message = this.describeImportResult(result);
    } else if(overrideCount){
      message = `Imported ${plural(overrideCount, 'lesson override')}.`;
    } else {
      message = 'No lesson changes were imported.';
    }
    await this.showNotice('Import complete', message + markNote);
  },
  describeImportResult(result){
    const changed = result.added + result.updated + result.versions;
    const details = [];
    if(result.added) details.push(`${result.added} new`);
    if(result.updated) details.push(`${result.updated} updated`);
    if(result.versions) details.push(`${result.versions} kept as a new version`);
    let message = changed
      ? `Imported ${plural(changed, 'lesson')}: ${details.join(', ')}.`
      : 'No lessons were changed.';
    if(result.restored) message += ` ${plural(result.restored, 'lesson')} restored.`;
    if(result.identical) message += ` ${plural(result.identical, 'lesson')} already had identical content and ${result.identical === 1 ? 'was' : 'were'} skipped.`;
    if(result.skipped) message += ` ${plural(result.skipped, 'conflict')} skipped.`;
    if(result.invalid) message += ` ${plural(result.invalid, 'entry', 'entries')} ${result.invalid === 1 ? 'was' : 'were'} not a valid lesson (title and text are required).`;
    return message;
  },
  async processImportedLessons(list, decide){
    const result = { added:0, updated:0, versions:0, identical:0, skipped:0, restored:0, invalid:0, conflicts:0 };
    let applyAllAction = null;
    let lessonsChanged = false, overridesChanged = false, deletedChanged = false;

    for(const raw of list){
      const incoming = normalizeImportedLesson(raw);
      if(!incoming){ result.invalid++; continue; }
      const existing = this.findLessonEntry(incoming.id);
      if(!existing){
        this.addImportedLesson(incoming, null, false);
        result.added++;
        lessonsChanged = true;
        if(this.deletedLessons.delete(incoming.id)) deletedChanged = true;
        continue;
      }
      const comparison = compareImportedLesson(existing.lesson, existing.courseTitle, incoming);
      if(comparison.same){
        if(this.deletedLessons.delete(existing.lesson.id)){ result.restored++; deletedChanged = true; }
        else result.identical++;
        continue;
      }
      result.conflicts++;
      let action = applyAllAction;
      if(!action){
        const answer = decide ? await decide({ incoming, existing, comparison }) : 'skip';
        if(answer && typeof answer === 'object'){
          action = answer.action;
          if(answer.applyAll) applyAllAction = action;
        } else {
          action = answer || 'skip';
        }
      }
      if(action === 'update'){
        this.applyImportedUpdate(existing, incoming);
        result.updated++;
        lessonsChanged = overridesChanged = true;
      } else if(action === 'new'){
        this.addImportedLesson(incoming, existing, true);
        result.versions++;
        lessonsChanged = true;
      } else {
        result.skipped++;
        continue;
      }
      if(this.deletedLessons.delete(incoming.id)) deletedChanged = true;
    }

    if(lessonsChanged) Storage.saveLessons(this.customLessons);
    if(overridesChanged) Storage.saveOverrides(this.overrides);
    if(deletedChanged) Storage.saveDeletedLessons(Array.from(this.deletedLessons));
    this.renderSidebar();
    return result;
  },
  importLessonsSync(list, conflictMode = 'skip'){
    // Non-interactive path for Studyping.importData(): conflicts follow the
    // caller's rule ('skip' by default) and identical ids are always skipped.
    const mode = conflictMode === 'update' || conflictMode === 'new' ? conflictMode : 'skip';
    const result = { added:0, updated:0, versions:0, identical:0, skipped:0, restored:0, invalid:0, conflicts:0 };
    let lessonsChanged = false, overridesChanged = false, deletedChanged = false;
    for(const raw of list){
      const incoming = normalizeImportedLesson(raw);
      if(!incoming){ result.invalid++; continue; }
      const existing = this.findLessonEntry(incoming.id);
      if(!existing){
        this.addImportedLesson(incoming, null, false);
        result.added++;
        lessonsChanged = true;
        if(this.deletedLessons.delete(incoming.id)) deletedChanged = true;
        continue;
      }
      const comparison = compareImportedLesson(existing.lesson, existing.courseTitle, incoming);
      if(comparison.same){
        if(this.deletedLessons.delete(existing.lesson.id)){ result.restored++; deletedChanged = true; }
        else result.identical++;
        continue;
      }
      result.conflicts++;
      if(mode === 'update'){
        this.applyImportedUpdate(existing, incoming);
        result.updated++;
        lessonsChanged = overridesChanged = true;
      } else if(mode === 'new'){
        this.addImportedLesson(incoming, existing, true);
        result.versions++;
        lessonsChanged = true;
      } else {
        result.skipped++;
        continue;
      }
      if(this.deletedLessons.delete(incoming.id)) deletedChanged = true;
    }
    if(lessonsChanged) Storage.saveLessons(this.customLessons);
    if(overridesChanged) Storage.saveOverrides(this.overrides);
    if(deletedChanged) Storage.saveDeletedLessons(Array.from(this.deletedLessons));
    this.renderSidebar();
    return result;
  },
  addImportedLesson(incoming, existing, asNewVersion){
    const base = existing ? existing.lesson : null;
    const lesson = {
      id: asNewVersion ? uid('custom') : incoming.id,
      title: incoming.title,
      course: incoming.course || (base ? (base.course || existing.courseTitle) : 'My Lessons'),
      text: incoming.text,
      targetWPM: incoming.targetWPM !== null ? incoming.targetWPM
        : (base && base.targetWPM != null ? base.targetWPM : 30),
      targetAccuracy: incoming.targetAccuracy !== null ? incoming.targetAccuracy
        : (base && base.targetAccuracy != null ? base.targetAccuracy : 95),
      ...(incoming.order !== null ? { order:incoming.order } : {}),
      ...(incoming.courseOrder !== null ? { courseOrder:incoming.courseOrder } : {}),
      custom: true
    };
    if(incoming.objectives) lesson.objectives = incoming.objectives;
    if(incoming.topics) lesson.topics = incoming.topics;
    this.customLessons.push(lesson);
    return lesson;
  },
  applyImportedUpdate(entry, incoming){
    if(entry.kind === 'custom'){
      // Update the copy the canonical list is actually showing (the last one with
      // this id); any older duplicate stays in history but no longer renders.
      const target = this.customLessons.slice().reverse().find(l => l.id === entry.lesson.id);
      if(!target) return;
      target.title = incoming.title;
      target.text = incoming.text;
      if(incoming.course) target.course = incoming.course;
      if(incoming.order !== null) target.order = incoming.order;
      if(incoming.courseOrder !== null) target.courseOrder = incoming.courseOrder;
      if(incoming.targetWPM !== null) target.targetWPM = incoming.targetWPM;
      if(incoming.targetAccuracy !== null) target.targetAccuracy = incoming.targetAccuracy;
      if(incoming.objectives) target.objectives = incoming.objectives;
      if(incoming.topics) target.topics = incoming.topics;
      target.custom = true;
      return;
    }
    // Built-in / static-pack lessons are code- or git-managed, so importing over
    // them writes the same kind of override as an in-place edit: same id, stats
    // and marks stay attached, and the original remains one click away.
    const raw = entry.raw;
    const id = raw.id;
    const current = this.overrides[id];
    const ov = current == null ? {} : (typeof current === 'string' ? { text:current } : { ...current });
    const originalText = normalizeLessonText(String(raw.text || ''));
    if(incoming.text !== originalText) ov.text = incoming.text; else delete ov.text;
    if(incoming.title !== raw.title) ov.title = incoming.title; else delete ov.title;
    const originalCourse = raw.course || entry.sourceCourseTitle || 'My Lessons';
    if(incoming.course){
      if(incoming.course !== originalCourse) ov.course = incoming.course; else delete ov.course;
    } else if(ov.course === originalCourse){
      delete ov.course;
    }
    const originalWpm = raw.targetWPM != null ? raw.targetWPM : 30;
    if(incoming.targetWPM !== null){
      if(incoming.targetWPM !== originalWpm) ov.targetWPM = incoming.targetWPM; else delete ov.targetWPM;
    }
    const originalAcc = raw.targetAccuracy != null ? raw.targetAccuracy : 95;
    if(incoming.targetAccuracy !== null){
      if(incoming.targetAccuracy !== originalAcc) ov.targetAccuracy = incoming.targetAccuracy; else delete ov.targetAccuracy;
    }
    if(incoming.order !== null){
      if(incoming.order !== (raw.order ?? null)) ov.order = incoming.order; else delete ov.order;
    }
    if(incoming.courseOrder !== null){
      if(incoming.courseOrder !== (raw.courseOrder ?? null)) ov.courseOrder = incoming.courseOrder;
      else delete ov.courseOrder;
    }
    if(Object.keys(ov).length) this.overrides[id] = ov; else delete this.overrides[id];
  },

  /* ----- import conflict dialog ----- */
  promptImportConflict(info){
    return new Promise(resolve => {
      this.importConflict = { info, resolve, previousFocus: document.activeElement };
      this.renderImportConflict(info);
      this.dom.importConflictApplyAll.checked = false;
      this.dom.importConflictScrim.classList.add('open');
      setTimeout(() => {
        if(this.importConflict) this.dom.importConflictUpdate.focus();
      }, 40);
    });
  },
  finishImportConflict(action){
    const pending = this.importConflict;
    if(!pending) return;
    const applyAll = this.dom.importConflictApplyAll.checked;
    const choice = action === 'update' || action === 'new' ? action : 'skip';
    this.importConflict = null;
    this.dom.importConflictScrim.classList.remove('open');
    this.dom.importConflictBody.innerHTML = '';
    if(pending.previousFocus && typeof pending.previousFocus.focus === 'function'){
      try{ pending.previousFocus.focus(); }catch(e){ /* the element may be gone */ }
    }
    pending.resolve({ action:choice, applyAll });
  },
  renderImportConflict({ incoming, existing, comparison }){
    const d = this.dom;
    const existingChars = normalizeLessonText(String(existing.lesson.text || '')).length;
    const incomingChars = incoming.text.length;
    d.importConflictIntro.textContent =
      `The file contains "${incoming.title}" (id: ${incoming.id}), but that id already belongs to ` +
      `"${existing.lesson.title}" in ${existing.courseTitle}. Choose what to do with the incoming version.`;

    const body = d.importConflictBody;
    body.innerHTML = '';

    const counts = document.createElement('div');
    counts.className = 'conflict-counts';
    const card = (label, title, chars, className) => {
      const box = document.createElement('div');
      box.className = `conflict-count ${className || ''}`.trim();
      const l = document.createElement('span');
      l.className = 'conflict-count-label';
      l.textContent = label;
      const t = document.createElement('span');
      t.className = 'conflict-count-title';
      t.textContent = title;
      const m = document.createElement('span');
      m.className = 'conflict-count-meta';
      m.textContent = `${chars.toLocaleString()} chars`;
      box.append(l, t, m);
      return box;
    };
    counts.append(
      card('Existing', existing.lesson.title, existingChars),
      Object.assign(document.createElement('span'), { className:'conflict-arrow', textContent:'→' }),
      card('Incoming', incoming.title, incomingChars, 'incoming')
    );
    body.appendChild(counts);

    const fields = document.createElement('div');
    fields.className = 'conflict-fields';
    comparison.changes.forEach(change => {
      const row = document.createElement('div');
      row.className = 'conflict-field';
      const label = document.createElement('span');
      label.className = 'conflict-field-label';
      label.textContent = change.field;
      const values = document.createElement('span');
      values.className = 'conflict-field-values';
      if(change.kind === 'text'){
        values.textContent =
          `${change.beforeChars.toLocaleString()} → ${change.afterChars.toLocaleString()} chars ` +
          `(${signed(change.deltaChars)}); ${signed(change.afterWords - change.beforeWords)} words; ` +
          `first change at character ${change.firstChange + 1}`;
      } else {
        const before = document.createElement('b');
        before.textContent = change.before || '(none)';
        values.append(before, document.createTextNode(' → '));
        const after = document.createElement('b');
        after.textContent = change.after || '(none)';
        values.append(after);
      }
      row.append(label, values);
      fields.appendChild(row);
    });
    body.appendChild(fields);

    const textChange = comparison.changes.find(c => c.kind === 'text');
    if(textChange){
      const diff = document.createElement('div');
      diff.className = 'conflict-diff';
      const head = document.createElement('div');
      head.className = 'conflict-diff-head';
      head.textContent = textChange.firstChange >= normalizeLessonText(String(existing.lesson.text || '')).length
        ? 'Text is added at the end'
        : textChange.firstChange === 0
          ? 'Text changes from the start'
          : `First change at character ${textChange.firstChange + 1}`;
      diff.appendChild(head);
      const chunk = (kind, labelText, text) => {
        if(!text) return;
        const row = document.createElement('div');
        row.className = `conflict-chunk ${kind}`;
        const label = document.createElement('span');
        label.className = 'conflict-chunk-label';
        label.textContent = labelText;
        const code = document.createElement('code');
        code.textContent = clampExcerpt(text, 320);
        row.append(label, code);
        diff.appendChild(row);
      };
      chunk('removed', 'Existing', textChange.removed);
      chunk('added', 'Incoming', textChange.added);
      body.appendChild(diff);
    }
  },

  /* ----- drawer ----- */
  openDrawer(){ this.dom.drawer.classList.add('open'); this.dom.drawerScrim.classList.add('open'); },
  closeDrawer(){ this.dom.drawer.classList.remove('open'); this.dom.drawerScrim.classList.remove('open'); },
  toggleShortcuts(){
    this.shortcutsCollapsed = !this.shortcutsCollapsed;
    this.savePref('shortcutsCollapsed', this.shortcutsCollapsed);
    this.applyShortcutCollapsed();
  },
  toggleCourse(title){
    const key = courseKey(title);
    if(!key) return;
    if(this.collapsedCourses.has(key)) this.collapsedCourses.delete(key);
    else this.collapsedCourses.add(key);
    this.savePref('collapsedCourses', Array.from(this.collapsedCourses));
    this.syncCourseCollapse(title);
  },
  syncCourseCollapse(title){
    const key = courseKey(title);
    const collapsed = this.collapsedCourses.has(key);
    this.dom.courseList.querySelectorAll('.course-group').forEach(group => {
      if(courseKey(group.dataset.courseDrag) !== key) return;
      group.classList.toggle('collapsed', collapsed);
      const lessons = group.querySelector('.course-lessons');
      const toggle = group.querySelector('.course-toggle');
      if(lessons){
        lessons.setAttribute('aria-hidden', String(collapsed));
        lessons.inert = collapsed;
      }
      if(toggle){
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${title}`);
        toggle.title = `${collapsed ? 'Expand' : 'Collapse'} ${title}`;
      }
    });
  },
  applyShortcutCollapsed(){
    const d = this.dom;
    if(!d.drawer) return;
    const collapsed = this.shortcutsCollapsed;
    d.drawer.classList.toggle('shortcuts-collapsed', collapsed);
    d.shortcutToggle.setAttribute('aria-expanded', String(!collapsed));
    d.shortcutToggle.setAttribute('aria-label', collapsed ? 'Expand shortcuts' : 'Collapse shortcuts');
    d.shortcutToggle.title = collapsed ? 'Expand shortcuts' : 'Collapse shortcuts';
  },

  /* ----- theme / sound / keyboard toggle ----- */
  setTheme(theme, persist=true){
    if(theme === 'system'){
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.dataset.theme = theme;
    }
    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const isGray = theme === 'gray';
    this.dom.themeBtn.classList.toggle('is-dark', isDark);
    this.dom.themeBtn.classList.toggle('is-gray', isGray);
    const nextTheme = isGray ? 'light' : isDark ? 'gray' : 'dark';
    const nextLabel = nextTheme === 'gray' ? 'grayscale' : nextTheme;
    this.dom.themeBtn.setAttribute('aria-label', `Switch to ${nextLabel} theme`);
    this.dom.themeBtn.title = `Switch to ${nextLabel} theme`;
    if(persist) this.savePref('theme', theme);
  },
  toggleTheme(){
    const current = document.documentElement.dataset.theme ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nextTheme = current === 'light' ? 'dark' : current === 'dark' ? 'gray' : 'light';
    this.setTheme(nextTheme);
  },
  toggleSound(){
    this.sound.enabled = !this.sound.enabled;
    this.updateSoundButton();
    this.savePref('sound', this.sound.enabled);
  },
  setSoundEnabled(enabled){
    this.sound.enabled = enabled;
    this.updateSoundButton();
    this.savePref('sound', enabled);
  },
  setRadioPlaying(playing){
    if(window.parent !== window && window.location.origin !== 'null'){
      window.parent.postMessage({ type:'studyping:radio', action:playing ? 'on' : 'off' }, window.location.origin);
    }
    this.showPill('edit', playing ? 'Radio on' : 'Radio off', 1200);
  },
  updateSoundButton(){
    const muted = !this.sound.enabled;
    const action = muted ? 'Unmute sound' : 'Mute sound';
    this.dom.soundBtn.classList.toggle('is-muted', muted);
    this.dom.soundBtn.setAttribute('aria-label', action);
    this.dom.soundBtn.title = action;
  },
  toggleKeyboard(){
    this.keyboardHidden = !this.keyboardHidden;
    this.applyKeyboardCollapsed();
    this.savePref('keyboardHidden', this.keyboardHidden);
  },
  applyKeyboardCollapsed(){
    const collapsed = this.keyboardHidden;
    this.dom.stageWrap.classList.toggle('keyboard-collapsed', collapsed);
    this.dom.keyboardToggleBtn.textContent = collapsed ? 'Show keyboard' : 'Hide keyboard';
    this.dom.keyboardToggleBtn.setAttribute('aria-expanded', String(!collapsed));
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
      ? 'Escape controls Studyping commands; turn off to leave Escape to the browser'
      : 'Escape is left to the browser; turn on to use Studyping commands';
  },

  /* ----- wiring ----- */
  wireEvents(){
    const d = this.dom;

    window.addEventListener('storage', (e) => {
      if(e.key === Storage.STATS_KEY) this.updateGlobalStats();
    });
    d.menuBtn.addEventListener('click', () => this.openDrawer());
    d.escapeSwitch.addEventListener('click', () => this.toggleEscapeCommands());
    d.shortcutToggle.addEventListener('click', () => this.toggleShortcuts());
    d.drawerCloseBtn.addEventListener('click', () => this.closeDrawer());
    d.drawerScrim.addEventListener('click', () => this.closeDrawer());

    d.courseList.addEventListener('change', (e) => {
      const box = e.target.closest('.lesson-export');
      if(!box) return;
      if(box.checked) this.exportSelection.add(box.dataset.exportId);
      else this.exportSelection.delete(box.dataset.exportId);
      this.updateExportButton();
    });
    d.courseList.addEventListener('dragstart', (e) => {
      const lesson = e.target.closest('.lesson-item');
      const course = e.target.closest('.course-group');
      if(lesson){
        this._drag = { type:'lesson', id:lesson.dataset.id };
        lesson.classList.add('dragging');
      }else if(course){
        this._drag = { type:'course', title:course.dataset.courseDrag };
        course.classList.add('dragging');
      }
      if(this._drag && e.dataTransfer){
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this._drag.id || this._drag.title);
      }
    });
    d.courseList.addEventListener('dragover', (e) => {
      if(!this._drag) return;
      e.preventDefault();
      const target = e.target.closest('.lesson-item, .course-group');
      if(target) target.classList.add('drag-over');
    });
    d.courseList.addEventListener('dragleave', (e) => {
      const target = e.target.closest('.lesson-item, .course-group');
      if(target && !target.contains(e.relatedTarget)) target.classList.remove('drag-over');
    });
    d.courseList.addEventListener('drop', (e) => this.handleSidebarDrop(e));
    d.courseList.addEventListener('dragend', () => {
      this._drag = null;
      d.courseList.querySelectorAll('.dragging,.drag-over').forEach(el => el.classList.remove('dragging', 'drag-over'));
    });
    d.courseList.addEventListener('click', (e) => {
      if(e.target.closest('.lesson-export')){ e.stopPropagation(); return; }
      const courseToggle = e.target.closest('.course-toggle');
      if(courseToggle){ e.stopPropagation(); this.toggleCourse(courseToggle.dataset.courseToggle); return; }
      const courseAdd = e.target.closest('.course-add');
      if(courseAdd){ e.stopPropagation(); this.openModal({ course:courseAdd.dataset.courseNew }); return; }
      const menuTrigger = e.target.closest('.lesson-menu-trigger');
      if(menuTrigger){
        e.stopPropagation();
        const menu = menuTrigger.closest('.lesson-menu');
        if(menu.classList.contains('open')){
          this.closeLessonMenu(menu);
        }else{
          this.closeOpenLessonMenus();
          const menuList = menu.querySelector('.lesson-menu-list');
          document.body.appendChild(menuList);
          menuList.classList.add('open');
          menu.classList.add('open');
          menuList.style.left = '0px';
          menuList.style.top = '0px';
          if(typeof menuList.showPopover === 'function') menuList.showPopover();
          this.positionLessonMenu(menuList, menuTrigger);
        }
        return;
      }
      const item = e.target.closest('.lesson-item');
      if(item){
        const found = this.findLesson(item.dataset.id);
        if(found){ this.loadLesson(found.lesson, found.courseTitle); this.closeDrawer(); }
      }
    });
    document.addEventListener('click', (e) => {
      const menuAction = e.target.closest('.lesson-menu-action');
      if(menuAction){
        e.stopPropagation();
        const menuList = menuAction.closest('.lesson-menu-list');
        const menu = Array.from(this.dom.courseList.querySelectorAll('.lesson-menu'))
          .find(item => item.dataset.menuId === menuList.dataset.menuId);
        if(!menu) return;
        const id = menu.dataset.menuId;
        this.closeLessonMenu(menu);
        if(menuAction.dataset.action === 'rename') this.renameLesson(id);
        else if(menuAction.dataset.action === 'assign-course') this.assignLessonCourse(id);
        else if(menuAction.dataset.action === 'set-order') this.setLessonOrder(id);
        else if(menuAction.dataset.action === 'restore') this.restoreLesson(id);
        else if(menuAction.dataset.action === 'delete') this.deleteLesson(id);
        return;
      }
      if(e.target.closest('.lesson-menu, .lesson-menu-list')) return;
      this.closeOpenLessonMenus();
    });

    d.newLessonBtn.addEventListener('click', () => this.openModal());
    d.exportLessonsBtn.addEventListener('click', () => this.exportLessons());
    d.selectAllLessonsBtn.addEventListener('click', () => this.toggleAllLessonSelection());
    d.importLessonsBtn.addEventListener('click', () => d.importFileInput.click());
    d.importFileInput.addEventListener('change', () => {
      const file = d.importFileInput.files[0];
      if(file) this.importLessonsFromFile(file);
      d.importFileInput.value = '';
    });
    d.importConflictSkip.addEventListener('click', () => this.finishImportConflict('skip'));
    d.importConflictNew.addEventListener('click', () => this.finishImportConflict('new'));
    d.importConflictUpdate.addEventListener('click', () => this.finishImportConflict('update'));
    d.importConflictScrim.addEventListener('click', (e) => {
      if(e.target === d.importConflictScrim) this.finishImportConflict('skip');
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
    d.figuresToggleBtn.addEventListener('click', () => this.toggleFigures());
    d.mediaDeckPrev.addEventListener('mousedown', (e) => e.preventDefault());
    d.mediaDeckNext.addEventListener('mousedown', (e) => e.preventDefault());
    d.mediaDeckCollapse.addEventListener('mousedown', (e) => e.preventDefault());
    d.mediaDeck.addEventListener('mousedown', (e) => {
      if(!e.target.closest('button')) e.preventDefault(); // reading the figure must not steal typing focus
    });
    d.mediaDeckPrev.addEventListener('click', () => this.stepMediaSlide(-1));
    d.mediaDeckNext.addEventListener('click', () => this.stepMediaSlide(1));
    d.mediaDeckCollapse.addEventListener('click', () => this.toggleMediaDeckCollapsed());
    d.mediaDeckImage.addEventListener('load', () => {
      d.mediaDeckImage.hidden = false;
      d.mediaDeckFallback.hidden = true;
    });
    d.mediaDeckImage.addEventListener('error', () => {
      d.mediaDeckImage.hidden = true;
      d.mediaDeckFallback.hidden = false;
      d.mediaDeckFallback.textContent = 'This figure could not be loaded. Check its URL or replace it from Marks & masks.';
    });
    d.mediaCloseBtn.addEventListener('click', () => this.closeMediaEditor());
    d.mediaDone.addEventListener('click', () => this.closeMediaEditor());
    d.mediaScrim.addEventListener('click', (e) => { if(e.target === d.mediaScrim) this.closeMediaEditor(); });
    d.mediaForm.addEventListener('submit', (e) => this.submitMediaForm(e));
    d.mediaUrl.addEventListener('input', () => {
      if(this.mediaPendingSrc){
        this.mediaPendingSrc = '';
        d.mediaFile.value = '';
        d.mediaHint.textContent = 'Figures appear in a floating deck while the caret is inside this marked passage.';
      }
    });
    d.mediaFile.addEventListener('change', () => {
      const file = d.mediaFile.files[0];
      if(!file) return;
      if(!file.type.startsWith('image/')){
        d.mediaHint.textContent = 'Choose an image file (PNG, JPEG, GIF, WebP, SVG…).';
        d.mediaFile.value = '';
        return;
      }
      if(file.size > 1.5 * 1024 * 1024){
        d.mediaHint.textContent = 'That image is larger than 1.5 MB. Use a smaller file or paste an image URL.';
        d.mediaFile.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        this.mediaPendingSrc = String(reader.result);
        d.mediaUrl.value = '';
        d.mediaHint.textContent = `${file.name} selected (${Math.round(file.size / 1024)} KB). Add figure to attach it.`;
      };
      reader.onerror = () => { d.mediaHint.textContent = 'That file could not be read.'; };
      reader.readAsDataURL(file);
    });
    d.mediaList.addEventListener('input', (e) => {
      const field = e.target.dataset.field;
      if(!field) return;
      const row = e.target.closest('.media-edit-item');
      const mark = this.mediaMark();
      if(!row || !mark) return;
      const item = (mark.media || []).find(x => x.id === row.dataset.mediaId);
      if(!item) return;
      item[field] = e.target.value.slice(0, 240);
      Storage.saveMarks(this.marks);
      this.syncMediaDeck();
    });
    d.mediaList.addEventListener('change', (e) => {
      if(e.target.dataset.field) this.renderMarks();
    });
    d.mediaList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-media-remove]');
      const mark = this.mediaMark();
      if(!btn || !mark || !Array.isArray(mark.media)) return;
      mark.media = mark.media.filter(x => x.id !== btn.dataset.mediaRemove);
      if(!mark.media.length) delete mark.media;
      this.dom.mediaHint.textContent = 'Figure removed.';
      this.renderMediaEditor();
      this.saveMediaChanges();
    });
    d.marksOpenBtn.addEventListener('click', () => this.openMarks());
    d.marksCloseBtn.addEventListener('click', () => this.closeMarks());
    d.marksScrim.addEventListener('click', (e) => { if(e.target === d.marksScrim) this.closeMarks(); });
    d.marksPracticeBtn.addEventListener('click', () => this.practiceMarks());
    d.marksExportBtn.addEventListener('click', () => this.exportMarks());
    d.marksImportBtn.addEventListener('click', () => d.marksImportFileInput.click());
    d.marksImportFileInput.addEventListener('change', () => {
      const file = d.marksImportFileInput.files[0];
      if(file) this.importMarksFromFile(file);
      d.marksImportFileInput.value = '';
    });
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
      if(btn.dataset.act === 'media'){ this.openMediaEditor(m.id); return; }
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

    // Capture Escape before browser-level focus handling can consume it. Keep the
    // field's own handler responsible for inline editing and command-mode input.
    document.addEventListener('keydown', (e) => {
      if(e.key !== 'Escape' || (e.target === d.captureInput && (this.editing || this.commandMode))) return;
      this.onGlobalKeydown(e);
    }, true);
    // "Press any key" works from anywhere on the page, not just once the field has focus.
    document.addEventListener('keydown', (e) => {
      if(e.key !== 'Escape') this.onGlobalKeydown(e);
    });
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
      if(e.defaultPrevented) return;
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
   PUBLIC API — window.Studyping
   ---------------------------------------------------------------------
   Use this surface to feed your own content and hook your own gamification
   logic in without touching the internals above.

     Studyping.addLesson({
       title: 'My Drill', course: 'My Lessons', text: '...',
       targetWPM: 40, targetAccuracy: 96,
       objectives: [{ type:'minWpm', value:40, label:'Reach 40 wpm' }] // optional
     })
     Studyping.loadLesson(lessonId)
     Studyping.courses()                 // -> [{ title, lessons:[...] }]
     Studyping.getState()                // -> { lessonId, state, stats }
     Studyping.getGlobalStats()          // -> { lessons, runs, avgWpm, avgAccuracy, ... }
     Studyping.on('checkpoint', fn)      // events: start, keystroke, error,
     Studyping.off('checkpoint', fn)     //   wordComplete, checkpoint, lessonLoaded,
                                             //   lessonComplete, lessonAdded, lessonEdited,
                                             //   ready, paused, resumed, markAdded, markRemoved
     Studyping.setSoundEnabled(bool)
     Studyping.setTheme('light'|'dark'|'gray'|'system')
     Studyping.exportData() / importData(json, { conflicts:'skip'|'update'|'new' })
   ========================================================================= */
window.Studyping = {
  addLesson(lesson){
    const source = lesson && typeof lesson === 'object' ? lesson : {};
    const title = String(source.title || '').trim();
    const text = normalizeLessonText(String(source.text || ''));
    if(!title || !text) throw new Error('addLesson requires a title and text');
    let id = source.id || uid('custom');
    const existing = App.findLessonEntry(id);
    if(existing){
      const incoming = normalizeImportedLesson({ ...source, id, title, text });
      const comparison = compareImportedLesson(existing.lesson, existing.courseTitle, incoming);
      if(comparison.same) return existing.lesson.id; // already saved: no duplicate row
      id = uid('custom'); // same id, different content: keep both under a fresh id
      console.info(`Studyping: lesson id "${source.id}" already exists with different content; adding the new lesson as "${id}".`);
    }
    const wpm = optionalInt(source.targetWPM, 5, 200);
    const acc = optionalInt(source.targetAccuracy, 50, 100);
    const full = {
      id,
      title,
      course: source.course || 'My Lessons',
      text,
      targetWPM: wpm !== null ? wpm : 30,
      targetAccuracy: acc !== null ? acc : 95,
      objectives: source.objectives,
      topics: source.topics,
      ...(optionalOrder(source.order) !== null ? { order:optionalOrder(source.order) } : {}),
      ...(optionalOrder(source.courseOrder) !== null ? { courseOrder:optionalOrder(source.courseOrder) } : {}),
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
  marks(){
    return App.marks.map(m => ({
      ...m,
      ...(Array.isArray(m.media) ? { media:m.media.map(item => ({ ...item })) } : {})
    }));
  },
  getState(){
    return {
      lessonId: App.currentLesson ? App.currentLesson.id : null,
      state: App.state,
      pauseReason: App.pauseReason,
      stats: App.engine ? App.engine.getStats() : null
    };
  },
  getGlobalStats(){ return collectGlobalStats(Storage.loadStats()); },
  on(evt, fn){ App.bus.addEventListener(evt, fn); },
  off(evt, fn){ App.bus.removeEventListener(evt, fn); },
  setSoundEnabled(v){
    App.setSoundEnabled(!!v);
  },
  setTheme(t){ App.setTheme(t); },
  exportData(){
    return JSON.stringify({ lessons: App.customLessons, stats: Storage.loadStats(), marks: App.marks, overrides: App.overrides, deletedLessons:Array.from(App.deletedLessons) }, null, 2);
  },
  importData(json, options = {}){
    try{
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      const conflictMode = options && typeof options === 'object' ? options.conflicts : undefined;
      if(Array.isArray(data.deletedLessons)){
        data.deletedLessons.forEach(id => { if(typeof id === 'string' && id) App.deletedLessons.add(id); });
        Storage.saveDeletedLessons(Array.from(App.deletedLessons));
      }
      if(Array.isArray(data.lessons)){
        // Same id + identical content is always skipped. A differing id follows
        // options.conflicts: 'skip' (default), 'update', or 'new' (second version).
        const result = App.importLessonsSync(data.lessons, conflictMode);
        if(result.conflicts){
          console.info(`Studyping: importData resolved ${plural(result.conflicts, 'conflict')} using "${conflictMode || 'skip'}".`);
        }
      }
      if(data.stats){
        const merged = Object.assign({}, Storage.loadStats(), data.stats);
        Storage.saveStats(merged);
        App.updateGlobalStats();
      }
      if(Array.isArray(data.marks)) App.importMarks(data.marks);
      if(data.overrides) App.importOverrides(data.overrides);
      App.renderSidebar();
      return true;
    }catch(e){
      console.warn('Studyping: importData failed', e);
      return false;
    }
  }
};

// Keep integrations written for the previous module name working after the rename.
window.TypingStudio = window.Studyping;

})();
