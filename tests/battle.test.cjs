'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Battle, CONFIG, TYPES, avatarURL } = require('../game.js');
const event = (type, id, data = {}) => ({ event: type, data: { uniqueId: id, nickname: id, ...data } });
function advance(game, seconds) { for (let i=0; i<Math.ceil(seconds*60); i++) game.update(1/60); }
function join(game, id, team) { game.handle(event('chat', id, { comment: team === 'red' ? 'rojo' : 'azul' })); return game.users.get(id); }

test('chat, comandos, perfiles anidados y cambios de equipo', () => {
  const g = new Battle(); join(g,'luna','red');
  assert.equal(g.users.get('luna').team,'red'); assert.equal(g.queue.length,1);
  g.handle(event('chat','luna',{comment:'AZUL!'})); assert.deepEqual(g.queue.map(q=>q.team),['red','blue']);
  g.handle(event('chat','nico',{comment:'vamos 1!'})); assert.equal(g.users.get('nico').team,'red');
  assert.equal(g.handle(event('chat','x',{comment:'2026'})),false);
  g.handle({event:'chat',data:{user:{uniqueId:'nested',nickname:'Perfil',avatarThumb:{urlList:['https://example.com/a.png']}},comment:'2'}});
  assert.equal(g.users.get('nested').team,'blue');assert.equal(g.users.get('nested').avatar,'https://example.com/a.png');
});

test('likes acumulan por usuario y nunca leen totalLikeCount como incremento',()=>{
  const g=new Battle();g.handle(event('like','likes',{likeCount:6}));assert.equal(g.queue.length,0);
  g.handle(event('like','other',{likeCount:4}));assert.equal(g.queue.length,0);
  g.handle(event('like','likes',{likeCount:25,totalLikeCount:999999}));assert.equal(g.queue.length,9);assert.equal(g.users.get('likes').likes,1);
  assert.ok(['red','blue'].includes(g.users.get('likes').team));
});

test('regalos respetan los tres umbrales y la vida del titán',()=>{
  for(const coins of [1,10,11,99,100,5000]){
    const g=new Battle();g.handle(event('gift','donor',{diamondCount:coins}));
    if(coins<=10){assert.equal(g.queue.filter(q=>q.type==='mini').length,5);assert.equal(g.queue.filter(q=>q.type==='warrior').length,1);}
    else if(coins<=99)assert.equal(g.meteors.length,1);
    else {advance(g,.1);assert.equal(g.units[0].hp,2500);assert.equal(g.units[0].damage,150);assert.equal(g.units[0].radius,TYPES.basic.radius*3);}
  }
});

test('las rachas 1→2→2 final no duplican regalos ni suben de nivel por valor total',()=>{
  const g=new Battle();const gift={giftId:1,giftType:1,diamondCount:10};
  for(const [repeatCount,repeatEnd,msgId] of [[1,false,'a'],[2,false,'b'],[2,true,'c']])g.handle(event('gift','donor',{...gift,repeatCount,repeatEnd,msgId}));
  assert.equal(g.queue.length,12);assert.equal(g.meteors.length,0);
  assert.equal(g.handle(event('gift','donor',{...gift,repeatCount:2,repeatEnd:true,msgId:'c'})),false);
  g.handle(event('gift','donor',{...gift,repeatCount:1,repeatEnd:false,msgId:'d'}));assert.equal(g.queue.length,18);
  g.handle(event('gift','donor',{...gift,repeatCount:3,repeatEnd:false,msgId:'e'}));
  g.handle(event('gift','donor',{...gift,repeatCount:2,repeatEnd:false,msgId:'late'}));
  g.handle(event('gift','donor',{...gift,repeatCount:3,repeatEnd:true,msgId:'end'}));assert.equal(g.queue.length,30);
});

test('daño simultáneo, muerte mutua y MVP sin overkill',()=>{
  const g=new Battle();join(g,'r','red');join(g,'b','blue');advance(g,.1);
  assert.equal(g.units.length,2);const [a,b]=g.units;
  a.x=b.x=540;a.y=970;b.y=1010;a.hp=b.hp=5;a.nextAttack=b.nextAttack=0;
  g.update(1/60);assert.equal(g.units.length,0);assert.equal(g.users.get('r').damage,5);assert.equal(g.users.get('b').damage,5);
  assert.equal(g.users.get('r').score,6);
});

test('meteorito elimina pequeños del rival y preserva aliados/fuera de área',()=>{
  const g=new Battle();const r=join(g,'r','red');join(g,'b','blue');join(g,'far','blue');advance(g,.1);
  const ally=g.units.find(u=>u.owner==='r'),enemy=g.units.find(u=>u.owner==='b'),far=g.units.find(u=>u.owner==='far');
  ally.x=enemy.x=540;ally.y=enemy.y=980;far.x=120;far.y=650;
  const before=g.territory;g.explode({x:540,y:980,owner:r.id,team:'red',power:1});
  assert.equal(ally.hp,100);assert.equal(enemy.hp,0);assert.equal(far.hp,100);assert.equal(r.damage,100);assert.ok(g.territory>before);
});

