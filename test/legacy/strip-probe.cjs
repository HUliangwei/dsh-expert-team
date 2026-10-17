// strip-probe: conversation.view 顶部 tab 验证（user-mirror buka-assistant 机制）
// usage: node strip-probe.cjs <debugPort> <token> <outDir>
const http = require('http'); const fs = require('fs'); const crypto = require('crypto');
const [_, __, port, token, outDir] = process.argv;
const logFile = outDir + '/s.log';
function log(...a) { const l = a.join(' ') + '\n'; try { fs.appendFileSync(logFile, l); } catch (e) {} console.error(l.trim()); }
function httpGetJson(u) { return new Promise((res, rej) => { http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
class WS {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.buf = Buffer.alloc(0); this.sock = null; this.errors = []; }
  connect() { return new Promise((resolve, reject) => { const u = new URL(this.url); const key = crypto.randomBytes(16).toString('base64'); const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } }); req.on('upgrade', (_r, sock) => { this.sock = sock; sock.on('data', (chunk) => { this.buf = Buffer.concat([this.buf, chunk]); for (;;) { const m = this._decode(); if (m === null) break; let j; try { j = JSON.parse(m); } catch (e) { continue; } if (j.method === 'Runtime.exceptionThrown') this.errors.push(j.params.exceptionDetails?.exception?.description || 'exc'); if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') this.errors.push((j.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 160)); if (j.id && this.pending.has(j.id)) { const p = this.pending.get(j.id); this.pending.delete(j.id); j.error ? p.rej(new Error(JSON.stringify(j.error))) : p.res(j.result); } } }); resolve(this); }); req.on('error', reject); req.end(); }); }
  _encode(str) { const p = Buffer.from(str, 'utf8'); const mask = crypto.randomBytes(4); const x = Buffer.alloc(p.length); for (let i = 0; i < p.length; i++) x[i] = p[i] ^ mask[i % 4]; let h; if (p.length < 126) { h = Buffer.alloc(2); h[0] = 0x81; h[1] = 0x80 | p.length; } else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); } return Buffer.concat([h, mask, x]); }
  _decode() { if (this.buf.length < 2) return null; const len = this.buf[1] & 0x7f; let off = 2, size = len; if (len === 126) { if (this.buf.length < 4) return null; size = this.buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (this.buf.length < 10) return null; size = Number(this.buf.readBigUInt64BE(2)); off = 10; } if (this.buf.length < off + size) return null; const out = this.buf.slice(off, off + size).toString('utf8'); this.buf = this.buf.slice(off + size); return out; }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(id); rej(new Error('to ' + method)); }, 15000); this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } }); this.sock.write(this._encode(JSON.stringify({ id, method, params }))); }); }
}
(async () => {
  const targets = await httpGetJson('http://127.0.0.1:' + port + '/json');
  const page = targets.find((t) => t.type === 'page');
  const ws = await new WS(page.webSocketDebuggerUrl).connect();
  await ws.send('Page.enable'); await ws.send('Runtime.enable');
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await ws.send('Page.navigate', { url: 'http://127.0.0.1:3100/?token=' + token });
  const ev = async (expr) => { const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception?.description || '').slice(0, 120); return r.result?.value; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // wait for conversation mount (start page OR conversation)
  let mounted = false;
  for (let i = 0; i < 40 && !mounted; i++) { await sleep(1000); const txt = await ev('document.body ? document.body.innerText.slice(0, 4000) : ""'); if (/新会话|发送|输入|消息/.test(txt || '')) mounted = true; }
  await sleep(1000);
  // open a conversation if on the start page (click a 新会话 button)
  const opened = await ev(`(()=>{
    const cands=[...document.querySelectorAll('button')];
    const hit=cands.find(e=>(e.textContent||'').trim().replace(/\\s+/g,' ').startsWith('新会话'));
    if(!hit) return 'no-new-session-btn';
    hit.click(); return 'opened';
  })()`);
  log('OPEN-SESSION', opened);
  await sleep(2500);
  const tabs = await ev(`(()=>{
    const hits=[];
    const all=[...document.querySelectorAll('[role="tab"],[data-slot="conversation.view"],[data-slot^="conversation"],button,li,[data-key]')];
    const labels=['专家团模板','对话','轨迹','画廊','buka助理','上下文','工作台'];
    for(const e of all){
      const txt=(e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,24);
      if(labels.includes(txt)) hits.push({tag:e.tagName,slot:e.getAttribute('data-slot'),role:e.getAttribute('role'),sel:e.getAttribute('aria-selected'),txt});
    }
    const unique=[]; const seen=new Set();
    for(const h of hits){const k=h.tag+'|'+h.slot+'|'+h.txt; if(!seen.has(k)){seen.add(k); unique.push(h);} }
    return { unique, bodyHasExpertLabel: document.body.innerText.includes('专家团模板') };
  })()`);
  log('TABS', JSON.stringify(tabs));
  fs.writeFileSync(outDir + '/tabs.json', JSON.stringify(tabs, null, 1));
  // right sidebar should NOT carry our guide anymore
  const side = await ev(`(()=>({expertGuide: !!document.querySelector('[data-sidebar-right-guide-entry="expert.team"]'), anyGuide:[...document.querySelectorAll('[data-sidebar-right-guide-entry]')].map(e=>e.getAttribute('data-sidebar-right-guide-entry'))}))()`);
  log('SIDEBAR', JSON.stringify(side));
  // click the tab
  const clicked = await ev(`(()=>{
    const cands=[...document.querySelectorAll('[role="tab"],[data-slot="conversation.view"],button')];
    const hit=cands.find(e=>(e.textContent||'').trim()==='专家团模板'||((e.getAttribute('data-slot')||'').includes('conversation.view')&&(e.textContent||'').includes('专家团模板')));
    if(!hit) return 'no-tab-hit';
    hit.click(); return 'clicked:'+hit.tagName;
  })()`);
  log('CLICK', clicked);
  await sleep(1200);
  const body = await ev(`(()=>{
    const t=document.body.innerText||'';
    return { hasTitle: t.includes('智能体团队模板'), hasTeam: t.includes('trading-team')&&t.includes('交易分析团队'), hasDesc: t.includes('A股/港股/美股投资分析'), hasLead: t.includes('主理人')&&t.includes('投资分析编排'), hasMember: t.includes('researcher')&&t.includes('导入成员'), pos: t.indexOf('智能体团队模板') };
  })()`);
  log('BODY', JSON.stringify(body));
  const shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outDir + '/shot3.png', Buffer.from(shot.data, 'base64'));
  await sleep(300);
  log('ERRORS', JSON.stringify(ws.errors.slice(0, 5)));
  try { ws.sock.end(); } catch (e) {}
  setTimeout(() => process.exit(0), 200);
})().catch((e) => { log('FATAL', (e && e.message) || String(e)); try { process.exit(1); } catch (x) {} });
