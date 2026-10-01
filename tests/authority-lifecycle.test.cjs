const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{EventEmitter}=require('node:events');
process.env.PLAYER_SESSION_SECRET='fixture-session-secret-000000000000000000000';process.env.PLAYER_BOT_TOKEN='fixture-bot-secret-000000000000000000000000';
const express=require('express'),{playerRouter}=require('../dist/routes/player'),{PlayerManager}=require('../dist/player/playerManager');
test('player mutations require owner capability or bot key',async()=>{
 const calls=[],app=express();app.use(express.json());app.use('/api/player',playerRouter({stop:async id=>calls.push(id),getSnapshot:()=>({queue:[]})},{isConnected:true}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try {
  const post=(route,body={},headers={})=>fetch(base+'/api/player/'+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post('stop',{playerId:'123456789012345678'})).status,401);
  const session=await (await post('session',{playerId:'victim'})).json();const authorization={Authorization:'Bearer '+session.token};assert.notEqual(session.playerId,'victim');
  assert.equal((await post('stop',{playerId:'victim'},authorization)).status,403);
  assert.equal((await post('stop',{},authorization)).status,200);assert.equal(calls[0],session.playerId);
  assert.equal((await post('stop',{}, {Authorization:'Bearer '+session.token+'x'})).status,401);
  assert.equal((await post('voice',{},authorization)).status,403);
  assert.equal((await post('stop',{playerId:'123456789012345678'},{'x-player-bot-token':process.env.PLAYER_BOT_TOKEN})).status,200);
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
const track=id=>({encoded:id,info:{identifier:id,title:id,author:'Fixture',length:1000}});
test('stale and duplicate end events do not advance current playback',async()=>{
 const events=new EventEmitter(),sent=[];const manager=new PlayerManager({events,currentSessionId:'fixture',updatePlayer:async(s,id,body)=>sent.push(body)});
 await manager.playMany('fixture',[track('A'),track('B'),track('C')]);const old={...track('A'),userData:sent[0].track.userData};
 await manager.skip('fixture');events.emit('trackEnd','fixture',old,'finished');await new Promise(r=>setImmediate(r));assert.equal(manager.getSnapshot('fixture').current.id,'B');
 const current={...track('B'),userData:sent[1].track.userData};events.emit('trackEnd','fixture',current,'finished');events.emit('trackEnd','fixture',current,'finished');await new Promise(r=>setImmediate(r));assert.equal(manager.getSnapshot('fixture').current.id,'C');
 await manager.stop('fixture');events.emit('trackEnd','fixture',{...track('C'),userData:sent[2].track.userData},'finished');await new Promise(r=>setImmediate(r));assert.equal(manager.getSnapshot('fixture').current,null);
});
test('repeated same track has a different operation identity',async()=>{
 const events=new EventEmitter(),sent=[];const manager=new PlayerManager({events,currentSessionId:'fixture',updatePlayer:async(s,id,body)=>sent.push(body)});
 manager.setRepeat('fixture','one');await manager.play('fixture',track('A'));const ended={...track('A'),userData:sent[0].track.userData};
 events.emit('trackEnd','fixture',ended,'finished');await new Promise(r=>setImmediate(r));assert.equal(sent.length,2);assert.notEqual(sent[0].track.userData.operationId,sent[1].track.userData.operationId);
 events.emit('trackEnd','fixture',ended,'finished');await new Promise(r=>setImmediate(r));assert.equal(sent.length,2);
});

test('failed transport restores state and cannot poison following controls',async()=>{
 const events=new EventEmitter();let fail=true;const manager=new PlayerManager({events,currentSessionId:'fixture',updatePlayer:async()=>{if(fail)throw new Error('Lavalink (503)');}});
 await assert.rejects(manager.play('fixture',track('A')));assert.equal(manager.getSnapshot('fixture').current,null);assert.equal(manager.getSnapshot('fixture').queue.length,0);
 fail=false;await manager.playMany('fixture',[track('A'),track('B')]);fail=true;await assert.rejects(manager.skip('fixture'));assert.equal(manager.getSnapshot('fixture').current.id,'A');assert.equal(manager.getSnapshot('fixture').queue[0].id,'B');
 fail=false;await manager.skip('fixture');assert.equal(manager.getSnapshot('fixture').current.id,'B');
 await assert.rejects(manager.seek('fixture',NaN));await assert.rejects(manager.setVolume('fixture',Infinity));await assert.rejects(manager.removeFromQueue('fixture',-1));
});
test('browser playback does not mask Discord validation errors',async()=>{
 const events=new EventEmitter();const manager=new PlayerManager({events,currentSessionId:null,updatePlayer:async()=>{throw new Error('Bad Request (400)');}});
 await manager.play('browser_fixture',track('A'));assert.equal(manager.getSnapshot('browser_fixture').current.id,'A');
 await assert.rejects(manager.play('discord_fixture',track('A')));assert.equal(manager.getSnapshot('discord_fixture').current,null);
});

test('event subscriptions never expose another player queue',()=>{
 const {subscribe,broadcast}=require('../dist/events');const first=[],second=[];const response=buffer=>({setHeader(){},flushHeaders(){},on(){},write:x=>buffer.push(x)});
 subscribe(response(first),'first');subscribe(response(second),'second');broadcast('queue',{playerId:'first',queue:['private']});assert.equal(first.length,1);assert.equal(second.length,0);
 broadcast('lavalink',{status:'ready'});assert.equal(first.length,2);assert.equal(second.length,1);
});
