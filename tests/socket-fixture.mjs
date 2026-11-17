// Fixture LOCAL de pruebas. No sustituye a TikFinity. Ejecutar: node tests/socket-fixture.mjs
import http from 'node:http';
import { createHash } from 'node:crypto';
const clients = new Set();
function frame(object) {
  const payload = Buffer.from(JSON.stringify(object));
  const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
  header[0] = 0x81;
  if (payload.length < 126) header[1] = payload.length;
  else { header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  return Buffer.concat([header, payload]);
}
const events = [
  { event:'chat', data:{uniqueId:'fixture-red', nickname:'Luna WS', comment:'rojo', msgId:'fixture-chat-r', avatarUrl:'http://127.0.0.1:8080/no-avatar.png'} },
  { event:'chat', data:{uniqueId:'fixture-blue', nickname:'Nico WS', comment:'azul', msgId:'fixture-chat-b'} },
  { event:'like', data:{uniqueId:'fixture-red', nickname:'Luna WS', likeCount:10, msgId:'fixture-like'} },
  { event:'gift', data:{uniqueId:'fixture-blue', nickname:'Nico WS', diamondCount:100, giftType:0, repeatCount:1, msgId:'fixture-titan'} }
];
const server = http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain'});res.end('Fixture WebSocket FRONTERA en 21214');});
server.on('upgrade',(req,socket)=>{
  const key=req.headers['sec-websocket-key']; if(!key){socket.destroy();return;}
  const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(socket);socket.on('error',()=>clients.delete(socket));socket.on('close',()=>clients.delete(socket));
  // Solo emite datos sintéticos; no implementa un servidor WebSocket de producción.
  for(const event of events)socket.write(frame(event));
  console.log('Cliente conectado: emitidos chat rojo/azul, 10 likes y titán azul.');
});
server.listen(21214,'127.0.0.1',()=>console.log('Fixture: ws://127.0.0.1:21214/ · vida máxima 3 min'));
function close(){for(const socket of clients)socket.destroy();server.close();}
const timeout=setTimeout(close,180000);timeout.unref();process.on('SIGINT',close);
