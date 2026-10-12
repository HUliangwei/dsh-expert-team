// Focused Round 22b @-menu e2e: real Shift+2 '@' -> native menu collapsed + injected import group + row click.
const http = require('http');
const crypto = require('crypto');
const port = '9223', token = process.argv[2];
class WS { constructor(u) { this.url = u; this.id = 0; this.pending = new Map(); this.listeners = {}; this.buf = Buffer.alloc(0); }
  connect() { return new Promise((res, rej) => { const u = new URL(this.url); const key = crypto.randomBytes(16).toString('base64'); const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } }); req.on('upgrade', (_r, s) => { this.socket = s; this._a(s); res(this); }); req.on('error', rej); req.end(); }); }
  _a(s) { s.on('data', c => { this.buf = Buffer.concat([this.buf, c]); for (;;) { const m = this._d(); if (m === null) { if (this.buf.length === 0) break; } const j = JSON.parse(m); if (j.id && this.pending.has(j.id)) { const p = this.pending.get(j.id); this.pending.delete(j.id); j.error ? p.rej(new Error(JSON.stringify(j.error))) : p.res(j.result); } else if (j.method && this.listeners[j.method]) { for (const f of this.listeners[j.method]) f(j.params); } } }); }
  _e(str) { const p = Buffer.from(str); const mask = crypto.randomBytes(4); const m = Buffer.alloc(p.length); for (let i = 0; i < p.length; i++) m[i] = p[i] ^ mask[i % 4]; let h; if (p.length < 126) { h = Buffer.alloc(2); h[0] = 0x81; h[1] = 0x80 | p.length; } else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); } else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(p.length), 2); } return Buffer.concat([h, mask, m]); }
  _d() { if (this.buf.length < 2) return null; const len = this.buf[1] & 0x7f; let off = 2, size = len; if (len === 126) { if (this.buf.length < 4) return null; size = this.buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (this.buf.length < 10) return null; size = Number(this.buf.readBigUInt64BE(2)); off = 10; } if (this.buf.length < off + size) return null; const o = this.buf.slice(off, off + size).toString(); this.buf = this.buf.slice(off + size); return o; }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(id); rej(new Error('timeout')); }, 15000); this.pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } }); this.socket.write(this._e(JSON.stringify({ id, method, params }))); }); } }
