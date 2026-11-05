'use strict';

// ── stations ──────────────────────────────────────────────────────────────────
const STATIONS = [
  // ── SomaFM ──────────────────────────────────────────────────────────────
  {
    name:  'Groove Salad',
    genre: 'ambient · electronic',
    url:   'https://ice6.somafm.com/groovesalad-128-mp3',
  },
  {
    name:  'Lush',
    genre: 'chillout · downbeat',
    url:   'https://ice6.somafm.com/lush-128-mp3',
  },
  {
    name:  'Deep Space One',
    genre: 'deep space · ambient',
    url:   'https://ice6.somafm.com/deepspaceone-128-mp3',
  },
  {
    name:  'Drone Zone',
    genre: 'dark ambient · drone',
    url:   'https://ice6.somafm.com/dronezone-128-mp3',
  },
  {
    name:  'Secret Agent',
    genre: 'spy · lounge · jazz',
    url:   'https://ice6.somafm.com/secretagent-128-mp3',
  },
  {
    name:  'Indie Pop Rocks',
    genre: 'indie · alternative',
    url:   'https://ice6.somafm.com/indiepop-128-mp3',
  },
  {
    name:  'Illinois Street Lounge',
    genre: 'lounge · exotica',
    url:   'https://ice6.somafm.com/illstreet-128-mp3',
  },
  {
    name:  'Boot Liquor',
    genre: 'americana · roots · country',
    url:   'https://ice6.somafm.com/bootliquor-128-mp3',
  },
  {
    name:  'Suburbs of Goa',
    genre: 'psychedelic · indian',
    url:   'https://ice6.somafm.com/suburbsofgoa-128-mp3',
  },
  {
    name:  'Digitalis',
    genre: 'idm · electronic',
    url:   'https://ice6.somafm.com/digitalis-128-mp3',
  },
  {
    name:  'Folk Forward',
    genre: 'folk · singer-songwriter',
    url:   'https://ice6.somafm.com/folkfwd-128-mp3',
  },
  // ── Radio Paradise ───────────────────────────────────────────────────────
  {
    name:  'Radio Paradise',
    genre: 'eclectic · rock · pop',
    url:   'https://stream.radioparadise.com/mp3-192',
  },
  // ── Public Radio ─────────────────────────────────────────────────────────
  {
    name:  'FIP',
    genre: 'jazz · eclectic · world',
    url:   'https://icecast.radiofrance.fr/fip-hifi.aac',
  },
  {
    name:  'FIP Rock',
    genre: 'rock · france',
    url:   'https://icecast.radiofrance.fr/fiprock-hifi.aac',
  },
  {
    name:  'WFMU',
    genre: 'freeform · experimental',
    url:   'https://stream0.wfmu.org/freeform-128k',
  },
  // ── Ambient ──────────────────────────────────────────────────────────────
  {
    name:  'Space Station Soma',
    genre: 'ambient · electronica',
    url:   'https://ice6.somafm.com/spacestation-128-mp3',
  },
  {
    name:  'Спокойное радио',
    genre: 'ambient · calm',
    url:   'https://listen9.myradio24.com/6262',
  },
  // ── Chillstep · Chillout ─────────────────────────────────────────────────
  {
    name:  'CalmFlow',
    genre: 'chillstep · lo-fi',
    url:   'https://stream.24dubstep.pl/listen/chillstep/mp3_normal',
  },
  {
    name:  'Café del Mar',
    genre: 'chillout · balearic',
    url:   'https://streams.radio.co/se1a320b47/listen',
  },
  {
    name:  '0N Chillout',
    genre: 'chillout · downtempo',
    url:   'https://0n-chillout.radionetz.de/0n-chillout.aac',
  },
  // ── Bossa Nova ───────────────────────────────────────────────────────────
  {
    name:  'Monte Carlo Bossa Nova',
    genre: 'bossa nova · lounge',
    url:   'https://mc-mcbossa.hostingradio.ru/mcbossa96.aacp',
  },
  {
    name:  'Bossa Jazz Brasil',
    genre: 'bossa nova · jazz',
    url:   'https://centova5.transmissaodigital.com:20104/live',
  },
  {
    name:  '100% Covers Lounge',
    genre: 'bossa · lounge · covers',
    url:   'https://az1.mediacp.eu/listen/100coverslounge/radio.mp3',
  },
];

