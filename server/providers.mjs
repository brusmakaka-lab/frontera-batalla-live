import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { createWebSocketUrl, SchemaVersion } from '@eulerstream/euler-websocket-sdk';

export function tikfinityURL(value){
  const u=new URL(value);
  if(u.protocol!=='ws:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('TikFinity debe usar ws://localhost:puerto/');
  return u.href;
}

export function eulerEvents(input){
  // rawMessages=false solicita JSON decodificado, individual o ClientMessageBundle.
  let raw=typeof input==='string'?JSON.parse(input):input;
  if(Array.isArray(raw))return raw.slice(0,1000).flatMap(eulerEvents);
  if(!raw||typeof raw!=='object')return [];
  if(Array.isArray(raw.messages))return raw.messages.slice(0,1000).flatMap(eulerEvents);
  const names={WebcastChatMessage:'chat',WebcastLikeMessage:'like',WebcastGiftMessage:'gift',chat:'chat',like:'like',gift:'gift'};
  const event=names[raw.type||raw.event];if(!event)return [];
  const d=raw.data||raw,u=d.user||{},gift=d.gift||d.giftDetails||{};
  const avatar=u.avatarThumb||u.avatarMedium||u.avatarLarge||u.profilePicture||{};
  const data={uniqueId:String(u.uniqueId||u.displayId||u.userId||u.id||d.uniqueId||d.userId||''),
    nickname:String(u.nickname||d.nickname||u.displayId||u.uniqueId||''),
    avatarUrl:d.avatarUrl||d.profilePictureUrl||u.profilePictureUrl||avatar.urlList?.[0]||avatar.url_list?.[0]||avatar.urls?.[0]||'',
    msgId:String(d.common?.msgId||d.common?.messageId||d.msgId||d.messageId||raw.id||'')};
  if(event==='chat')data.comment=d.content??d.comment??d.text??'';
  if(event==='like')data.likeCount=d.count??d.likeCount??0;
  if(event==='gift')Object.assign(data,{giftId:String(d.giftId??gift.id??''),groupId:String(d.groupId||d.repeatId||''),giftName:gift.giftName||gift.name||d.giftName||'Regalo',
    diamondCount:gift.diamondCount??d.diamondCount??d.giftDetails?.diamondCount??0,
    giftType:gift.type??gift.giftType??d.giftType??0,repeatCount:d.repeatCount??1,
    repeatEnd:d.repeatEnd===undefined?(d.repeat_end===undefined?undefined:!!d.repeat_end):!!d.repeatEnd});
  return [{event,data}];
}

const reasons={4400:'Configuración rechazada',4401:'API key inválida',4403:'Sin permiso para este LIVE',4404:'El creador no está en vivo',4429:'Límite de conexiones; esperando',4005:'El LIVE terminó',4006:'Sin eventos; reconectando',4500:'TikTok cerró la conexión',4555:'Renovando conexión de larga duración'};

export class Provider extends EventEmitter{
  constructor({eulerEndpoint=null,retryScale=1}={}){super();this.endpoint=eulerEndpoint;this.retryScale=retryScale;this.generation=0;this.socket=null;this.retry=null;this.heartbeat=null;this.attempt=0;this.status={provider:'local',state:'offline',live:false,message:'Modo local',lastEventAt:null};}
  setStatus(value){this.status={...this.status,...value};this.emit('status',this.status);}
  stop(){
    this.generation++;clearTimeout(this.retry);clearInterval(this.heartbeat);this.retry=null;
    if(this.socket){this.socket.removeAllListeners();this.socket.on('error',()=>{});this.socket.terminate();this.socket=null;}
    this.setStatus({state:'offline',live:false,message:'Desconectado',nextRetryAt:null});
  }
  connect(config,key){
    this.stop();this.attempt=0;this.config={provider:config.provider,username:config.username,tikfinityUrl:config.tikfinityUrl};
    this.key=key;this.setStatus({provider:config.provider,lastEventAt:null,code:null});
    if(config.provider==='local'){this.setStatus({message:'Modo local'});return;}
    if(config.provider==='euler'&&(!key||!config.username)){this.setStatus({state:'error',message:'Configura usuario y API key de Euler Stream'});return;}
    this.open(this.generation);
  }
  open(generation){
    if(generation!==this.generation)return;
    const config=this.config;let address;
    try{
      if(config.provider==='tikfinity')address=tikfinityURL(config.tikfinityUrl);
      else{
        const built=new URL(createWebSocketUrl({uniqueId:config.username,apiKey:this.key,features:{schemaVersion:SchemaVersion.v2,bundleEvents:true,rawMessages:false,includeRawBytes:false}}));
        const u=new URL(this.endpoint||'wss://ws.eulerstream.com');u.search=built.search;address=u.href;
      }
    }catch{this.setStatus({state:'error',message:'Dirección de conexión inválida'});return;}
    this.setStatus({state:'connecting',live:false,message:'Conectando',nextRetryAt:null});
    const ws=new WebSocket(address,{handshakeTimeout:10000,maxPayload:2*1024*1024,followRedirects:false,perMessageDeflate:false});this.socket=ws;
    let alive=true;
    ws.on('open',()=>{
      if(generation!==this.generation)return;this.attempt=0;
      this.setStatus({state:'connected',live:false,message:config.provider==='euler'?'Euler: esperando eventos del LIVE':'TikFinity: socket conectado',code:null});
      this.heartbeat=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},25000);this.heartbeat.unref();
    });
    ws.on('pong',()=>{alive=true;});
    ws.on('message',buffer=>{
      if(generation!==this.generation)return;
      try{
        const raw=JSON.parse(buffer.toString('utf8'));
        if(config.provider==='euler'){
          const list=Array.isArray(raw.messages)?raw.messages:[raw];
          for(const item of list){
            if(item.type==='room.status')this.setStatus({live:item.data?.state==='connected',message:({connected:'LIVE conectado',offline:'Creador sin LIVE',ended:'LIVE terminado',reconnecting:'Reconectando con TikTok'})[item.data?.state]||'Esperando TikTok'});
            if(item.type==='tiktok.disconnect')this.setStatus({live:false,message:'TikTok desconectado'});
          }
          const events=eulerEvents(raw);
          for(const event of events)this.emit('event',event);
          if(events.length)this.setStatus({live:true,message:'Euler Stream: recibiendo eventos',lastEventAt:Date.now()});
        }else if(['chat','like','gift'].includes(raw.event)){
          this.emit('event',raw);this.setStatus({live:true,message:'TikFinity: recibiendo eventos',lastEventAt:Date.now()});
        }
      }catch{this.emit('invalid','Mensaje no compatible; se esperaba JSON decodificado');}
    });
    ws.on('error',()=>{/* La URL contiene la clave: nunca se imprimen errores de socket. */});
    ws.on('close',code=>{
      clearInterval(this.heartbeat);if(generation!==this.generation)return;this.socket=null;
      if([4400,4401,4403].includes(code)){this.setStatus({state:'error',live:false,code,message:reasons[code]});return;}
      const base=[4404,4005].includes(code)?30000:code===4429?60000:Math.min(30000,1000*2**Math.min(5,this.attempt++));
      const delay=(base+Math.random()*300)*this.retryScale;
      this.setStatus({state:'retrying',live:false,code,message:reasons[code]||'Conexión cerrada; reintentando',nextRetryAt:Date.now()+delay});
      this.retry=setTimeout(()=>this.open(generation),delay);this.retry.unref();
    });
  }
}
