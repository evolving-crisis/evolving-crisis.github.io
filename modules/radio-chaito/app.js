/* Radio Chaito - a portable, dependency-free radio player module. */
'use strict';

const isEmbed = new URLSearchParams(window.location.search).get('embed') === 'header';
if (isEmbed) document.body.classList.add('embed');

const CFG = {
  brand: '420 pb chaïto',
  playlist: [
    { title: 'Black holes', src: null, dur: 90, type: 'voice' },
    { title: 'The DNA suite', src: null, dur: 90, type: 'music' },
    { title: 'Climate 101', src: null, dur: 60, type: 'voice' }
  ]
};
let S = { mode: 'auto', accent: '#cb4b16', bars: 32, sens: 1.2, smooth: 0.75 };
try { Object.assign(S, JSON.parse(localStorage.getItem('rc-cfg') || '{}')); } catch (error) { console.warn('Radio settings could not be loaded.', error); }

const $ = id => document.getElementById(id);
const L = CFG.playlist;
const TOTAL = L.reduce((total, track) => total + track.dur, 0);
const bar = $('bar');
const aud = $('aud');
let folded = isEmbed;
if (folded) document.body.classList.add('folded');
$('bname').textContent = CFG.brand;

function setFolded(value) {
  folded = value;
  document.body.classList.toggle('folded', folded);
  if (!folded) document.body.classList.remove('meiosis');
  $('fold').setAttribute('aria-label', folded ? $('play').getAttribute('aria-label') : 'Collapse radio player');
  $('fold').setAttribute('aria-expanded', String(!folded));
  if (folded) $('fold').setAttribute('aria-pressed', $('play').getAttribute('aria-pressed') || 'false');
  else $('fold').removeAttribute('aria-pressed');
  if (isEmbed) window.parent.postMessage({ type: 'radio-chaito:widget', action: 'fold', folded }, window.location.origin);
}
$('fold').onclick = () => {
  if (folded) {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.body.classList.remove('meiosis');
      void $('fold').offsetWidth;
      document.body.classList.add('meiosis');
    }
    togglePlayback();
  } else setFolded(true);
};
$('fold').addEventListener('animationend', event => {
  if (event.animationName === 'nucleus-meiosis') document.body.classList.remove('meiosis');
});
$('fold').addEventListener('keydown', event => {
  if (folded && event.key === 'Escape') {
    event.preventDefault();
    setFolded(false);
    $('play').focus();
  }
});
bar.addEventListener('click', event => {
  if (event.target.closest('button, input, select, a')) return;
  setFolded(!folded);
});
setFolded(folded);

function reportActivity(kind, event) {
  let point = null;
  if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    point = { x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight };
  }
  if (isEmbed) window.parent.postMessage({ type: 'radio-chaito:widget', action: 'activity', kind, point }, window.location.origin);
}

function createWanderer(element) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const margin = 12;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const randomBetween = (min, max) => min + Math.random() * (max - min);
  const limits = () => ({
    x: Math.max(margin, window.innerWidth - element.offsetWidth - margin),
    y: Math.max(margin, window.innerHeight - element.offsetHeight - margin)
  });
  const max = limits();
  const position = {
    x: clamp((window.innerWidth - element.offsetWidth) * .36, margin, max.x),
    y: clamp(window.innerHeight * .16, margin, max.y)
  };
  let movement = null;
  let frame = 0;
  let timer = 0;
  element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;

  function schedule() {
    timer = setTimeout(() => moveTo(null), randomBetween(7000, 19000));
  }

  function animate(now) {
    frame = 0;
    if (!movement) return;
    const progress = Math.min(1, (now - movement.startedAt) / movement.duration);
    const eased = progress * progress * (3 - 2 * progress);
    position.x = movement.from.x + (movement.to.x - movement.from.x) * eased;
    position.y = movement.from.y + (movement.to.y - movement.from.y) * eased;
    element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    if (progress < 1) frame = requestAnimationFrame(animate);
    else {
      movement = null;
      schedule();
    }
  }

  function moveTo(point) {
    clearTimeout(timer);
    if (reducedMotion.matches) return;
    const bounds = limits();
    const target = point
      ? {
          x: clamp(point.x + randomBetween(-180, 180) - element.offsetWidth / 2, margin, bounds.x),
          y: clamp(point.y + randomBetween(-140, 140) - element.offsetHeight / 2, margin, bounds.y)
        }
      : { x: randomBetween(margin, bounds.x), y: randomBetween(margin, bounds.y) };
    movement = {
      from: { x: position.x, y: position.y },
      to: target,
      startedAt: performance.now(),
      duration: randomBetween(26000, 52000)
    };
    if (!frame) frame = requestAnimationFrame(animate);
  }

  function nudge(point) { moveTo(point); }
  window.addEventListener('resize', () => {
    const bounds = limits();
    position.x = clamp(position.x, margin, bounds.x);
    position.y = clamp(position.y, margin, bounds.y);
    element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    moveTo(null);
  });
  reducedMotion.addEventListener?.('change', event => {
    if (event.matches) {
      clearTimeout(timer);
      movement = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    } else schedule();
  });
  if (!reducedMotion.matches) schedule();
  return { nudge };
}

