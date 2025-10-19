// app.js (type="module")
// Қысқаша: drag/drop және file input арқылы аудионы алып, IndexedDB-ге сақтап,
// UI-да көрсетіп, ойнатуды басқарады. Service Worker пен install prompt-ты да өңдейді.

const dbName = 'my-media-player-db';
const storeName = 'tracks';
let db;

// --- IndexedDB helper (қарапайым) ---
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(storeName)) {
        const store = idb.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
        // индекс қоюға болады: store.createIndex('title', 'title', { unique: false });
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
    const q = store.add(track);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
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

function deleteTrackFromDB(id){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// --- DOM elements ---
const fileInput = document.getElementById('fileInput');
const addBtn = document.getElementById('addBtn');
const dropZone = document.getElementById('dropZone');
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

const metaModal = document.getElementById('metaModal');
const metaTitle = document.getElementById('metaTitle');
const metaArtist = document.getElementById('metaArtist');
const metaCoverInput = document.getElementById('metaCoverInput');
const saveMetaBtn = document.getElementById('saveMetaBtn');
const cancelMetaBtn = document.getElementById('cancelMetaBtn');

const installBtn = document.getElementById('installBtn');

// app state
let tracks = []; // loaded tracks from db: {id, title, artist, audioBlob, coverBlob, duration}
let currentIndex = -1;
let isPlaying = false;
let deferredPrompt = null;

// --- Service Worker registration ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW reg failed', err));
}

// --- Install prompt handling ---
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  if (choice.outcome === 'accepted') {
    console.log('App installed');
  }
  deferredPrompt = null;
  installBtn.hidden = true;
});

// --- init DB and UI ---
async function init() {
  await openDB();
  tracks = await getAllTracksFromDB();
  renderPlaylist();
  if (tracks.length) {
    loadTrack(0);
  }
}
init().catch(console.error);

// --- handle add file button & input ---
addBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  await handleFiles(files);
  fileInput.value = '';
});

// --- drag & drop ---
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files);
  await handleFiles(files);
});

// --- process files: accept audio and images ---
async function handleFiles(files) {
  // Group audio files and image files separately; for each audio create a record, optional cover if image exists with same basename
  const audioFiles = files.filter(f => f.type.startsWith('audio/'));
  const imageFiles = files.filter(f => f.type.startsWith('image/'));

  // map image name -> blob
  const imageMap = {};
  for (const img of imageFiles) {
    imageMap[img.name] = img;
  }

  for (const f of audioFiles) {
    // try to set title from filename
    const name = f.name.replace(/\.[^/.]+$/, '');
    const track = {
      title: name,
      artist: 'Unknown',
      audioBlob: await f.arrayBuffer().then(buf => new Blob([buf], {type: f.type})),
      coverBlob: null,
      duration: 0,
      created: Date.now()
    };

    // assign cover if an image with same basename exists
    const base = f.name.replace(/\.[^/.]+$/, '');
    const matchingImage = imageFiles.find(img => img.name.replace(/\.[^/.]+$/, '') === base);
    if (matchingImage) {
      track.coverBlob = await matchingImage.arrayBuffer().then(buf => new Blob([buf], {type: matchingImage.type}));
    }

    // save to DB
    const id = await addTrackToDB(track);
    track.id = id;
    tracks.push(track);

    // attempt to compute duration
    await computeDurationForTrack(track);
  }

  renderPlaylist();
  if (currentIndex === -1 && tracks.length) loadTrack(0);
}

// compute duration using temporary audio element
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
    tmp.addEventListener('error', () => { resolve(); });
  });
}

// --- render playlist ---
function renderPlaylist() {
  playlistEl.innerHTML = '';
  tracks.forEach((t, idx) => {
    const li = document.createElement('li');
    li.className = 'track-item';
    li.dataset.index = idx;
    li.innerHTML = `<div class="leftcol">
                      <div style="font-weight:600">${t.title}</div>
                      <div style="font-size:0.85rem;color:#cfc0ff">${t.artist}</div>
                    </div>
                    <div class="rightcol">${formatTime(t.duration)}</div>`;
    li.addEventListener('click', () => {
      loadTrack(Number(li.dataset.index));
      play();
    });
    playlistEl.appendChild(li);
  });
}

// --- load a track into player ---
function loadTrack(index) {
  if (index < 0 || index >= tracks.length) return;
  currentIndex = index;
  const t = tracks[index];
  // audio object URL
  const url = URL.createObjectURL(t.audioBlob);
  audio.src = url;
  titleEl.textContent = t.title;
  artistEl.textContent = t.artist || 'Unknown';
  durationEl.textContent = formatTime(t.duration);
  if (t.coverBlob) {
    coverEl.src = URL.createObjectURL(t.coverBlob);
  } else {
    coverEl.src = 'images/icon-192.png';
  }
  highlightPlaylistItem(index);
}

// update UI highlight
function highlightPlaylistItem(index) {
  playlistEl.querySelectorAll('li').forEach(li => li.classList.remove('active'));
  const el = playlistEl.querySelector(`li[data-index="${index}"]`);
  if (el) el.classList.add('active');
}

// --- playback controls ---
playBtn.addEventListener('click', () => { if (isPlaying) pause(); else play(); });
prevBtn.addEventListener('click', () => { if (tracks.length) { loadTrack((currentIndex -1 + tracks.length)%tracks.length); play(); }});
nextBtn.addEventListener('click', () => { if (tracks.length) { loadTrack((currentIndex +1)%tracks.length); play(); }});

audio.addEventListener('timeupdate', () => {
  if (!isNaN(audio.duration)) {
    const pct = (audio.currentTime / audio.duration) * 100;
    progress.value = pct;
    currentTimeEl.textContent = formatTime(Math.floor(audio.currentTime));
  }
});
audio.addEventListener('ended', () => { nextBtn.click(); });

// progress seek
progress.addEventListener('input', () => {
  if (!isNaN(audio.duration)) {
    audio.currentTime = (progress.value/100) * audio.duration;
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

// remove track
removeBtn.addEventListener('click', async () => {
  if (currentIndex === -1) return;
  const id = tracks[currentIndex].id;
  await deleteTrackFromDB(id);
  tracks.splice(currentIndex,1);
  if (tracks.length === 0) {
    currentIndex = -1;
    audio.src = '';
    titleEl.textContent = 'There is no selected song';
    artistEl.textContent = 'there is no singer';
    coverEl.src = 'images/icon-192.png';
  } else {
    const next = Math.min(currentIndex, tracks.length-1);
    loadTrack(next);
  }
  renderPlaylist();
});

// edit metadata modal
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
  // if cover file chosen
  if (metaCoverInput.files && metaCoverInput.files[0]) {
    const img = metaCoverInput.files[0];
    t.coverBlob = await img.arrayBuffer().then(buf => new Blob([buf], {type: img.type}));
  }
  // update DB (simple put by id)
  await putTrackToDB(t);
  metaModal.classList.remove('show');
  renderPlaylist();
  loadTrack(currentIndex);
});

// helper: put (replace) track in DB
function putTrackToDB(track) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(track);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// --- utilities ---
function formatTime(s) {
  if (!s && s !== 0) return '0:00';
  const mm = Math.floor(s/60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2,'0')}`;
}
