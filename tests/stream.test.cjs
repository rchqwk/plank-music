const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { invidious } = require('../dist/services/invidious');
const resolver = require('../dist/services/audioResolver');
const originalResolve = resolver.resolveYtDlpAudio;
const router = require('../dist/routes/tracks').default;
let provider, backend, providerUrl, baseUrl;
const originalGetVideo = invidious.getVideo;
let lastRange;
let disconnected = false;
const listen = (server) => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

before(async () => {
  provider = http.createServer((req, res) => {
    lastRange = req.headers.range;
    if ((req.url === '/failure' || req.url === '/refresh')) { res.writeHead(403); return res.end(); }
    if (req.url === '/invalid-range') { res.writeHead(416, { 'Content-Range': 'bytes */10' }); return res.end(); }
    if (req.url === '/long' || req.url === '/cancel') {
      res.writeHead(200, { 'Content-Type': 'audio/webm' });
      res.write('start');
      const timer = setTimeout(() => res.end('finish'), 21000);
      res.on('close', () => { clearTimeout(timer); if (req.url === '/cancel') disconnected = true; });
      return;
    }
    if (req.headers.range) {
      res.writeHead(206, { 'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 2-5/10', 'Content-Length': '4', 'Accept-Ranges': 'bytes' });
      return res.end('2345');
    }
    res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Content-Length': '10' });
    res.end('0123456789');
  });
  providerUrl = await listen(provider);
  invidious.getVideo = async (id) => ({
    videoId: id, title: id, author: 'Test',
    audioStreams: id === 'legacy' ? [{ url: '', bitrate: '9999' }] : id === 'missing' ? [] : [{ url: `${providerUrl}/${id}`, container: 'm4a', bitrate: '128000' }],
    adaptiveFormats: id === 'legacy' ? [{ url: `${providerUrl}/audio`, type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: '128000' }] : [],
  });
  resolver.resolveYtDlpAudio = async id => { if(id==='refresh') return {url:providerUrl+'/audio',type:'audio/mp4'}; throw Error('Synthetic resolver failure'); };
  const app = express();
  app.use('/api', router);
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  backend = http.createServer(app);
  baseUrl = await listen(backend);
});
after(() => {
  invidious.getVideo = originalGetVideo;
  resolver.resolveYtDlpAudio = originalResolve;
  backend.closeAllConnections(); backend.close();
  provider.closeAllConnections(); provider.close();
});

test('new audioStreams and legacy adaptiveFormats return binary audio', async () => {
  for (const id of ['audio', 'legacy']) {
    const response = await fetch(`${baseUrl}/api/stream/${id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mp4');
    assert.equal(await response.text(), '0123456789');
  }
});
test('seeking forwards Range and preserves 206 and Content-Range', async () => {
  const response = await fetch(`${baseUrl}/api/stream/audio`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(lastRange, 'bytes=2-5');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await response.text(), '2345');
});
test('out-of-range requests preserve the provider response', async () => {
  const response = await fetch(`${baseUrl}/api/stream/invalid-range`);
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */10');
});
test('missing or failed audio returns errors, never a false audio success', async () => {
  assert.equal((await fetch(`${baseUrl}/api/stream/missing`)).status, 404);
  const response = await fetch(`${baseUrl}/api/stream/failure`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "10");
  assert.deepEqual(await response.json(), { error: "Audio provider temporarily unavailable. Please retry this track.", retryable: true });
});
test('closing browser stream cancels the provider connection', async () => {
  const response = await fetch(`${baseUrl}/api/stream/cancel`);
  await response.body.cancel();
  for (let i = 0; i < 30 && !disconnected; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(disconnected, true);
});
test('audio remains connected beyond the old 20-second cutoff', async () => {
  const response = await fetch(`${baseUrl}/api/stream/long`);
  assert.equal(await response.text(), 'startfinish');
});


test("rejected signed URL refresh uses resolver and preserves range", async () => {
  const response=await fetch(`${baseUrl}/api/stream/refresh`,{headers:{Range:"bytes=2-5"}});
  assert.equal(response.status,206);assert.equal(await response.text(),"2345");assert.equal(lastRange,"bytes=2-5");
});