// ── state ─────────────────────────────────────────────────────────────────────
const STORE_KEY = 'boxradio:station';

// restoreStation returns the last-selected station index from localStorage,
// clamped to a valid range. Falls back to 0 if unset or storage is unavailable.
function restoreStation() {
  try {
    const i = parseInt(localStorage.getItem(STORE_KEY), 10);
    if (Number.isInteger(i) && i >= 0 && i < STATIONS.length) return i;
  } catch { /* private mode / disabled storage — ignore */ }
  return 0;
}

let current = restoreStation();

// ── elements ──────────────────────────────────────────────────────────────────
const audio      = document.getElementById('audio');
const statusDot  = document.getElementById('status-dot');
const statusEl   = document.getElementById('stream-status');
const stationEl  = document.getElementById('station-name');
const genreEl    = document.getElementById('genre-name');
const btnPlay    = document.getElementById('btn-play');
const btnPrev    = document.getElementById('btn-prev');
const btnNext    = document.getElementById('btn-next');
const volumeEl   = document.getElementById('volume');
const listEl     = document.getElementById('list');
const filterEl   = document.getElementById('filter');

// ── favorites (persisted by station url) ────────────────────────────────────────
const FAV_KEY = 'boxradio:favs';

function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY));
    return new Set(Array.isArray(v) ? v : []);
  } catch { return new Set(); }
}

const favs = loadFavs();

function saveFavs() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch { /* ignore */ }
}

function isFav(idx) {
  return favs.has(STATIONS[idx].url);
}

function toggleFav(idx) {
  const url = STATIONS[idx].url;
  if (favs.has(url)) favs.delete(url); else favs.add(url);
  saveFavs();
  buildList();
}

// ── station list ────────────────────────────────────────────────────────────────
let filter = 'all'; // 'all' | 'fav'

function buildList() {
  listEl.textContent = '';
  const shown = STATIONS.map((_, i) => i).filter(i => filter === 'all' || isFav(i));

  if (shown.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = 'нет избранных станций';
    listEl.appendChild(empty);
    return;
  }

  for (const i of shown) {
    const s = STATIONS[i];

    const row = document.createElement('div');
    row.className = 'station' + (i === current ? ' active' : '');
    row.dataset.idx = i;

    const main = document.createElement('button');
    main.className = 'station__main';
    const name = document.createElement('span');
    name.className = 'station__name';
    name.textContent = s.name;
    const genre = document.createElement('span');
    genre.className = 'station__genre';
    genre.textContent = s.genre;
    main.append(name, genre);
    main.addEventListener('click', () => switchTo(i, true));

    const fav = document.createElement('button');
    fav.className = 'station__fav' + (isFav(i) ? ' on' : '');
    fav.textContent = isFav(i) ? '★' : '☆';
    fav.title = 'В избранное';
    fav.addEventListener('click', () => toggleFav(i));

    row.append(main, fav);
    listEl.appendChild(row);
  }
}

function highlightActive() {
  for (const row of listEl.children) {
    if (row.dataset.idx !== undefined) {
      row.classList.toggle('active', Number(row.dataset.idx) === current);
    }
  }
}

function scrollActiveIntoView() {
  const row = listEl.querySelector('.station.active');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

filterEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  filter = btn.dataset.f;
  for (const c of filterEl.children) c.classList.toggle('active', c === btn);
  buildList();
});

// ── station info ──────────────────────────────────────────────────────────────
function showStation() {
  stationEl.textContent = STATIONS[current].name;
  genreEl.textContent   = STATIONS[current].genre;
}

