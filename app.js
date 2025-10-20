// app.js (type="module")
// Аудио файлдарды IndexedDB-ге сақтап, PWA режимінде жұмыс істейтін ойнатқыш

const dbName = 'my-media-player-db';
const storeName = 'tracks';
let db;

// --- IndexedDB helper ---
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(storeName)) {
        idb.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function addTrackToDB(track) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.add(track);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllTracksFromDB() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function deleteTrackFromDB(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function putTrackToDB(track) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(track);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// --- DOM Elements ---
const fileInput = document.getElementById('fileInput');
const addBtn = document.getElementById('addBtn');
const playlistEl = document.getElementById('playlist');
const audio = document.getElementById('audio');
const coverEl = document.getElementById('cover');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const progress = document.getElementById('progress');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const editMetaBtn = document.getElementById('editMetaBtn');
const removeBtn = document.getElementById('removeBtn');
const installBtn = document.getElementById('installBtn');
const metaModal = document.getElementById('metaModal');
const metaTitle = document.getElementById('metaTitle');
const metaArtist = document.getElementById('metaArtist');
const metaCoverInput = document.getElementById('metaCoverInput');
const saveMetaBtn = document.getElementById('saveMetaBtn');
const cancelMetaBtn = document.getElementById('cancelMetaBtn');
const volumeSlider = document.getElementById('volume');

// --- App State ---
let tracks = [];
let currentIndex = -1;
let isPlaying = false;
let deferredPrompt = null;

// --- Service Worker ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log('SW registered'))
    .catch(err => console.warn('SW failed', err));
}

// --- Install PWA ---
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = "block";
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  if (choice.outcome === 'accepted') console.log('App installed');
  deferredPrompt = null;
  installBtn.style.display = "none";
});

// --- Init ---
async function init() {
  await openDB();
  tracks = await getAllTracksFromDB();
  renderPlaylist();
  if (tracks.length) loadTrack(0);
  audio.volume = 1; // дыбыс бастапқыда 100%
}
init().catch(console.error);

// --- Add Files via Button Only ---
addBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  await handleFiles(files);
  fileInput.value = '';
});

// --- Handle Files ---
async function handleFiles(files) {
  const audioFiles = files.filter(f => f.type.startsWith('audio/'));
  const imageFiles = files.filter(f => f.type.startsWith('image/'));

  for (const f of audioFiles) {
    const name = f.name.replace(/\.[^/.]+$/, '');
    const track = {
      title: name,
      artist: 'Unknown',
      audioBlob: await f.arrayBuffer().then(buf => new Blob([buf], { type: f.type })),
      coverBlob: null,
      duration: 0,
      created: Date.now()
    };

    // Автоматты cover іздеу
    const base = f.name.replace(/\.[^/.]+$/, '');
    const matchingImage = imageFiles.find(img => img.name.replace(/\.[^/.]+$/, '') === base);
    if (matchingImage) {
      track.coverBlob = await matchingImage.arrayBuffer().then(buf => new Blob([buf], { type: matchingImage.type }));
    }

    await computeDurationForTrack(track);
    const id = await addTrackToDB(track);
    track.id = id;
    tracks.push(track);
  }

  renderPlaylist();
  if (currentIndex === -1 && tracks.length) loadTrack(0);
}

// --- Compute Duration ---
function computeDurationForTrack(track) {
  return new Promise((resolve) => {
    const tmp = document.createElement('audio');
    const url = URL.createObjectURL(track.audioBlob);
    tmp.src = url;
    tmp.addEventListener('loadedmetadata', () => {
      track.duration = Math.floor(tmp.duration);
      URL.revokeObjectURL(url);
      resolve();
    });
    tmp.addEventListener('error', () => resolve());
  });
}

// --- Render Playlist ---
function renderPlaylist() {
  playlistEl.innerHTML = '';
  tracks.forEach((t, idx) => {
    const li = document.createElement('li');
    li.className = 'track-item';
    li.dataset.index = idx;
    li.innerHTML = `
      <div class="leftcol">
        <div style="font-weight:600">${t.title}</div>
        <div style="font-size:0.85rem;color:#cfc0ff">${t.artist}</div>
      </div>
      <div class="rightcol">${formatTime(t.duration)}</div>`;
    li.addEventListener('click', () => {
      loadTrack(idx);
      play();
    });
    playlistEl.appendChild(li);
  });
}

