import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require=createRequire(resolve('package.json'));
const actions=require('@actions/http-client');
const undici=createRequire(require.resolve('@actions/http-client/package.json'))('undici');
const {Miniflare,Headers,Request}=require('miniflare');
const checks=[];const sockets=new Set();let mf;
const fixture=createServer((request,response)=>{if(request.url==='/disconnect'){request.socket.destroy();return;}if(request.url==='/redirect'){response.writeHead(302,{location:'/normal'}).end();return;}let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{response.writeHead(request.url==='/error'?500:200,{'content-type':'application/json','x-fixture':'loopback'});response.end(JSON.stringify({url:request.url,method:request.method,header:request.headers['x-patch'],body}));});});
const proxy=createServer((_request,response)=>response.writeHead(405).end());let denied=false,connectCount=0;
proxy.on('connect',(request,socket,head)=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));assert.equal(request.headers['proxy-authorization'],undefined);const [host,port]=request.url.split(':');if(denied||host!=='security-patch.invalid'||Number(port)!==fixture.address().port){socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');return;}connectCount++;const upstream=connect(Number(port),'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});sockets.add(upstream);upstream.once('close',()=>sockets.delete(upstream));upstream.on('error',()=>socket.destroy());socket.once('close',()=>upstream.destroy());});
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=server=>new Promise(resolve=>server.close(resolve));
const saved=Object.fromEntries(['http_proxy','https_proxy','HTTP_PROXY','HTTPS_PROXY','no_proxy','NO_PROXY'].map(key=>[key,process.env[key]]));
const dispatchers=[];const clients=[];
try{
 await listen(fixture);await listen(proxy);const fixtureOrigin='http://127.0.0.1:'+fixture.address().port,origin='http://security-patch.invalid:'+fixture.address().port,proxyUrl='http://127.0.0.1:'+proxy.address().port;
 for(const key of ['http_proxy','https_proxy','HTTP_PROXY','HTTPS_PROXY'])process.env[key]=proxyUrl;
 for(const key of ['no_proxy','NO_PROXY'])process.env[key]='';
 const client=new actions.HttpClient('bounded-security-patch',[],{keepAlive:false,allowRetries:false,socketTimeout:5000});clients.push(client);
 const dispatcher=client.getAgentDispatcher(origin);assert.ok(dispatcher instanceof undici.ProxyAgent);dispatchers.push(dispatcher);
 const result=await undici.fetch(origin+'/normal',{dispatcher,signal:AbortSignal.timeout(5000)});assert.equal(result.status,200);assert.equal((await result.json()).url,'/normal');assert.ok(connectCount>0);checks.push({name:'actual Actions getAgentDispatcher ProxyAgent success',status:'PASS',proxyConnectCount:connectCount});
 const native=await client.get(origin+'/normal');assert.equal(native.message.statusCode,200);assert.equal(JSON.parse(await native.readBody()).url,'/normal');checks.push({name:'Actions HttpClient request through explicit proxy',status:'PASS'});
 denied=true;await assert.rejects(undici.fetch(origin+'/normal',{dispatcher,signal:AbortSignal.timeout(5000)}));checks.push({name:'actual Actions ProxyAgent failure',status:'PASS'});
 await assert.rejects(client.get(origin+'/normal'));checks.push({name:'Actions HttpClient proxy failure',status:'PASS'});denied=false;
 // Restore child-only proxy configuration before the emulator starts.
 for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 const script=`export default {async fetch(request){const url=new URL(request.url);if(url.pathname==='/ws'){const pair=new WebSocketPair();pair[1].accept();pair[1].addEventListener('message',event=>{pair[1].send('echo:'+event.data);if(event.data==='close')pair[1].close(1000,'done');});return new Response(null,{status:101,webSocket:pair[0]});}try{const headers=new Headers(request.headers);headers.set('x-patch','verified');const path=url.pathname==='/follow'?'/redirect':url.pathname;const outgoing=new Request(${JSON.stringify(fixtureOrigin)}+path,{method:'POST',headers,body:'bounded-body',redirect:'follow'});const response=await fetch(outgoing);return new Response(await response.text(),{status:response.status,headers:response.headers});}catch{return new Response('fixture-network-failure',{status:502});}}};`;
 mf=new Miniflare({modules:true,script,compatibilityDate:'2026-08-01',host:'127.0.0.1',port:0});const ready=await mf.ready;
 for(const path of ['/normal','/error','/follow']){const request=new Request('http://worker.test'+path,{headers:new Headers({'x-client':'yes'})});const response=await mf.dispatchFetch(request);assert.equal(response.status,path==='/error'?500:200);assert.equal(response.headers.get('x-fixture'),'loopback');const body=await response.json();assert.equal(body.header,'verified');assert.equal(body.url,path==='/follow'?'/normal':path);if(path!=='/follow')assert.equal(body.body,'bounded-body');checks.push({name:'Miniflare fetch Headers Request Response '+path,status:'PASS'});}
 const network=await mf.dispatchFetch('http://worker.test/disconnect');assert.equal(network.status,502);assert.equal(await network.text(),'fixture-network-failure');checks.push({name:'Miniflare network error boundary',status:'PASS'});
 const upgrade=await mf.dispatchFetch('http://worker.test/ws',{headers:{upgrade:'websocket'}});assert.equal(upgrade.status,101);const ws=upgrade.webSocket;assert.ok(ws);ws.accept();const message=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WS_MESSAGE_TIMEOUT')),5000);ws.addEventListener('message',event=>{clearTimeout(timer);resolve(event.data);},{once:true});});ws.send('hello');assert.equal(await message,'echo:hello');const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WS_CLOSE_TIMEOUT')),5000);ws.addEventListener('close',event=>{clearTimeout(timer);resolve(event.code);},{once:true});});ws.send('close');assert.equal(await closed,1000);checks.push({name:'Miniflare websocket echo close',status:'PASS'});
 console.log(JSON.stringify({fixture:fixtureOrigin,proxyTarget:origin,proxy:proxyUrl,worker:ready.href,connectCount,checks},null,2));
}finally{
 for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 await mf?.dispose();for(const dispatcher of dispatchers)await dispatcher.close();for(const client of clients)client.dispose();for(const socket of sockets)socket.destroy();fixture.closeAllConnections();proxy.closeAllConnections();await Promise.all([close(fixture),close(proxy)]);assert.equal(sockets.size,0);console.log(JSON.stringify({cleanup:'PASS',workerDisposed:true,fixtureListening:fixture.listening,proxyListening:proxy.listening,sockets:sockets.size}));
}
