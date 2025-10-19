# My Media Player (PWA)

Simple offline-capable Progressive Web App music player.
- Add songs via **Add File** or drag & drop
- Local tracks are stored in the browser (IndexedDB)
- Works offline for the app shell (service worker)
- Installable (PWA install prompt)

## Files
- `index.html` — main page
- `style.css` — styles
- `app.js` — application logic (IndexedDB, playback, UI)
- `sw.js` — service worker
- `manifest.json` — PWA manifest
- `images/*` — icons & optional bg
- `README.md` — this file

## How to run locally (recommended)
You need to serve files over HTTP (service workers don't work on `file://`).

### Using Python (simple):
```bash
# Python 3
cd "My Media Player"
python -m http.server 8000
# Open http://localhost:8000 in browser
