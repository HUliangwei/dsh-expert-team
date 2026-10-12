// Round 26b 诊断2：plus 按钮打开 / 指令菜单，dump「反馈/目标」等宿主指令行 vs 我们「导入成员和专家团」行的 outerHTML + 计算颜色。
// 用法：node test/cdp-menupeek.cjs <port> <token> <outDir>
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
  await evalJs(`(()=>{const t=document.body?document.body.innerText:'';if(t.includes('选择工作区')){const b=[...document.querySelectorAll('button')].find(e=>e.innerText.includes('默认工作区'))||[...document.querySelectorAll('button')].find(e=>e.innerText.includes('继续'));if(b)b.click();}return 1;})()`).catch(() => {});
  await sleep(1800);
  await evalJs(`(()=>{[...document.querySelectorAll('button')].forEach(b=>{const t=(b.innerText||'');if(t.includes('稍后配置')||t.includes('保存并继续'))b.click()});return 1;})()`).catch(() => {});
  await sleep(1500);
  await evalJs(`(()=>{const n=[...document.querySelectorAll('button')].find(b=>b.getAttribute&&(b.getAttribute('aria-label')==='新建会话'||b.getAttribute('aria-label')==='在“默认工作区”中新建会话'));if(n)n.click();return 1;})()`).catch(() => {});
  await sleep(2200);
  await evalJs(`(()=>{const el=[...document.querySelectorAll('textarea,[contenteditable="true"]')].find(e=>(e.getAttribute&&e.getAttribute('placeholder')||'').includes('发消息'))||document.querySelector('textarea')||document.querySelector('[contenteditable="true"]');if(!el)return;el.focus();})()`);
  await sleep(400);

  // plus 按钮打开指令菜单（套件实证路径）；若打开的是会话切换列表则重试 '/' 路径
  let dump = null;
  let attempts = 0;
  while (attempts < 4 && !dump) {
    await evalJs(`(()=>{const b=document.querySelector('button[aria-label="添加文件或调用指令"]');if(b){b.click()}return 1;})()`);
    await sleep(1000);
    dump = await evalJs(`(()=>{const slot=document.querySelector('[data-slot="conversation.input.overlay"]');const menu=slot&&slot.querySelector('[data-trigger-menu]');if(!menu)return null;const t=(menu.innerText||''); if(!t.includes('反馈')) return {retry:true,t:t.slice(0,120)}; for(let i=0;i<12;i++){menu.scrollTop=menu.scrollHeight; menu.scrollBy(0,999999);} return {ok:true,totalText:(menu.innerText||'').length, full:(menu.innerText||'').slice(0,600)};})()`);
    if (dump) { console.log('SCOLL', JSON.stringify(dump)); dump = null; }
    await sleep(800);
    dump = await evalJs(`(()=>{const slot=document.querySelector('[data-slot="conversation.input.overlay"]');const menu=slot&&slot.querySelector('[data-trigger-menu]');if(!menu)return null;const leaves=[...menu.querySelectorAll('*')].filter(e=>e.childElementCount===0&&e.textContent&&e.textContent.trim()); const snap=(el)=>{ const cs=getComputedStyle(el); return {tag:el.tagName,cls:String(el.className||'').slice(0,90),text:(el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,60),color:cs.color,fw:cs.fontWeight,fs:cs.fontSize}; }; const rows={}; leaves.forEach(l=>{const tx=l.textContent; if(tx.includes('导入成员和专家团')&&!rows.mine)rows.mine=snap(l); if(tx.includes('反馈')&&!rows.feedback)rows.feedback=snap(l); if(tx.includes('目标')&&!rows.goal)rows.goal=snap(l); if(tx.includes('模型')&&!rows.model)rows.model=snap(l);}); return {nLeaves:leaves.length,menuText:(menu.innerText||'').slice(0,300),rows,sampleLeaf:snap(leaves[0]||menu)};})()`);
    if (dump && dump.retry) { console.log('RETRY', attempts, JSON.stringify(dump.t)); dump = null; }
    attempts++;
    if (!dump) {
      await evalJs(`(()=>{const slot=document.querySelector('[data-slot="conversation.input.overlay"]');if(slot)slot.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 1;})()`).catch(() => {});
      await sleep(600);
    }
  }

  console.log(JSON.stringify(dump, null, 1));
  fs.writeFileSync(outDir + '/menupeek2.json', JSON.stringify(dump, null, 1));
  ws.socket.end(); process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
