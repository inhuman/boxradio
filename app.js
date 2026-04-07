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
  {
    name:  'RP Mellow',
    genre: 'mellow · ambient',
    url:   'https://stream.radioparadise.com/mellow-mp3-192',
  },
  {
    name:  'RP Rock',
    genre: 'rock',
    url:   'https://stream.radioparadise.com/rock-mp3-192',
  },
  {
    name:  'RP Global',
    genre: 'world music',
    url:   'https://stream.radioparadise.com/global-mp3-192',
  },
  // ── Public Radio ─────────────────────────────────────────────────────────
  {
    name:  'KEXP 90.3',
    genre: 'indie · alternative · seattle',
    url:   'https://live-mp3-128.kexp.org/kexp128.mp3',
  },
  {
    name:  'WFMU',
    genre: 'freeform · experimental',
    url:   'https://stream0.wfmu.org/freeform-128k',
  },
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
];

// ── state ─────────────────────────────────────────────────────────────────────
let current  = 0;
let playing  = false;

// ── elements ──────────────────────────────────────────────────────────────────
const audio      = document.getElementById('audio');
const box        = document.querySelector('.box');
const statusDot  = document.getElementById('status-dot');
const stationEl  = document.getElementById('station-name');
const genreEl    = document.getElementById('genre-name');
const btnPlay    = document.getElementById('btn-play');
const btnPrev    = document.getElementById('btn-prev');
const btnNext    = document.getElementById('btn-next');
const volumeEl   = document.getElementById('volume');
const eqEl       = document.getElementById('eq');
const dotsEl     = document.getElementById('station-dots');

// ── build EQ bars ─────────────────────────────────────────────────────────────
const EQ_COUNT = 18;
const bars = Array.from({ length: EQ_COUNT }, (_, i) => {
  const bar = document.createElement('div');
  bar.className = 'eq-bar';
  // stagger duration and peak for organic feel
  const dur  = (.55 + Math.random() * .7).toFixed(2) + 's';
  const peak = (2.5 + Math.random() * 4).toFixed(1);
  bar.style.setProperty('--dur',  dur);
  bar.style.setProperty('--peak', peak);
  bar.style.animationDelay = (Math.random() * -.8).toFixed(2) + 's';
  eqEl.appendChild(bar);
  return bar;
});

// ── build station dots ────────────────────────────────────────────────────────
const dots = STATIONS.map((_, i) => {
  const d = document.createElement('button');
  d.className = 'btn s-dot';
  d.title = STATIONS[i].name;
  d.addEventListener('click', () => switchTo(i, true));
  dotsEl.appendChild(d);
  return d;
});

function updateDots() {
  dots.forEach((d, i) => d.classList.toggle('active', i === current));
}

// ── station info ──────────────────────────────────────────────────────────────
function loadStation(idx) {
  const s = STATIONS[idx];
  stationEl.textContent = s.name;
  genreEl.textContent   = s.genre;
  audio.src = s.url;
}

function switchTo(idx, autoplay = false) {
  current = (idx + STATIONS.length) % STATIONS.length;
  loadStation(current);
  updateDots();
  if (autoplay || playing) {
    audio.play().catch(() => {});
  }
}

// ── play / pause ──────────────────────────────────────────────────────────────
function setPlaying(state) {
  playing = state;
  box.classList.toggle('box--playing', state);
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

// ── WebSocket — live metadata ──────────────────────────────────────────────────
// Connects to /ws to receive now-playing metadata updates.
// Silently reconnects on drop; parse errors are discarded.
(function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('message', ({ data }) => {
    try {
      const msg = JSON.parse(data);
      if (msg.station) stationEl.textContent = msg.station;
      if (msg.track)   genreEl.textContent   = msg.track;
    } catch { /* binary protocol or malformed — ignore */ }
  });

  ws.addEventListener('close',   () => setTimeout(connectWS, 4000));
  ws.addEventListener('error',   () => ws.close());
})();

// ── init ──────────────────────────────────────────────────────────────────────
loadStation(current);
updateDots();
