// Round 27b：验证宿主 slash /expert-import —— 菜单行 + 输入 /expert-import 后的灰字 hint（kantu 同款）。
// 用法：node test/cdp-hint.cjs <port> <token> <outDir>
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

(async () => {
  const targets = await httpGetJson('http://127.0.0.1:' + port + '/json');
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = await new WS(page.webSocketDebuggerUrl).connect();
  await ws.send('Page.enable'); await ws.send('Runtime.enable');
  let cerrs = 0;
  ws.listeners['Runtime.consoleAPICalled'] = ws.listeners['Runtime.consoleAPICalled'] || [];
  ws.listeners['Runtime.exceptionThrown'] = ws.listeners['Runtime.exceptionThrown'] || [];
  ws.listeners['Runtime.exceptionThrown'].push((p) => { cerrs++; console.log('EXC', JSON.stringify(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').slice(0, 200)); });
  const evalJs = async (expr) => { const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception?.description || ''); return r.result?.value; };
  const rawKey = async (k, code, vk, mods, text) => { await ws.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); if (text !== undefined) await ws.send('Input.dispatchKeyEvent', { type: 'char', key: k, text, unmodifiedText: text, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await ws.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
  const typeStr = async (s) => { for (const ch of s) { await rawKey(ch, /^[A-Za-z]$/.test(ch) ? 'Key' + ch.toUpperCase() : '', ch.charCodeAt(0), 0, ch); await sleep(80); } };

  await ws.send('Page.navigate', { url: 'http://127.0.0.1:3100/?token=' + token });
  await sleep(6000);
  await evalJs(`(()=>{if(document.body.innerText.includes('选择工作区')){const b=[...document.querySelectorAll('button')].find(e=>e.innerText.includes('默认工作区'))||[...document.querySelectorAll('button')].find(e=>e.innerText.includes('继续'));if(b)b.click();}return 1;})()`).catch(() => {});
  await sleep(1800);
  await evalJs(`(()=>{[...document.querySelectorAll('button')].forEach(b=>{const t=(b.innerText||'');if(t.includes('稍后配置')||t.includes('保存并继续'))b.click()});return 1;})()`).catch(() => {});
  await sleep(1500);
  await evalJs(`(()=>{const n=[...document.querySelectorAll('button')].find(b=>b.getAttribute&&(b.getAttribute('aria-label')==='新建会话'||b.getAttribute('aria-label')==='在“默认工作区”中新建会话'));if(n)n.click();return 1;})()`).catch(() => {});
  await sleep(2200);
  await evalJs(`(()=>{const el=[...document.querySelectorAll('textarea,[contenteditable="true"]')].find(e=>(e.getAttribute&&e.getAttribute('placeholder')||'').includes('发消息'))||document.querySelector('textarea')||document.querySelector('[contenteditable="true"]');if(!el)return;el.focus();})()`);
  await sleep(400);
  await evalJs(`(()=>{const b=document.querySelector('button[aria-label="添加文件或调用指令"]');if(b){b.click()}return 1;})()`);
  await sleep(1000);
  // ① 菜单行 dump：host expert-import 行 + client expert-pick(导入成员和专家团) 行
  let menu = null;
  for (let a = 0; a < 6 && !menu; a++) {
    await evalJs(`(()=>{const b=document.querySelector('button[aria-label="添加文件或调用指令"]');if(b){b.click()}return 1;})()`);
    await sleep(1000);
    menu = await evalJs(`(()=>{const slot=document.querySelector('[data-slot="conversation.input.overlay"]');const menu=slot&&slot.querySelector('[data-trigger-menu]');if(!menu)return null;const t=menu.innerText||'';if(!t.includes('反馈')&&!t.includes('expert')&&!t.includes('导入成员'))return {retry:true,t:t.slice(0,90)};for(let i=0;i<12;i++){menu.scrollTop=menu.scrollHeight;}const leaves=[...menu.querySelectorAll('*')].filter(e=>e.childElementCount===0&&e.textContent&&e.textContent.trim());const snap=(el)=>{const cs=getComputedStyle(el);return {text:(el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,70),color:cs.color,fw:cs.fontWeight};};const rows={};leaves.forEach(l=>{const tx=l.textContent.trim();if(tx==='expert-import'&&!rows.hostName)rows.hostName=snap(l);if(tx.includes('导入成员和专家团')&&!rows.mine)rows.mine=snap(l);if(tx.includes('模板名')&&!rows.hintHost)rows.hintHost=snap(l);if(tx==='expert-pick'&&!rows.pick)rows.pick=snap(l);});return {nLeaves:leaves.length,menuText:(menu.innerText||'').slice(0,520),rows};})()`);
    if (menu && menu.retry) { console.log('RETRY', a, JSON.stringify(menu.t)); menu = null; await evalJs(`(()=>{document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 1;})()`).catch(() => {}); await sleep(600); }
  }
  console.log('MENU', JSON.stringify(menu, null, 1));
  fs.writeFileSync(outDir + '/hint-menu.json', JSON.stringify(menu, null, 1));
  // ② 输入 /expert-import 空格 → claim → 灰字 hint（insertText 一次性注入 + 真实空格键触发 claim）
  await evalJs(`(()=>{const ed=document.querySelector('[data-slot="conversation.draft"]')||document.querySelector('textarea');if(!ed)return;ed.focus();if(typeof ed.value==='string'){ed.value='';ed.dispatchEvent(new Event('input',{bubbles:true}));}return 1;})()`).catch(() => {});
  await sleep(500);
  await rawKey('a', 'KeyA', 65, 2); await rawKey('Delete', 'Delete', 46, 0);
  await sleep(300);
  await ws.send('Input.insertText', { text: '/expert-import' });
  await sleep(600);
  await rawKey(' ', 'Space', 32, 0, ' ');
  await sleep(1200);
  const claim = await evalJs(`(()=>{
    const ov=document.querySelector('[data-slot="conversation.input.overlay"]');
    const ed=document.querySelector('[data-slot="conversation.draft"]')||document.querySelector('textarea')||document.activeElement;
    let v=''; try{ v = ed.value!=null?ed.value:(ed.innerText||ed.textContent||''); }catch(e){}
    const all=document.body.innerText;
    return {draft:String(v).slice(0,80), ovText:ov?(ov.innerText||'').slice(0,200):'', hasHint: all.includes('<模板名>') && (all.includes('--ctx')||all.includes('--model')), hintSnip: (all.match(/[<].*?(--model[^\\n]*)/)||[])[1]||(all.match(/[<][^\\n]*/)||[])[0]||''};
  })()`);
  console.log('CLAIM', JSON.stringify(claim, null, 1));
  fs.writeFileSync(outDir + '/hint-claim.json', JSON.stringify(claim, null, 1));
  console.log('CERRCOUNT', cerrs);
  ws.socket.end(); process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