// ── telemetry ─────────────────────────────────────────────────────────────────
// The player's own phases, and nothing else, recorded so that a report like
// "не играет на айфоне" can be reconstructed instead of guessed at.
// See .speckit/features/001-telemetry/specify.md for the allow-list.
const telemetry = (() => {
  const ENDPOINT = '/api/telemetry';
  const MAX_RECORDS = 12;   // per session (SC-005)
  const MAX_BYTES = 8192;   // per session
  const MAX_BATCH = 8;      // per request
  const FLUSH_MS = 1500;
  const COALESCE_MS = 5000; // identical failures merge into one record

  // Opt out before anything is allocated. GPC is on by default in Firefox, so
  // its sessions are simply absent — that is the opt-out working, not a bug.
  try {
    const dnt = String(navigator.doNotTrack || window.doNotTrack || '');
    if (navigator.globalPrivacyControl === true || dnt === '1' || dnt === 'yes') return null;
  } catch { /* treat as opt-in */ }

  let sid = '';
  try {
    const raw = new Uint8Array(8);
    crypto.getRandomValues(raw);
    sid = Array.from(raw, b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    sid = String(Math.random()).slice(2).padEnd(16, '0').slice(0, 16);
  }

  const clock = () => (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  const t0 = clock();
  const at = () => Math.round(clock() - t0);

  let seq = 0;
  let bytes = 0;
  let dropped = false;
  let started = false;
  let timer = null;
  let phase = 'idle';
  let phaseAt = 0;
  const outbox = [];

  // send delivers one batch. Beacons are reserved for the unload path, where
  // fetch may be cancelled; WebKit refuses a beacon whose type is not
  // CORS-safelisted ("application/json" is not), so the body goes as text/plain
  // and the collector reads JSON regardless of the declared type.
  function send(records, unload) {
    let body;
    try { body = JSON.stringify(records); } catch { return; }
    if (unload) {
      try {
        if (navigator.sendBeacon &&
            navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) {
          return;
        }
      } catch { /* fall through to fetch */ }
    }
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: body,
        keepalive: true,
      }).catch(() => {});
    } catch { /* silence: a broken collector must never affect playback */ }
  }

  function flush(unload) {
    clearTimeout(timer);
    timer = null;
    while (outbox.length) send(outbox.splice(0, MAX_BATCH), unload);
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
  }

  function push(fields) {
    if (dropped) return null;
    const rec = Object.assign({ v: 1, sid: sid, seq: ++seq, t: at() }, fields);
    const line = JSON.stringify(rec);
    if (outbox.length >= MAX_RECORDS - 1 || bytes + line.length > MAX_BYTES) {
      dropped = true;
      outbox.push({ v: 1, sid: sid, seq: ++seq, t: at(), kind: 'budget-exhausted' });
      flush();
      return null;
    }
    bytes += line.length;
    outbox.push(rec);
    schedule();
    return rec;
  }

  function phaseTo(to, extra) {
    if (to === phase) return;
    const now = at();
    const from = phase;
    const ms = phaseAt ? now - phaseAt : 0;
    phase = to;
    phaseAt = now;

    // A flapping stream repeats the same transition over and over; one record
    // with the latest timing tells the story better than twelve copies.
    const prev = outbox[outbox.length - 1];
    if (prev && prev.kind === 'phase' && prev.from === from && prev.to === to &&
        now - prev.t < COALESCE_MS) {
      prev.t = now;
      prev.ms = ms;
      return;
    }
    push(Object.assign({ kind: 'phase', from: from, to: to, ms: ms }, extra || {}));
  }

  addEventListener('pagehide', () => flush(true));
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });

  return {
    // Nothing is sent before the listener's first playback action (SC-007).
    start: function (station) {
      if (started) return;
      started = true;
      push({ t: 0, kind: 'start', station: station });
    },
    phase: phaseTo,
    attempt: function (n, reason, ms) {
      push({
        kind: 'attempt',
        attempt: n,
        reason: reason || 'none',
        ms: Math.max(0, Math.round(ms || 0)),
      });
    },
    flush: function () { flush(false); },
  };
})();

// ── playback state ────────────────────────────────────────────────────────────
// wantsPlay is the user's intent, not the state of the <audio> element. A live
// stream can be dead or reconnecting while the user still wants it on; keeping
// intent separate keeps the button on "pause" while recovery restarts the
// stream (selecting a new source momentarily puts the element back to paused).
let wantsPlay = false;

// phase drives the header, and so it also decides what the user is told is
// happening. The old code called every dial a "reconnect", so a slow first
// connection and a station that will never answer looked exactly the same:
// "переподключение" for as long as you cared to stare at it.
let phase = 'idle'; // 'idle' | 'connecting' | 'live' | 'retry' | 'failed' | 'blocked'

const PHASE_TEXT = {
  idle:       '',
  connecting: 'подключение',
  buffering:  'буферизация',
  live:       'эфир',
  retry:      'переподключение',
  failed:     'нет сигнала',
  blocked:    'нажмите ▶',
};

