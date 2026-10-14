// Resource probe for dsh-expert-team GUI (uses the same minimal CDP driver pattern as cdp-e2e.cjs).
// usage: node resource-probe.cjs <debugPort> <webPort> <token> <outDir>
// Samples twice (5s apart): Performance.getMetrics + DOM/plugin counters + timer interception,
// to surface leaks / constant burn / live timers in the team-graph page.
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const [_, __, port, webPort, token, outDir] = process.argv;
const logFile = outDir + '/probe.log';
function log(...parts) {
  const line = parts.join(' ') + '\n';
  try { fs.appendFileSync(logFile, line); } catch (e) { }
  try { console.error(line.trim()); } catch (e) { }
}
function httpGetJson(u) {
  return new Promise((res, rej) => {
    http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
class WS {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.buf = Buffer.alloc(0); }
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
      this.pending.set(id, { res, rej });
      const body = JSON.stringify({ id, method, params: params || {} });
      const buf = this._encode(body);
      this.socket.write(buf);
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const probe = `(() => { const w = window; const out = {};
  out.title = document.title;
  out.plugin = !!document.querySelector('.oetGraph, .oetCanvas, [class*="oet"]');
  out.mdots = document.querySelectorAll('.oetMdot').length;              // 残留活动光点（应为 0）
  out.tasks = document.querySelectorAll('.oetT-node').length;
  out.nodes = document.querySelectorAll('.oetC-node').length;
  out.menus = document.querySelectorAll('.oetMenu').length;
  out.graphs = document.querySelectorAll('.oetGraph').length;
  out.localStorageBytes = JSON.stringify(localStorage).length;
  let halo = 0, pulse = 0;
  document.querySelectorAll('.oetC-node circle.halo').forEach((el) => { const cs = getComputedStyle(el); if (cs.animationName === 'oetHalo') halo++; });
  document.querySelectorAll('.oetT-node.is-busy .dot').forEach((el) => { const cs = getComputedStyle(el); if (cs.animationName === 'oetPulse') pulse++; });
  out.animHalo = halo; out.animPulse = pulse;
  const els = ['pointermove','pointerup','wheel','pointerdown','click','mousemove'];
  out.listeners = {};
  els.forEach((k) => { let n = 0; document.querySelectorAll('*').forEach((el) => { try { n += (getEventListeners && getEventListeners(el) && getEventListeners(el)[k] || []).length; } catch(e){} }); out.listeners[k] = n; });
  out.perfEntries = performance.getEntriesByType('resource').length;
  const inter = w.setInterval ? 1 : 0;
  out.setIntervalOverridden = inter;
  return out; })()`;

const timers = `(() => { const w = window; if (w.__probeTimers) return w.__probeTimers;
  const t = { interval: 0, timeout: 0, intervalTotal: 0, timeoutTotal: 0 };
  const si = w.setInterval, st = w.setTimeout, ci = w.clearInterval, ct = w.clearTimeout;
  w.setInterval = function (fn, ms) { t.intervalTotal++; if (ms < 30000) t.interval++; const id = si(fn, ms); w.__is = w.__is || {}; w.__is[id] = 1; return id; };
  w.setTimeout = function (fn, ms) { t.timeoutTotal++; if (ms < 120000) t.timeout++; const id = st(fn, ms); w.__ts = w.__ts || {}; w.__ts[id] = 1; return id; };
  w.__probeTimers = t;
  return t; })()`;

const liveTimers = `(() => { const w = window; if (!w.__is && !w.__ts) return { unknown: 1 };
  let i = 0, to = 0;
  for (const k in (w.__is || {})) i++;
  for (const k in (w.__ts || {})) to++;
  return { liveInterval: i, liveTimeout: to }; })()`;

async function main() {
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { }
  const targets = await httpGetJson('http://127.0.0.1:' + port + '/json');
  const page = targets.find((t) => t.type === 'page');
  if (!page) { log('ERR no page target'); process.exit(1); }
  const ws = await new WS(page.webSocketDebuggerUrl).connect();
  await ws.send('Performance.enable').catch(() => { });
  const noNav = process.argv.includes('--no-nav');
  if (noNav) {
    // 假定当前页已由 cdp-e2e 打开到团队图谱：不导航不点击，直接测「图谱打开态」
    await sleep(2000);
    log('mode no-nav (current page, graph expected open)');
    const s = await sample('graph-open');
    const out = { s, mode: 'no-nav' };
    fs.writeFileSync(outDir + '/probe-result.json', JSON.stringify(out, null, 1));
    log(JSON.stringify(out, null, 1));
    process.exit(0);
  }
  const evalJs = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).catch(() => ({ result: {} }));
    if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception?.description || '');
    return r.result && r.result.value;
  };
  await ws.send('Page.navigate', { url: 'http://127.0.0.1:' + webPort + '/?token=' + token });
  // 等待应用就绪（body 出现会话/专家团特征）
  let states = null;
  for (let i = 0; i < 45; i++) {
    const t = String(await evalJs('document.body ? document.body.innerText.slice(0, 4000) : ""') || '');
    const sel = /选择工作区|选择一个工作区/.test(t);
    const conv = /新会话|发送|输入|消息/.test(t);
    states = { i, sel, conv, hasExpert: t.includes('专家团模板') };
    if ((states.hasExpert || states.conv) || i > 35) break;
    await sleep(1000);
  }
  // 首次启动可能停在「选择工作区」：点 默认工作区 → 继续
  if (states && states.sel) {
    await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText.includes('默认工作区'));if(b){b.click();return 1}const c=[...document.querySelectorAll('button')].find(e=>e.innerText.includes('继续'));if(c){c.click();return 1}return 0})()`);
    await sleep(1800);
  }
  // 关首启向导，点「新建会话」建立真实会话
  await evalJs(`(()=>{const f=t=>[...document.querySelectorAll('button')].find(e=>(e.innerText||'').includes(t));
    const a=f('稍后配置')||f('保存并继续');if(a){a.click();return 1}return 0})()`);
  await sleep(1200);
  await evalJs(`(()=>{const n=[...document.querySelectorAll('button')].find(b=>b.getAttribute&&(b.getAttribute('aria-label')==='新建会话'||b.getAttribute('aria-label')==='在“默认工作区”中新建会话'));if(n){n.click();return 1}return 0})()`);
  await sleep(2000);
  // 点开「Agent 管理」tab（团队图谱所在页；重复重试等 DOM）
  const openTab = `(()=>{const like=e=>{const t=(e.innerText||'').trim();return t==='Agent 管理'||t.indexOf('Agent 管理')===0||t==='Agent Management'||t.indexOf('Agent Management')===0;};
    const tab=[...document.querySelectorAll('button,[role=tab],[data-tab]')].find(like);if(!tab)return 'no-tab';tab.click();return 'tab:'+(tab.innerText||'').trim().slice(0,12);})()`;
  let opened = '';
  for (let i = 0; i < 8; i++) {
    const r = await ws.send('Runtime.evaluate', { expression: openTab, returnByValue: true }).catch(() => ({ result: {} }));
    opened = r.result && r.result.value;
    if (opened && opened.indexOf('tab:') === 0) break;
    await sleep(1500);
  }
  await sleep(2500);
  log('tab', opened || 'none');
  // 采样（函数声明：提升，供 no-nav 分支早期调用）
  function sample(tag) {
    return (async () => {
      await ws.send('Runtime.evaluate', { expression: timers, returnByValue: true }).catch(() => ({}));
      const now = await ws.send('Performance.getMetrics');
      const m = {};
      (now.metrics || []).forEach((x) => { m[x.name] = x.value; });
      const dom = await ws.send('Runtime.evaluate', { expression: probe, returnByValue: true }).catch(() => ({ result: { value: {} } }));
      const lt = await ws.send('Runtime.evaluate', { expression: liveTimers, returnByValue: true }).catch(() => ({ result: { value: {} } }));
      return {
        tag,
        jsHeapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2),
        nodes: m.Nodes,
        listeners: m.JSListeners,
        documents: m.Documents,
        taskDurationMs: +(m.TaskDuration / 1000).toFixed(1),
        scriptDurationMs: +(m.ScriptDuration / 1000).toFixed(1),
        layoutDurationMs: +(m.LayoutDuration / 1000).toFixed(1),
        styleDurationMs: +(m.StyleDuration / 1000).toFixed(1),
        dom: dom.result ? dom.result.value : {},
        live: lt.result ? lt.result.value : {},
      };
    })();
  }
  const s1 = await sample('t0 (page loaded)');
  await sleep(5000);
  const s2 = await sample('t1 (+5s idle)');

  const out = {
    s1,
    s2,
    delta: {
      jsHeapMB: +(s2.jsHeapMB - s1.jsHeapMB).toFixed(2),
      nodes: s2.nodes - s1.nodes,
      listeners: s2.listeners - s1.listeners,
      taskDurationDeltaMs: +(s2.taskDurationMs - s1.taskDurationMs).toFixed(1),
    },
  };
  fs.writeFileSync(outDir + '/probe-result.json', JSON.stringify(out, null, 1));
  log(JSON.stringify(out, null, 1));
  process.exit(0);
}
main().catch((e) => { log('ERR', e && e.stack || String(e)); process.exit(1); });
