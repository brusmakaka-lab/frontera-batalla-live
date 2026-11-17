import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { StateStore } from './persistence.mjs';
import { Provider, tikfinityURL } from './providers.mjs';
const require=createRequire(import.meta.url);
const { Battle,CONFIG }=require('../game.js');
const defaults={provider:'local',username:'',tikfinityUrl:'ws://localhost:21213/',autoConnect:false,volume:.35,soundEnabled:false,duration:180,baseHP:10000};
const trim=(s,n=32)=>String(s??'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,n);

export class BattleRuntime extends EventEmitter{
  constructor({directory,projectRoot,providerOptions={},env=process.env}={}){
    super();this.directory=directory;this.root=projectRoot;this.env=env;this.store=new StateStore(directory);this.provider=new Provider(providerOptions);
    this.config={...defaults};this.key='';this.serverId=randomUUID();this.seq=0;this.effectId=0;this.effects=[];this.activity='ELIGE TU EQUIPO · ESCRIBE ROJO O AZUL';this.activityUntil=0;this.titan=null;this.demo=null;this.configChain=Promise.resolve();
  }
  async init(){
    let localEnv={};try{localEnv=parseEnv(await readFile(path.join(this.root,'.env'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    this.key=this.env.EULER_API_KEY||localEnv.EULER_API_KEY||'';
    try{const saved=JSON.parse(await readFile(path.join(this.directory,'settings.json'),'utf8'));this.config=this.validateConfig(saved);}catch(e){if(e.code!=='ENOENT')this.activity='Configuración inválida; se usan valores iniciales';}
    if(!this.config.username)this.config.username=trim(this.env.TIKTOK_USERNAME||localEnv.TIKTOK_USERNAME).replace(/^@/,'');
    this.provider.setStatus({provider:this.config.provider,message:this.config.provider==='local'?'Modo local':'Proveedor sin conectar'});
    this.game=await this.store.load()||new Battle({duration:this.config.duration,baseHP:this.config.baseHP});
    const reset=this.game.reset.bind(this.game);
    this.game.reset=()=>{this.game.options.duration=this.config.duration;this.game.options.baseHP=this.config.baseHP;reset();};
    this.game.on('activity',text=>{this.activity=text;this.activityUntil=Date.now()+5000;});
    this.game.on('titan',data=>{this.titan={...data,until:Date.now()+3600};this.effect('titan',data);});
    this.game.on('impact',()=>{if(!this.impactAt||Date.now()>this.impactAt){this.effect('impact');this.impactAt=Date.now()+85;}});
    this.game.on('explosion',data=>this.effect('explosion',data));
    this.game.on('result',()=>{this.effect('victory');void this.save();});
    this.game.on('round',()=>{this.titan=null;this.activity='NUEVA RONDA · ESCRIBE ROJO O AZUL';this.activityUntil=Date.now()+5000;void this.save();});
    this.provider.on('event',event=>{this.decodeError='';this.game.handle(event);});
    this.provider.on('invalid',message=>{this.decodeError=message;});
    this.provider.on('status',()=>this.emit('status'));
    return this;
  }
  effect(type,data=null){this.effects.push({id:++this.effectId,type,data,at:Date.now()});this.effects=this.effects.slice(-40);}
  validateConfig(input){
    const c={...defaults,...this.config,...input};
    if(!['local','euler','tikfinity'].includes(c.provider))throw Error('Proveedor inválido');
    c.username=trim(c.username).replace(/^@/,'');if(c.username&&!/^[\w.]{1,32}$/.test(c.username))throw Error('Escribe el usuario de TikTok sin URL');
    c.tikfinityUrl=tikfinityURL(c.tikfinityUrl);c.autoConnect=c.autoConnect===true;c.soundEnabled=c.soundEnabled===true;
    for(const[k,min,max]of [['volume',0,1],['duration',30,1800],['baseHP',100,1000000]]){c[k]=Number(c[k]);if(!Number.isFinite(c[k])||c[k]<min||c[k]>max)throw Error(`Valor inválido: ${k}`);}
    c.duration=Math.round(c.duration);c.baseHP=Math.round(c.baseHP);
    return Object.fromEntries(Object.keys(defaults).map(k=>[k,c[k]]));
  }
  configure(input){
    const task=this.configChain.catch(()=>{}).then(async()=>{
      const config=this.validateConfig(input);
      let key=this.key;
      if(input.clearApiKey===true)key='';else if(input.apiKey!==undefined&&input.apiKey!==''){
        if(typeof input.apiKey!=='string'||input.apiKey.length>2048||/[\s\u0000-\u001f]/.test(input.apiKey))throw Error('API key inválida');key=input.apiKey;
      }
      const changed=config.provider!==this.config.provider||config.username!==this.config.username||config.tikfinityUrl!==this.config.tikfinityUrl||key!==this.key;
      if(key!==this.key){
        if(this.env.EULER_API_KEY)throw Error('La clave está fijada por EULER_API_KEY del proceso; cámbiala allí y reinicia');
        let values={};try{values=parseEnv(await readFile(path.join(this.root,'.env'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
        values.EULER_API_KEY=key;await writeFile(path.join(this.root,'.env.tmp'),Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600});
        await rename(path.join(this.root,'.env.tmp'),path.join(this.root,'.env'));
      }
      await mkdir(this.directory,{recursive:true});await writeFile(path.join(this.directory,'settings.json.tmp'),JSON.stringify(config,null,2));
      await rename(path.join(this.directory,'settings.json.tmp'),path.join(this.directory,'settings.json'));
      if(changed){this.provider.stop();this.provider.setStatus({provider:config.provider,message:config.provider==='local'?'Modo local':'Configuración guardada; listo para conectar',lastEventAt:null});}this.config=config;this.key=key;return this.status();
    });this.configChain=task;return task;
  }
  start(){
    if(this.config.autoConnect)this.provider.connect(this.config,this.key);
    let last=performance.now(),acc=0;
    this.tick=setInterval(()=>{const now=performance.now();acc+=Math.min(.25,(now-last)/1000);last=now;let n=0;while(acc>=1/60&&n<15){this.game.update(1/60);acc-=1/60;n++;}if(this.activityUntil&&Date.now()>this.activityUntil){this.activity='ELIGE TU EQUIPO · ESCRIBE ROJO O AZUL';this.activityUntil=0;}},1000/60);
    this.broadcast=setInterval(()=>{if(!this.hasViewers||this.hasViewers())this.emit('frame',this.frame());},50);
    this.autosave=setInterval(()=>{void this.save();},2000);
    for(const t of [this.tick,this.broadcast,this.autosave])t.unref();
  }
  save(){return this.store.save(this.game);}
  async close(){clearInterval(this.tick);clearInterval(this.broadcast);clearInterval(this.autosave);this.stopDemo();this.provider.stop();await this.configChain.catch(()=>{});await this.save();}
  stopDemo(){if(this.demo)clearInterval(this.demo);this.demo=null;}
  startDemo(){
    this.provider.stop();this.stopDemo();let index=0;const names=['Luna','Nico','Valen','Sofi','Mateo','Cami','Leo','Meli','Tomi','Alma','Max','Flor'];
    const tick=()=>{if(this.game.paused||this.game.phase!=='playing')return;const i=index++,data={uniqueId:`demo-${i%12}`,nickname:names[i%12],comment:i%2?'azul':'rojo'};this.game.handle({event:'chat',data});if(i%7===0)this.game.handle({event:'gift',data:{...data,diamondCount:1}});if(i&&i%43===0)this.game.handle({event:'gift',data:{...data,diamondCount:100}});};
    for(let i=0;i<16;i++)tick();this.demo=setInterval(tick,650);this.demo.unref();
  }
  simulate(action,name='Streamer',avatar=''){
    if(['connecting','connected','retrying'].includes(this.provider.status.state))throw Error('Desconecta el proveedor antes de simular');
    const base={uniqueId:`sim-${trim(name)}`,nickname:trim(name)||'Streamer',avatarUrl:String(avatar).slice(0,2048)},[team,type]=String(action).split('-');
    if(['red','blue'].includes(team)&&['basic','titan','meteor'].includes(type)){
      const e=this.game.normalize({event:'chat',data:{...base,comment:team==='red'?'rojo':'azul'}}),p=this.game.player(e);if(!p)throw Error('Límite de usuarios alcanzado');p.team=team;
      return this.game.handle(type==='basic'?{event:'chat',data:{...base,comment:team==='red'?'rojo':'azul'}}:{event:'gift',data:{...base,diamondCount:type==='titan'?100:25}});
    }
    if(action==='likes')return this.game.handle({event:'like',data:{...base,likeCount:10}});
    if(action==='gift')return this.game.handle({event:'gift',data:{...base,diamondCount:1}});
    throw Error('Acción de simulación inválida');
  }
  async command(body){
    switch(body.action){
      case'connect':this.stopDemo();this.provider.connect(this.config,this.key);break;
      case'disconnect':this.provider.stop();break;
      case'pause':this.game.paused=typeof body.value==='boolean'?body.value:!this.game.paused;break;
      case'new-round':this.game.reset();break;
      case'finish':this.game.finish();break;
      case'reset-scores':this.game.wins={red:0,blue:0};break;
      case'demo':if(body.value===false||this.demo)this.stopDemo();else this.startDemo();break;
      case'simulate':this.simulate(body.kind,body.name,body.avatar);break;
      case'event':if(['connecting','connected','retrying'].includes(this.provider.status.state))throw Error('Desconecta el proveedor antes de enviar eventos de prueba');if(!this.game.handle(body.event))throw Error('Evento ignorado o duplicado');break;
      case'save':break;
      default:throw Error('Comando inválido');
    }
    await this.save();return this.status();
  }
  status(){
    const top=[...this.game.users.values()].filter(p=>p.score>0).sort((a,b)=>b.score-a.score).slice(0,10).map(p=>({id:p.id,name:p.name,team:p.team,score:Math.round(p.score),damage:Math.round(p.damage),troops:p.troops}));
    return {version:2,serverId:this.serverId,connection:{...this.provider.status},config:{...this.config,hasApiKey:!!this.key,keySource:this.env.EULER_API_KEY?'environment':'.env'},game:this.game.snapshot(),paused:this.game.paused,demo:!!this.demo,top,
      persistence:{savedAt:this.store.savedAt,recovered:this.store.recovered,error:this.store.error},decodeError:this.decodeError||''};
  }
  frame(){
    const g=this.game,owners=new Set(g.units.map(u=>u.owner));for(const p of g.lastResult?.mvp||[])owners.add(p.id);
    const users=[...owners].map(id=>g.users.get(id)).filter(Boolean).map(p=>({id:p.id,name:p.name,avatar:p.avatar,team:p.team}));
    return {version:2,serverId:this.serverId,seq:++this.seq,at:Date.now(),state:{round:g.round,phase:g.phase,remaining:g.remaining,breakRemaining:g.breakRemaining,wins:g.wins,bases:g.bases,territory:g.territory,paused:g.paused,options:{duration:g.options.duration,baseHP:g.options.baseHP,intermission:g.options.intermission},
      users,units:g.units.map(u=>({id:u.id,owner:u.owner,team:u.team,type:u.type,radius:u.radius,hp:u.hp,maxHP:u.maxHP,x:u.x,y:u.y,hit:u.hit})),meteors:g.meteors,particles:g.particles,texts:g.texts,shake:g.shake,lastResult:g.lastResult},
      meta:{connection:this.provider.status,demo:!!this.demo,activity:this.activity,titan:this.titan,soundEnabled:this.config.soundEnabled,volume:this.config.volume},effects:this.effects.filter(e=>Date.now()-e.at<2000)};
  }
}