function setPhase(next, extra) {
  if (phase === next) return;
  phase = next;
  if (telemetry) telemetry.phase(next, extra);
  if (next === 'buffering') bufferingSince = Date.now();
  const isError = next === 'failed' || next === 'blocked';
  const isBuffer = next === 'buffering';
  statusDot.classList.toggle('live',  next === 'live');
  statusDot.classList.toggle('retry', next === 'retry');
  statusDot.classList.toggle('error', isError);
  statusDot.classList.toggle('buffering', isBuffer);
  statusEl.classList.toggle('retry', next === 'retry');
  statusEl.classList.toggle('error', isError);
  statusEl.classList.toggle('buffering', isBuffer);
  statusEl.textContent = PHASE_TEXT[next];
}

function setIntent(on) {
  wantsPlay = on;
  btnPlay.innerHTML = on ? '&#9646;&#9646;' : '&#9654;';
}

// ── buffered playback ────────────────────────────────────────────────────────
// A plain <audio> on a live stream keeps only ~2 s of reserve (measured), which
// is exactly the size of the holes listeners hear. There is no API to ask for
// more, so on browsers whose MSE accepts MP3/AAC we fetch the stream ourselves,
// keep five seconds buffered, and play from behind the live edge. Everywhere
// else the element path below is used unchanged.
const buffered = (() => {
  const RESERVE_MS = 5000;     // held before sound starts
  const MAX_BUFFER = 20;       // seconds ahead before we jump forward
  const TRIM_BEHIND = 10;      // seconds kept behind the playhead
  const START_TIMEOUT = 10000;

  let ms = null, sb = null, ctrl = null, timer = null;
  let started = false, url = null;

  function supported() {
    try {
      if (!window.MediaSource || !window.ReadableStream || !MediaSource.isTypeSupported) return false;
      return MediaSource.isTypeSupported('audio/mpeg') || MediaSource.isTypeSupported('audio/aac');
    } catch { return false; }
  }

  function type() {
    return MediaSource.isTypeSupported('audio/mpeg') ? 'audio/mpeg' : 'audio/aac';
  }

  function release() {
    clearTimeout(timer);
    timer = null;
    started = false;
    try { if (ctrl) ctrl.abort(); } catch { /* already gone */ }
    ctrl = null;
    sb = null;
    if (ms) {
      try { if (ms.readyState === 'open') ms.endOfStream(); } catch { /* detached */ }
      ms = null;
    }
    if (url) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      url = null;
    }
  }

  function stop() {
    release();
  }

  function append(chunk) {
    return new Promise((resolve, reject) => {
      if (!sb || !ms || ms.readyState !== 'open') return resolve();
      const done = () => { sb.removeEventListener('updateend', done); resolve(); };
      const bad = () => { sb.removeEventListener('error', bad); reject(new Error('append')); };
      sb.addEventListener('updateend', done);
      sb.addEventListener('error', bad, { once: true });
      try { sb.appendBuffer(chunk); } catch (e) { reject(e); }
    });
  }

  function trim() {
    return new Promise(resolve => {
      if (!sb || !ms || ms.readyState !== 'open' || sb.updating) return resolve();
      const b = sb.buffered;
      if (!b.length || !started) return resolve();
      const begin = b.start(0);
      const playhead = audio.currentTime || 0;
      if (playhead - begin <= TRIM_BEHIND) return resolve();
      const done = () => { sb.removeEventListener('updateend', done); resolve(); };
      sb.addEventListener('updateend', done);
      try { sb.remove(begin, Math.max(begin, playhead - 3)); } catch { resolve(); }
    });
  }

  function reserve() {
    if (!sb || !sb.buffered.length) return 0;
    const b = sb.buffered;
    return Math.round((b.end(b.length - 1) - b.start(0)) * 1000);
  }

  function startIfReady(alive, hooks) {
    if (started) return;
    const b = sb && sb.buffered;
    if (!b || !b.length) return;
    const begin = b.start(0);
    if ((b.end(b.length - 1) - begin) * 1000 < RESERVE_MS) return;

    started = true;
    clearTimeout(timer);
    timer = null;
    try { audio.currentTime = begin; } catch { /* not seekable yet */ }
    if (hooks.onReserve) hooks.onReserve(reserve());
    if (hooks.play) hooks.play(); else audio.play().catch(() => {});
  }

  function drift() {
    if (!sb || !sb.buffered.length) return;
    const b = sb.buffered;
    const end = b.end(b.length - 1);
    if (end - audio.currentTime > MAX_BUFFER) {
      try { audio.currentTime = end - RESERVE_MS / 1000; } catch { /* ignore */ }
    }
  }

  async function pump(streamURL, alive, hooks) {
    ctrl = new AbortController();
    const resp = await fetch(streamURL, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'Icy-MetaData': '0' },
    });
    if (!resp.ok || !resp.body) throw new Error('http ' + resp.status);

    const reader = resp.body.getReader();
    for (;;) {
      if (!alive()) { try { await reader.cancel(); } catch { /* ignore */ } return; }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      await append(value);
      if (!alive()) return;
      await trim();
      if (started) drift(); else startIfReady(alive, hooks);
    }
  }

  // start resolves when the pump ends or fails; the caller decides what that
  // means: a failure before sound is a fallback, after sound it is a drop.
  async function start(streamURL, alive, hooks) {
    release();
    const source = new MediaSource();
    ms = source;
    url = URL.createObjectURL(source);
    audio.src = url;

    await new Promise((resolve, reject) => {
      source.addEventListener('sourceopen', resolve, { once: true });
      source.addEventListener('error', () => reject(new Error('sourceopen')), { once: true });
    });
    if (!alive()) { release(); return; }

    sb = source.addSourceBuffer(type());
    if (hooks.onBuffering) hooks.onBuffering();

    timer = setTimeout(() => {
      if (!started && alive()) {
        release();
        if (hooks.onFail) hooks.onFail();
      }
    }, START_TIMEOUT);

    try {
      await pump(streamURL, alive, hooks);
    } catch (err) {
      release();
      if (!alive()) return;
      if (started) { if (hooks.onDrop) hooks.onDrop(); }
      else if (hooks.onFail) hooks.onFail();
    }
  }

  return { supported, start, stop, reserve };
})();

