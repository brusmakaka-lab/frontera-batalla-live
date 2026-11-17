import { mkdir, readFile, writeFile, rename, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { Battle, CONFIG, TYPES }=require('../game.js');
const finite=(n,a,b)=>typeof n==='number'&&Number.isFinite(n)&&n>=a&&n<=b;
const team=t=>t==='red'||t==='blue';

export function serializeBattle(g){
  const keys=['round','phase','remaining','breakRemaining','bases','territory','wins','clock','cleanupAt','paused','nextID','spawnBudget','stats','lastResult'];
  const state={};for(const k of keys)state[k]=g[k];
  return {version:2,savedAt:Date.now(),options:{duration:g.options.duration,baseHP:g.options.baseHP,intermission:g.options.intermission},
    state,users:[...g.users],units:g.units,queue:g.queue,meteors:g.meteors,seen:[...g.seen],streaks:[...g.streaks]};
}

export function restoreBattle(data){
  if(!data||data.version!==2||!data.state||!data.options)throw Error('Formato de partida incompatible');
  const o=data.options,s=data.state;
  if(!finite(o.duration,30,1800)||!finite(o.baseHP,100,1000000)||!finite(o.intermission,1,30))throw Error('Reglas inválidas');
  if(!['playing','results'].includes(s.phase)||!finite(s.round,1,1e9)||!finite(s.clock,0,1e12)||!finite(s.nextID,1,1e12)||!finite(s.remaining,0,o.duration)||!finite(s.breakRemaining,0,o.intermission)||!finite(s.territory,.1,.9))throw Error('Reloj inválido');
  for(const t of ['red','blue'])if(!finite(s.bases?.[t],0,o.baseHP)||!finite(s.wins?.[t],0,1e9))throw Error('Marcador inválido');
  if(!Array.isArray(data.users)||data.users.length>CONFIG.maxUsers||!Array.isArray(data.units)||data.units.length>CONFIG.maxUnits||!Array.isArray(data.queue)||data.queue.length>CONFIG.maxQueue)throw Error('Capacidad inválida');
  const g=new Battle(o);
  for(const [id,p]of data.users){
    if(typeof id!=='string'||id.length>96||!p||p.id!==id||typeof p.name!=='string'||p.name.length>32||p.team!==null&&!team(p.team)||!finite(p.damage,0,1e15)||!finite(p.troops,0,1e12)||!finite(p.likes,0,9))throw Error('Participante inválido');
    g.users.set(id,{id,name:p.name,avatar:typeof p.avatar==='string'?p.avatar.slice(0,2048):'',team:p.team,likes:p.likes,damage:p.damage,troops:p.troops,score:p.damage+p.troops,lastSeen:finite(p.lastSeen,0,1e12)?p.lastSeen:0});
  }
  const ids=new Set();
  g.units=data.units.map(u=>{
    const spec=TYPES[u.type];
    if(!spec||!g.users.has(u.owner)||!team(u.team)||!finite(u.id,1,1e12)||ids.has(u.id)||!finite(u.hp,0,spec.hp)||!finite(u.x,CONFIG.minX,CONFIG.maxX)||!finite(u.y,CONFIG.top,CONFIG.bottom)||!finite(u.nextAttack,0,1e12)||!finite(u.age,0,240)||!finite(u.vx,-100000,100000)||!finite(u.vy,-100000,100000))throw Error('Unidad inválida');
    ids.add(u.id);return {...spec,maxHP:spec.hp,id:u.id,owner:u.owner,team:u.team,type:u.type,hp:u.hp,x:u.x,y:u.y,vx:u.vx,vy:u.vy,direction:u.team==='red'?1:-1,nextAttack:u.nextAttack,age:u.age,hit:0,pending:0};
  });
  g.queue=data.queue.map(q=>{if(!TYPES[q.type]||!g.users.has(q.owner)||!team(q.team))throw Error('Cola inválida');return {owner:q.owner,team:q.team,type:q.type};});
  g.meteors=(data.meteors||[]).slice(0,16).map(m=>{
    if(!g.users.has(m.owner)||!team(m.team)||!finite(m.x,0,1080)||!finite(m.y,CONFIG.top,CONFIG.bottom)||!finite(m.timer,-.6,1)||!finite(m.power,1,6))throw Error('Meteorito inválido');return {...m};
  });
  Object.assign(g,{round:s.round,phase:s.phase,remaining:s.remaining,breakRemaining:s.breakRemaining,bases:{...s.bases},wins:{...s.wins},territory:s.territory,clock:s.clock,paused:s.paused===true,
    cleanupAt:s.clock+30,nextID:Math.max(1,...g.units.map(u=>u.id+1),Number(s.nextID)||1),spawnBudget:0,stats:{accepted:0,rejected:0,overflow:0},lastResult:null});
  for(const k of ['accepted','rejected','overflow'])if(finite(s.stats?.[k],0,1e15))g.stats[k]=s.stats[k];
  g.seen=new Map((data.seen||[]).slice(-12000).filter(([k,v])=>typeof k==='string'&&finite(v,s.clock,s.clock+301)));
  g.streaks=new Map((data.streaks||[]).slice(-5000).filter(([k,v])=>typeof k==='string'&&v&&finite(v.count,0,100000)&&finite(v.expires,s.clock,s.clock+121)));
  if(g.phase==='results'){
    const winner=s.lastResult?.winner;if(winner!==null&&!team(winner))throw Error('Resultado inválido');
    const mvp=[...g.users.values()].filter(p=>p.score>0).sort((a,b)=>b.score-a.score||b.damage-a.damage).slice(0,3).map(p=>({...p}));
    g.lastResult={winner,reason:String(s.lastResult?.reason||'Ronda finalizada').slice(0,120),mvp};
  }
  return g;
}

export class StateStore{
  constructor(directory){this.directory=directory;this.file=path.join(directory,'partida.json');this.chain=Promise.resolve();this.savedAt=null;this.error='';this.recovered=false;}
  async load(){
    for(const file of [this.file,this.file+'.bak']){
      try{
        if((await stat(file)).size>64*1024*1024)throw Error('Archivo demasiado grande');
        const data=JSON.parse(await readFile(file,'utf8')),game=restoreBattle(data);
        this.savedAt=data.savedAt;this.recovered=true;if(file.endsWith('.bak'))this.error='Recuperada la copia de respaldo';return game;
      }catch(e){if(e.code!=='ENOENT')this.error='Partida guardada inválida; se buscará el respaldo';}
    }
    return null;
  }
  save(game){
    const value=JSON.stringify(serializeBattle(game));
    const operation=this.chain.catch(()=>{}).then(async()=>{
      await mkdir(this.directory,{recursive:true});
      await writeFile(this.file+'.tmp',value,{mode:0o600});
      try{await copyFile(this.file,this.file+'.bak');}catch(e){if(e.code!=='ENOENT')throw e;}
      await rename(this.file+'.tmp',this.file);this.savedAt=Date.now();this.error='';
    });
    this.chain=operation.catch(()=>{this.error='No se pudo guardar: comprueba espacio y permisos';});return this.chain;
  }
}
