const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PlayerManager } = require('../dist/player/playerManager');
test('skip after pausing resets position and resumes the next track', async () => {
  const manager = new PlayerManager({ events: new EventEmitter(), currentSessionId: 'test', updatePlayer: async () => {} });
  const track = id => ({ encoded: id, info: { identifier: id, title: id, author: 'Test', length: 10000 } });
  await manager.play('default', track('first'));
  await manager.play('default', track('second'));
  await manager.seek('default', 7000);
  await manager.pause('default');
  await manager.skip('default');
  const snapshot = manager.getSnapshot('default');
  assert.equal(snapshot.current.id, 'second');
  assert.equal(snapshot.positionMs, 0);
  assert.equal(snapshot.paused, false);
});