// ── stream recovery ───────────────────────────────────────────────────────────
// Live streams die quietly, and mobile Safari goes further: it can leave the
// element paused with data buffered and simply ignore play(), without raising
// `error` at all. Silence is therefore the only failure signal we get, and both
// the dials and the watchdog below are built around it: no sound for N ms means
// the dial failed, no matter what the element claims.
const CONNECT_MS    = 10000; // nothing playing this long after a dial
const STALL_MS      = 6000;  // was playing, then went silent
const BUFFERED_MS   = 2500;  // data buffered but the element never started
const HEALTHY_MS    = 15000; // played this long — the stream is fine again
const MAX_TRIES     = 3;     // failed dials in a row before we stop and ask
const RETRY_MS      = [0, 1000, 3000, 7000];

let retryTimer = null;
let healthyTimer = null;
let dialGen = 0;        // bumped on every dial; stale play() results are ignored
let failedGen = 0;      // last dial already counted as failed (one count per dial)
let dialAt = 0;         // when the current dial started (for telemetry durations)
let mixedContent = false; // station is http:// on an https page
let usingBuffered = false; // the current dial owns an MSE buffer
let lastReserve = 0;      // ms buffered when sound started
let bufferingSince = 0;   // when the current буферизация phase began
let tries = 0;          // failed dials since this station last played
let lastFailureAt = 0;  // when recovery was last scheduled
let lastTime = 0;       // last known currentTime
let lastProgressAt = 0; // when playback last actually moved

function playAudio(gen) {
  if (!wantsPlay || gen !== dialGen) return;
  const p = audio.play();
  if (!p || typeof p.then !== 'function') return;
  p.then(() => {
    if (!wantsPlay || gen !== dialGen) return;
    // play() resolving does not prove the element is running. On iOS Safari it
    // resolves while the element stays paused — a source change outside a
    // gesture drops the element's playback permission — so nudge it once from
    // the live element and let the watchdog catch whatever is left.
    if (audio.paused) {
      setTimeout(() => {
        if (wantsPlay && gen === dialGen && audio.paused) audio.play().catch(() => {});
      }, 350);
    }
  }).catch(err => {
    if (!wantsPlay || gen !== dialGen) return;
    const name = err && err.name;
    if (name === 'AbortError') return;      // a newer dial superseded this one
    if (name === 'NotAllowedError') { block(bufferedMs()); return; }
    fail();
  });
}

