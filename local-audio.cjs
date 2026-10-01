const express = require('express');
const cors = require('cors');
const { spawn } = require('node:child_process');
const path = require('node:path');

const app = express();
const ytDlp = process.env.YTDLP_BINARY || path.join(__dirname, 'tools', 'yt-dlp.exe');
const cookies = process.env.YOUTUBE_COOKIES || 'C:\\Users\\timhu\\Downloads\\cookies.txt';

app.use(cors({ origin: true }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/stream/:id', async (req, res) => {
  try {
    const child = spawn(ytDlp, [
      '--quiet', '--cookies', cookies, '--no-playlist', '-f', 'bestaudio/best',
      '-o', '-', `https://www.youtube.com/watch?v=${req.params.id}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let started = false;
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdout.once('data', chunk => {
      started = true;
      res.type('audio/webm');
      res.write(chunk);
      child.stdout.pipe(res);
    });
    child.once('close', code => {
      if (!started && !res.headersSent) res.status(502).json({ error: 'Local audio bridge could not resolve this track' });
      if (!started) console.error('Local audio bridge failed:', stderr || `yt-dlp exited ${code}`);
    });
    req.once('close', () => child.kill());
  } catch (error) {
    console.error('Local audio bridge failed:', error.message);
    res.status(502).json({ error: 'Local audio bridge could not resolve this track' });
  }
});

app.listen(process.env.PORT || 4310, () => console.log('Local audio bridge ready'));
