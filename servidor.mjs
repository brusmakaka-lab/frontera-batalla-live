import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BattleRuntime } from './server/runtime.mjs';

const projectRoot=path.dirname(fileURLToPath(import.meta.url));
const staticFiles=new Map([
  ['/', ['index.html','text/html']],['/index.html',['index.html','text/html']],
  ['/style.css',['style.css','text/css']],['/game.js',['game.js','text/javascript']],['/client.js',['client.js','text/javascript']],
  ['/admin',['admin.html','text/html']],['/admin.html',['admin.html','text/html']],['/admin.css',['admin.css','text/css']],['/admin.js',['admin.js','text/javascript']]
]);
const securityHeaders={ 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'X-Frame-Options':'SAMEORIGIN','Cross-Origin-Resource-Policy':'same-origin' };
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...securityHeaders});res.end(JSON.stringify(value));}
async function bodyJSON(req){
  let length=0;const parts=[];
  for await(const chunk of req){length+=chunk.length;if(length>65536)throw Error('El cuerpo supera 64 KiB');parts.push(chunk);}
  let data;try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('JSON inválido');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Se esperaba un objeto JSON');return data;
}

export async function createApp({root=projectRoot,directory=path.join(root,'runtime'),providerOptions={},env=process.env}={}){
  const runtime=await new BattleRuntime({directory,projectRoot:root,providerOptions,env}).init();
  const token=randomBytes(32).toString('hex'),clients=new Set();
  runtime.hasViewers=()=>clients.size>0;
  const server=http.createServer(async(req,res)=>{
    const port=server.address()?.port,validHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
    if(!validHosts.has(req.headers.host)){json(res,403,{error:'Host local inválido'});return;}
    const origins=new Set([...validHosts].map(h=>'http://'+h));
    if(req.headers.origin&&!origins.has(req.headers.origin)||req.headers['sec-fetch-site']==='cross-site'){json(res,403,{error:'Origen no permitido'});return;}
    try{
      const requested=new URL(req.url,'http://127.0.0.1').pathname;
      if(req.method==='GET'&&requested==='/api/bootstrap'){json(res,200,{token,status:runtime.status()});return;}
      if(req.method==='GET'&&requested==='/api/status'){json(res,200,runtime.status());return;}
      if(req.method==='GET'&&requested==='/api/stream'){
        if(clients.size>=8){json(res,503,{error:'Máximo 8 visores simultáneos'});return;}
        res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no',...securityHeaders});
        res.write('retry: 1000\n\n');res.write(`data: ${JSON.stringify(runtime.frame())}\n\n`);clients.add(res);
        req.on('close',()=>clients.delete(res));return;
      }
      if(req.method==='POST'&&['/api/command','/api/config'].includes(requested)){
        const provided=Buffer.from(String(req.headers['x-frontera-token']||'')),expected=Buffer.from(token);
        if(!origins.has(req.headers.origin)||provided.length!==expected.length||!timingSafeEqual(provided,expected)){json(res,403,{error:'Actualiza el panel para renovar la sesión local'});return;}
        if(!String(req.headers['content-type']).startsWith('application/json')){json(res,415,{error:'Se requiere application/json'});return;}
        const body=await bodyJSON(req);
        const state=requested==='/api/config'?await runtime.configure(body):await runtime.command(body);
        json(res,200,state);return;
      }
      const file=staticFiles.get(requested);
      if(file&&['GET','HEAD'].includes(req.method)){
        let content=await readFile(path.join(root,file[0]));
        if(file[0]==='index.html')content=Buffer.from(content.toString('utf8').replace('<html lang="es">','<html lang="es" data-server="true">'));
        res.writeHead(200,{'Content-Type':`${file[1]}; charset=utf-8`,'Content-Length':content.length,...securityHeaders});res.end(req.method==='HEAD'?undefined:content);return;
      }
      json(res,404,{error:'No encontrado'});
    }catch(e){
      const safe=/^(Proveedor|Escribe|TikFinity|Valor|API key|La clave|Desconecta|Límite|Acción|Evento|Comando|JSON|Se esperaba|El cuerpo)/.test(e.message);
      json(res,400,{error:safe?e.message:'No se pudo completar la operación local'});
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  runtime.on('frame',frame=>{
    if(!clients.size)return;const payload=`data: ${JSON.stringify(frame)}\n\n`;
    for(const res of clients){if(res.destroyed||res.writableLength>1024*1024){clients.delete(res);res.destroy();}else res.write(payload);}
  });
  return {server,runtime,token,
    async listen(port=8080){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});runtime.start();return server.address().port;},
    async close(){for(const res of clients)res.end();clients.clear();await runtime.close();await new Promise(resolve=>server.close(resolve));}
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    let envFile={};try{envFile=parseEnv(await readFile(path.join(projectRoot,'.env'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const port=Number(process.env.PORT||envFile.PORT||8080);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Puerto inválido');
    const app=await createApp();const actual=await app.listen(port);
    console.log(`FRONTERA 2 · Juego: http://127.0.0.1:${actual}/`);
    console.log(`Panel separado: http://127.0.0.1:${actual}/admin`);
    console.log(`Partida ${app.runtime.store.recovered?'recuperada':'nueva'}. Guardado automático cada 2 s. Ctrl+C guarda y cierra.`);
    let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();process.exit(0);};process.on('SIGINT',close);process.on('SIGTERM',close);
  }catch(e){console.error(e.code==='EADDRINUSE'?'El puerto está ocupado. Cierra el servidor anterior o cambia PORT.':'No se pudo iniciar FRONTERA. Comprueba Node.js, dependencias y permisos.');process.exitCode=1;}
}