const wanderer = isEmbed ? null : createWanderer(bar);
let lastActivityAt = 0;
let lastPointerPoint = null;
function handleActivity(kind, event) {
  const now = Date.now();
  if (kind === 'pointer' && now - lastActivityAt < 1400) return;
  lastActivityAt = now;
  const point = event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
    ? { x: event.clientX, y: event.clientY }
    : null;
  reportActivity(kind, event);
  if (!isEmbed && wanderer) wanderer.nudge(point);
}
window.addEventListener('pointermove', event => {
  const point = { x: event.clientX, y: event.clientY };
  if (lastPointerPoint && Math.hypot(point.x - lastPointerPoint.x, point.y - lastPointerPoint.y) < 60) return;
  lastPointerPoint = point;
  handleActivity('pointer', event);
}, { passive: true });
window.addEventListener('pointerdown', event => handleActivity('click', event), { passive: true });
window.addEventListener('keydown', event => {
  if (!event.repeat && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) handleActivity('key');
});

function applyCfg() {
  document.documentElement.style.setProperty('--accent', S.accent);
  $('mode').value = S.mode;
  $('accent').value = S.accent;
  $('bars').value = S.bars;
  $('sens').value = S.sens;
  $('smooth').value = S.smooth;
  if (an) an.smoothingTimeConstant = S.smooth;
  try { localStorage.setItem('rc-cfg', JSON.stringify(S)); } catch (error) { console.warn('Radio settings could not be saved.', error); }
}
['mode', 'accent', 'bars', 'sens', 'smooth'].forEach(key => $(key).addEventListener('input', event => {
  S[key] = key === 'mode' || key === 'accent' ? event.target.value : +event.target.value;
  applyCfg();
}));
$('gear').onclick = () => $('panel').classList.toggle('open');

let ctx;
let an;
let vol;
let elSrc;
let synthStop = null;
function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  an = ctx.createAnalyser();
  an.fftSize = 1024;
  an.smoothingTimeConstant = S.smooth;
  vol = ctx.createGain();
  vol.gain.value = +$('vol').value;
  vol.connect(an);
  an.connect(ctx.destination);
  elSrc = ctx.createMediaElementSource(aud);
  elSrc.connect(vol);
}
$('vol').oninput = event => { if (vol) vol.gain.value = +event.target.value; };

function synth(type) {
  const nodes = [];
  const timers = [];
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(vol);
  const osc = (oscillatorType, frequency) => {
    const oscillator = ctx.createOscillator();
    oscillator.type = oscillatorType;
    oscillator.frequency.value = frequency;
    oscillator.start();
    nodes.push(oscillator);
    return oscillator;
  };
  if (type === 'voice') {
    const oscillator = osc('sawtooth', 115);
    const lfo = osc('sine', 5.5);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 4;
    lfo.connect(lfoGain);
    lfoGain.connect(oscillator.frequency);
    const firstFilter = ctx.createBiquadFilter();
    const secondFilter = ctx.createBiquadFilter();
    firstFilter.type = secondFilter.type = 'bandpass';
    firstFilter.Q.value = secondFilter.Q.value = 4;
    oscillator.connect(firstFilter);
    oscillator.connect(secondFilter);
    firstFilter.connect(gain);
    secondFilter.connect(gain);
    timers.push(setInterval(() => {
      const now = ctx.currentTime;
      firstFilter.frequency.setTargetAtTime(300 + Math.random() * 600, now, .05);
      secondFilter.frequency.setTargetAtTime(900 + Math.random() * 1500, now, .05);
      oscillator.frequency.setTargetAtTime(100 + Math.random() * 50, now, .08);
      gain.gain.setTargetAtTime(Math.random() < .2 ? .02 : .5 + Math.random() * .4, now, .04);
    }, 170));
  } else {
    const scale = [220, 261.6, 329.6, 392, 440, 523.3, 659.3];
    const oscillators = [osc('triangle', 220), osc('square', 110)];
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1800;
    oscillators.forEach(oscillator => oscillator.connect(lowpass));
    lowpass.connect(gain);
    const kick = osc('sine', 55);
    const kickGain = ctx.createGain();
    kickGain.gain.value = 0;
    kick.connect(kickGain);
    kickGain.connect(gain);
    let i = 0;
    gain.gain.value = .35;
    timers.push(setInterval(() => {
      const now = ctx.currentTime;
      oscillators[0].frequency.setValueAtTime(scale[(i * 3) % 7], now);
      oscillators[1].frequency.setValueAtTime(scale[(i * 2) % 7] / 2, now);
      if (i % 2 === 0) {
        kickGain.gain.cancelScheduledValues(now);
        kickGain.gain.setValueAtTime(1.2, now);
        kickGain.gain.exponentialRampToValueAtTime(.01, now + .3);
      }
      i++;
    }, 250));
  }
  return () => {
    timers.forEach(clearInterval);
    gain.gain.setTargetAtTime(0, ctx.currentTime, .05);
    setTimeout(() => {
      nodes.forEach(node => { try { node.stop(); } catch (error) { /* already stopped */ } });
      gain.disconnect();
    }, 300);
  };
}

