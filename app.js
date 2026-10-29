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

let current  = restoreStation();
let playing  = false;

// ── elements ──────────────────────────────────────────────────────────────────
const audio      = document.getElementById('audio');
const statusDot  = document.getElementById('status-dot');
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
function loadStation(idx) {
  const s = STATIONS[idx];
  stationEl.textContent = s.name;
  genreEl.textContent   = s.genre;
  audio.src = s.url;
}

function switchTo(idx, autoplay = false) {
  current = (idx + STATIONS.length) % STATIONS.length;
  try { localStorage.setItem(STORE_KEY, String(current)); } catch { /* ignore */ }
  loadStation(current);
  highlightActive();
  scrollActiveIntoView();
  if (autoplay || playing) {
    audio.play().catch(() => {});
  }
}

// ── play / pause ──────────────────────────────────────────────────────────────
function setPlaying(state) {
  playing = state;
  statusDot.classList.toggle('live', state);
  btnPlay.innerHTML = state ? '&#9646;&#9646;' : '&#9654;';
}

btnPlay.addEventListener('click', () => {
  if (audio.paused) {
    if (!audio.src) loadStation(current);
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
});

btnPrev.addEventListener('click', () => switchTo(current - 1, playing));
btnNext.addEventListener('click', () => switchTo(current + 1, playing));

audio.addEventListener('play',  () => setPlaying(true));
audio.addEventListener('pause', () => setPlaying(false));
audio.addEventListener('ended', () => setPlaying(false));

// ── volume ────────────────────────────────────────────────────────────────────
audio.volume = +volumeEl.value;
volumeEl.addEventListener('input', () => { audio.volume = +volumeEl.value; });

// ── init ──────────────────────────────────────────────────────────────────────
buildList();
loadStation(current);
scrollActiveIntoView();
