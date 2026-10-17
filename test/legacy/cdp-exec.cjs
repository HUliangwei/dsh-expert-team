// Round 28d 诊断：输入 /expert-import <模板> 回车 → handler 是否执行、invocation 结构、spawn 可行性。
// 用法：node test/cdp-exec.cjs <port> <token> <outDir>
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const [_, __, port, token, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
function httpGetJson(u) { return new Promise((res, rej) => { http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
class WS {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = {}; this.buf = Buffer.alloc(0); }
  connect() { return new Promise((resolve, reject) => { const u = new URL(this.url); const key = crypto.randomBytes(16).toString('base64'); const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } }); req.on('upgrade', (_res, socket) => { this.socket = socket; this._attach(socket); resolve(this); }); req.on('error', reject); req.end(); }); }
  _attach(sock) { sock.on('data', (chunk) => { this.buf = Buffer.concat([this.buf, chunk]); for (;;) { const msg = this._decode(); if (msg === null) break; const j = JSON.parse(msg); if (j.id && this.pending.has(j.id)) { const p = this.pending.get(j.id); this.pending.delete(j.id); j.error ? p.rej(new Error(JSON.stringify(j.error))) : p.res(j.result); } else if (j.method && this.listeners[j.method]) { for (const f of this.listeners[j.method]) f(j.params); } } }); }
  _encode(str) { const p = Buffer.from(str, 'utf8'); const mask = crypto.randomBytes(4); const masked = Buffer.alloc(p.length); for (let i = 0; i < p.length; i++) masked[i] = p[i] ^ mask[i % 4]; let h; if (p.length < 126) { h = Buffer.alloc(2); h[0] = 0x81; h[1] = 0x80 | p.length; } else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); } else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(p.length), 2); } return Buffer.concat([h, mask, masked]); }
  _decode() { if (this.buf.length < 2) return null; const len = this.buf[1] & 0x7f; let off = 2, size = len; if (len === 126) { if (this.buf.length < 4) return null; size = this.buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (this.buf.length < 10) return null; size = Number(this.buf.readBigUInt64BE(2)); off = 10; } if (this.buf.length < off + size) return null; const out = this.buf.slice(off, off + size).toString('utf8'); this.buf = this.buf.slice(off + size); return out; }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, 15000); this.pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } }); this.socket.write(this._encode(JSON.stringify({ id, method, params }))); }); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rawKey = async (ws, k, code, vk, mods, text) => { await ws.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); if (text !== undefined) await ws.send('Input.dispatchKeyEvent', { type: 'char', key: k, text, unmodifiedText: text, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await ws.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };

(async () => {
  const targets = await httpGetJson('http://127.0.0.1:' + port + '/json');
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = await new WS(page.webSocketDebuggerUrl).connect();
  await ws.send('Page.enable'); await ws.send('Runtime.enable');
  await ws.send('Page.navigate', { url: 'http://127.0.0.1:3100/?token=' + token });
  await sleep(6000);
  const evalJs = async (expr) => { const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception?.description || ''); return r.result?.value; };
  await evalJs(`(()=>{document.body.innerText.includes('选择工作区')&&([...document.querySelectorAll('button')].find(b=>b.innerText.includes('默认工作区'))||[...document.querySelectorAll('button')].find(b=>b.innerText.includes('继续')))?.click();return 1;})()`).catch(() => {});
  await sleep(1500);
  await evalJs(`(()=>{[...document.querySelectorAll('button')].forEach(b=>{const t=(b.innerText||'');if(t.includes('稍后配置')||t.includes('保存并继续'))b.click()});return 1;})()`).catch(() => {});
  await sleep(1200);
  // 宽松匹配「新建会话」（欢迎屏 aria-label 可能与标准会话不同）
  const freshInfo = await evalJs(`(()=>{
    const cands=[...document.querySelectorAll('button')].map((b,i)=>({i,t:(b.innerText||'').trim().slice(0,16),al:b.getAttribute&&b.getAttribute('aria-label'),tt:b.getAttribute&&b.getAttribute('title')}));
    return {sample:cands.slice(0,24)};
  })()`);
  console.log('FRESHBTNS', JSON.stringify(freshInfo, null, 1));
  const clicked = await evalJs(`(()=>{
    const re=/新建|新会话|New/i;
    const b=[...document.querySelectorAll('button')].find(b=>re.test((b.getAttribute&&b.getAttribute('aria-label'))||'')||re.test((b.innerText||'').trim()));
    if(b){b.click();return (b.getAttribute&&b.getAttribute('aria-label'))||b.innerText.trim().slice(0,16);}
    return 'no-newbtn';
  })()`);
  console.log('FRESH', clicked);
  // 轮询直到真实会话就绪（conversation.draft / 发消息输入框出现）
  let ready = null;
  for (let p = 0; p < 20; p++) {
    ready = await evalJs(`(()=>{
      const el=[...document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable=""]')].find(e=>(e.getAttribute&&e.getAttribute('placeholder')||'').includes('发消息'));
      return {ok:!!el, tag:el?el.tagName:'', nEditors:document.querySelectorAll('textarea').length};
    })()`);
    if (ready && ready.ok) break;
    await sleep(1500);
  }
  console.log('READY', JSON.stringify(ready));
  for (let i = 0; i < 6; i++) {
    const f = await evalJs(`(()=>{const el=[...document.querySelectorAll('textarea,[contenteditable="true"]')].find(e=>(e.getAttribute&&e.getAttribute('placeholder')||'').includes('发消息'))||document.querySelector('textarea');if(!el)return 'no-editor';el.focus();return 'ok';})()`);
    if (f === 'ok') break;
    await sleep(800);
  }
  await sleep(400);
  // 输入完整指令 + 回车（单成员模板，验证直接 spawn 链路）
  await ws.send('Input.insertText', { text: '/expert-import content-adapter --ctx fresh' });
  await sleep(600);
  await rawKey(ws, 'Enter', 'Enter', 13, 0);
  await sleep(6000);
  const after = await evalJs(`(()=>{
    const t=document.body.innerText;
    return { tail:t.slice(-600), hasError:/用法|未知模板|error|失败/i.test(t), hasExec:t.includes('expert-import'), hasSpawn:t.includes('lead')||t.includes('spawn') };
  })()`);
  console.log('AFTER', JSON.stringify(after, null, 1));
  fs.writeFileSync(outDir + '/exec-after.json', JSON.stringify(after, null, 1));
  ws.socket.end(); setTimeout(() => process.exit(0), 200);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
