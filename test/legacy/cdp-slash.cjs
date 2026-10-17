// Round 25 聚焦探针：真实敲 '/' → 原生指令菜单 → 真鼠标点 trading-team 行 → 读草稿应为 /trading-team。
// 用法：node test/cdp-slash.cjs <port> <token> <outDir>
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
  ws.listeners['Runtime.exceptionThrown'] = ws.listeners['Runtime.exceptionThrown'] || [];
  ws.listeners['Runtime.exceptionThrown'].push((p) => { try { console.log('EXC', (p.exceptionDetails && (p.exceptionDetails.exception?.description || p.exceptionDetails.text)) || ''); } catch (e) { } });
  ws.listeners['Runtime.consoleAPICalled'] = ws.listeners['Runtime.consoleAPICalled'] || [];
  ws.listeners['Runtime.consoleAPICalled'].push((p) => { try { if (p.type === 'error') console.log('CERR', (p.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200)); } catch (e) { } });
  const evalJs = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception?.description || '');
    return r.result?.value;
  };
  const rawKey = async (k, code, vk, mods, text) => {
    await ws.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    if (text !== undefined) await ws.send('Input.dispatchKeyEvent', { type: 'char', key: k, text, unmodifiedText: text, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await ws.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  const mouseClick = async (x, y) => {
    await ws.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await ws.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  await ws.send('Page.navigate', { url: 'http://127.0.0.1:3100/?token=' + token });
  await sleep(6000);
  await evalJs(`(()=>{const t=document.body?document.body.innerText:'';if(t.includes('选择工作区')||t.includes('选择一个工作区')){const b=[...document.querySelectorAll('button')].find(e=>e.innerText.includes('默认工作区'))||[...document.querySelectorAll('button')].find(e=>e.innerText.includes('继续'));if(b){b.click();return 'ws-clicked';}}return 'no-ws-sel';})()`).catch(() => {});
  await sleep(1800);
  await evalJs(`(()=>{[...document.querySelectorAll('button')].forEach(b=>{const t=(b.innerText||'');if(t.includes('稍后配置')||t.includes('保存并继续'))b.click()});return 1;})()`).catch(() => {});
  await sleep(1500);
  await evalJs(`(()=>{const n=[...document.querySelectorAll('button')].find(b=>b.getAttribute&&(b.getAttribute('aria-label')==='新建会话'||b.getAttribute('aria-label')==='在“默认工作区”中新建会话'));if(n){n.click();return 'new-session';}return 'no-newbtn';})()`).catch(() => {});
  await sleep(2200);

  // 聚焦 + 清空（真实按键）
  await evalJs(`(()=>{const el=[...document.querySelectorAll('textarea,[contenteditable="true"]')].find(e=>(e.getAttribute&&e.getAttribute('placeholder')||'').includes('发消息'))||document.querySelector('textarea')||document.querySelector('[contenteditable="true"]');if(!el)return 'none';el.focus();return 'ok';})()`);
  await sleep(400);
  await rawKey('a', 'KeyA', 65, 2);
  await rawKey('Delete', 'Delete', 46, 0);
  await sleep(300);
  await rawKey('/', 'Slash', 191, 0, '/');
  await sleep(1200);
  const menu = await evalJs(`(()=>{
    const slot=document.querySelector('[data-slot="conversation.input.overlay"]');
    const menu=slot&&slot.querySelector('[data-trigger-menu]');
    if(!menu) return {err:'no-menu'};
    const rows=[...menu.querySelectorAll('button')].map(b=>b.textContent.trim().replace(/\\s+/g,' ').slice(0,60));
    const leaves=[...menu.querySelectorAll('*')].filter(e=>e.childElementCount===0&&e.textContent&&(e.textContent.includes('trading-team')||e.textContent.includes('导入成员')));
    return {rows:rows.slice(0,16), hits:leaves.slice(0,8).map(e=>e.tagName+':'+e.textContent.trim().slice(0,50))};
  })()`);
  console.log('MENU', JSON.stringify(menu, null, 1));
  // 输入过滤词 'trad'（host 以菜单为搜索框过滤；我们 searchLabels 含 trading-team）
  for (const ch of 'trad') await rawKey(ch, ch.length === 1 ? 'Key' + ch.toUpperCase() : '', 0, 0, ch);
  await sleep(600);
  const filtered = await evalJs(`(()=>{
    const slot=document.querySelector('[data-slot="conversation.input.overlay"]');
    const menu=slot&&slot.querySelector('[data-trigger-menu]');
    if(!menu) return {err:'no-menu'};
    const rows=[...menu.querySelectorAll('button')].map(b=>b.textContent.trim().replace(/\\s+/g,' ').slice(0,50));
    return {rows:rows.slice(0,10),ovText:(slot?slot.innerText:'').slice(0,200)};
  })()`);
  console.log('FILTERED', JSON.stringify(filtered));
  // Enter 激活当前行（应展开模板选项 popup）
  await rawKey('Enter', 'Enter', 13, 0);
  await sleep(900);
  const afterEnter = await evalJs(`(()=>{
    const ov=document.querySelector('[data-slot="conversation.input.overlay"]');
    const menu=ov&&ov.querySelector('[data-trigger-menu]');
    return {ovText:(ov?ov.innerText:'').slice(0,300),menuOpen:!!(menu&&getComputedStyle(menu).display!=='none'),hasTrd:document.body.innerText.includes('trading-team')&&document.body.innerText.includes('交易分析')};
  })()`);
  console.log('AFTERENTER', JSON.stringify(afterEnter));
  // ① 点「导入成员和专家团」栏目：先 JS click（Round 23e 实证对指令菜单行有效），
  //    菜单还在就真鼠标兜底（坐标中心按下/抬起）→ 轮询模板选项（trading-team）出现
  const cInfo = await evalJs(`(()=>{
    const slot=document.querySelector('[data-slot="conversation.input.overlay"]');
    const menu=slot&&slot.querySelector('[data-trigger-menu]');
    if(!menu) return null;
    const leaves=[...menu.querySelectorAll('*')].filter(e=>e.childElementCount===0&&e.textContent&&e.textContent.includes('导入成员和专家团'));
    const el=leaves[0];
    if(!el) return null;
    const hit=el.closest('button,[role="option"],[role="menuitem"],li')||el.parentElement||el;
    hit.click();
    const r=hit.getBoundingClientRect();
    return {clicked:(hit.innerText||'').trim().slice(0,30),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
  })()`);
  console.log('CINFO', JSON.stringify(cInfo));
  let optLeaves = null;
  for (let i = 0; i < 15; i++) {
    optLeaves = await evalJs(`(()=>{
      const ov=document.querySelector('[data-slot="conversation.input.overlay"]');
      const t=document.body.innerText;
      const inOv=ov&&ov.innerText;
      return {ovHasTrd:!!(inOv&&inOv.includes('trading-team')),bodyHasTrd:t.includes('trading-team'),ovHasMember:!!(inOv&&inOv.includes('researcher'))};
    })()`);
    if (optLeaves && optLeaves.ovHasTrd) break;
    const menuStill = await evalJs(`(()=>{const slot=document.querySelector('[data-slot="conversation.input.overlay"]');const m=slot&&slot.querySelector('[data-trigger-menu]');return !!(m&&getComputedStyle(m).display!=='none');})()`);
    if (i === 0 && menuStill && cInfo) {
      // JS click 未展开：真鼠标兜底
      await mouseClick(cInfo.x, cInfo.y);
      await sleep(400);
      const dbg = await evalJs(`(()=>{
        const ov=document.querySelector('[data-slot="conversation.input.overlay"]');
        const m=ov&&ov.querySelector('[data-trigger-menu]');
        return {ovText:ov?(ov.innerText||'').slice(0,300):'', menuNow:!!(m&&getComputedStyle(m).display!=='none'),
          bodyTail:(document.body.innerText||'').slice(-200)};
      })()`);
      console.log('DBG', JSON.stringify(dbg));
    }
    if (i === 1 && !menuStill) {
      // 菜单被 click 关掉了：重开 '/'，用键盘导航到我们行再 Enter（真实用户热路径）
      await rawKey('/', 'Slash', 191, 0, '/');
      await sleep(900);
      for (let s = 0; s < 9; s++) await rawKey('ArrowDown', 'ArrowDown', 40, 0);
      await rawKey('Enter', 'Enter', 13, 0);
      await sleep(600);
      console.log('KBD', JSON.stringify(await evalJs(`(()=>{const ov=document.querySelector('[data-slot="conversation.input.overlay"]');return {ovText:ov?(ov.innerText||'').slice(0,200):'',hasTrd:document.body.innerText.includes('trading-team')};})()`)));
    }
    await sleep(500);
  }
  console.log('OPT', JSON.stringify(optLeaves));
  // ② 模板选项弹出后，定位 trading-team 行并真鼠标点它
  const rect = await evalJs(`(()=>{
    const ov=document.querySelector('[data-slot="conversation.input.overlay"]');
    const menu=ov&&ov.querySelector('[data-trigger-menu]');
    const root=menu||document;
    const leaves=[...root.querySelectorAll('*')].filter(e=>e.childElementCount===0&&e.textContent&&e.textContent.includes('trading-team'));
    const el=leaves[leaves.length-1];
    if(!el) return null;
    const el2=el.closest('button,[role="option"]')||el;
    const r=el2.getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),tag:el2.tagName};
  })()`);
  console.log('RECT', JSON.stringify(rect));
  if (rect) {
    await mouseClick(rect.x, rect.y);
    await sleep(800);
  }
  const after = await evalJs(`(()=>{
    const cands=[...document.querySelectorAll('textarea,[contenteditable="true"]')];
    const ed=cands.find(e=>(e.getAttribute&&e.getAttribute('placeholder')||'').includes('发消息'))||cands[0];
    const v=ed?(ed.value!=null?ed.value:(ed.innerText||ed.textContent||'')):'';
    return {v:v.slice(0,80),hasSlash:v.trim().startsWith('/trading-team'),includesTrading:v.includes('/trading-team')};
  })()`);
  console.log('AFTER', JSON.stringify(after));
  const ok = !!after && after.includesTrading;
  fs.writeFileSync(outDir + '/slash-cmd.json', JSON.stringify({ menu, rect, after, ok }, null, 1));
  console.log('OK', ok);
  ws.socket.end(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
