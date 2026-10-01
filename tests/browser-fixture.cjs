// Local-only browser regression fixture. Run: node tests/browser-fixture.cjs
const express = require('express');
const path = require('node:path');
const { invidious } = require('../dist/services/invidious');
const tracksRouter = require('../dist/routes/tracks').default;
const app = express();
app.use(express.json());
const tracks = ['Retry test', 'Queue test'].map((title, index) => ({ id: `fixture-${index}`, title, author: 'Local audio fixture', durationMs: 35000 }));
const state = { current: null, queue: [], paused: false, positionMs: 0 };
let failFirst = true;
const subscribers = new Set();
const broadcast = () => { for (const res of subscribers) res.write(`event: queue\ndata: ${JSON.stringify({ playerId: 'default', ...state })}\n\n`); };
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.flushHeaders(); subscribers.add(res);
  req.on('close', () => subscribers.delete(res));
});
app.get('/api/search', (req, res) => res.json(tracks));
app.get('/api/player/state', (req, res) => res.json(state));
app.post('/api/player/:action', (req, res) => {
  switch (req.params.action) {
    case 'play':
      state.queue.push(tracks.find(track => track.id === req.body.videoId));
      if (!state.current) state.current = state.queue.shift();
      break;
    case 'pause': state.paused = true; break;
    case 'resume': state.paused = false; break;
    case 'skip': state.current = state.queue.shift() || null; state.paused = false; break;
    case 'stop': state.current = null; state.queue = []; state.paused = false; break;
  }
  broadcast(); res.json(state);
});
const sampleRate = 8000;
const samples = 35 * sampleRate;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let n = 0; n < samples; n++) wav.writeInt16LE(Math.round(Math.sin(n * Math.PI * 2 * 440 / sampleRate) * 150), 44 + n * 2);
app.get('/fixture-audio/:id', (req, res) => {
  if (req.params.id === 'fixture-0' && failFirst) { failFirst = false; return res.status(503).end(); }
  res.set({ 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes' });
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = Number(range[1]); const end = Math.min(Number(range[2] || wav.length - 1), wav.length - 1);
    if (start > end) return res.status(416).set('Content-Range', `bytes */${wav.length}`).end();
    return res.status(206).set('Content-Range', `bytes ${start}-${end}/${wav.length}`).send(wav.subarray(start, end + 1));
  }
  res.send(wav);
});
invidious.getVideo = async id => ({ videoId: id, title: id, author: 'Local', audioStreams: [{ url: `http://127.0.0.1:4188/fixture-audio/${id}`, container: 'wav' }] });
app.use('/api', tracksRouter);
app.use(express.static(path.join(__dirname, '../frontend')));
app.listen(4188, '127.0.0.1', () => console.log('Browser fixture: http://127.0.0.1:4188'));