async function key(ws, k, code, vk, mods, text) {
  await ws.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  if (text !== undefined) await ws.send('Input.dispatchKeyEvent', { type: 'char', key: k, text, unmodifiedText: text, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await ws.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
(async function () {
  const tk = (await new Promise((res, rej) => http.get('http://127.0.0.1:9223/json', r => { let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res(JSON.parse(d))); }).on('error', rej))).find(x => x.type === 'page');
  const ws = await new WS(tk.webSocketDebuggerUrl).connect();
  await ws.send('Page.enable'); await ws.send('Runtime.enable');
  ws.listeners['Runtime.consoleAPICalled'] = ws.listeners['Runtime.consoleAPICalled'] || [];
  ws.listeners['Runtime.consoleAPICalled'].push(p => { try { console.log('CERR', p.type, (p.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 300)); } catch (e) { } });
  ws.listeners['Runtime.exceptionThrown'] = ws.listeners['Runtime.exceptionThrown'] || [];
  ws.listeners['Runtime.exceptionThrown'].push(p => { try { console.log('EXC', (p.exceptionDetails && (p.exceptionDetails.exception?.description || p.exceptionDetails.text)) || ''); } catch (e) { } });
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });
  await ws.send('Page.navigate', { url: 'http://127.0.0.1:3100/?token=' + token });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(6000);
  const ev = async x => { const r = await ws.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? ('EXC:' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : 'x')) : r.result && r.result.value; };
  // 关向导 + 新建会话 + 聚焦输入框（多点几次确保无遮罩）
  await ev("(()=>{[...document.querySelectorAll('button')].forEach(b=>{const t=(b.innerText||'');if(t.includes('稍后配置')||t.includes('保存并继续'))b.click()});return 1})()").catch(() => {});
  await sleep(1500);
  await ev("(()=>{const n=[...document.querySelectorAll('button')].find(b=>b.getAttribute&&(b.getAttribute('aria-label')==='新建会话'||b.getAttribute('aria-label')==='在“默认工作区”中新建会话'));if(n)n.click();return !!n})()").catch(() => {});
  await sleep(2200);
  const foc = await ev("(()=>{var cs=[...document.querySelectorAll('textarea,[contenteditable=true]')];var el=cs.find(function(e){return (e.getAttribute&&e.getAttribute('placeholder')||'').indexOf('发消息')>=0})||cs[0];if(!el)return 'no-editor';el.focus();return el.tagName})()");
  console.log('focus=' + foc);
  await sleep(400);
  // 清空：Ctrl+A + Delete（真实按键）
  await key(ws, 'a', 'KeyA', 65, 2); await key(ws, 'Delete', 'Delete', 46, 0);
  await sleep(300);
  // 监听真实按键产生的事件（诊断：我们的 input 监听为何收不到）
  await ev("window.__oetEvts=[];['input','beforeinput','keydown'].forEach(function(t){document.addEventListener(t,function(e){var tg=e.target;window.__oetEvts.push(t+':'+(tg&&(tg.tagName||'?'))+':'+(tg&&tg.isContentEditable?'ed':'')+':'+String(e.data));},true)});1");
  // 真实 '@' (Shift+2)
  await key(ws, '@', 'Digit2', 50, 8, '@');
  await sleep(900);
  const bare = await ev("(()=>{const slot=document.querySelector('[data-slot=\"conversation.input.overlay\"]');const menu=slot&&slot.querySelector('[data-trigger-menu]');const ov=document.querySelector('.oetMentionOv');const dbg=window.__oetDbg||null;if(!menu)return {nat:false,hasNoOv:!ov,dbg};const st=getComputedStyle(menu);if(st.display==='none'||st.visibility==='hidden')return {nat:false,hidden:true,dbg};const heads=[...menu.querySelectorAll('[class*=\"sectionTitle\"]')].map(h=>{const c=h.querySelector('[data-oet-grp-cnt]');return {t:h.textContent.trim().replace(/\\s+/g,' '),cnt:c?c.textContent:null}});const bodies=[...menu.querySelectorAll('[data-oet-grp-body]')];return {nat:true,heads,bodies:bodies.length,collapsed:bodies.length>0&&bodies.every(b=>getComputedStyle(b).display==='none'),hasImport:heads.some(h=>h.t.includes('导入智能体')),hasNoOv:!ov,grpN:document.querySelectorAll('[data-oet-grp]').length,impN:document.querySelectorAll('[data-oet-import-group]').length,dbg};})()");
  console.log('BARE=' + JSON.stringify(bare));
  // 展开导入组 + 点 game-dev-team 行
  const pick = await ev("(()=>{const menu=document.querySelector('[data-slot=\"conversation.input.overlay\"] [data-trigger-menu]');const grp=menu&&menu.querySelector('[data-oet-import-group]');if(!grp)return {grp:false};const head=grp.querySelector('[data-oet-grp]');const body=grp.querySelector('[data-oet-import-body]');if(head)head.click();const b=body&&[...body.querySelectorAll('button')].find(x=>x.textContent.includes('game-dev-team'));if(!b)return {grp:true,row:false,open:getComputedStyle(body).display!=='none'};b.click();return {grp:true,row:true};})()");
  console.log('PICK=' + JSON.stringify(pick));
  await sleep(800);
  const after = await ev("(()=>{const vals=[...document.querySelectorAll('textarea,[contenteditable=true]')].map(e=>e.value!==undefined?e.value:(e.innerText||'')).filter(Boolean);const menu=document.querySelector('[data-slot=\"conversation.input.overlay\"] [data-trigger-menu]');const ov=document.querySelector('.oetMentionOv');return {vals:vals.slice(-4).map(v=>v.slice(-50)),hit:vals.some(v=>v.includes('@game-dev-team')),menuShown:!!menu&&getComputedStyle(menu).display!=='none',hasNoOv:!ov,evts:window.__oetEvts||[]};})()");
  console.log('AFTER=' + JSON.stringify(after));
  try { ws.socket.end(); } catch (e) { }
  process.exit(0);
})().catch(e => { console.log('FATAL', (e && e.message) || String(e)); process.exit(1); });
