// 诊断：真实键入 @ → 停顿 → 再输入，原声菜单分组折叠是否被 React 重建冲掉；
// 以及 / 指令菜单的 DOM 结构（是否也用 sectionTitle 分组头）。
// 用法: node test/cdp-native2.cjs <debugPort> <token>
const http = require('http');
const crypto = require('crypto');
const port = process.argv[2], token = process.argv[3];
const sleep = ms => new Promise(r => setTimeout(r, ms));

class WS {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = {}; this.buf = Buffer.alloc(0); }
  connect() { return new Promise((res, rej) => { const u = new URL(this.url); const key = crypto.randomBytes(16).toString('base64'); const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } }); req.on('upgrade', (_r, s) => { this.socket = s; this._a(s); res(this); }); req.on('error', rej); req.end(); }); }
  _a(s) { s.on('data', c => { this.buf = Buffer.concat([this.buf, c]); for (;;) { const m = this._d(); if (m === null) { break; } const j = JSON.parse(m); if (j.id && this.pending.has(j.id)) { const p = this.pending.get(j.id); this.pending.delete(j.id); j.error ? p.rej(new Error(JSON.stringify(j.error))) : p.res(j.result); } else if (j.method && this.listeners[j.method]) { for (const f of this.listeners[j.method]) f(j.params); } } }); }
  _e(str) { const p = Buffer.from(str); const mask = crypto.randomBytes(4); const m = Buffer.alloc(p.length); for (let i = 0; i < p.length; i++) m[i] = p[i] ^ mask[i % 4]; let h; if (p.length < 126) { h = Buffer.alloc(2); h[0] = 0x81; h[1] = 0x80 | p.length; } else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); } return Buffer.concat([h, mask, m]); }
  _d() { if (this.buf.length < 2) return null; const len = this.buf[1] & 0x7f; let off = 2, size = len; if (len === 126) { if (this.buf.length < 4) return null; size = this.buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (this.buf.length < 10) return null; size = Number(this.buf.readBigUInt64BE(2)); off = 10; } if (this.buf.length < off + size) return null; const o = this.buf.slice(off, off + size).toString(); this.buf = this.buf.slice(off + size); return o; }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(id); rej(new Error('to')); }, 20000); this.pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } }); this.socket.write(this._e(JSON.stringify({ id, method, params }))); }); }
}

async function key(ws, k, code, vk, mods, text) {
  await ws.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  if (text) await ws.send('Input.dispatchKeyEvent', { type: 'char', key: k, text, unmodifiedText: text, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await ws.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}

(async () => {
  const pages = await new Promise((res, rej) => http.get('http://127.0.0.1:' + port + '/json', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const page = pages.find(x => x.type === 'page');
  const ws = await new WS(page.webSocketDebuggerUrl).connect();
  await ws.send('Page.enable'); await ws.send('Runtime.enable');
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });
  await ws.send('Page.navigate', { url: 'http://127.0.0.1:3100/?token=' + token });
  await sleep(6000);
  const ev = async x => { const r = await ws.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? ('EXC:' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : 'x')) : r.result && r.result.value; };
  await ev("(()=>{[...document.querySelectorAll('button')].forEach(b=>{const t=(b.innerText||'');if(t.includes('稍后配置')||t.includes('保存并继续'))b.click()});return 1})()").catch(()=>{});
  await sleep(1500);
  await ev("(()=>{const n=[...document.querySelectorAll('button')].find(b=>b.getAttribute&&(b.getAttribute('aria-label')==='新建会话'||b.getAttribute('aria-label')==='在“默认工作区”中新建会话'));if(n)n.click();return !!n})()").catch(()=>{});
  await sleep(2200);
  await ev("(()=>{var cs=[...document.querySelectorAll('textarea,[contenteditable=true]')];var el=cs.find(function(e){return (e.getAttribute&&e.getAttribute('placeholder')||'').indexOf('发消息')>=0})||cs[0];if(el)el.focus();return 1})()");
  await sleep(400);
  const menuState = `(()=>{const menu=document.querySelector('[data-slot="conversation.input.overlay"] [data-trigger-menu]');if(!menu)return {menu:false};const vp=menu.querySelector('[role="listbox"]')||menu;const heads=[...vp.querySelectorAll('[class*="sectionTitle"]')].map(h=>({t:(h.textContent||'').trim().replace(/\\s+/g,' ').slice(0,24),wrapped:h.getAttribute('data-oet-wrapped')?'1':'0',cls:(h.getAttribute('class')||'').slice(0,40)}));const bodies=[...vp.querySelectorAll('[data-oet-grp-body]')].map(b=>getComputedStyle(b).display);const rows=vp.querySelectorAll('button[role="option"]').length;return {menu:true,heads,bodyDisp:bodies,rows,imp:!!menu.querySelector('[data-oet-import-group]'),html:vp.outerHTML.slice(0,700)};})()`;

  // ── 场景 A：@ 后停顿 2.5s（>1.5s 新鲜窗）再输入 → 看折叠是否被冲掉
  await ev("(()=>{var cs=[...document.querySelectorAll('textarea,[contenteditable=true]')];var el=cs.find(e=>((e.getAttribute&&e.getAttribute('placeholder'))||'').indexOf('发消息')>=0)||cs[0];if(el)el.focus();return 1})()");
  await key(ws, 'a', 'KeyA', 65, 2, 'a'); await key(ws, 'Delete', 'Delete', 46, 0, '');
  await sleep(300);
  await key(ws, '@', 'Digit2', 50, 8, '@'); await sleep(900);
  const a1 = await ev(menuState);
  await sleep(1600); // 停顿 > 新鲜窗
  await key(ws, 'x', 'KeyX', 88, 0, 'x'); await sleep(400);
  const a2 = await ev(menuState);
  console.log('A1(@)= ' + JSON.stringify(a1).slice(0, 900));
  console.log('A2(@+pause+ x)= ' + JSON.stringify(a2).slice(0, 900));

  // ── 场景 B：/ 菜单 DOM（是否同样用 sectionTitle 分组头）
  await ev("(()=>{var cs=[...document.querySelectorAll('textarea,[contenteditable=true]')];var el=cs.find(e=>((e.getAttribute&&e.getAttribute('placeholder'))||'').indexOf('发消息')>=0)||cs[0];if(el)el.focus();return 1})()");
  await key(ws, 'a', 'KeyA', 65, 2, 'a'); await key(ws, 'Delete', 'Delete', 46, 0, '');
  await sleep(300);
  await key(ws, '/', 'Slash', 191, 0, '/'); await sleep(1000);
  const b1 = await ev(menuState);
  console.log('B1(/)= ' + JSON.stringify(b1).slice(0, 1200));
  process.exit(0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
