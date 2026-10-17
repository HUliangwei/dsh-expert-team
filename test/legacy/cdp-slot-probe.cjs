// Dump the native @-menu tree inside [data-slot="conversation.input.overlay"]
const http = require('http');
const crypto = require('crypto');
const port = '9223', token = process.argv[2];
class WS { constructor(u) { this.url = u; this.id = 0; this.pending = new Map(); this.listeners = {}; this.buf = Buffer.alloc(0); }
  connect() { return new Promise((res, rej) => { const u = new URL(this.url); const key = crypto.randomBytes(16).toString('base64'); const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } }); req.on('upgrade', (_r, s) => { this.socket = s; this._a(s); res(this); }); req.on('error', rej); req.end(); }); }
  _a(s) { s.on('data', c => { this.buf = Buffer.concat([this.buf, c]); for (;;) { const m = this._d(); if (m === null) { if (this.buf.length === 0) break; } const j = JSON.parse(m); if (j.id && this.pending.has(j.id)) { const p = this.pending.get(j.id); this.pending.delete(j.id); j.error ? p.rej(new Error(JSON.stringify(j.error))) : p.res(j.result); } else if (j.method && this.listeners[j.method]) { for (const f of this.listeners[j.method]) f(j.params); } } }); }
  _e(str) { const p = Buffer.from(str); const mask = crypto.randomBytes(4); const m = Buffer.alloc(p.length); for (let i = 0; i < p.length; i++) m[i] = p[i] ^ mask[i % 4]; let h; if (p.length < 126) { h = Buffer.alloc(2); h[0] = 0x81; h[1] = 0x80 | p.length; } else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); } else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(p.length), 2); } return Buffer.concat([h, mask, m]); }
  _d() { if (this.buf.length < 2) return null; const len = this.buf[1] & 0x7f; let off = 2, size = len; if (len === 126) { if (this.buf.length < 4) return null; size = this.buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (this.buf.length < 10) return null; size = Number(this.buf.readBigUInt64BE(2)); off = 10; } if (this.buf.length < off + size) return null; const o = this.buf.slice(off, off + size).toString(); this.buf = this.buf.slice(off + size); return o; }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(id); rej(new Error('timeout')); }, 15000); this.pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } }); this.socket.write(this._e(JSON.stringify({ id, method, params }))); }); } }
(async function () {
  const tk = (await new Promise((res, rej) => http.get('http://127.0.0.1:9223/json', r => { let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res(JSON.parse(d))); }).on('error', rej))).find(x => x.type === 'page');
  const ws = await new WS(tk.webSocketDebuggerUrl).connect();
  await ws.send('Page.enable'); await ws.send('Runtime.enable');
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });
  await ws.send('Page.navigate', { url: 'http://127.0.0.1:3100/?token=' + token });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(6000);
  const ev = async x => { const r = await ws.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? ('EXC:' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : 'x')) : r.result && r.result.value; };
  await ev("(()=>{var s=[...document.querySelectorAll('button')].find(function(b){return b.innerText.indexOf('稍后配置')>=0});if(s)s.click();return 1})()").catch(() => {});
  await sleep(1000);
  await ev("(()=>{var n=[...document.querySelectorAll('button')].find(function(b){return b.getAttribute&&b.getAttribute('aria-label')==='新建会话'});if(n)n.click();return 1})()").catch(() => {});
  await sleep(2500);
  await ev("(()=>{var cs=[...document.querySelectorAll('textarea,[contenteditable=true]')];var el=cs.find(function(e){return (e.getAttribute&&e.getAttribute('placeholder')||'').indexOf('发消息')>=0})||cs[0];if(el)el.focus();return 1})()");
  await sleep(300);
  await ws.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '@', code: 'Digit2', modifiers: 8, windowsVirtualKeyCode: 50, nativeVirtualKeyCode: 50 });
  await ws.send('Input.dispatchKeyEvent', { type: 'char', key: '@', text: '@', unmodifiedText: '@', modifiers: 8, windowsVirtualKeyCode: 50, nativeVirtualKeyCode: 50 });
  await ws.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '@', code: 'Digit2', modifiers: 8, windowsVirtualKeyCode: 50, nativeVirtualKeyCode: 50 });
  await sleep(1600);
  const expr = "(()=>{var out={};var ov=document.querySelector('[data-slot=\"conversation.input.overlay\"]');" +
    'out.slotEx=!!ov;' +
    'if(ov){out.slotHTML=ov.outerHTML.slice(0,7000);out.slotText=(ov.innerText||"").replace(/\\n+/g,"|").slice(0,900);}' +
    "var o=document.querySelector('.oetMentionOv');out.ovOwn=!!o&&!o.classList.contains('hide');" +
    "return JSON.stringify(out)})()";
  console.log('DUMP=' + await ev(expr));
  try { ws.socket.end(); } catch (e) { }
  process.exit(0);
})().catch(e => { console.log('FATAL', (e && e.message) || String(e)); process.exit(1); });