let idx = 0;
let live = true;
let playing = false;
let online = navigator.onLine;
let animationFrame = 0;
let progressTimer = null;
let startedAt = 0;
let endTimer = null;
function whatsOn() {
  let time = (Date.now() / 1000) % TOTAL;
  for (let i = 0; i < L.length; i++) {
    if (time < L[i].dur) return { i, off: time };
    time -= L[i].dur;
  }
  return { i: 0, off: 0 };
}
function stopCurrent() {
  clearTimeout(endTimer);
  if (synthStop) { synthStop(); synthStop = null; }
  aud.pause();
}
function load(i, offset) {
  initAudio();
  stopCurrent();
  idx = i;
  const track = L[i];
  startedAt = Date.now() - offset * 1000;
  if (ctx.state === 'suspended') ctx.resume();
  if (track.src) {
    aud.src = track.src;
    aud.onloadedmetadata = () => { aud.currentTime = offset; aud.play().catch(() => {}); };
    aud.onended = () => advance();
    aud.load();
  } else {
    synthStop = synth(track.type);
    endTimer = setTimeout(advance, (track.dur - offset) * 1000);
  }
  playing = true;
  ui();
}
function advance() {
  if (live) { const current = whatsOn(); load(current.i, current.off); }
  else load((idx + 1) % L.length, 0);
}
function ui() {
  const playLabel = playing ? 'Pause radio' : 'Play radio';
  $('ic').setAttribute('d', playing ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'M8 5v14l11-7z');
  $('play').setAttribute('aria-label', playLabel);
  $('play').setAttribute('aria-pressed', String(playing));
  if (folded) {
    $('fold').setAttribute('aria-label', playLabel);
    $('fold').setAttribute('aria-pressed', String(playing));
  }
  bar.classList.toggle('on', playing);
  document.body.classList.toggle('awake', playing);
  document.body.classList.toggle('playing', playing);
  $('live').classList.toggle('is', online && live && playing);
  const now = $('now');
  const text = !online
    ? 'offline · no live signal'
    : playing
    ? (live ? '● ' : '') + L[idx].title + ' · ' + L[idx].type
    : 'a quiet frequency · tap to tune in';
  now.firstChild.textContent = text;
  now.classList.toggle('scroll', online && playing && text.length > 22);
  if (playing && online) {
    if (!progressTimer) progressTimer = setInterval(updateProgress, 500);
    updateProgress();
    if (getComputedStyle($('viz')).display !== 'none') startVisualization();
  } else {
    clearInterval(progressTimer);
    progressTimer = null;
    stopVisualization();
  }
}
function syncConnectivity() {
  online = navigator.onLine;
  document.body.classList.toggle('offline', !online);
  bar.setAttribute('aria-label', online ? 'Radio player' : 'Radio player, offline');
  ui();
}
window.addEventListener('online', syncConnectivity);
window.addEventListener('offline', syncConnectivity);
function togglePlayback() {
  if (playing) { stopCurrent(); playing = false; ui(); }
  else {
    if (live) { const current = whatsOn(); load(current.i, current.off); }
    else load(idx, 0);
  }
}
$('play').onclick = togglePlayback;
window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.source !== window.parent ||
      event.data?.type !== 'radio-chaito:command' ||
      !['on', 'off'].includes(event.data.action)) return;
  if (event.data.action === 'on') {
    if (!playing) $('play').click();
  } else if (playing) {
    stopCurrent();
    playing = false;
    ui();
  }
});
function updateProgress() {
  const progress = playing ? Math.min(100, (Date.now() - startedAt) / 10 / L[idx].dur) : 0;
  const progressBar = $('prog');
  progressBar.style.setProperty('--progress', String(progress));
  progressBar.setAttribute('aria-valuenow', String(Math.round(progress)));
  progressBar.setAttribute('aria-valuetext', `${Math.round(progress)}% played, ${100 - Math.round(progress)}% remaining`);
}
$('next').onclick = () => { live = false; load((idx + 1) % L.length, 0); };
$('prev').onclick = () => { live = false; load((idx - 1 + L.length) % L.length, 0); };
$('live').onclick = () => { live = true; const current = whatsOn(); load(current.i, current.off); };