test('una tropa alcanza la base, inflige daño y termina la ronda',()=>{
  const g=new Battle({baseHP:20});join(g,'attacker','red');
  for(let i=0;i<60*30 && g.phase==='playing';i++)g.update(1/60);
  assert.equal(g.phase,'results');assert.equal(g.bases.blue,0);assert.equal(g.wins.red,1);assert.equal(g.lastResult.winner,'red');
  assert.ok(g.users.get('attacker').damage>=20);
});

test('180 segundos, desempates, 8 segundos de resultados y reinicio de MVP',()=>{
  const g=new Battle();const p=join(g,'hero','blue');advance(g,.1);g.bases.red=9999;advance(g,180);
  assert.equal(g.phase,'results');assert.equal(g.lastResult.winner,'blue');assert.equal(g.lastResult.mvp[0].id,p.id);assert.equal(g.wins.blue,1);
  const round=g.round;advance(g,8.1);assert.equal(g.round,round+1);assert.equal(g.phase,'playing');assert.equal(g.users.get('hero').score,0);assert.equal(g.wins.blue,1);assert.equal(g.bases.red,10000);
  const tie=new Battle();tie.finish();assert.equal(tie.lastResult.winner,null);assert.deepEqual(tie.wins,{red:0,blue:0});
  const territory=new Battle();territory.territory=.65;territory.finish();assert.equal(territory.lastResult.winner,'red');
});

test('intermisión no acumula tropas y finalizar es idempotente',()=>{
  const g=new Battle();join(g,'p','red');advance(g,.1);g.bases.blue=1;g.finish();g.finish();assert.equal(g.wins.red,1);
  join(g,'q','blue');g.handle(event('gift','q',{diamondCount:100}));g.handle(event('like','q',{likeCount:10}));assert.equal(g.queue.length,0);
});

test('Top 3 por daño efectivo + tropas y snapshot aislado',()=>{
  const g=new Battle();for(const [id,team]of [['a','red'],['b','blue'],['c','red'],['d','blue']])join(g,id,team);advance(g,.2);
  g.award('a',5);g.award('b',30);g.award('c',15);g.award('d',2);
  assert.deepEqual(g.finish().mvp.map(p=>p.id),['b','c','a']);
  const s=g.snapshot();s.wins.red=999;assert.notEqual(g.wins.red,999);
});

test('datos inválidos, CORS/URLs inseguras y límites de memoria',()=>{
  const g=new Battle({maxUnits:12,maxQueue:25,maxUsers:50});
  for(const raw of ['{',null,[],{event:'chat',data:{comment:'rojo'}},'x'.repeat(66000)])assert.equal(g.handle(raw),false);
  for(const url of ['javascript:alert(1)','file:///a','data:image/png;base64,x','https://u:p@example.com/x'])assert.equal(avatarURL(url),'');
  assert.equal(avatarURL('https://example.com/a.jpg'),'https://example.com/a.jpg');
  assert.equal(avatarURL('https://example.com/'+ 'ñ'.repeat(1000)),'');
  g.handle(event('like','spam',{likeCount:1000000}));advance(g,4);
  assert.ok(g.units.length<=12);assert.ok(g.queue.length<=25);assert.ok(g.stats.overflow>0);
  g.handle(event('gift','spam',{diamondCount:500,giftType:0,repeatCount:Infinity}));
  for(let i=0;i<100;i++)g.meteor(g.users.get('spam'));
  assert.ok(g.meteors.length<=16);assert.ok(g.particles.length<=CONFIG.maxParticles);
});

test('pausa congela reloj y reanudar retoma sin saltos',()=>{
  const g=new Battle();g.paused=true;advance(g,5);assert.equal(g.remaining,180);g.paused=false;advance(g,1);assert.ok(Math.abs(g.remaining-179)<.00001);
});

test('carga sostenida: rondas y entidades mantienen cotas y valores finitos',()=>{
  const g=new Battle({duration:15,intermission:.5});
  for(let frame=0;frame<60*120;frame++){
    if(frame%6===0){const id=`viewer-${frame%300}`;join(g,id,frame%12===0?'red':'blue');g.handle(event('like',id,{likeCount:20}));}
    if(frame%120===0)g.handle(event('gift',`viewer-${frame%300}`,{diamondCount:frame%240===0?100:25}));
    g.update(1/60);
    assert.ok(g.units.length<=CONFIG.maxUnits);assert.ok(g.queue.length<=CONFIG.maxQueue);
    for(const u of g.units)assert.ok(Number.isFinite(u.x)&&Number.isFinite(u.y)&&Number.isFinite(u.hp));
  }
  assert.ok(g.round>=7);assert.ok(g.users.size<=300);
});
