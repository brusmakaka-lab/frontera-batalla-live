/* Visor del servidor: renderiza la partida compartida; no simula otro combate. */
'use strict';
if(document.documentElement.dataset.server==='true'){
  (function(){
    const {Battle,Renderer,Sound,Avatars,COLORS,CONFIG}=window.FronteraEngine;
    const $=id=>document.getElementById(id),view=new Battle(),avatars=new Avatars(),audio=new Sound();
    const renderer=new Renderer($('battle'),view,avatars),oldDebug=$('debug');oldDebug?.remove();
    $('stage').style.visibility='hidden';
    let token='',stream=null,lastPacket=null,first=true,effectId=0,serverId='',resultKey='',renderAt=0,hudAt=0,last=performance.now(),targets=new Map(),closed=false;
    function resize(){$('stage').style.transform=`scale(${Math.min(innerWidth/1080,innerHeight/1920)})`;}
    window.addEventListener('resize',resize);resize();
    function connection(text,state){$('connection').className=`status ${state}`;$('connection').replaceChildren();const dot=document.createElement('i');$('connection').append(dot,document.createTextNode(text));}
    async function bootstrap(){const r=await fetch('/api/bootstrap',{cache:'no-store'});if(!r.ok)throw Error();const b=await r.json();token=b.token;return b;}
    async function command(data){
      if(!token)await bootstrap();const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Frontera-Token':token},body:JSON.stringify(data)});
      if(r.status===403)await bootstrap();if(!r.ok){const e=await r.json();$('activity').textContent=e.error||'Revisa el panel de administración';}
    }
    function result(data){
      $('results').style.setProperty('--winner',data.winner?COLORS[data.winner]:'#f4d399');$('winner').textContent=data.winner?`VICTORIA ${data.winner==='red'?'ROJA':'AZUL'}`:'EMPATE';$('win-reason').textContent=data.reason;
      const list=$('mvp-list');list.replaceChildren();
      data.mvp.forEach((p,i)=>{
        const li=document.createElement('li'),rank=document.createElement('span'),pic=document.createElement('canvas'),info=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small'),points=document.createElement('div'),label=document.createElement('small');
        rank.className='rank';rank.textContent=`0${i+1}`;pic.width=144;pic.height=144;pic.className='mvp-avatar';pic.style.borderColor=COLORS[p.team];pic.getContext('2d').drawImage(avatars.get(p,p.team),0,0);info.className='mvp-info';name.textContent=p.name;detail.textContent=`${Math.round(p.damage).toLocaleString('es-AR')} daño · ${p.troops} tropas`;info.append(name,detail);points.className='mvp-points';points.textContent=Math.round(p.score).toLocaleString('es-AR');label.textContent='PUNTOS';points.append(label);li.append(rank,pic,info,points);list.append(li);
      });
      if(!data.mvp.length){const li=document.createElement('li');li.className='empty-mvp';li.textContent='La próxima ronda espera a sus héroes.';list.append(li);}
    }
    function receive(packet){
      if(packet.version!==2)return;
      const changedServer=packet.serverId!==serverId;
      if(changedServer){serverId=packet.serverId;first=true;effectId=0;resultKey='';targets.clear();}
      const s=packet.state,oldUnits=new Map(view.units.map(u=>[u.id,u]));
      if(changedServer)oldUnits.clear();
      Object.assign(view,{round:s.round,phase:s.phase,remaining:s.remaining,breakRemaining:s.breakRemaining,wins:s.wins,bases:s.bases,territory:s.territory,paused:s.paused,shake:s.shake,meteors:s.meteors,particles:s.particles,texts:s.texts,lastResult:s.lastResult});
      view.options={...CONFIG,...s.options};view.users=new Map(s.users.map(p=>[p.id,p]));
      view.units=s.units.map(u=>{const previous=oldUnits.get(u.id);targets.set(u.id,{x:u.x,y:u.y});return {...u,x:previous?.x??u.x,y:previous?.y??u.y};});
      const active=new Set(s.units.map(u=>u.id));for(const id of targets.keys())if(!active.has(id))targets.delete(id);
      lastPacket=packet;$('stage').style.visibility='visible';if(audio.master)audio.master.gain.value=packet.meta.soundEnabled?packet.meta.volume*.45:0;
      if(!first)for(const effect of packet.effects)if(effect.id>effectId)audio.play(effect.type);
      effectId=Math.max(effectId,...packet.effects.map(e=>e.id),0);first=false;
      if(s.phase==='results'&&s.lastResult){const key=`${serverId}:${s.round}`;if(resultKey!==key){result(s.lastResult);resultKey=key;}$('results').hidden=false;}else{$('results').hidden=true;resultKey='';}
    }
    function connect(){
      stream=new EventSource('/api/stream');
      stream.onmessage=e=>{try{receive(JSON.parse(e.data));}catch{connection('ACTUALIZA EL VISOR','offline');}};
      stream.onerror=()=>{connection('RECONECTANDO AL SERVIDOR','offline');};
    }
    function hud(){
      if(!lastPacket)return;
      const {meta}=lastPacket,r=view.units.filter(u=>u.team==='red').length,b=view.units.length-r,p=Math.round(view.territory*100),seconds=Math.ceil(view.remaining);
      $('red-wins').textContent=view.wins.red;$('blue-wins').textContent=view.wins.blue;$('timer').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;$('timer').style.color=seconds<=30?'#ffba82':'';
      $('round-label').textContent=`RONDA ${String(view.round).padStart(2,'0')}`;$('red-territory').textContent=`${p}%`;$('blue-territory').textContent=`${100-p}%`;$('territory-red').style.width=`${p}%`;
      $('red-count').textContent=r;$('blue-count').textContent=b;$('battle-state').textContent=view.paused?'PAUSADO':meta.demo?'DEMOSTRACIÓN':view.phase==='results'?'RONDA FINALIZADA':view.units.length?'BATALLA EN CURSO':'ESPERANDO REFUERZOS';
      $('activity').textContent=meta.activity;$('countdown').textContent=Math.ceil(view.breakRemaining);$('countdown-progress').style.width=`${view.breakRemaining/view.options.intermission*100}%`;
      const titan=meta.titan;$('titan-alert').hidden=!titan||titan.until<Date.now()||view.phase==='results';if(titan)$('titan-user').textContent=`¡${titan.name} ha invocado un TITÁN!`;
      const c=meta.connection,label=meta.demo?'DEMOSTRACIÓN':c.provider==='local'?'MODO LOCAL':c.state==='connected'?(c.live?`${c.provider==='euler'?'EULER':'TIKFINITY'} · LIVE`:'ESPERANDO LIVE'):c.state==='connecting'?'CONECTANDO':c.state==='retrying'?'RECONECTANDO':c.state==='error'?'REVISAR PANEL':'DESCONECTADO';
      if(Date.now()-lastPacket.at<3000)connection(label,c.live?'connected':'waiting');else connection('SIN SERVIDOR','offline');
      $('sound-label').textContent=!meta.soundEnabled?'SONIDO DESACTIVADO':audio.enabled?'AUDIO SINTÉTICO · ON':'INTERACTUAR → S: ACTIVAR AUDIO';
    }
    window.addEventListener('keydown',e=>{
      if(e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;
      if(e.key.toLowerCase()==='d'){window.open('/admin','frontera-admin');return;}
      if(e.key.toLowerCase()==='s'){void audio.unlock();return;}
      const kind={'1':'red-basic','2':'blue-basic','3':'red-titan','4':'blue-titan','5':'red-meteor','6':'blue-meteor','7':'likes','8':'gift'}[e.key];if(kind)void command({action:'simulate',kind,name:'Streamer'}).catch(()=>connection('SIN SERVIDOR','offline'));
    });
    window.addEventListener('pointerdown',()=>{if(lastPacket?.meta.soundEnabled)void audio.unlock();});
    function frame(now){
      const dt=Math.min(.05,(now-last)/1000);last=now;
      const blend=1-Math.exp(-dt*32);for(const u of view.units){const t=targets.get(u.id);if(t){u.x+=(t.x-u.x)*blend;u.y+=(t.y-u.y)*blend;}}
      if(now>=renderAt){renderer.draw(now);renderAt=now-(now-renderAt)%(1000/60)+1000/60;}
      if(now>=hudAt){hud();hudAt=now+125;}if(!closed)requestAnimationFrame(frame);
    }
    window.BattleLive=Object.freeze({snapshot:()=>view.snapshot()});
    window.addEventListener('pagehide',()=>{closed=true;stream?.close();});
    void bootstrap().catch(()=>connection('SIN SERVIDOR','offline'));connect();requestAnimationFrame(frame);
  })();
}
