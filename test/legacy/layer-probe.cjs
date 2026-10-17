// layer-probe: wide-viewport layering comparison — builtin files/terminal vs our expert.team tab.
// usage: node layer-probe.cjs <debugPort> <token> <outDir>
const http = require('http'); const fs = require('fs'); const crypto = require('crypto');
const [_, __, port, token, outDir] = process.argv;
const logFile = outDir + '/p.log';
function log(...a) { const l = a.join(' ') + '\n'; try { fs.appendFileSync(logFile, l); } catch (e) {} console.error(l.trim()); }
function httpGetJson(u) { return new Promise((res, rej) => { http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
class WS {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.buf = Buffer.alloc(0); this.sock = null; }
  connect() { return new Promise((resolve, reject) => { const u = new URL(this.url); const key = crypto.randomBytes(16).toString('base64'); const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } }); req.on('upgrade', (_r, sock) => { this.sock = sock; this._attach(sock); resolve(this); }); req.on('error', reject); req.end(); }); }
  _attach(sock) { sock.on('data', (chunk) => { this.buf = Buffer.concat([this.buf, chunk]); for (;;) { const m = this._decode(); if (m === null) break; const j = JSON.parse(m); if (j.id && this.pending.has(j.id)) { const p = this.pending.get(j.id); this.pending.delete(j.id); j.error ? p.rej(new Error(JSON.stringify(j.error))) : p.res(j.result); } } }); }
  _encode(str) { const p = Buffer.from(str, 'utf8'); const mask = crypto.randomBytes(4); const x = Buffer.alloc(p.length); for (let i = 0; i < p.length; i++) x[i] = p[i] ^ mask[i % 4]; let h; if (p.length < 126) { h = Buffer.alloc(2); h[0] = 0x81; h[1] = 0x80 | p.length; } else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); } else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(p.length), 2); } return Buffer.concat([h, mask, x]); }
  _decode() { if (this.buf.length < 2) return null; const len = this.buf[1] & 0x7f; let off = 2, size = len; if (len === 126) { if (this.buf.length < 4) return null; size = this.buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (this.buf.length < 10) return null; size = Number(this.buf.readBigUInt64BE(2)); off = 10; } if (this.buf.length < off + size) return null; const out = this.buf.slice(off, off + size).toString('utf8'); this.buf = this.buf.slice(off + size); return out; }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(id); rej(new Error('to ' + method)); }, 15000); this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } }); this.sock.write(this._encode(JSON.stringify({ id, method, params }))); }); }
}
(async () => {
  const targets = await httpGetJson('http://127.0.0.1:' + port + '/json');
  const page = targets.find((t) => t.type === 'page');
  const ws = await new WS(page.webSocketDebuggerUrl).connect();
  await ws.send('Page.enable');
  await ws.send('Runtime.enable');
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  await ws.send('Page.navigate', { url: 'http://127.0.0.1:3100/?token=' + token });
  const ev = async (expr) => { const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception?.description || ''); return r.result?.value; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(30000);
  const snapshot = async (tag) => {
    const s = await ev(`(()=>{
      const panel = document.querySelector('[data-sidebar-right-panel]');
      const chips = [...document.querySelectorAll('[data-sidebar-right-tab]')].map(e=>({id:e.getAttribute('data-sidebar-right-tab'),txt:(e.innerText||'').trim().replace(/\\s+/g,' ').slice(0,20)}));
      const floatHosts = document.querySelectorAll('[data-dockkit-host="float"],[data-dockkit-float]').length;
      const openDocs = [...document.querySelectorAll('[data-dockkit-pane]')].map(p=>p.getAttribute('data-dockkit-pane'));
      return { panel: panel ? panel.getAttribute('data-sidebar-right-panel') : 'none', chips, floatHosts, panes: openDocs };
    })()`);
    log(tag, JSON.stringify(s));
    return s;
  };
  // expand rightbar
  await ev(`(()=>{const b=document.querySelector('[data-sidebar-right-expand="true"]');if(b)b.click();return 1})()`);
  await sleep(1200);
  const before = await snapshot('BEFORE');
  // builtin: files card → open
  await ev(`(()=>{const b=document.querySelector('[data-sidebar-right-guide-entry="files"]');if(!b)return 0;b.click();return 1})()`);
  await sleep(1200);
  const afterFiles = await snapshot('AFTER-FILES');
  // builtin: terminal
  await ev(`(()=>{const b=document.querySelector('[data-sidebar-right-guide-entry="terminal"]');if(!b)return 0;b.click();return 1})()`);
  await sleep(1200);
  const afterTerminal = await snapshot('AFTER-TERMINAL');
  // ours
  await ev(`(()=>{const b=document.querySelector('[data-sidebar-right-guide-entry="expert.team"]');if(!b)return 0;b.click();return 1})()`);
  await sleep(1200);
  const afterOurs = await snapshot('AFTER-OURS');
  // viewport width check
  const vw = await ev('window.innerWidth + "x" + window.innerHeight');
  log('VIEWPORT', vw);
  const shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outDir + '/shot2.png', Buffer.from(shot.data, 'base64'));
  try { ws.sock.end(); } catch (e) {}
  setTimeout(() => process.exit(0), 200);
})().catch((e) => { log('FATAL', (e && e.message) || String(e)); try { process.exit(1); } catch (x) {} });