const cv = $('viz');
const c = cv.getContext('2d');
let W = 0;
let H = 0;
let ph = 0;
const peaks = [];
const sm = [];
function fit() {
  const d = devicePixelRatio || 1;
  const rect = cv.getBoundingClientRect();
  W = rect.width;
  H = rect.height;
  cv.width = W * d;
  cv.height = H * d;
  c.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener('resize', fit);
fit();
const fd = new Uint8Array(512);
function band(a, b) {
  let max = 0;
  for (let i = a; i < b; i++) max = Math.max(max, fd[i]);
  return max / 255;
}
function frame() {
  animationFrame = 0;
  if (!playing) return;
  c.clearRect(0, 0, W, H);
  const mode = S.mode === 'auto' ? L[idx].type : S.mode;
  const accent = S.accent;
  const mid = H / 2;
  if (an && playing) an.getByteFrequencyData(fd);
  else fd.fill(0);
  if (mode === 'voice') {
    ph += .05;
    const energy = [band(2, 14), band(14, 50), band(50, 160)];
    for (let k = 0; k < 3; k++) {
      sm[k] = (sm[k] || 0) * .8 + energy[k] * .2;
      const amp = (.06 + sm[k] * S.sens) * H * .5;
      const frequency = (k + 1.4) * .018;
      c.beginPath();
      c.lineWidth = k === 0 ? 2 : 1.2;
      c.strokeStyle = accent;
      c.globalAlpha = k === 0 ? 1 : .45 - k * .1;
      for (let x = 0; x <= W; x += 2) {
        const envelope = Math.sin(Math.PI * x / W);
        const y = mid + Math.sin(x * frequency + ph * (1 + k * .6) + k) * amp * envelope;
        x ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
    c.globalAlpha = 1;
  } else if (mode === 'helix') {
    ph += .035;
    const cycles = Math.max(2, W / 72);
    const amplitude = H * (.2 + Math.min(.12, band(3, 80) * S.sens * .1));
    const points = [];
    for (let x = 0; x <= W; x += 2) {
      const angle = x / W * Math.PI * 2 * cycles + ph;
      points.push({ x, upper: mid + Math.sin(angle) * amplitude, lower: mid - Math.sin(angle) * amplitude });
    }
    c.lineWidth = 1.25;
    c.strokeStyle = accent;
    for (const strand of ['upper', 'lower']) {
      c.beginPath();
      points.forEach((point, index) => index ? c.lineTo(point.x, point[strand]) : c.moveTo(point.x, point[strand]));
      c.globalAlpha = strand === 'upper' ? .92 : .55;
      c.stroke();
    }
    for (let i = 0; i < points.length; i += 7) {
      const point = points[i];
      const energy = band(4 + i % 36, 20 + i % 48);
      c.globalAlpha = .2 + energy * .7;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(point.x, point.upper);
      c.lineTo(point.x, point.lower);
      c.stroke();
      if (i % 21 === 0) {
        c.globalAlpha = .3 + energy * .55;
        c.beginPath();
        c.ellipse(point.x, mid, 2 + energy * 2, 1.3, ph + i, 0, Math.PI * 2);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
  } else {
    const n = S.bars;
    const gap = 3;
    const barWidth = Math.max(2, (W - gap * (n - 1)) / n);
    const segment = 4;
    const segmentGap = 2;
    const maxSegments = Math.floor(H / (segment + segmentGap));
    for (let i = 0; i < n; i++) {
      const a = Math.floor(2 * Math.pow(200, i / n));
      const b = Math.max(a + 1, Math.floor(2 * Math.pow(200, (i + 1) / n)));
      const value = Math.min(1, band(a, b) * S.sens * (1 + i / n * .6));
      sm[i] = Math.max(value, (sm[i] || 0) * .85);
      const segments = Math.round(sm[i] * maxSegments);
      const x = i * (barWidth + gap);
      peaks[i] = Math.max(segments, (peaks[i] || 0) - .12);
      c.fillStyle = accent;
      for (let j = 0; j < Math.max(segments, 1); j++) {
        c.globalAlpha = segments ? 1 - j / maxSegments * .5 : .25;
        c.fillRect(x, H - (j + 1) * (segment + segmentGap) + segmentGap, barWidth, segment);
      }
      c.globalAlpha = 1;
      c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg');
      c.fillRect(x, H - (Math.round(peaks[i]) + 1) * (segment + segmentGap) + segmentGap, barWidth, 2);
    }
  }
  animationFrame = requestAnimationFrame(frame);
}
function startVisualization() {
  if (!animationFrame && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    fit();
    animationFrame = requestAnimationFrame(frame);
  }
}
function stopVisualization() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  c.clearRect(0, 0, W, H);
}
syncConnectivity();
applyCfg();
