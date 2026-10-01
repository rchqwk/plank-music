# Sonora static web player

This is a Vite-free static frontend. Serve this folder with any static file server and open `index.html` in a browser. It calls the backend at `http://localhost:4000` by default and uses `/api/search`, `/api/player/*`, `/api/player/state`, and `/api/events`.

```bash
npm run build       # validates the no-build static package
npm run start       # serves on http://localhost:4173
```

To use a different backend without editing files, set `window.SONORA_API_BASE` before `app.js`, or save the URL as `localStorage.setItem('sonora-api-base', 'https://your-backend.example')`.
