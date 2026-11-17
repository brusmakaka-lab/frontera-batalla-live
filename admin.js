'use strict';
(function(){
  const $=id=>document.getElementById(id);let token='',state=null,loaded=false,refreshTimer=null;
  const fmt=n=>Math.round(n||0).toLocaleString('es-AR');
  function notice(message,error=false){$('notice').textContent=message;$('notice').className=`notice${error?' error':''}`;}
  async function bootstrap(){const r=await fetch('/api/bootstrap',{cache:'no-store'});if(!r.ok)throw Error('Servidor local no disponible');const b=await r.json();token=b.token;render(b.status);}
  async function request(route,data,retry=true){
    const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Frontera-Token':token},body:JSON.stringify(data)});
    if(r.status===403&&retry){await bootstrap();return request(route,data,false);}
    const value=await r.json();if(!r.ok)throw Error(value.error||'No se pudo completar la acción');render(value);return value;
  }
  const command=async(action,args={})=>request('/api/command',{action,...args});
  async function safely(fn,message){try{await fn();if(message)notice(message);}catch(e){notice(e.message,true);}}
  function providerFields(){$('euler-fields').hidden=$('provider').value!=='euler';$('tikfinity-fields').hidden=$('provider').value!=='tikfinity';}
  function render(s){
    state=s;$('server-status').textContent='SERVIDOR CONECTADO';$('server-status').style.color='#8ce0c6';
    const g=s.game,c=s.connection,p=Math.round(g.territory*100),seconds=Math.ceil(g.remaining);
    $('provider-badge').textContent=({local:'LOCAL',euler:'EULER',tikfinity:'TIKFINITY'})[c.provider]||'LOCAL';
    $('connection-state').textContent=c.message;$('provider-dot').style.background=c.live?'#73d9b7':c.state==='error'?'#ff6b84':'#d6b16e';
    $('last-event').textContent=s.decodeError||(c.lastEventAt?`Último evento: ${new Date(c.lastEventAt).toLocaleTimeString('es-AR')}`:'Sin eventos recibidos');
    $('mode').replaceChildren();const dot=document.createElement('i');$('mode').append(dot,document.createTextNode(s.demo?'DEMOSTRACIÓN':s.config.provider==='local'?'MODO LOCAL':c.live?'LIVE CONECTADO':'ESPERANDO LIVE'));
    $('round').textContent=`RONDA ${String(g.round).padStart(2,'0')}`;$('phase').textContent=s.paused?'PAUSADO':g.phase==='results'?'RESULTADOS':'EN CURSO';
    $('time').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    for(const t of ['red','blue']){$(`${t}-wins`).textContent=g.wins[t];$(`${t}-base`).textContent=`${fmt(g.bases[t])} HP`;}
    $('red-control').textContent=`${p}%`;$('blue-control').textContent=`${100-p}%`;$('territory-fill').style.width=`${p}%`;
    $('units').textContent=g.units;$('queued').textContent=g.queued;$('users').textContent=g.users;$('overflow').textContent=fmt(g.stats.overflow);
    $('pause').textContent=s.paused?'Reanudar':'Pausar';$('demo').textContent=s.demo?'Detener demo':'Iniciar demo';
    $('save-state').textContent=s.persistence.error||s.persistence.savedAt? (s.persistence.error||`Guardado ${new Date(s.persistence.savedAt).toLocaleTimeString('es-AR')}`):'Esperando primer guardado';
    $('save-state').style.color=s.persistence.error?'#ffafbc':'#a1e3cf';$('recovery-state').textContent=s.persistence.recovered?'Partida recuperada del disco. OBS puede reconectarse sin reiniciar la ronda.':'Guardado automático cada 2 segundos. Recargar OBS conserva el combate.';
    $('key-state').textContent=s.config.hasApiKey?`Clave configurada · ${s.config.keySource==='environment'?'variable del proceso':'.env local'}`:'Sin clave configurada.';
    const ranking=$('ranking');ranking.replaceChildren();
    for(const p of s.top.slice(0,5)){const row=document.createElement('tr');for(const[value,index]of [p.name,fmt(p.damage),fmt(p.troops),fmt(p.score)].map((v,i)=>[v,i])){const cell=document.createElement('td');cell.textContent=value;if(index===0)cell.style.color=p.team==='red'?'#ff97aa':'#87c9ff';row.append(cell);}ranking.append(row);}
    if(!s.top.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.className='empty';cell.textContent='La batalla espera a sus héroes.';row.append(cell);ranking.append(row);}
    const busy=['connecting','connected','retrying'].includes(c.state);for(const button of document.querySelectorAll('[data-sim]'))button.disabled=busy;$('send-json').disabled=busy;
    if(!loaded){
      $('provider').value=s.config.provider;$('username').value=s.config.username;$('tikfinity-url').value=s.config.tikfinityUrl;$('auto-connect').checked=s.config.autoConnect;
      $('duration').value=s.config.duration;$('base-hp').value=s.config.baseHP;$('sound-enabled').checked=s.config.soundEnabled;$('volume').value=Math.round(s.config.volume*100);$('volume-label').textContent=`${$('volume').value}%`;providerFields();loaded=true;
    }
  }
  $('provider').onchange=providerFields;
  $('connection-form').onsubmit=e=>{e.preventDefault();void safely(async()=>{
    await request('/api/config',{provider:$('provider').value,username:$('username').value,tikfinityUrl:$('tikfinity-url').value,autoConnect:$('auto-connect').checked,apiKey:$('api-key').value,clearApiKey:$('clear-key').checked});$('api-key').value='';$('clear-key').checked=false;
  },'Configuración guardada. Pulsa Conectar para usar el proveedor seleccionado.');};
  $('rules-form').onsubmit=e=>{e.preventDefault();void safely(()=>request('/api/config',{duration:Number($('duration').value),baseHP:Number($('base-hp').value),volume:Number($('volume').value)/100,soundEnabled:$('sound-enabled').checked}),'Audio actualizado. Duración y HP se aplican en la próxima ronda.');};
  $('volume').oninput=()=>{$('volume-label').textContent=`${$('volume').value}%`;};
  $('connect').onclick=()=>void safely(async()=>{const next=await command('connect');if(next.connection.state==='error')throw Error(next.connection.message);},'Conexión solicitada. Consulta el estado del proveedor.');
  $('disconnect').onclick=()=>void safely(()=>command('disconnect'),'Proveedor desconectado. Puedes usar el simulador.');
  $('pause').onclick=()=>void safely(()=>command('pause'));
  $('finish').onclick=()=>void safely(()=>command('finish'),'Ronda finalizada. El resultado se muestra en el overlay.');
  $('new-round').onclick=()=>void safely(()=>command('new-round'),'Nueva ronda iniciada.');
  $('reset-scores').onclick=()=>void safely(()=>command('reset-scores'),'Marcador global reiniciado.');
  $('save-now').onclick=()=>void safely(()=>command('save'),'Partida guardada en este equipo.');
  $('demo').onclick=()=>void safely(()=>command('demo'),'Demo actualizada. Detén la demo y comienza una ronda nueva antes del LIVE.');
  for(const button of document.querySelectorAll('[data-sim]'))button.onclick=()=>void safely(()=>command('simulate',{kind:button.dataset.sim,name:$('sim-user').value,avatar:$('sim-avatar').value}),`Invocación: ${button.textContent}`);
  $('send-json').onclick=()=>void safely(()=>command('event',{event:JSON.parse($('json-event').value)}),'Evento de prueba aceptado.');
  window.addEventListener('keydown',e=>{
    if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;
    const kind={'1':'red-basic','2':'blue-basic','3':'red-titan','4':'blue-titan','5':'red-meteor','6':'blue-meteor','7':'likes','8':'gift'}[e.key];
    if(kind)void safely(()=>command('simulate',{kind,name:$('sim-user').value,avatar:$('sim-avatar').value}));
  });
  async function refresh(){try{if(!token)await bootstrap();else{const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error();render(await r.json());}}catch{$('server-status').textContent='SIN SERVIDOR';$('server-status').style.color='#ff9bad';token='';}finally{refreshTimer=setTimeout(refresh,1000);}}
  window.addEventListener('pagehide',()=>clearTimeout(refreshTimer));void refresh();
})();
