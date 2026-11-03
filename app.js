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
let status = 'idle'; // 'idle' | 'live' | 'retry'

function setStatus(next) {
  if (status === next) return;
  status = next;
  statusDot.classList.toggle('live', next === 'live');
  statusDot.classList.toggle('retry', next === 'retry');
  statusEl.classList.toggle('retry', next === 'retry');
  statusEl.textContent =
    next === 'live'  ? 'эфир' :
    next === 'retry' ? 'переподключение' : '';
}

function setIntent(on) {
  wantsPlay = on;
  btnPlay.innerHTML = on ? '&#9646;&#9646;' : '&#9654;';
  if (!on) setStatus('idle');
}

// ── stream recovery ───────────────────────────────────────────────────────────
// Live streams die quietly. When a station or the network drops the connection,
// the browser often fires no `error` at all: currentTime simply stops advancing
// and the element waits forever. play() does not revive it — the resource has
// to be selected again, which is exactly what "switch to another station and
// back" did by hand. The code below does that on its own.
const CONNECT_MS = 20000; // no audio at all after (re)connecting
const STALL_MS   = 5000;  // playback was running, then went silent
const HEALTHY_MS = 15000; // playback long enough to reset the backoff
const RETRY_MS   = [0, 1000, 2000, 4000, 8000, 15000]; // then 15s forever

let retryTimer = null;
let healthyTimer = null;
let lastFailureAt = 0;  // last time the stream failed / recovery was scheduled
let retries = 0;
let lastTime = 0;       // last known currentTime
let lastProgressAt = 0; // when playback last actually moved

function playAudio() {
  if (!wantsPlay) return;
  const p = audio.play();
  if (!p) return;
  // play() resolves even if the user pressed pause mid-connect; don't let a
  // pending promise undo that.
  p.then(() => { if (!wantsPlay) audio.pause(); }).catch(onPlayRejected);
}

function onPlayRejected(err) {
  if (!wantsPlay) return;
  if (err && err.name === 'NotAllowedError') {
    // The browser refused to start audio without a user gesture; retrying
    // would only spin the watchdog, so drop back to paused.
    stopPlayback();
    return;
  }
  scheduleReconnect();
}

// reloadStation selects the current station's stream from scratch. Clearing the
// source and calling load() resets a stalled / errored element; assigning the
// URL opens a new connection. Assigning src does not fire `pause`, so recovery
// never looks like the user pressed pause.
function reloadStation() {
  if (!wantsPlay) return;
  clearTimeout(retryTimer);
  retryTimer = null;

  audio.removeAttribute('src');
  audio.load();
  audio.src = STATIONS[current].url;
  audio.load();

  lastTime = 0;
  lastProgressAt = Date.now();
  setStatus('retry');
  playAudio();
}

function scheduleReconnect() {
  if (!wantsPlay || retryTimer) return;
  const delay = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
  retries++;
  lastFailureAt = Date.now();
  setStatus('retry');
  retryTimer = setTimeout(reloadStation, delay);
}

function startPlayback() {
  setIntent(true);
  retries = 0;
  lastFailureAt = 0;
  // Always dial a fresh connection: a paused live stream holds stale buffered
  // audio and would resume seconds behind the live edge.
  reloadStation();
}

function stopPlayback() {
  clearTimeout(retryTimer);
  retryTimer = null;
  clearTimeout(healthyTimer);
  healthyTimer = null;
  retries = 0;
  setIntent(false);
  audio.pause();
  // Close the stream connection rather than leaving it downloading while
  // paused; playback always dials a fresh connection anyway.
  audio.removeAttribute('src');
  audio.load();
}

// ── controls ──────────────────────────────────────────────────────────────────
function switchTo(idx, autoplay = false) {
  current = (idx + STATIONS.length) % STATIONS.length;
  try { localStorage.setItem(STORE_KEY, String(current)); } catch { /* ignore */ }

  clearTimeout(retryTimer);
  retryTimer = null;
  clearTimeout(healthyTimer);
  healthyTimer = null;
  retries = 0;

  showStation();
  highlightActive();
  scrollActiveIntoView();

  if (autoplay || wantsPlay) {
    startPlayback();
  } else {
    // Nothing to play: drop the old source instead of leaving the paused
    // element holding a connection to the previous station.
    audio.removeAttribute('src');
    audio.load();
    setStatus('idle');
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
  setStatus('live');
  lastTime = audio.currentTime;
  lastProgressAt = Date.now();
  clearTimeout(healthyTimer);
  // Only a stream that stays up resets the backoff, so a station that dies
  // right after connecting backs off instead of reconnecting in a tight loop.
  healthyTimer = setTimeout(() => { retries = 0; }, HEALTHY_MS);
});

// A stall starts the silence clock; the stream may still recover on its own.
audio.addEventListener('waiting', () => {
  if (wantsPlay) lastProgressAt = Date.now();
});

audio.addEventListener('pause', () => {
  if (!wantsPlay) return;  // stopPlayback() already handled it
  if (audio.ended) return; // a live stream ran dry; `ended` reconnects

  // A failed stream pauses the element too. Chrome sets error and fires
  // `error` first, but recovery may already have reset the element, so also
  // ignore pauses that arrive right after a failure was reported.
  if (audio.error || retryTimer) return;
  if (Date.now() - lastFailureAt < 2000) return;

  stopPlayback();
});

audio.addEventListener('ended', () => {
  if (wantsPlay) scheduleReconnect();
});

audio.addEventListener('error', () => {
  if (wantsPlay) scheduleReconnect();
});

// Watchdog: a dead stream can sit forever in a half-dead state where
// currentTime never moves and no error is raised. Silence is the only reliable
// failure signal for live audio, so treat it as a dropped connection.
setInterval(() => {
  if (!wantsPlay || retryTimer) return;
  if (audio.paused || audio.ended || audio.seeking) return;

  const t = audio.currentTime;
  if (Number.isFinite(t) && t !== lastTime) {
    lastTime = t;
    lastProgressAt = Date.now();
    return;
  }

  const deadline = lastTime > 0 ? STALL_MS : CONNECT_MS;
  if (Date.now() - lastProgressAt > deadline) scheduleReconnect();
}, 1000);

// Coming back online: retry right away instead of waiting out the backoff,
// but leave healthy playback alone.
window.addEventListener('online', () => {
  if (!wantsPlay || Date.now() - lastProgressAt < 3000) return;
  retries = 0;
  reloadStation();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !wantsPlay) return;
  // Phone browsers suspend <audio> when the screen locks. Dial in fresh
  // instead of resuming a buffer that is already behind the live edge.
  if (audio.paused && !audio.ended) reloadStation();
});

// ── volume ────────────────────────────────────────────────────────────────────
audio.volume = +volumeEl.value;
volumeEl.addEventListener('input', () => { audio.volume = +volumeEl.value; });

// ── init ──────────────────────────────────────────────────────────────────────
buildList();
showStation();
scrollActiveIntoView();