// closeStream releases the connection instead of leaving it downloading.
function closeStream() {
  clearTimeout(retryTimer);
  retryTimer = null;
  clearTimeout(healthyTimer);
  healthyTimer = null;
  dialGen++;
  buffered.stop();
  usingBuffered = false;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

// dial selects the current station from scratch. Assigning src is what runs the
// media load algorithm, so that is all a dial does. The old code also cleared
// src and called load() before selecting the new one; on iOS Safari that leaves
// the element paused and unplayable, which is why the radio sat on
// "переподключение" forever. The fragment makes every dial a fresh URL so the
// element really reconnects — fragments are never sent to the server.
function dial() {
  if (!wantsPlay) return;
  clearTimeout(retryTimer);
  retryTimer = null;

  const gen = ++dialGen;
  dialAt = Date.now();
  // A station moved to http:// on an https page cannot play at all; the reason
  // is worth recording so the failure is not mistaken for a dead stream.
  mixedContent = location.protocol === 'https:' &&
                 STATIONS[current].url.indexOf('http:') === 0;
  lastTime = 0;
  lastProgressAt = Date.now();
  setPhase(tries > 0 ? 'retry' : 'connecting');

  const url = STATIONS[current].url;
  usingBuffered = buffered.supported() && !mixedContent;
  if (usingBuffered) {
    buffered.start(url, () => gen === dialGen && wantsPlay, {
      onBuffering: () => { if (gen === dialGen && wantsPlay) setPhase('buffering'); },
      onReserve: (ms) => { lastReserve = ms; },
      play: () => playAudio(gen),
      onFail: () => {
        // No CORS, no MSE or a stream we cannot read: today's path, once.
        if (gen !== dialGen || !wantsPlay) return;
        usingBuffered = false;
        buffered.stop();
        elementDial(gen);
      },
      onDrop: () => { if (gen === dialGen && wantsPlay) fail('transport-error'); },
    });
    return;
  }
  elementDial(gen);
}

// elementDial is the pre-002 path: let the element fetch and buffer the stream.
function elementDial(gen) {
  audio.src = STATIONS[current].url + '#' + gen;
  playAudio(gen);
}

// fail counts a dead dial and either schedules the next one or gives up.
function fail(reason = 'transport-error') {
  if (!wantsPlay) return;
  // Browsers can report one dead source more than once (a 404 arrives as both
  // `error` and a stalled element). Count each dial once, or the retry budget
  // burns out before the second attempt.
  if (failedGen === dialGen) return;
  failedGen = dialGen;
  tries++;
  lastFailureAt = Date.now();
  if (telemetry) telemetry.attempt(tries, reason, Date.now() - dialAt);

  if (tries >= MAX_TRIES) {
    // Retrying forever behind "переподключение" is what made a dead station
    // look like it was about to start. Stop, say so, arm the play button.
    closeStream();
    setIntent(false);
    setPhase('failed');
    return;
  }

  setPhase('retry');
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    dial();
  }, RETRY_MS[Math.min(tries, RETRY_MS.length - 1)]);
}

// block: the browser wants a tap before it will make sound. Say so and leave
// the play button armed instead of promising a reconnect that cannot happen.
function block(buffered = 0) {
  if (telemetry) {
    telemetry.phase('blocked', { attempt: tries + 1, reason: 'play-refused', bufferedMs: buffered });
  }
  closeStream();
  setIntent(false);
  setPhase('blocked');
}

// bufferedMs is how much audio had arrived before playback was refused: the
// signature of the iOS state this feature exists to make visible (SC-002).
function bufferedMs() {
  return audio.readyState >= 3 ? Date.now() - dialAt : 0;
}

// errorReason names what the platform reported, from the closed set in the spec.
function errorReason() {
  if (mixedContent) return 'mixed-content';
  return audio.error && audio.error.code === 4 ? 'media-error' : 'transport-error';
}

function startPlayback() {
  setIntent(true);
  tries = 0;
  lastFailureAt = 0;
  if (telemetry) telemetry.start(STATIONS[current].name);
  // Always dial a fresh connection: a paused live stream holds stale buffered
  // audio and would resume seconds behind the live edge.
  dial();
}

function stopPlayback() {
  setIntent(false);
  setPhase('idle');
  closeStream();
}