// --- Load Track ---
function loadTrack(index) {
  if (index < 0 || index >= tracks.length) return;
  currentIndex = index;
  const t = tracks[index];

  if (audio.src) URL.revokeObjectURL(audio.src);
  const url = URL.createObjectURL(t.audioBlob);
  audio.src = url;

  titleEl.textContent = t.title;
  artistEl.textContent = t.artist || 'Unknown';
  durationEl.textContent = formatTime(t.duration);
  coverEl.src = t.coverBlob ? URL.createObjectURL(t.coverBlob) : 'images/icon-192.png';

  highlightPlaylistItem(index);
}

// --- Highlight Playlist Item ---
function highlightPlaylistItem(index) {
  playlistEl.querySelectorAll('li').forEach(li => li.classList.remove('active'));
  const el = playlistEl.querySelector(`li[data-index="${index}"]`);
  if (el) el.classList.add('active');
}

// --- Playback Controls ---
playBtn.addEventListener('click', () => isPlaying ? pause() : play());
prevBtn.addEventListener('click', () => {
  if (tracks.length) {
    loadTrack((currentIndex - 1 + tracks.length) % tracks.length);
    play();
  }
});
nextBtn.addEventListener('click', () => {
  if (tracks.length) {
    loadTrack((currentIndex + 1) % tracks.length);
    play();
  }
});

audio.addEventListener('timeupdate', () => {
  if (!isNaN(audio.duration)) {
    const pct = (audio.currentTime / audio.duration) * 100;
    progress.value = pct;
    currentTimeEl.textContent = formatTime(Math.floor(audio.currentTime));
  }
});
audio.addEventListener('ended', () => nextBtn.click());

progress.addEventListener('input', () => {
  if (!isNaN(audio.duration)) {
    audio.currentTime = (progress.value / 100) * audio.duration;
  }
});

function play() {
  if (!audio.src) return;
  audio.play();
  isPlaying = true;
  playBtn.textContent = '⏸';
}
function pause() {
  audio.pause();
  isPlaying = false;
  playBtn.textContent = '▶️';
}

// --- Volume Control ---
if (volumeSlider) {
  volumeSlider.addEventListener('input', () => {
    audio.volume = volumeSlider.value;
  });
}

// --- Remove Track ---
removeBtn.addEventListener('click', async () => {
  if (currentIndex === -1) return;
  const id = tracks[currentIndex].id;
  await deleteTrackFromDB(id);
  tracks.splice(currentIndex, 1);
  if (!tracks.length) {
    currentIndex = -1;
    audio.src = '';
    titleEl.textContent = 'No song selected';
    artistEl.textContent = '';
    coverEl.src = 'images/icon-192.png';
  } else {
    const next = Math.min(currentIndex, tracks.length - 1);
    loadTrack(next);
  }
  renderPlaylist();
});

// --- Edit Meta Modal ---
editMetaBtn.addEventListener('click', () => {
  if (currentIndex === -1) return;
  const t = tracks[currentIndex];
  metaTitle.value = t.title || '';
  metaArtist.value = t.artist || '';
  metaModal.classList.add('show');
});

cancelMetaBtn.addEventListener('click', () => metaModal.classList.remove('show'));

saveMetaBtn.addEventListener('click', async () => {
  if (currentIndex === -1) return;
  const t = tracks[currentIndex];
  t.title = metaTitle.value || t.title;
  t.artist = metaArtist.value || t.artist;

  if (metaCoverInput.files && metaCoverInput.files[0]) {
    const img = metaCoverInput.files[0];
    t.coverBlob = await img.arrayBuffer().then(buf => new Blob([buf], { type: img.type }));
  }
  await putTrackToDB(t);
  metaModal.classList.remove('show');
  renderPlaylist();
  loadTrack(currentIndex);
});

// --- Utils ---
function formatTime(s) {
  if (!s && s !== 0) return '0:00';
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}
