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
  live:       'эфир',
  retry:      'переподключение',
  failed:     'нет сигнала',
  blocked:    'нажмите ▶',
};

function setPhase(next) {
  if (phase === next) return;
  phase = next;
  const isError = next === 'failed' || next === 'blocked';
  statusDot.classList.toggle('live',  next === 'live');
  statusDot.classList.toggle('retry', next === 'retry');
  statusDot.classList.toggle('error', isError);
  statusEl.classList.toggle('retry', next === 'retry');
  statusEl.classList.toggle('error', isError);
  statusEl.textContent = PHASE_TEXT[next];
}

function setIntent(on) {
  wantsPlay = on;
  btnPlay.innerHTML = on ? '&#9646;&#9646;' : '&#9654;';
}

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
    if (name === 'NotAllowedError') { block(); return; }
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
  lastTime = 0;
  lastProgressAt = Date.now();
  setPhase(tries > 0 ? 'retry' : 'connecting');
  audio.src = STATIONS[current].url + '#' + gen;
  playAudio(gen);
}

// fail counts a dead dial and either schedules the next one or gives up.
function fail() {
  if (!wantsPlay) return;
  // Browsers can report one dead source more than once (a 404 arrives as both
  // `error` and a stalled element). Count each dial once, or the retry budget
  // burns out before the second attempt.
  if (failedGen === dialGen) return;
  failedGen = dialGen;
  tries++;
  lastFailureAt = Date.now();

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
function block() {
  closeStream();
  setIntent(false);
  setPhase('blocked');
}

function startPlayback() {
  setIntent(true);
  tries = 0;
  lastFailureAt = 0;
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
  setPhase('live');
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
  if (wantsPlay) fail();
});

audio.addEventListener('error', () => {
  if (wantsPlay) fail();
});

// Watchdog: silence is the only failure signal a live stream gives us.
setInterval(() => {
  if (!wantsPlay || retryTimer) return;
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
    block();
    return;
  }

  const deadline = lastTime > 0 ? STALL_MS : CONNECT_MS;
  if (waited > deadline) fail();
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