// ── controls ──────────────────────────────────────────────────────────────────
function switchTo(idx, autoplay = false) {
  current = (idx + STATIONS.length) % STATIONS.length;
  try { localStorage.setItem(STORE_KEY, String(current)); } catch { /* ignore */ }

  tries = 0;
  lastFailureAt = 0;

  showStation();
  highlightActive();
  scrollActiveIntoView();

  if (autoplay || wantsPlay) {
    startPlayback();
  } else {
    // Nothing to play: drop the old source instead of leaving the paused
    // element holding a connection to the previous station.
    closeStream();
    setPhase('idle');
  }
}

btnPlay.addEventListener('click', () => {
  if (wantsPlay) stopPlayback();
  else startPlayback();
});

btnPrev.addEventListener('click', () => switchTo(current - 1, wantsPlay));
btnNext.addEventListener('click', () => switchTo(current + 1, wantsPlay));

// ── stream events ─────────────────────────────────────────────────────────────
audio.addEventListener('playing', () => {
  setPhase('live', lastReserve > 0 ? { bufferedMs: lastReserve } : undefined);
  lastTime = audio.currentTime;
  lastProgressAt = Date.now();
  clearTimeout(healthyTimer);
  // Only a stream that stays up resets the counter, so a station that dies
  // right after connecting still backs off instead of reconnecting in a loop.
  healthyTimer = setTimeout(() => { tries = 0; }, HEALTHY_MS);
});

// A stall starts the silence clock; the stream may still recover on its own.
audio.addEventListener('waiting', () => {
  if (wantsPlay) lastProgressAt = Date.now();
  // A refill is a real state, not silence: say so while it happens.
  if (wantsPlay && usingBuffered && phase === 'live') setPhase('buffering');
});

audio.addEventListener('pause', () => {
  if (!wantsPlay) return;  // stopPlayback() already handled it
  if (audio.ended) return; // a live stream ran dry; `ended` recovers

  // A failed dial pauses the element too, and recovery may already have
  // swapped the source. Only a pause that arrives while the element actually
  // had audio means the user (or the OS) stopped us on purpose.
  if (audio.error || retryTimer) return;
  if (!audio.getAttribute('src')) return;  // our own teardown
  if (audio.readyState < 2) return;        // still connecting, not a pause
  if (Date.now() - lastFailureAt < 2000) return;

  stopPlayback();
});

audio.addEventListener('ended', () => {
  if (wantsPlay) fail('transport-error');
});

audio.addEventListener('error', () => {
  if (wantsPlay) fail(errorReason());
});

// Watchdog: silence is the only failure signal a live stream gives us.
setInterval(() => {
  if (!wantsPlay || retryTimer) return;
  if (phase === 'buffering') {
    // A refill that never finishes must not hang the header: the constitution
    // gives this state 15 seconds to become эфир or нет сигнала.
    if (Date.now() - bufferingSince > 15000) fail('transport-error');
    return;
  }
  if (audio.ended || audio.seeking) return;

  const now = Date.now();
  const t = audio.currentTime;
  if (!audio.paused && Number.isFinite(t) && t !== lastTime) {
    lastTime = t;
    lastProgressAt = now;
    return;
  }

  const waited = now - lastProgressAt;

  // Data is buffered but the element never started: play() was ignored. On
  // iOS that means the browser wants a gesture — no amount of reconnecting
  // fixes it, and waiting out the connect timeout made it look like a stuck
  // "переподключение" with a full buffer and no sound.
  if (audio.paused && audio.readyState >= 3 && waited > BUFFERED_MS) {
    block(Date.now() - dialAt);
    return;
  }

  const deadline = lastTime > 0 ? STALL_MS : CONNECT_MS;
  if (waited > deadline) fail(lastTime > 0 ? 'stall' : 'transport-error');
}, 1000);

// Coming back online: retry right away instead of waiting out the backoff,
// but leave healthy playback alone.
window.addEventListener('online', () => {
  if (!wantsPlay || phase === 'live') return;
  if (Date.now() - lastProgressAt < 3000) return;
  tries = 0;
  dial();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !wantsPlay) return;
  // Phone browsers suspend <audio> when the screen locks. Dial in fresh
  // instead of resuming a buffer that is already behind the live edge.
  if (audio.paused && !audio.ended) {
    tries = 0;
    dial();
  }
});

// ── volume ────────────────────────────────────────────────────────────────────
audio.volume = +volumeEl.value;
volumeEl.addEventListener('input', () => { audio.volume = +volumeEl.value; });

// ── init ──────────────────────────────────────────────────────────────────────
buildList();
showStation();
scrollActiveIntoView();
