// No external dependencies: headless Chrome is driven through its DevTools API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {once} = require('node:events');

const root = path.resolve(__dirname,'..');
const script = fs.readFileSync(path.join(root,'page.js'),'utf8');
const bootstrap = fs.readFileSync(path.join(root,'config/base.js'),'utf8');
const probe = `({language:navigator.language,languages:navigator.languages,
  zone:new Intl.DateTimeFormat().resolvedOptions().timeZone,
  iso:new Date('2026-01-15T12:00:00').toISOString(),
  parsed:Date.parse('2026-01-15T12:00:00'),constructor:new Date().constructor===Date})`;
const expected = {language:'en-US',languages:['en-US','en'],zone:'America/New_York',
  iso:'2026-01-15T17:00:00.000Z',parsed:Date.UTC(2026,0,15,17),constructor:true};
const resourceProbe = `await fetch('./resource.json').then(r=>r.json());
  const request=new Request('./resource.json');
  if(request.constructor!==Request)throw Error('Request constructor mismatch');
  await fetch(request).then(r=>r.json());
  await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();
    xhr.open('GET','./resource.json');xhr.onload=()=>xhr.status===200?resolve():reject(Error('XHR status'));
    xhr.onerror=()=>reject(Error('XHR failed'));xhr.send()});`;
const server = http.createServer((req,res)=>{
  const url = req.url.split('?')[0];
  if (url === '/fixture' || url === '/frame') {
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><script src="/bootstrap.js"></script><script src="/page.js"></script>');
  } else {
    res.setHeader('Content-Type','text/javascript');
    if (url === '/bootstrap.js') res.end(bootstrap);
    else if (url === '/page.js') res.end(script);
    else if (url === '/workers/classic.js') res.end(`importScripts('./dependency.js');(async()=>{${resourceProbe}postMessage(${probe})})().catch(e=>{throw e});`);
    else if (url === '/workers/dependency.js') res.end(`if(navigator.language!=='en-US')throw Error('unpatched dependency');`);
    else if (url === '/workers/module.js') res.end(`import './module-dependency.js';${resourceProbe}postMessage(${probe});`);
    else if (url === '/workers/module-dependency.js') res.end(`if(new Intl.DateTimeFormat().resolvedOptions().timeZone!=='America/New_York')throw Error('unpatched module dependency');`);
    else if (url === '/workers/shared.js') res.end(`onconnect=e=>e.ports[0].postMessage(${probe});`);
    else if (url === '/workers/nested.js') res.end(`const child=new Worker('./classic.js');child.onmessage=e=>postMessage(e.data);`);
    else if (url === '/workers/resource.json') res.end('{"ok":true}');
    else {res.statusCode=404;res.end('');}
  }
});

(async()=>{
  let chrome, socket;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(),'region-cloak-smoke-'));
  try {
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const binary = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    chrome = spawn(binary,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
      '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    const endpoint = await new Promise((resolve,reject)=>{
      const timer = setTimeout(()=>reject(Error('Chrome startup timed out')),20000);
      let logs='';
      chrome.once('error',error=>{clearTimeout(timer);reject(error)});
      chrome.stderr.on('data',data=>{
        logs+=data.toString();
        const match=logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if(match){clearTimeout(timer);resolve(match[1]);}
      });
    });
    socket = new WebSocket(endpoint);
    await once(socket,'open');
    let id=0;
    const pending = new Map();
    socket.addEventListener('message',event=>{
      const value=JSON.parse(event.data);
      if (!pending.has(value.id)) return;
      const {resolve,reject,timer}=pending.get(value.id);
      pending.delete(value.id);clearTimeout(timer);
      value.error ? reject(Error(JSON.stringify(value.error))) : resolve(value.result);
    });
    function send(method,params={},sessionId) {
      return new Promise((resolve,reject)=>{
        const requestId=++id;
        const timer=setTimeout(()=>{pending.delete(requestId);reject(Error(`${method} timed out`))},20000);
        pending.set(requestId,{resolve,reject,timer});
        socket.send(JSON.stringify({id:requestId,method,params,sessionId}));
      });
    }
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'},sessionId);
    await send('Emulation.setLocaleOverride',{locale:'zh-CN'},sessionId);
    await send('Page.enable',{},sessionId);
    await send('Page.navigate',{url:`${base}/fixture`},sessionId);
    const result=await send('Runtime.evaluate',{
      expression:`(async()=>{
        while (!document.body || !globalThis[Symbol.for('chatgpt-region-cloak.state.v3')]) await new Promise(r=>setTimeout(r,10));
        const worker=(url,options,shared=false)=>new Promise((resolve,reject)=>{
          const w=shared?new SharedWorker(url,options):new Worker(url,options);
          const port=shared?w.port:w;
          const timeout=setTimeout(()=>reject(Error('worker timeout: '+url)),8000);
          w.onerror=e=>{clearTimeout(timeout);reject(Error(e.message||'worker error: '+url))};
          port.onmessage=e=>{clearTimeout(timeout);resolve(e.data);shared?port.close():w.terminate()};
        });
        const result={document:${probe}};
        const frame=document.createElement('iframe');frame.src='/frame';
        await new Promise(r=>{frame.onload=r;document.body.append(frame)});
        result.frame=frame.contentWindow.eval(${JSON.stringify(probe)});
        result.classic=await worker('/workers/classic.js');
        result.module=await worker('/workers/module.js',{type:'module'});
        result.shared=await worker('/workers/shared.js',{name:'region-smoke'},true);
        result.sharedModule=await worker('/workers/shared.js',{name:'region-module-smoke',type:'module'},true);
        result.nested=await worker('/workers/nested.js');
        const blob=URL.createObjectURL(new Blob(['postMessage('+${JSON.stringify(probe)}+')'],{type:'text/javascript'}));
        const blobResult=worker(blob);URL.revokeObjectURL(blob);result.blob=await blobResult;
        const moduleBlob=URL.createObjectURL(new Blob(['postMessage('+${JSON.stringify(probe)}+')'],{type:'text/javascript'}));
        const moduleBlobResult=worker(moduleBlob,{type:'module'});URL.revokeObjectURL(moduleBlob);
        result.moduleBlob=await moduleBlobResult;
        return result;
      })()`,awaitPromise:true,returnByValue:true
    },sessionId);
    if(result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    for(const [kind,value] of Object.entries(result.result.value)) {
      assert.deepEqual(value,expected,kind);
      console.log(`PASS ${kind}: Shanghai host → New York Date/Intl/language`);
    }
    await send('Browser.close');
  } finally {
    socket?.close();
    if(chrome && chrome.exitCode === null) {
      await Promise.race([once(chrome,'exit'),new Promise(r=>setTimeout(r,3000))]);
      if(chrome.exitCode === null) chrome.kill();
    }
    server.close();
    // mkdtemp created this exact isolated profile under the system temp folder.
    if(path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('region-cloak-smoke-')) {
      try {fs.rmSync(profile,{recursive:true,force:true})} catch {}
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1});
