// minimal CDP driver: wait for app restore, screenshot, probe & click dsh-expert-team UI, read draft.
// usage: node cdp-e2e.cjs <debugPort> <token> <outDir>  (outDir must exist)
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const [_, __, port, token, outDir] = process.argv;
const logFile = outDir + '/run.log';
function log(...parts) {
  const line = parts.join(' ') + '\n';
  try { fs.appendFileSync(logFile, line); } catch (e) { /* ignore */ }
  try { console.error(line.trim()); } catch (e) { /* ignore */ }
}

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
      this.pending.set(id, {
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); }
      });
      this.socket.write(this._encode(JSON.stringify({ id, method, params })));
    });
  }
}

(async function main() {
  log('start', 'port=' + port, 'out=' + outDir);
  const targets = await httpGetJson('http://127.0.0.1:' + port + '/json');
  const page = targets.find((t) => t.type === 'page');
  log('targets', targets.length, 'page=' + (page && page.webSocketDebuggerUrl ? 'yes' : 'NO'));
  const ws = await new WS(page.webSocketDebuggerUrl).connect();
  log('ws-connected');
  await ws.send('Page.enable');
  await ws.send('Runtime.enable');
  await ws.send('Log.enable');
  ws.listeners['Runtime.exceptionThrown'] = ws.listeners['Runtime.exceptionThrown'] || [];
  ws.listeners['Runtime.exceptionThrown'].push((p) => {
    try { log('EXC', (p.exceptionDetails && (p.exceptionDetails.exception?.description || p.exceptionDetails.text)) || ''); } catch (e) { /* */ }
  });
  ws.listeners['Runtime.consoleAPICalled'] = ws.listeners['Runtime.consoleAPICalled'] || [];
  ws.listeners['Runtime.consoleAPICalled'].push((p) => {
    try { if (p.type === 'error' || p.type === 'warning') log('CONSOLE', p.type, (p.args || []).map((a) => a.value || a.description || '').join(' ')); } catch (e) { /* */ }
  });
  ws.listeners['Log.entryAdded'] = ws.listeners['Log.entryAdded'] || [];
  ws.listeners['Log.entryAdded'].push((p) => {
    try { if (p.entry && p.entry.level === 'error') log('LOGERR', p.entry.text || ''); } catch (e) { /* */ }
  });
  await ws.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });
  await ws.send('Page.navigate', { url: 'http://127.0.0.1:3100/?token=' + token });
  log('navigated');
  const evalJs = async (expr) => {
    const r = await ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception?.description || '');
    return r.result?.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rawKey = async (k, code, vk, mods, text) => {
    await ws.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    if (text) await ws.send('Input.dispatchKeyEvent', { type: 'char', key: k, text, unmodifiedText: text, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await ws.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };

  let states = null;
  for (let i = 0; i < 45; i++) {
    const t = await evalJs('document.body ? document.body.innerText.slice(0, 4000) : ""');
    const sel = /选择工作区|选择一个工作区/.test(t);
    const conv = /新会话|发送|输入|消息/.test(t);
    states = { i, sel, conv, hasExpert: t.includes('专家团模板'), hasImportBtn: t.includes('＋ 导入') };
    log('poll', i, JSON.stringify(states));
    if ((states.hasExpert || states.hasImportBtn || states.conv) || i > 35) break;
    await sleep(1000);
  }
  fs.writeFileSync(outDir + '/body-state.json', JSON.stringify(states, null, 1));

  // 首次启动可能停在「选择工作区」：点 默认工作区 → 继续。
  if (states.sel) {
    const selClick = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText.includes('默认工作区'));if(b){b.click();return 'ws:'+b.innerText.trim();}const c=[...document.querySelectorAll('button')].find(e=>e.innerText.includes('继续'));if(c){c.click();return 'continue';}return 'no-sel-btns';})()`);
    log('selClick', selClick);
    await sleep(1800);
  }

  // ① 规范要求：不再有独立的「＋ 导入」按钮（入口改挂输入框「+」/「/」菜单）。
  const btnDump = await evalJs(`([...document.querySelectorAll('button')].map(b=>b.innerText||'').filter(t=>t.trim()).slice(0,40))`);
  log('buttons', JSON.stringify(btnDump));
  const hasImportBtn = (btnDump || []).some((s) => s.includes('＋ 导入') || s.includes('导入'));
  log('hasImportBtn', hasImportBtn);
  const headerProbe = await evalJs(`(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.childElementCount===0&&e.textContent&&e.textContent.includes('专家团'));return els.map(e=>e.tagName+':'+e.textContent.trim().slice(0,20)).slice(0,6);})()`);
  log('headerProbe', JSON.stringify(headerProbe));

  // 关掉首启向导（稍后配置/保存并继续），点「新会话」建立真实会话（host 命令目录需要保留会话）。
  const dismiss = await evalJs(`(()=>{const a=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('稍后配置'));if(a){a.click();return 'later';}const s=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('保存并继续'));if(s){s.click();return 'save-and-continue';}return 'no-wizard';})()`);
  log('dismiss', dismiss);
  await sleep(1200);
  const fresh = await evalJs(`(()=>{const n=[...document.querySelectorAll('button')].find(b=>b.getAttribute&&(b.getAttribute('aria-label')==='新建会话'||b.getAttribute('aria-label')==='在“默认工作区”中新建会话'));if(n){n.click();return 'new-session:'+n.getAttribute('aria-label');}return 'no-newbtn';})()`);
  log('fresh', fresh);
  await sleep(1800);

  // ② 焦点进输入框，敲「/」打开指令菜单（与「+」同一 trigger 菜单）→ 找栏目 → 选模板 → 草稿。
  let focus = null;
  for (let i = 0; i < 6; i++) {
    focus = await evalJs(`(()=>{
      const cands=[...document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable=""]')];
      const el=cands.find(e=>(e.getAttribute&&e.getAttribute('placeholder')||'').includes('发消息'))
        || cands.find(e=>e.tagName==='TEXTAREA') || cands[0];
      if(!el) return 'no-editor';
      el.focus();
      const sel=el.ownerDocument&&el.ownerDocument.getSelection&&el.ownerDocument.getSelection();
      if(sel&&el.nodeType===1){try{const r=el.ownerDocument.createRange();r.selectNodeContents(el);r.collapse(false);sel.removeAllRanges();sel.addRange(r);}catch(e){}}
      return 'focused:'+el.tagName+':'+((el.getAttribute&&el.getAttribute('placeholder'))||'');
    })()`);
    if (focus && focus !== 'no-editor') break;
    await sleep(800);
  }
  log('focus', focus);
  let menu = null, menuDom = null, rowClick = null, popup = null, optClick = null, draft = null;
  // ② 真实用户路径：点输入框「+」（aria-label=添加文件或调用指令）→ 指令菜单
  //    （与「/」同一 trigger 菜单）→ 找栏目 → 选模板 → 草稿。
  const plus = await evalJs(`(()=>{const b=document.querySelector('button[aria-label="添加文件或调用指令"]');if(!b)return 'no-plus';b.click();return 'clicked-plus';})()`);
  log('plus', plus);
  // plus 首次打开可能落在「最近会话」列表；Esc 重开直到指令菜单展开（host 行需滚动到列表深处）。
  const esc = () => evalJs(`(()=>{document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 1;})()`).catch(()=>{});
  for (let attempt = 0; attempt < 6; attempt++) {
    menu = null;
    for (let i = 0; i < 20; i++) {
      menu = await evalJs(`(()=>{const ov=document.querySelector('[data-slot="conversation.input.overlay"]');const t=ov?ov.innerText:'';return {ov:!!ov,hasCommands:t.includes('指令'),hasHost:t.includes('expert-import'),hasImportRow:t.includes('导入成员和专家团'),expert:t.includes('expert-import')};})()`);
      log('menu-poll', attempt + '/' + i, JSON.stringify(menu));
      if (menu && (menu.hasHost || menu.hasCommands)) break;
      await sleep(500);
    }
    if (menu && menu.hasHost) break;
    if (menu && menu.hasCommands) {
      // 指令区展开但 host 行未渲染 → 滚动后再看
      const rolled = await evalJs(`(()=>{const ov=document.querySelector('[data-slot="conversation.input.overlay"]');const menu=ov&&ov.querySelector('[data-trigger-menu]');if(!menu)return false;for(let i=0;i<16;i++){menu.scrollTop=menu.scrollHeight;}return (menu.innerText||'').includes('expert-import');})()`);
      if (rolled) { menu.hasHost = true; break; }
    }
    await esc(); await sleep(500);
    await evalJs(`(()=>{const b=document.querySelector('button[aria-label="添加文件或调用指令"]');if(b){b.click()}return 1;})()`).catch(()=>{});
    await sleep(900);
  }
    fs.writeFileSync(outDir + '/menu-state.json', JSON.stringify(menu, null, 1));
    const menuDomRaw = await evalJs(`(()=>{
      const ov=document.querySelector('[data-slot="conversation.input.overlay"]');
      const rows=ov?[...ov.querySelectorAll('*')].filter(e=>e.childElementCount===0&&e.textContent&&e.textContent.trim()).map(e=>e.tagName+':'+e.textContent.trim().slice(0,50)):[];
      const ae=document.activeElement;
      const ed=document.querySelector('[data-slot="conversation.draft"]')||ae;
      let draftText='';
      if(ed){ if(typeof ed.value==='string') draftText=ed.value; else draftText=ed.innerText||ed.textContent||''; }
      const plusBtns=[...document.querySelectorAll('button')].map(b=>({t:(b.innerText||'').trim().slice(0,20),al:b.getAttribute&&b.getAttribute('aria-label'),tt:b.getAttribute&&b.getAttribute('title')})).filter(x=>x.al||x.tt||x.t.includes('+')||x.t.includes('加'));
      const t=document.body.innerText;
      return { ovExists:!!ov, rows: rows.slice(0,40), active:ae?ae.tagName+'.'+String(ae.className||'').slice(0,40):'', draftText:String(draftText).slice(0,80), plusBtns:plusBtns.slice(0,12), hasHost:t.includes('expert-import'), hasImportRow:t.includes('导入成员和专家团'), hasCompact:t.includes('压缩'), hasPerm:t.includes('权限'), hasModel:t.includes('模型'), hasAdd:t.includes('添加') };
    })()`);
    menuDom = menuDomRaw;
    log('menuDom', JSON.stringify(menuDom, null, 1));
    fs.writeFileSync(outDir + '/menu-dom.json', JSON.stringify(menuDom, null, 1));

    // Round 23：/ 指令菜单（command 行）不得被折叠包裹、不得注入导入智能体组
    const slashClean = await evalJs(`(()=>{const ov=document.querySelector('[data-slot="conversation.input.overlay"]');const menu=ov&&ov.querySelector('[data-trigger-menu]');if(!menu)return {menu:false};return {grpN:menu.querySelectorAll('[data-oet-grp]').length,impN:menu.querySelectorAll('[data-oet-import-group]').length,heads:[...menu.querySelectorAll('[class*="sectionTitle"]')].map(h=>(h.textContent||'').trim().replace(/\\s+/g,' ')).slice(0,6)};})()`);
    log('slash-clean', JSON.stringify(slashClean));

    // Round 28c：菜单里只认宿主 /expert-import 指令行（kantu 同款）——不再有任何
    // 本插件 commandUi 弹层行（「导入成员和专家团」已按用户要求移除）。
    // 宿主把未列表指令排在指令区最底部 → 先滚动菜单到底再取证（innerText 判定，
    // 虚拟列表叶子元素不可靠）。
    const hostRow = await evalJs(`(()=>{
      const ov=document.querySelector('[data-slot="conversation.input.overlay"]');
      const menu=ov&&ov.querySelector('[data-trigger-menu]');
      if(!menu) return {menu:false};
      for(let i=0;i<16;i++){menu.scrollTop=menu.scrollHeight;}
      const txt=menu.innerText||'';
      const descM=txt.match(/expert-import[^\\n]*((?:\\n|.){0,120})/);
      return {menu:true, hasHostRow:txt.includes('expert-import'), hasHostDesc:txt.includes('--ctx fresh|fork')&&txt.includes('--model'), hostDescText:descM?descM[1].replace(/\\s+/g,' ').trim().slice(0,120):'', hasImportRow:txt.includes('导入成员和专家团')};
    })()`);
    log('hostRow', JSON.stringify(hostRow));
    fs.writeFileSync(outDir + '/host-row.json', JSON.stringify(hostRow, null, 1));
  fs.writeFileSync(outDir + '/btn-dump.json', JSON.stringify(btnDump, null, 1));

  // ⑩ 换轨后断言（headless 空白会话不渲染 conversation.view 条，用服务端 bundle 标记做真断言）：
  //    主挂点 conversation.view / expert-team-templates 在、order 30；侧栏托盘注册已移除
  //    （sidebarRightTabs / sidebar.right.pane.tab 不应再出现在 bundle 里）。
  const bundle = await evalJs(`(async()=>{
    const name=(performance && performance.getEntriesByType) ? (performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('dsh-expert-team'))||'') : '';
    if(!name) return { err: 'no-bundle-resource' };
    const rev=(name.match(/rev=([0-9a-f]+)/)||[])[1]||'';
    // 先试单模块 URL；不行退整包（整包含 sidebar-right 自身源码，侧栏断言只对单模块有意义）
    let txt='', mode='';
    // 整包合并资源即服务端内容（单模块 URL 本版本 404，无需尝试）
    const r=await fetch(name); txt=await r.text(); mode='grouped';
    return {
      mode,
      view: txt.includes('conversation.view'),
      id: txt.includes('expert-team-templates'),
      order30: txt.includes('order: 30'),
      noPaneSeats: !txt.includes('sidebar.right.pane.tab'),
      hasCommandUi: txt.includes('commandUi'),
      hasNoNativeMentionUpgrade: !txt.includes('installNativeMentionUpgrade') && !txt.includes('data-trigger-menu') && !txt.includes('data-oet-grp-'),
      hasNoOverlay: !txt.includes('installMentionOverlay') && !txt.includes('oetMentionOv') && !txt.includes('MENTION_OV_CLASS')
    };
  })()`);
  log('bundle', JSON.stringify(bundle));
  fs.writeFileSync(outDir + '/bundle-marks.json', JSON.stringify(bundle, null, 1));

  // 运行时：样式标签注入在 apply 即发生（tab 不在空会话渲染，但注入可断言）
  const runtimeStyleTag = await evalJs(`(()=>{const s=document.head.querySelector('style[data-plugin-css="dsh-expert-team-tab"]');return {tag:!!s, hasGrid:!!s && s.textContent.includes('.oetGrid'), hasHover:!!s && s.textContent.includes('.oetCard:hover'), hasFocus:!!s && s.textContent.includes(':focus-visible'), hasBtn:!!s && s.textContent.includes('.oetBtn:hover'), hasPage:!!s && s.textContent.includes('.oetPageSwitch') && s.textContent.includes('.oetTcard'),
      hasNoOverlayCss:!!s && !s.textContent.includes('oetMentionOv'),
      hasNoAtMenuCss: !!s && !s.textContent.includes('data-trigger-menu') && !s.textContent.includes('oetGrpChev') && !s.textContent.includes('data-oet-grp')};})()`);
  log('runtimeStyleTag', JSON.stringify(runtimeStyleTag));
  fs.writeFileSync(outDir + '/runtime-style.json', JSON.stringify(runtimeStyleTag, null, 1));

  // 无构建链（ModuleLoader 直吐 lib/client.js），本地文件 == 服务端内容；
  // 侧栏托盘移除以「我们代码里不再有该槽串」断言（整包合并资源含 sidebar-right 自身源码，不能在此层面断言）。
  const local = fs.readFileSync(__dirname + '/../lib/client.js', 'utf8');
  const serverLocal = fs.readFileSync(__dirname + '/../lib/index.js', 'utf8');
  const localMarks = {
    hasViewId: local.includes('expert-team-templates'),
    hasConversationViewInject: local.includes('ctx.slots.inject("conversation.view"'),
    hasOrder30: local.includes('order: 30'),
    hasNoCommandUiContribution: !local.includes('commandUi.register') && !local.includes('installImportContribution'),
    hasNoCommandUiInject: !local.includes('ctx.inject(["commandUi"]'),
    hasNoMenuShell: !local.includes('"menu.label"') && !local.includes('"menu.desc"') && !local.includes('"menu.hint.team"'),
    hasTabTools: local.includes('function fileAddressFor(') && local.includes('openTemplateEdit') && local.includes('PLUGIN_WORKSPACE_PREFIX') && local.includes('"panel.path"') && local.includes('tabSessionId') && local.includes('"sidebarRight"') && local.includes('member.json'),
    hasCardCss: local.includes('oetGrid') && local.includes('oetCard:hover') && local.includes(':focus-visible') && local.includes('oetBtn:hover') && local.includes('injectTabStyles') && local.includes('pressEnter') && local.includes('role: "button"') && local.includes('tabIndex: 0') && local.includes('"panel.edit.aria"') && local.includes('is-member'),
    hasAgentTabs: local.includes('"Agent 管理"') && local.includes('"panel.page.teams"') && local.includes('"panel.page.individuals"') && local.includes('"panel.func.research"') && local.includes('"panel.func.content"') && local.includes('teamCard') && local.includes('toggleTeam') && local.includes('oetPageSwitch') && local.includes('oetTcard') && local.includes('MEMBER_FUNC_ORDER') && local.includes('aria-pressed') && local.includes('oetExpBody'),
    hasContentTeam: local.includes('ai-content-creator-team') && local.includes('SHIPPED_TEAMS.map(teamCard)') && local.includes('创意总监') && local.includes('素材改编') && local.includes('ai-content-production'),
    hasGameExperts: local.includes('game-dev-team') && local.includes('narrative-designer') && local.includes('godot-shader-developer') && local.includes('ui-designer') && local.includes('"panel.func.game"') && local.includes('"content", "game"') && local.includes('叙事设计师'),
    hasTeamCardRich: local.includes('TEAM_BADGE') && local.includes('oetTbadge') && local.includes('oetChips') && local.includes('oetChip') && !local.includes('oetKind member" }, t("import.member")') && local.includes('oetKind member" }, t("panel.members")'),
    hasNoMentionUpgrade: !local.includes('installNativeMentionUpgrade') && !local.includes('nativeMenuNow') && !local.includes('injectImportGroup') && !local.includes('lastMentionAt') && !local.includes('buildMentionSections') && !local.includes('data-trigger-menu') && !local.includes('data-oet-grp') && !local.includes('oetGrpChev') && !local.includes('panel.mention') && !local.includes('installMentionOverlay') && !local.includes('oetMentionOv'),
    hasCmdRoute: local.includes('deployDraft') && local.includes('"/expert-import " + name') && !local.includes('installImportContribution'),
    hasGraphPage: local.includes('"panel.page.current"') && local.includes('"current"') && local.includes('h(CurrentTeamCanvas'),
    hasGraphCss: local.includes('oetC-node') && local.includes('oetHalo') && local.includes('oetMdot') && local.includes('oetC-edge'),
    hasGraphStore: local.includes('sessions.list') && local.includes('listStore.subscribe') && local.includes('projectionsBySession') && local.includes('values.agentTeam'),
    hasGraphCircle: local.includes('CV_R') && local.includes('"body"') && local.includes('stdot') && local.includes('oetC-node is-lead') && local.includes('cvNavName') && local.includes('svgPoint'),
    hasRealPulse: local.includes('function spawnMdot') && local.includes('el.animate') && local.includes('getScreenCTM') && local.includes('"oetMdot"') && local.includes('anim.finished') && local.includes('last.__boot') && local.includes('chained') && local.includes('runNow ? "out" : "in"') && !local.includes('animateMotion'),
    hasTaskNodes: local.includes('oetT-node') && local.includes('TASK_ZONE') && local.includes('taskCardPos') && local.includes('team.tasks') && local.includes('taskOwner') && local.includes('last.__tasks') && local.includes('"oetT-edge"') && local.includes('CV_CX') && local.includes('ow && busy') && local.includes('togglePin') && local.includes('loadTaskPins') && local.includes('is-pinned') && local.includes('is-selected') && local.includes('"📌 取消置顶"') && local.includes('badgeTxt') && local.includes('oetMenuFaceEmoji') && local.includes('is-done') && local.includes('.oetT-node:hover') && local.includes('closest(".oetT-node")') && !local.includes('pinCheck') && !local.includes('cvTaskPos'),
    hasMemberName: local.includes('rr.displayName || mr.displayName || mr.name') && !local.includes('rr.displayTitle || rr.title'),
    hasTaskMenu: local.includes('"task:" + tk.id') && local.includes('taskMenuEl') && local.includes('"/expert-task claim "') && local.includes('"/expert-task complete "') && local.includes('"/expert-task delete "') && local.includes("'/expert-task edit '") && local.includes('"/expert-task create \\"') && local.includes('mode: "owner"') && local.includes('oetMenuWrap') && serverLocal.includes('"expert-task"') && serverLocal.includes('createTask') && serverLocal.includes('action: "reassign"') && serverLocal.includes('"--desc"'),
    hasAvatarFace: local.includes('avatarFace') && local.includes('"face"') && local.includes('clipPath: "url(#cvFace-') && local.includes('preserveAspectRatio: "xMidYMid slice"') && local.includes('templates/avatars'),
    hasCompactCanvas: !local.includes('var W = 780') && !local.includes('var W = 660') && local.includes('var W = 620') && local.includes('Math.max(285, 175 + members.length * 28)') && local.includes('Math.min(158, 44 + members.length * 14)') && local.includes('graph-v4-') && local.includes('max-height: 56vh'),
    hasNodeMenu: local.includes('stMenu') && local.includes('openMenu') && local.includes('commitRename') && local.includes('.oetMenu') && local.includes('oetMenuBtn') && local.includes('catalog.rename'),
    hasMemberCmdClient: local.includes('"/expert-member archive "') && local.includes('"/expert-member restock "') && local.includes('"rename"') && local.includes('oetMenuFoot'),
    hasCanvasDismiss: local.includes('closest(".oetC-node")') && local.includes('closest(".oetT-node")') && local.includes('closest(".oetMenu")') && local.includes('if (menu) closeMenu()'),
    hasRetitleAll: local.includes('AUTO_TITLES') && local.includes('localStorage.getItem(doneKey)') && local.includes('dsh-expert-team-title-') && local.includes('catalog.rename(m2.id, fr)'),
    hasLeadCreateMenu: local.includes('oetMenuLead') && local.includes('menu.name === "lead"') && local.includes('oetMenuGrid') && local.includes('SHIPPED_TEAMS.map') && local.includes('"/expert-import " + tt.name') && local.includes('oetMenuLabel'),
    hasOpenConversation: local.includes('openMemberConversation') && local.includes('uiWorkspace.openSession') && local.includes('mode: "continuable"') && local.includes('"🔗 打开对话"'),
    hasArchiveBrowse: serverLocal.includes('"archive-list"') && serverLocal.includes('"restore"') && serverLocal.includes('readdirSync') && local.includes('"📂 归档浏览"') && local.includes('setComposerDraft(pluginCtx, sid(), text)') && local.includes('navigator.clipboard'),
    hasDomDraft: local.includes('function domSetDraft') && local.includes('Object.getPrototypeOf(el)') && local.includes('return domSetDraft(text)') && local.includes('InputEvent'),
    hasFullMemberMenu: local.includes('oetMenuGridScroll') && local.includes('SHIPPED_MEMBERS.length') && !local.includes('SHIPPED_MEMBERS.slice(0, 8)'),
    hasLeadConvTitle: local.includes('cvNavName(leadRow.displayTitle') && local.includes('var leadRow = byId[leadId]'),
    hasCreationNorm: local.includes('AVATAR_ALIAS') && local.includes('charAvatar') && local.includes('runTop') && local.includes('top-title-sub') && local.includes('friendlyTitle(m2.name)'),
    hasCurrentTeamDefault: local.includes('react.useState("current")') && local.includes('"当前团队"') && local.includes('"Current team"') && (function () { var a = local.indexOf("var svgRef = react.useRef(null)"); var b = local.indexOf("空态（必须在本组件所有 hooks 之后返回"); return a > 0 && b > 0 && a < b; })(),
    hasMemberServer: serverLocal.includes('createMemberCommand') && serverLocal.includes('snapshotMember') && serverLocal.includes('ARCHIVE_ROOT') && serverLocal.includes('archive/') && serverLocal.includes('row.status === "running"') && serverLocal.includes('"expert-member"'),
    hasCreateBtn: local.includes('"panel.create"') && local.includes('mentionCmd("team", team.name)') && local.includes('mentionCmd("member", m.name)') && local.includes('"/expert-import " + name') && !local.includes('panel.summon') && !local.includes('importCmd('),
    noImportBtnCode: !local.includes('slots.inject("conversation.input.left"') && !local.includes('function InputImport'),
    noHeaderSeat: !local.includes('ctx.slots.inject("conversation.session.header.actions"') && !local.includes('function HeaderAction(') && !local.includes('"panel.written"'),
    noPaneSeats: !local.includes('sidebar.right.pane.tab')
  };
  log('local', JSON.stringify(localMarks));
  fs.writeFileSync(outDir + '/local-marks.json', JSON.stringify(localMarks, null, 1));

  // ⑪ 运行时 @ 提及（Round 24 定稿：@ 菜单零修改——原生原样；创建入口是 / 指令菜单）：
  //    清空输入框 → 真实按键 @ → 断言【原生菜单 [data-trigger-menu] 出现、里面没有我们
  //    的任何节点（[data-oet-grp] / [data-oet-grp-body] / [data-oet-import-*] / oetGrpChev）、
  //    也没有 .oetMentionOv 浮层】→ 按 Esc 关菜单 → 输入框仍是空（未被动过）。
  const mentionClear = await evalJs(`(()=>{
    const cands=[...document.querySelectorAll('textarea,[contenteditable="true"]')];
    const el=cands.find(e=>(e.getAttribute&&e.getAttribute('placeholder')||'').includes('发消息'))||cands.find(e=>e.tagName==='TEXTAREA')||cands[0];
    if(!el) return 'no-editor';
    el.focus();
    return 'focused:'+el.tagName;
  })()`);
  log('mention-clear', mentionClear);
  // 清空：Ctrl+A + Delete（真实按键，走壳层真正的 draft 管线）
  await rawKey('a', 'KeyA', 65, 2);
  await rawKey('Delete', 'Delete', 46, 0);
  await sleep(400);
  // ① 真实 '@' (Shift+2)：原生菜单在、零注入、无浮层
  await rawKey('@', 'Digit2', 50, 8, '@');
  await sleep(1000);
  const mentionBare = await evalJs(`(()=>{
    const slot=document.querySelector('[data-slot="conversation.input.overlay"]');
    const menu=slot&&slot.querySelector('[data-trigger-menu]');
    if(!menu) return {nat:false};
    const st=getComputedStyle(menu);
    if(st.display==='none'||st.visibility==='hidden') return {nat:false,hidden:true};
    const heads=[...menu.querySelectorAll('[class*="sectionTitle"]')].map(h=>h.textContent.trim().replace(/\\s+/g,' '));
    return {nat:true, heads,
      noOetGrp: !menu.querySelector('[data-oet-grp],[data-oet-grp-import],.oetGrpChev'),
      noOetBody: !menu.querySelector('[data-oet-grp-body],[data-oet-import-body],[data-oet-import-group]'),
      hasNoOv: !document.querySelector('.oetMentionOv')};
  })()`);
  log('mention-bare', JSON.stringify(mentionBare));
  const bareOk = !!mentionBare && mentionBare.nat && mentionBare.noOetGrp && mentionBare.noOetBody && mentionBare.hasNoOv;
  // ② Esc 关菜单；输入框未被我们改过（仍空）
  await rawKey('Escape', 'Escape', 27, 0);
  await sleep(500);
  const mentionAfter = await evalJs(`(()=>{
    const cands=[...document.querySelectorAll('textarea,[contenteditable="true"]')];
    const el=cands.find(e=>(e.getAttribute&&e.getAttribute('placeholder')||'').includes('发消息'))||cands[0];
    const v=el?(el.value!==undefined?el.value:(el.innerText||'')):'';
    const menu=document.querySelector('[data-slot="conversation.input.overlay"] [data-trigger-menu]');
    return {after:v.slice(0,60),onlyAt:v.trim()==='@',noInjected:!/(@|)[a-z][a-z0-9-]{3,}/.test(v) && !v.includes('@@'),menuClosed:!menu || getComputedStyle(menu).display==='none',
      hasNoOv: !document.querySelector('.oetMentionOv')};
  })()`);
  log('mention-after', JSON.stringify(mentionAfter));
  const mentionOk = !!bareOk && !!mentionAfter && mentionAfter.onlyAt && mentionAfter.noInjected && mentionAfter.menuClosed && mentionAfter.hasNoOv;
  log('mention', JSON.stringify({ ok: !!mentionOk }));
  fs.writeFileSync(outDir + '/mention.json', JSON.stringify({ cleared: mentionClear, bare: mentionBare, after: (mentionAfter && mentionAfter.after) || '', ok: !!mentionOk }, null, 1));

  // Round 23c：卡片「创建」= 以 @ 方式创建。开「Agent 管理」tab → 团队卡【创建】→
  // 草稿应含 @trading-team。（软探针：日志取证，不阻断主流程）
  const cardProbe = await evalJs(`(()=>{
    const like=e=>{const t=(e.innerText||'').trim();return t==='Agent 管理'||t==='Agent Management'||t.indexOf('Agent 管理')===0||t.indexOf('Agent Management')===0;};
    const cands=[...document.querySelectorAll('button,[role="tab"],div')].filter(like);
    cands.sort((a,b)=>a.textContent.length-b.textContent.length);
    const tab=cands.find(e=>e.tagName!=='DIV'||e.getAttribute('role')==='tab')||cands[0];
    if(tab){tab.click();window.__oetCardTab=tab.tagName+':'+(tab.className||'')+':'+tab.textContent.trim().slice(0,20);}
    else{window.__oetCardTab='';}
    return {tab:window.__oetCardTab,cands:cands.slice(0,3).map(e=>e.tagName+':'+e.textContent.trim().slice(0,20))};
  })()`);
  let cardSt = null;
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    cardSt = await evalJs(`(()=>{
      const createBtns=[...document.querySelectorAll('.oetTcard button, .oetGrid button, button')].filter(b=>(b.innerText||'').trim()==='创建'||(b.innerText||'').trim()==='Create');
      return {cards:document.querySelectorAll('.oetTcard').length, createN:createBtns.length};
    })()`);
    if (cardSt.createN > 0 || i === 11) break;
  }
  log('card-poll', JSON.stringify(cardSt));
  const cardAfter = await evalJs(`(()=>{
    const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='创建'||(x.innerText||'').trim()==='Create');
    if(!b) return {clicked:false};
    b.click();
    const draft=()=>{const ed=document.querySelector('[data-slot="conversation.draft"]');return ed?(ed.value!=null?ed.value:(ed.innerText||ed.textContent||'')):'';};
    return {clicked:true, btnText:(b.innerText||'').trim()};
  })()`);
  await sleep(800);
  const cardDraft = await evalJs(`(()=>{const ed=document.querySelector('[data-slot="conversation.draft"]');const v=ed?(ed.value!=null?ed.value:(ed.innerText||ed.textContent||'')):'';return {v:v.slice(0,80),hasSlash:v.includes('/expert-import trading-team'),hasCtx:v.includes('--ctx'),hasAnyCmd:new RegExp('/[a-z0-9-]').test(v)};})()`);
  log('card-after', JSON.stringify({ probe: cardProbe, state: cardSt, click: cardAfter, draft: cardDraft }));
  fs.writeFileSync(outDir + '/card-create.json', JSON.stringify({ probe: cardProbe, state: cardSt, click: cardAfter, draft: cardDraft }, null, 1));

  const shot = await ws.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outDir + '/shot.png', Buffer.from(shot.data, 'base64'));
  fs.writeFileSync(outDir + '/body-after.txt', ((await evalJs('document.body.innerText.slice(0, 1500)')) || '').toString());
  log('done');
  try { ws.socket.end(); } catch (e) { /* */ }
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { log('FATAL', (e && e.message) || String(e)); try { ws.socket.end(); } catch (x) { /* */ } setTimeout(() => process.exit(1), 300); });
