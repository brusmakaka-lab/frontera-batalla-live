import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { createApp } from '../servidor.mjs';
import { serializeBattle, restoreBattle, StateStore } from '../server/persistence.mjs';
import { Provider, eulerEvents, tikfinityURL } from '../server/providers.mjs';
const require=createRequire(import.meta.url),{Battle}=require('../game.js');
const project=path.dirname(path.dirname(fileURLToPath(import.meta.url))),work=path.join(project,'work','tests');
await mkdir(work,{recursive:true});
const scratch=()=>mkdtemp(path.join(work,'case-'));
const advance=(g,seconds)=>{for(let i=0;i<Math.ceil(seconds*60);i++)g.update(1/60);};
const chat=(id,comment)=>({event:'chat',data:{uniqueId:id,nickname:id,comment}});
const waitFor=async(fn,timeout=2500)=>{const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw Error('Tiempo de espera agotado');await new Promise(r=>setTimeout(r,10));}};

test('Euler v2: mensajes agrupados, perfil, comentarios, likes y precio de giftDetails',()=>{
  const raw={timestamp:1,messages:[
    {type:'roomInfo',data:{}},
    {type:'WebcastChatMessage',data:{common:{msgId:'1'},user:{uniqueId:'luna',nickname:'Luna',profilePicture:{urlList:['https://example.com/luna.jpg']}},content:'rojo'}},
    {type:'WebcastLikeMessage',data:{common:{msgId:'2'},user:{uniqueId:'luna'},count:10}},
    {type:'WebcastGiftMessage',data:{common:{msgId:'3'},user:{uniqueId:'luna'},giftId:55,groupId:'g1',giftDetails:{giftName:'Galaxia',diamondCount:100,giftType:0},repeatCount:1,repeatEnd:1}}
  ]};
  const events=eulerEvents(JSON.stringify(raw));assert.equal(events.length,3);assert.equal(events[0].data.avatarUrl,'https://example.com/luna.jpg');assert.equal(events[2].data.diamondCount,100);assert.equal(events[2].data.giftName,'Galaxia');assert.equal(events[2].data.repeatEnd,true);
  const g=new Battle();events.forEach(e=>g.handle(e));assert.equal(g.queue.length,5);assert.equal(g.queue.at(-1).type,'titan');assert.equal(g.users.get('luna').team,'red');
});

test('rachas de Euler con groupId distinto se procesan aunque coincidan los finales',()=>{
  const g=new Battle();for(const groupId of ['a','b'])g.handle(eulerEvents({type:'WebcastGiftMessage',data:{user:{uniqueId:'donor'},giftId:1,groupId,repeatCount:2,repeatEnd:1,giftDetails:{diamondCount:1,giftType:1}}})[0]);
  assert.equal(g.queue.length,24);
});

test('serialización restaura unidades, reloj, cola, rachas, likes y deduplicación',()=>{
  const g=new Battle();g.handle(chat('r','rojo'));g.handle(chat('b','azul'));g.handle({event:'like',data:{uniqueId:'r',likeCount:13,msgId:'like-x'}});advance(g,.2);g.paused=true;
  const saved=JSON.parse(JSON.stringify(serializeBattle(g))),restored=restoreBattle(saved);
  assert.deepEqual(restored.snapshot(),g.snapshot());assert.equal(restored.paused,true);assert.equal(restored.users.get('r').likes,3);assert.equal(restored.handle({event:'like',data:{uniqueId:'r',likeCount:13,msgId:'like-x'}}),false);
  assert.deepEqual(restored.units.map(u=>[u.id,u.x,u.y,u.hp,u.nextAttack]),g.units.map(u=>[u.id,u.x,u.y,u.hp,u.nextAttack]));
  const bad=structuredClone(saved);bad.units[0].x=null;assert.throws(()=>restoreBattle(bad));
});

test('resultados recuperados no vuelven a sumar victoria y reinician a los 8 segundos',()=>{
  const g=new Battle();g.handle(chat('r','rojo'));advance(g,.1);g.bases.blue=9000;g.finish();const restored=restoreBattle(JSON.parse(JSON.stringify(serializeBattle(g))));
  assert.equal(restored.wins.red,1);restored.finish();assert.equal(restored.wins.red,1);assert.equal(restored.lastResult.mvp[0].id,'r');advance(restored,8.1);assert.equal(restored.round,2);assert.equal(restored.wins.red,1);
});

test('guardado atómico y recuperación de respaldo si el archivo principal se corrompe',async()=>{
  const dir=await scratch(),store=new StateStore(dir),g=new Battle();g.handle(chat('r','rojo'));advance(g,.1);await store.save(g);g.paused=true;await store.save(g);
  await writeFile(path.join(dir,'partida.json'),'{incompleto');const next=new StateStore(dir),loaded=await next.load();assert.equal(next.recovered,true);assert.equal(loaded.units.length,1);assert.match(next.error,/respaldo/);
});

test('TikFinity solo acepta sockets locales; no permite reenviar claves a hosts arbitrarios',()=>{
  assert.equal(tikfinityURL('ws://localhost:21213/'),'ws://localhost:21213/');
  for(const u of ['ws://evil.example/','wss://evil.example/','ws://u:p@localhost:21213/','ws://localhost:21213/?apiKey=x'])assert.throws(()=>tikfinityURL(u));
});

