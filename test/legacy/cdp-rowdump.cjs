// 诊断：dump 原生 @ 菜单的行结构（首行 + 对话分组行 outerHTML），Round 23f 用。
// 用法：node test/cdp-rowdump.cjs <port> <token> <outDir>
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const [_, __, port, token, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });

function httpGetJson(u) {
  return new Promise((res, rej) => {
    http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

class WS {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = {}; this.buf = Buffer.alloc(0); }
  connect() {
    return new Promise((resolve, reject) => {
      const u = new URL(this.url);
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
      req.on('upgrade', (_res, socket) => { this.socket = socket; this._attach(socket); resolve(this); });
      req.on('error', reject);
      req.end();
    });
  }
  _attach(sock) {
    sock.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      for (;;) {
        const msg = this._decode();
        if (msg === null) break;
        const j = JSON.parse(msg);
        if (j.id && this.pending.has(j.id)) { const p = this.pending.get(j.id); this.pending.delete(j.id); j.error ? p.rej(new Error(JSON.stringify(j.error))) : p.res(j.result); }
        else if (j.method && this.listeners[j.method]) { for (const f of this.listeners[j.method]) f(j.params); }
      }
    });
  }
  _encode(str) {
    const p = Buffer.from(str, 'utf8');
    const mask = crypto.randomBytes(4);
    const masked = Buffer.alloc(p.length);
    for (let i = 0; i < p.length; i++) masked[i] = p[i] ^ mask[i % 4];
    let h;
    if (p.length < 126) { h = Buffer.alloc(2); h[0] = 0x81; h[1] = 0x80 | p.length; }
    else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
    return Buffer.concat([h, mask, masked]);
  }
  _decode() {
    if (this.buf.length < 2) return null;
    const len = this.buf[1] & 0x7f; let off = 2, size = len;
    if (len === 126) { if (this.buf.length < 4) return null; size = this.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (this.buf.length < 10) return null; size = Number(this.buf.readBigUInt64BE(2)); off = 10; }
    if (this.buf.length < off + size) return null;
    const out = this.buf.slice(off, off + size).toString('utf8');
    this.buf = this.buf.slice(off + size);
    return out;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, 15000);
      this.pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
      this.socket.write(this._encode(JSON.stringify({ id, method, params })));
    });
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const targets = await httpGetJson('http://127.0.0.1:' + port + '/json');
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = await new WS(page.webSocketDebuggerUrl).connect();
  await ws.send('Page.enable');
  await ws.send('Runtime.enable');
  const evalJs = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception?.description || '');
    return r.result?.value;
  };
  await ws.send('Page.navigate', { url: 'http://127.0.0.1:3100/?token=' + token });
  await sleep(6000);
  // 对齐 cdp-e2e 前置：工作区选择 → 关向导 → 新建会话 → 聚焦输入框
  await evalJs(`(()=>{const t=document.body?document.body.innerText:'';if(t.includes('选择工作区')||t.includes('选择一个工作区')){const b=[...document.querySelectorAll('button')].find(e=>e.innerText.includes('默认工作区'))||[...document.querySelectorAll('button')].find(e=>e.innerText.includes('继续'));if(b){b.click();return 'ws-clicked';}}return 'no-ws-sel';})()`).catch(() => {});
  await sleep(1800);
  await evalJs(`(()=>{[...document.querySelectorAll('button')].forEach(b=>{const t=(b.innerText||'');if(t.includes('稍后配置')||t.includes('保存并继续'))b.click()});return 1;})()`).catch(() => {});
  await sleep(1500);
  await evalJs(`(()=>{const n=[...document.querySelectorAll('button')].find(b=>b.getAttribute&&(b.getAttribute('aria-label')==='新建会话'||b.getAttribute('aria-label')==='在“默认工作区”中新建会话'));if(n){n.click();return 'new-session';}return 'no-newbtn';})()`).catch(() => {});
  await sleep(2200);
  // 聚焦输入框、清空（真实按键 Ctrl+A + Delete——合成值写入不驱动壳层草稿管线）
  await evalJs(`(()=>{const el=[...document.querySelectorAll('textarea,[contenteditable="true"]')].find(e=>(e.getAttribute&&e.getAttribute('placeholder')||'').includes('发消息'))||document.querySelector('textarea')||document.querySelector('[contenteditable="true"]');if(!el)return 'none';el.focus();return 'ok:'+el.tagName;})()`);
  await sleep(400);
  const rawKey = async (k, code, vk, mods, text) => {
    await ws.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    if (text !== undefined) await ws.send('Input.dispatchKeyEvent', { type: 'char', key: k, text, unmodifiedText: text, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await ws.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  await rawKey('a', 'KeyA', 65, 2);
  await rawKey('Delete', 'Delete', 46, 0);
  await sleep(300);
  await rawKey('@', 'Digit2', 50, 8, '@');
  await sleep(900);
  const dump = await evalJs(`(()=>{
    const slot=document.querySelector('[data-slot="conversation.input.overlay"]');const menu=slot&&slot.querySelector('[data-trigger-menu]');
    const ae=document.activeElement;
    const dg={ae:ae?(ae.tagName+':'+(ae.getAttribute&&ae.getAttribute('placeholder')||'')+':'+((ae.value!=null?ae.value:(ae.innerText||'')).slice(0,40))):'none',slot:!!slot,menu:!!menu};
    if(!menu)return {err:'no-menu',dg};
    const rows=[...menu.querySelectorAll('button[role="option"]')];
    const heads=[...menu.querySelectorAll('[class*="sectionTitle"]')];
    const convHead=heads.find(h=>h.textContent.includes('对话'));
    let convRow='';
    if(convHead){ const maybe=[...menu.querySelectorAll('button[role="option"]')]; convRow=maybe[0]?maybe[0].outerHTML.slice(0,900):''; }
    const importHead=heads.find(h=>h.textContent.includes('导入智能体'));
    let importRow='';
    if(importHead){const g=importHead.closest('[data-oet-import-group]');let b=g&&g.querySelector('button');if(!b){const hd=g&&g.querySelector('[data-oet-grp]');if(hd){hd.click();}b=g&&g.querySelector('button');}importRow=b?b.outerHTML.slice(0,1200):'';}
    return {
      dg, headN:heads.length, heads:heads.map(h=>h.textContent.trim().replace(/\\s+/g,' ')), rowN:rows.length,
      first: rows[0]?rows[0].outerHTML.slice(0,900):'',
      convRow, importRow,
      convHead: convHead?'yes':'no', importHead: importHead?'yes':'no'
    };
  })()`);
  console.log('ROWDUMP', JSON.stringify(dump, null, 1));
  fs.writeFileSync(outDir + '/rowdump.json', JSON.stringify(dump, null, 1));
  // 真实鼠标点击第一行（mousedown 路径）→ 读草稿应含 @trading-team
  if (dump && !dump.err) {
    // 克隆行样式取证：描述 span 是否可见（宽度>0）、行 display 是否原生 flex/grid
    const styleProbe = await evalJs(`(()=>{const menu=document.querySelector('[data-slot="conversation.input.overlay"] [data-trigger-menu]');const g=menu&&menu.querySelector('[data-oet-import-group]');const hd=g&&g.querySelector('[data-oet-grp]');if(hd&&getComputedStyle(hd.parentNode.querySelector('[data-oet-import-body]')).display==='none')hd.click();const b=g&&g.querySelector('button');if(!b)return null;const dd=b.querySelector('[class*="itemDescription"]');const cs=getComputedStyle(b);return {rowDisp:cs.display,rowW:Math.round(b.getBoundingClientRect().width),descW:dd?Math.round(dd.getBoundingClientRect().width):-1,descText:dd?(dd.textContent||'').slice(0,30):'',rowH:Math.round(b.getBoundingClientRect().height)};})()`);
    console.log('STYLEPROBE', JSON.stringify(styleProbe));
    const rect = await evalJs(`(()=>{const menu=document.querySelector('[data-slot="conversation.input.overlay"] [data-trigger-menu]');const g=menu&&menu.querySelector('[data-oet-import-group]');const b=g&&g.querySelector('button');if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    console.log('PICKRECT', JSON.stringify(rect));
    if (rect) {
      await ws.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
      await ws.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
      await sleep(700);
      const after = await evalJs(`(()=>{const ed=document.activeElement||document.querySelector('[data-slot="conversation.draft"]');const v=ed?(ed.value!=null?ed.value:(ed.innerText||ed.textContent||'')):'';const menu=document.querySelector('[data-slot="conversation.input.overlay"] [data-trigger-menu]');return {v:v.slice(0,60),hasAt:v.includes('@trading-team'),menuClosed:!menu||getComputedStyle(menu).display==='none'};})()`);
      console.log('AFTER', JSON.stringify(after));
      fs.writeFileSync(outDir + '/rowdump.json', JSON.stringify({ dump, styleProbe, after }, null, 1));
    }
  }
  ws.socket.end(); process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