test('conector Euler real local: normalización, reconexión, exclusión de sockets y error de auth',async()=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');const port=server.address().port;
  let connected=0;const clients=new Set(),events=[],provider=new Provider({eulerEndpoint:`ws://127.0.0.1:${port}`,retryScale:.01});
  server.on('connection',(ws,req)=>{connected++;clients.add(ws);ws.on('close',()=>clients.delete(ws));assert.equal(new URL(req.url,'http://local').searchParams.get('features.rawMessages'),'false');ws.send(JSON.stringify({messages:[{type:'WebcastChatMessage',data:{user:{uniqueId:'ws-user'},content:'rojo'}}]}));});
  provider.on('event',e=>events.push(e));
  try{
    provider.connect({provider:'euler',username:'test',tikfinityUrl:'ws://localhost:21213/'},'TEST-KEY');await waitFor(()=>events.length===1);assert.equal(events[0].event,'chat');assert.equal(provider.status.live,true);
    for(const ws of clients)ws.close(4500);await waitFor(()=>connected>=2);assert.equal(provider.status.provider,'euler');
    provider.connect({provider:'local'},'');await waitFor(()=>clients.size===0);assert.equal(provider.status.state,'offline');
    provider.connect({provider:'euler',username:'test'},'TEST-KEY');await waitFor(()=>provider.status.state==='connected');for(const ws of clients)ws.close(4401);await waitFor(()=>provider.status.state==='error');assert.match(provider.status.message,/API key/);
  }finally{provider.stop();for(const ws of clients)ws.terminate();await new Promise(resolve=>server.close(resolve));}
});

test('TikFinity conserva compatibilidad de chat, likes y regalos en su formato original',async()=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const provider=new Provider(),g=new Battle();provider.on('event',e=>g.handle(e));
  server.on('connection',ws=>{ws.send(JSON.stringify(chat('legacy','azul')));ws.send(JSON.stringify({event:'like',data:{uniqueId:'legacy',likeCount:10}}));ws.send(JSON.stringify({event:'gift',data:{uniqueId:'legacy',diamondCount:100}}));});
  try{provider.connect({provider:'tikfinity',tikfinityUrl:`ws://127.0.0.1:${server.address().port}/`},'');await waitFor(()=>g.queue.length===5);assert.equal(g.users.get('legacy').team,'blue');assert.equal(provider.status.live,true);assert.equal(g.queue.at(-1).type,'titan');}
  finally{provider.stop();for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));}
});

test('API separada: panel, secreto oculto, origen protegido y partida tras reiniciar servidor',async()=>{
  const root=await scratch();for(const file of ['index.html','style.css','game.js','client.js','admin.html','admin.js','admin.css'])await copyFile(path.join(project,file),path.join(root,file));
  const directory=path.join(root,'runtime');let app=await createApp({root,directory,env:{}}),port=await app.listen(0),origin=`http://127.0.0.1:${port}`;
  const headers=()=>({'Content-Type':'application/json','Origin':origin,'X-Frontera-Token':app.token});
  async function post(route,body){const r=await fetch(origin+route,{method:'POST',headers:headers(),body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();}
  try{
    assert.match(await(await fetch(origin+'/')).text(),/data-server="true"/);assert.equal((await fetch(origin+'/admin')).status,200);
    for(const route of ['/.env','/runtime/partida.json','/server/providers.mjs'])assert.equal((await fetch(origin+route)).status,404);
    const forbidden=await fetch(origin+'/api/command',{method:'POST',headers:{...headers(),Origin:'https://evil.example'},body:JSON.stringify({action:'new-round'})});assert.equal(forbidden.status,403);
    assert.equal((await fetch(origin+'/api/command',{method:'POST',headers:{...headers(),'X-Frontera-Token':'wrong'},body:'{}'})).status,403);
    await post('/api/config',{provider:'euler',username:'test',apiKey:'FAKE-LOCAL-TEST-SECRET',volume:.6});
    const status=await(await fetch(origin+'/api/bootstrap')).text();assert.ok(!status.includes('FAKE-LOCAL-TEST-SECRET'));assert.match(await readFile(path.join(root,'.env'),'utf8'),/FAKE-LOCAL-TEST-SECRET/);
    await post('/api/config',{provider:'local'});await post('/api/command',{action:'pause',value:true});await post('/api/command',{action:'simulate',kind:'red-titan',name:'Persistente'});
    // Desplegar una tropa para comprobar coordenadas y HP conservados, con pausa explícita.
    app.runtime.game.paused=false;advance(app.runtime.game,.1);app.runtime.game.paused=true;
    await post('/api/command',{action:'save'});const before=app.runtime.game.snapshot(),unit={...app.runtime.game.units[0]};
    const controller=new AbortController(),sse=await fetch(origin+'/api/stream',{signal:controller.signal});const reader=sse.body.getReader();const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/data: /);
    const second=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(Error('El stream no continúa')),1000))]);assert.match(new TextDecoder().decode(second.value),/data: /);controller.abort();
    await app.close();app=await createApp({root,directory,env:{}});port=await app.listen(0);origin=`http://127.0.0.1:${port}`;
    assert.equal(app.runtime.store.recovered,true);assert.deepEqual(app.runtime.game.snapshot(),before);assert.equal(app.runtime.game.units[0].hp,unit.hp);assert.equal(app.runtime.game.units[0].y,unit.y);assert.equal(app.runtime.game.paused,true);assert.equal(app.runtime.config.volume,.6);assert.equal(app.runtime.key,'FAKE-LOCAL-TEST-SECRET');
    await post('/api/config',{duration:120,baseHP:15000});assert.equal(app.runtime.game.options.duration,180);assert.equal(app.runtime.game.options.baseHP,10000);
    await post('/api/command',{action:'new-round'});assert.equal(app.runtime.game.options.duration,120);assert.equal(app.runtime.game.bases.red,15000);assert.equal(app.runtime.game.remaining,120);
    await post('/api/config',{clearApiKey:true});assert.equal(app.runtime.key,'');
  }finally{await app.close();}
});
