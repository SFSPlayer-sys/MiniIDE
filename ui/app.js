const $ = id => document.getElementById(id);

const treeEl=$('tree'), tabsEl=$('tabs'), hlEl=$('hl'), taEl=$('input'), gutterEl=$('gutter'),
      termTabs=$('termTabs'), termBodies=$('termBodies'), terminalEl=$('terminal'), sidebarEl=$('sidebar'),
      stRoot=$('stRoot'), stPos=$('stPos'), stLang=$('stLang'), toastEl=$('toast'), toastMsg=$('toastMsg'),
      ctxEl=$('ctx'), maskEl=$('mask'), dlgInput=$('dlgInput'), dlgTitle=$('dlgTitle'), tabRun=$('tabRun');

const sideTitle=$('sideTitle'), searchView=$('searchView'), searchInput=$('searchInput'),
      searchResults=$('searchResults'), srRe=$('srRe'), srCase=$('srCase'), srWord=$('srWord'),
      replaceInput=$('replaceInput'), srReplaceOne=$('srReplaceOne'), srReplaceAll=$('srReplaceAll'),
      fileMenuEl=$('fileMenu'), runMenuEl=$('runMenu'), edMenuEl=$('edMenu'), termToolsEl=$('termTools'),
      chatEl=$('chat'), chatBody=$('chatBody'), chatText=$('chatText'), chatSend=$('chatSend'), chatH=$('chatH'),
      chatImgs=$('chatImgs'),
      chatModel=$('chatModel'), chatHint=$('chatHint'), chatUp=$('chatUp'), setMask=$('setMask'), setNav=$('setNav'),
      mdlList=$('mdlList'), mdlAdd=$('mdlAdd'), setPrompt=$('setPrompt'),
      setTemp=$('setTemp'), setMaxTok=$('setMaxTok'), setExtra=$('setExtra'), setHistory=$('setHistory'),
      setFont=$('setFont'), setTab=$('setTab'), setUndo=$('setUndo'),
      setFontFamily=$('setFontFamily'), setTheme=$('setTheme'), customBox=$('customBox'), themeDel=$('themeDel'),
      cAccent=$('cAccent'), cSide=$('cSide'), cBg=$('cBg'), cText=$('cText'),
      cKeyword=$('cKeyword'), cType=$('cType'), cString=$('cString'), cNumber=$('cNumber'),
      cComment=$('cComment'), cFunc=$('cFunc'), cErr=$('cErr'),
      runList=$('runList'), runScan=$('runScan'),
      resTransEl=$('resTrans'), setLangEl=$('setLang'), setShellEl=$('setShell'),
      resListEl=$('resList'), lspListEl=$('lspList'),
      probTabsEl=$('probTabs'), probListEl=$('probList'), probScanEl=$('probScan'),
      panelOutEl=$('panelOut'), panelOutBox=$('panelOutBox'), outBody=$('outBody'),
      pvBtn=$('pvBtn'), pvEl=$('preview'),
      npMask=$('npMask'), npLang=$('npLang'), npTmpl=$('npTmpl'), npDir=$('npDir'), npName=$('npName');
const openMask=$('openMask'), openMsg=$('openMsg');
const findBar=$('findBar'), findInput=$('findInput'), findCount=$('findCount'),
      findPrevBtn=$('findPrev'), findNextBtn=$('findNext'), findCase=$('findCase'), findWord=$('findWord'),
      findRe=$('findRe'), findTogRep=$('findTogRep'), findCloseBtn=$('findClose'), findRepRow=$('findRepRow'),
      findRepInput=$('findRepInput'), findRepOneBtn=$('findRepOne'), findRepAllBtn=$('findRepAll'),
      outlineView=$('outlineView'), outlineList=$('outlineList'),
      gitView=$('gitView'), gitBranchEl=$('gitBranch'), gitAbEl=$('gitAb'), gitRefreshBtn=$('gitRefresh'),
      gitMsg=$('gitMsg'), gitCommitBtn=$('gitCommit'), gitPullBtn=$('gitPull'), gitPushBtn=$('gitPush'), gitList=$('gitList');

const contentEl = document.querySelector('.content');
const editorEl = document.querySelector('.editor');
const codeAreaEl = document.querySelector('.code-area');

//无webview时改用HTTP桥与本地服务通信
const BRIDGE = !window.ipc;
const send = (...a) => {
  const s = a.join('\u0001');
  if (window.ipc) {
    window.ipc.postMessage(s);
    return;
  }
  fetch('/ipc', { method: 'POST', body: s }).catch(() => {});
};
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const baseName = p => p.split(/[\\/]/).filter(Boolean).pop() || p;
const dirName = p => {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i <= 0 ? p : p.slice(0, i);
};
//相对当前打开的文件夹的路径
const relPath = p => root && p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, '') : p;

let root = '';
let active = null;
let hlTimer = 0, hlAt = 0;
let gutterSig = '';
let ctxDir = '';
let selPath = '';
let selPaths = new Set();
let selDir = false;
let previewOn = false;

let probMode = 'ws';
let curProb = [];
let wsProb = [];
let lspDiag = {};   //path -> 语言服务器报的问题

let pendingLine = null;
let openPend = '';        //等待确认以文本打开的文件
let execResolve = null;   //等待命令输出
let cur = null;           //流式中的助手消息
let aiErr = '';
let summarizing = false;  //正在总结超限的上下文
let sumBuf = '';          //总结阶段的流式文本
let sumTried = false;     //本轮是否已总结过，避免死循环
let toolRounds = 0;
let toolCallSeq = 0;
let pendImgs = [];        //待发送的图片附件
const chatQueue = [];
let chatBusy = false;
let aiAbort = false;      //用户已点停止，忽略后续回执
let renderTimer = 0;
let searchTimer = 0;

//当前侧栏视图
let curView = 'explorer';
const FIND_MAX = 2000;
let findOpenFlag = false, findRanges = [], findCur = -1;
let semRanges = [], inlayMarks = [], outlineSyms = [];
let sigWant = false, sigIdx = 0, sigCount = 0, sigItems = [];
let semTimer = 0, inlayTimer = 0, outlineTimer = 0, hoverTimer = 0;
const statSeen = {};

//git面板状态，busy保证同一时刻只有一条git命令在跑
let gitWait = null, gitBusy = false, gitState = null, gitTick = 0, gitRoot = '', gitSeq = 0;

//AI提示词资源来自 ui/prompts.js，由后端在页面加载前注入
const PROMPTS = window.AI_PROMPTS;


//取当前语言的文案，缺项回落到简中
function t(k, a) {
  const m = I18N[cfg.lang] || I18N['zh-CN'];
  let s = m[k] || I18N['zh-CN'][k] || k;
  if (a !== undefined) s = s.replace('{1}', a);
  return s;
}

//刷新界面上的静态文案
function applyLang() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) {
    el.placeholder = t(el.dataset.i18nPh);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  //侧栏标题跟随当前视图，不被上面的静态文案覆盖
  sideTitle.textContent = curView === 'debug' ? t('dbg') : t(curView);
  renderOutline();
  renderGit();
  if (!root) stRoot.textContent = t('noFolder');
  renderModelList();
  renderRuns();
  renderShells();
  renderResConf();
  renderLsp();
  renderDbg();
  renderProblems();
  renderLangs();
  renderThemeSelect();
  renderNewProj();
  syncPreview();
  updateStatus();
}

//资源地址，缺项用默认值
function resConf() {
  const r = cfg.res || {};
  const out = {};
  for (const k in RES_DEF) out[k] = r[k] || RES_DEF[k];
  return out;
}

//资源地址逐项编辑，留空即用默认值
function renderResConf() {
  const r = resConf();
  let h = '';
  for (const k in RES_DEF) {
    h += `<label>${esc(t('resN_' + k))}</label>
      <input data-res="${k}" spellcheck="false" autocomplete="off" value="${esc(r[k])}">`;
  }
  resListEl.innerHTML = h;
}

//读回资源地址，只保留被改过的项
function readResConf() {
  const out = { hljs:RES_DEF.hljs, trans:parseTrans(resTransEl.value) };
  for (const el of resListEl.querySelectorAll('[data-res]')) {
    const k = el.dataset.res;
    const v = el.value.trim();
    if (v && v !== RES_DEF[k]) out[k] = v;
  }
  return out;
}

//语言服务器的配置与列表
function lspConf(lang) {
  const d = LSP_DEF[lang] || { cmd:'', url:'' };
  const u = (cfg.lsp && cfg.lsp[lang]) || {};
  return { on:!!u.on, cmd:u.cmd || d.cmd, url:u.url !== undefined ? u.url : d.url };
}

//每种语言一行：启用开关、启动命令、下载地址、下载按钮
function renderLsp() {
  let h = '';
  for (const k in LSP_DEF) {
    const c = lspConf(k);
    h += `<label class="chk"><input type="checkbox" data-lsp-on="${k}"${c.on ? ' checked' : ''}>${esc(LSP_DEF[k].name)}</label>
      <div class="lsp-row">
        <input data-lsp-cmd="${k}" spellcheck="false" autocomplete="off" placeholder="${esc(t('lspCmdPh'))}" value="${esc(c.cmd)}">
        <input data-lsp-url="${k}" spellcheck="false" autocomplete="off" placeholder="${esc(t('lspUrlPh'))}" value="${esc(c.url)}">
        <button class="set-add" data-lsp-get="${k}">${esc(t('lspGet'))}</button>
      </div>`;
  }
  lspListEl.innerHTML = h;
}

//读回语言服务器配置，只保留与默认不同的项
function readLsp() {
  const out = {};
  for (const k in LSP_DEF) {
    const d = LSP_DEF[k];
    const onEl = lspListEl.querySelector(`[data-lsp-on="${k}"]`);
    const cmdEl = lspListEl.querySelector(`[data-lsp-cmd="${k}"]`);
    const urlEl = lspListEl.querySelector(`[data-lsp-url="${k}"]`);
    const cmd = cmdEl ? cmdEl.value.trim() : '';
    const url = urlEl ? urlEl.value.trim() : '';
    const o = {};
    if (onEl && onEl.checked) o.on = 1;
    if (cmd && cmd !== d.cmd) o.cmd = cmd;
    if (url !== (d.url || '')) o.url = url;
    if (Object.keys(o).length) out[k] = o;
  }
  cfg.lsp = out;
  cfg.lsp = out;
}

//调试适配器的配置与列表，字段与语言服务器一致
function renderDbg() {
  let h = '';
  for (const k in DEBUG_DEF) {
    const c = dbgConf(k);
    h += `<label class="chk"><input type="checkbox" data-dbg-on="${k}"${c.on ? ' checked' : ''}>${esc(DEBUG_DEF[k].name)}</label>
      <div class="lsp-row">
        <input data-dbg-cmd="${k}" spellcheck="false" autocomplete="off" placeholder="${esc(t('dbgCmdPh'))}" value="${esc(c.cmd)}">
        <input data-dbg-url="${k}" spellcheck="false" autocomplete="off" placeholder="${esc(t('dbgUrlPh'))}" value="${esc(c.url)}">
        <button class="set-add" data-dbg-get="${k}">${esc(t('lspGet'))}</button>
        <button class="set-add" data-dbg-check="${k}">${esc(t('dbgCheck'))}</button>
      </div>`;
  }
  dbgListEl.innerHTML = h;
}

//读回调试配置
function readDbg() {
  const out = {};
  for (const k in DEBUG_DEF) {
    const d = DEBUG_DEF[k];
    const onEl = dbgListEl.querySelector(`[data-dbg-on="${k}"]`);
    const cmdEl = dbgListEl.querySelector(`[data-dbg-cmd="${k}"]`);
    const urlEl = dbgListEl.querySelector(`[data-dbg-url="${k}"]`);
    const cmd = cmdEl ? cmdEl.value.trim() : '';
    const url = urlEl ? urlEl.value.trim() : '';
    const o = { on: onEl && onEl.checked ? 1 : 0 };
    if (cmd && cmd !== d.cmd) o.cmd = cmd;
    if (url !== (d.url || '')) o.url = url;
    out[k] = o;
  }
  cfg.dbg = out;
}

//翻译包配置，语言 -> 链接
function transMap() {
  return (cfg.res && cfg.res.trans) || {};
}

//每行 语言:链接 解析成映射
function parseTrans(text) {
  const m = {};
  for (const line of (text || '').split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && v) m[k] = v;
  }
  return m;
}

function transText(m) {
  return Object.keys(m).map(k => k + ':' + m[k]).join('\n');
}

//请求一份在线资源，force为真时忽略缓存
function loadRes(kind, force) {
  const url = resConf()[kind];
  if (url) send('resLoad', kind, url, '', force ? '1' : '0');
}

//内置语言直接用，其余按配置拉取
function loadTrans(lang, force) {
  if (I18N[lang]) return;
  const url = transMap()[lang];
  if (url) send('resLoad', 'trans', url, lang, force ? '1' : '0');
}

//启动或资源更新时重新获取全部资源
function initRes(force) {
  loadRes('hljs', force);
  loadRes('marked', force);
  loadRes('purify', force);
  loadTrans(cfg.lang, force);
  //固定名的资源直接预取，命中缓存会立刻返回，语法包仍按语言按需拉取
  for (const k of ['ts', 'tscore', 'tswasm']) loadResPath(k);
  loadResPath('tslib', '.es5');
  if (force) resReload();
}

//资源更新：已就绪的大资源按当前地址重新下载
function resReload() {
  for (const key of Object.keys(resUrls)) {
    const i = key.indexOf(':');
    const kind = i < 0 ? key : key.slice(0, i);
    const name = i < 0 ? '' : key.slice(i + 1);
    send('resLoad', kind, (resConf()[kind] || '').replace('{name}', name), name, '1');
  }
}

//按需拉取的大资源，就绪后给出本地服务地址
const resUrls = {};
const resWait = {};

//请求一份大资源，resolve本地地址，失败得到null
function loadResPath(kind, name) {
  const key = name ? kind + ':' + name : kind;
  if (resUrls[key]) return Promise.resolve(resUrls[key]);
  if (resWait[key]) return resWait[key];
  const tpl = resConf()[kind] || '';
  const p = new Promise(res => { resWait[key] = res; });
  send('resLoad', kind, tpl.replace('{name}', name || ''), name || '', '0');
  return p;
}

//缓存路径转成本地服务地址，供页面直接加载
function resUrl(path) {
  return window.__WS ? window.__WS + encodeURIComponent(path) : '';
}

//按需注入一段脚本，重复加载直接返回
const resScripts = {};
function loadResScript(key, url) {
  if (resScripts[key]) return resScripts[key];
  resScripts[key] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => res();
    s.onerror = () => { delete resScripts[key]; rej(new Error(key)); };
    document.head.appendChild(s);
  });
  return resScripts[key];
}

//按需注入一段样式，重复加载直接返回
const resStyles = {};
function loadResCss(key, url) {
  if (resStyles[key] || !url) return;
  resStyles[key] = 1;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = url;
  document.head.appendChild(l);
}

//按需加载ES模块，只有tree-sitter的js是ESM
const resMods = {};
function loadResModule(key, url) {
  if (!resMods[key]) {
    resMods[key] = import(url).catch(e => {
      delete resMods[key];
      throw e;
    });
  }
  return resMods[key];
}

//语言下拉：内置两种加已配置的翻译包
function renderLangs() {
  const m = transMap();
  let h = `<option value="zh-CN">${t('langZh')}</option><option value="en">${t('langEn')}</option>`;
  for (const k of Object.keys(m)) {
    //内置两种已经在上面写死，判断不能看 I18N，外部包加载后也会写进去
    if (k === 'zh-CN' || k === 'en') continue;
    h += `<option value="${esc(k)}">${esc(k)}</option>`;
  }
  setLangEl.innerHTML = h;
  setLangEl.value = cfg.lang || 'zh-CN';
}

//tree-sitter 语法包按扩展名选，只列有语法包的语言
const TS_GRAMMAR = {
  js:'javascript', mjs:'javascript', cjs:'javascript', jsx:'javascript', ts:'typescript', tsx:'tsx',
  py:'python', rs:'rust', go:'go', java:'java', cs:'c_sharp', rb:'ruby', php:'php', swift:'swift',
  c:'c', h:'c', cc:'cpp', cpp:'cpp', cxx:'cpp', hpp:'cpp', hh:'cpp', objc:'objc',
  json:'json', html:'html', htm:'html', css:'css', vue:'vue', yaml:'yaml', yml:'yaml', toml:'toml',
  sh:'bash', bash:'bash', lua:'lua', kt:'kotlin', kts:'kotlin', scala:'scala', dart:'dart', zig:'zig',
  elm:'elm', ex:'elixir', exs:'elixir', ml:'ocaml', mli:'ocaml', sol:'solidity', rdl:'systemrdl',
  tla:'tlaplus', erb:'embedded_template', res:'rescript',
};

//语法引擎与已加载的语法包都只加载一次
let tsMod = null;
let tsParser = null;
const tsLangs = {};
let lintSeq = 0;

function grammarOf(path) {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : TS_GRAMMAR[path.slice(i + 1).toLowerCase()] || '';
}

//引擎与运行时打包一次拉取，失败时下次再试
function loadTs() {
  if (!tsMod) {
    tsMod = Promise.all([loadResPath('tscore'), loadResPath('tswasm')]).then(([j, w]) => {
      if (!j || !w) throw new Error('ts');
      return loadResModule('tscore', j).then(m => m.Parser.init({ locateFile: () => w }).then(() => m));
    }).catch(e => { tsMod = null; throw e; });
  }
  return tsMod;
}

//同一种语言只加载一次语法包
function tsLang(mod, name) {
  if (!tsLangs[name]) {
    tsLangs[name] = loadResPath('grammar', name).then(u => {
      if (!u) throw new Error(name);
      return mod.Language.load(u);
    });
  }
  return tsLangs[name];
}

//收集语法错误节点，ERROR与MISSING节点已覆盖子树，不再往下找
function tsErrors(tree) {
  const out = [];
  const walk = n => {
    if (out.length >= 5) return;
    if (n.isError || n.isMissing) {
      out.push({ line:n.startPosition.row + 1, col:n.startPosition.column, msg:(n.isMissing ? t('probMissing') : t('probSyntax')) + ' ' + n.type });
      return;
    }
    if (!n.hasError) return;
    for (const c of n.children) walk(c);
  };
  walk(tree.rootNode);
  return out;
}

//解析一段文本，无对应语法包或引擎未就绪时视作无错误
async function parseText(path, text) {
  const name = grammarOf(path);
  if (!name) return [];
  const mod = await loadTs();
  tsParser = tsParser || new mod.Parser();
  tsParser.setLanguage(await tsLang(mod, name));
  const tree = tsParser.parse(text);
  const errs = tsErrors(tree);
  tree.delete();
  return errs;
}

//检查当前编辑的缓冲区
async function lintCurrent() {
  if (!active) return;
  const seq = ++lintSeq;
  let errs;
  try {
    errs = await parseText(active, buffers[active] || '');
  } catch (e) {
    return;
  }
  //解析期间又编辑过就丢弃这次结果
  if (seq !== lintSeq) return;
  curProb = errs.map(e => ({ path:active, line:e.line, col:e.col, msg:e.msg }));
  if (probMode === 'cur') renderProblems();
}

function renderProblems() {
  //当前文件优先用语言服务器报的问题，没有时退回语法包结果
  const list = probMode === 'cur' ? (lspDiag[active] || curProb) : wsProb;
  //把当前列表缓存一下，点击时用同一数据源
  renderProblems._list = list;
  if (!list.length) {
    probListEl.innerHTML = `<div class="prob-none">${t('probNone')}</div>`;
    return;
  }
  probListEl.innerHTML = list.map((x, i) => `<div class="prob-item" data-i="${i}">
    <span class="loc">${esc(relPath(x.path))}:${x.line}:${x.col + 1}</span>
    <span class="msg">${esc(x.msg)}</span></div>`).join('');
}

//扫描工作区，文件由后端读出后按语法包逐个检查
function scanWorkspace() {
  if (!root) {
    wsProb = [];
    renderProblems();
    return;
  }
  probListEl.innerHTML = `<div class="prob-none">${t('probScanning')}</div>`;
  send('resScan', root);
}

//等一次工作区扫描结果，供 AI 工具用；语法包不可用时回调 null
let lintCapture = null;

function lintWorkspace() {
  return new Promise(r => {
    lintCapture = r;
    //兜底：超时未回按失败处理，避免工具调用卡住
    setTimeout(() => { if (lintCapture === r) { lintCapture = null; r(null); } }, 20000);
    scanWorkspace();
  });
}

//切换问题面板的两个视图
function setProbMode(m) {
  probMode = m;
  for (const b of probTabsEl.querySelectorAll('.prob-tab')) b.classList.toggle('on', b.dataset.k === m);
  if (m === 'cur') {
    lintCurrent();
    renderProblems();
  } else {
    renderProblems();
    if (!wsProb.length) scanWorkspace();
  }
}

const cfg = {
  models:[],
  modelIdx:0,
  theme:'dark',
  themes:[],
  lang:'zh-CN',
  undoSteps:200,
  shell:'powershell',
  res:{ hljs:RES_DEF.hljs, trans:{} },
  lsp:{},
  prompt:PROMPTS.system,
  chat:{},
  sessions:{},
  run:{},
};

const buffers = {};      //path -> 内容
const dirty = new Set(); //未保存
const langs = {};        //path -> hljs语言id
const crlf = {};         //path -> 原文件是否CRLF
const openTabs = [];
const expanded = new Set();
const children = {};     //path -> 目录项

const FOLDER_SVG = `<svg class="icon" viewBox="0 0 16 16" fill="none">
  <path d="M1.5 3.2a.9.9 0 01.9-.9h3.2l1.3 1.4h6a.9.9 0 01.9.9v7.2a.9.9 0 01-.9.9H2.4a.9.9 0 01-.9-.9z"
        stroke="#dcb67a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

const FILE_SVG = `<svg class="icon" viewBox="0 0 16 16" fill="none">
  <path d="M3.5 2h5.6l3.4 3.4V14H3.5z" stroke="#dea584" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M9.1 2v3.4h3.4" stroke="#dea584" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

function toast(msg, icon) {
  let k = '';
  if (icon === '⚠') k = 'err';
  else if (icon === 'ℹ') k = 'warn';
  log(msg, k);
  toastMsg.textContent = msg;
  toastEl.querySelector('.tick').textContent = icon || '✓';
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

//IDE日志，在输出面板里逐行追加
function log(msg, kind) {
  const d = document.createElement('div');
  d.className = 'out-line' + (kind ? ' ' + kind : '');
  d.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + msg;
  outBody.appendChild(d);
  while (outBody.childElementCount > 500) outBody.firstChild.remove();
  outBody.scrollTop = outBody.scrollHeight;
}

window.addEventListener('error', e => log('脚本错误: ' + e.message + '（第 ' + e.lineno + ' 行）', 'err'));
window.addEventListener('unhandledrejection', e => {
  const r = e.reason;
  log('未处理的异常: ' + ((r && r.message) || r), 'err');
});

/* ---------- 文件树 ---------- */
function renderTree() {
  contentEl.classList.toggle('no-folder', !root);
  if (!root) {
    treeEl.innerHTML = '<div class="empty">未打开文件夹<br><a id="treeOpen">打开文件夹</a></div>';
    $('treeOpen').onclick = () => send('openFolder');
    return;
  }
  const top = treeEl.scrollTop;
  treeEl.innerHTML = dirNode(root, baseName(root), 0);
  treeEl.scrollTop = top;
}

//重读根目录与所有已展开目录，刷新资源管理器
function refreshTree() {
  if (!root) return;
  //刚读过目录，清掉基线，避免下次轮询把本次刷新当成外部改动
  delete statSeen[root];
  for (const p of expanded) delete statSeen[p];
  send('readDir', root);
  expanded.forEach(p => { if (p !== root) send('readDir', p); });
}

function dirNode(path, name, depth) {
  const open = expanded.has(path);
  const sel = selPaths.has(path) ? ' sel' : '';
  let h = `<div class="node${sel}" draggable="true" data-path="${path}" data-dir="1" style="padding-left:${8 + depth * 14}px">
    <span class="arrow${open ? '' : ' collapsed'}">▼</span>${FOLDER_SVG}<span>${esc(name)}</span></div>`;
  if (!open || !children[path]) {
    return h;
  }
  for (const e of children[path]) {
    h += e.dir ? dirNode(e.path, e.name, depth + 1) : fileNode(e, depth + 1);
  }
  return h;
}

function fileNode(e, depth) {
  const on = e.path === active ? ' active' : '';
  const sel = selPaths.has(e.path) ? ' sel' : '';
  return `<div class="node${on}${sel}" draggable="true" data-path="${e.path}" style="padding-left:${8 + depth * 14}px">
    <span class="arrow"></span>${FILE_SVG}<span>${esc(e.name)}</span></div>`;
}

function toggleDir(path) {
  if (expanded.has(path)) {
    expanded.delete(path);
    renderTree();
    saveSettings();
    return;
  }
  if (children[path]) {
    expanded.add(path);
    renderTree();
    saveSettings();
    return;
  }
  send('readDir', path);
}

treeEl.addEventListener('click', e => {
  const node = e.target.closest('.node');
  if (!node) {
    selPath = '';
    selPaths.clear();
    selDir = false;
    renderTree();
    return;
  }
  const path = node.dataset.path;
  //Shift 按树上的可见顺序选一段，别打开也不要展开目录
  if (e.shiftKey && selPath) {
    const all = [...treeEl.querySelectorAll('.node')].map(n => n.dataset.path);
    const a = all.indexOf(selPath), b = all.indexOf(path);
    if (a >= 0 && b >= 0) {
      selPaths = new Set(all.slice(Math.min(a, b), Math.max(a, b) + 1));
      selDir = false;
      renderTree();
      treeEl.focus();
      return;
    }
  }
  selPath = path;
  selPaths = new Set([path]);
  selDir = !!node.dataset.dir;
  if (selDir) {
    toggleDir(selPath);
  } else {
    openFile(selPath);
  }
  //焦点留在树上，否则按 Delete 会被编辑器抢走
  treeEl.focus();
});

//选中的路径，按树上的先后顺序返回
function selList() {
  const all = [...treeEl.querySelectorAll('.node')].map(n => n.dataset.path);
  const on = all.filter(p => selPaths.has(p));
  return on.length ? on : [...selPaths];
}

/* ---------- 右键菜单 ---------- */
function ctxMenuHtml() {
  const it = (a, label) => `<div class="ctx-item" data-a="${a}">${esc(label)}</div>`;
  const sep = '<div class="ctx-sep"></div>';
  if (!selPath) return it('newf', t('newFile')) + it('newd', t('newFolder')) + sep + it('refresh', t('refresh'));
  //多选只留能整组做的操作，重命名与打开对一组文件没有意义
  if (selPaths.size > 1) {
    return it('zip', t('zip')) + sep + it('copypath', t('copyPath')) + it('copyrel', t('copyRel')) + it('tochat', t('toChat'));
  }
  let h;
  if (selDir) {
    h = it('newf', t('newFile')) + it('newd', t('newFolder')) + it('refresh', t('refresh')) + it('zip', t('zip')) + sep;
  } else {
    h = it('open', t('open'));
    const info = fileLangInfo(selPath);
    if (info.compiled) h += it('build', t('build')) + it('runbuild', t('runBuild')) + it('run', t('run'));
    else if (info.lang) h += it('run', t('run'));
    if (/\.(zip|tar|tgz|gz|bz2|xz)$/i.test(selPath)) h += it('unzip', t('unzip'));
    h += it('zip', t('zip')) + sep;
  }
  h += it('rename', t('rename')) + it('del', t('del')) + sep;
  return h + it('copypath', t('copyPath')) + it('copyrel', t('copyRel')) + it('tochat', t('toChat'));
}

//原生右键菜单被禁用，用 mousedown 兜底弹自定义菜单
treeEl.addEventListener('contextmenu', e => e.preventDefault());

treeEl.addEventListener('mousedown', e => {
  if (e.button !== 2) return;
  e.preventDefault();
  const node = e.target.closest('.node');
  if (node) {
    const p = node.dataset.path;
    //右键落在已选中的项上就保持整组选中，否则重设为这一项
    if (!selPaths.has(p)) selPaths = new Set([p]);
    selPath = p;
    selDir = !!node.dataset.dir;
    ctxDir = selDir ? selPath : dirName(selPath);
  } else {
    if (!root) return;
    selPath = '';
    selPaths.clear();
    ctxDir = root;
  }
  //把焦点放到树上，之后按 Delete 才能删选中项
  treeEl.focus();
  renderTree();
  ctxEl.innerHTML = ctxMenuHtml();
  ctxEl.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  ctxEl.style.top = e.clientY + 'px';
  ctxEl.classList.add('show');
});

ctxEl.addEventListener('click', e => {
  const item = e.target.closest('[data-a]');
  if (!item) return;
  ctxEl.classList.remove('show');
  const a = item.dataset.a;
  const p = selPath;
  if (a === 'newf') openDlg(t('newFile'), true, n => send('create', ctxDir, n, '0'));
  if (a === 'newd') openDlg(t('newFolder'), true, n => send('create', ctxDir, n, '1'));
  if (a === 'refresh') refreshTree();
  if (a === 'open') openFile(p);
  if (a === 'run') runFile(p, 'run');
  if (a === 'build') runFile(p, 'compile');
  if (a === 'runbuild') runFile(p, 'buildrun');
  if (a === 'rename') {
    openDlg(t('rename'), true, n => doRename(p, n));
    dlgInput.value = baseName(p);
    dlgInput.select();
  }
  if (a === 'del') askDelete(p);
  if (a === 'zip') doZip(selList());
  if (a === 'unzip') doUnzip(p);
  if (a === 'copypath') copySel(false);
  if (a === 'copyrel') copySel(true);
  if (a === 'tochat') addToChat(selList().join('\n'));
});

/* ---------- 编辑器右键菜单 ---------- */
codeAreaEl.addEventListener('contextmenu', e => e.preventDefault());

codeAreaEl.addEventListener('mousedown', e => {
  if (e.button !== 2) return;
  e.preventDefault();
  taEl.focus();
  edMenuEl.style.left = Math.min(e.clientX, window.innerWidth - 130) + 'px';
  edMenuEl.style.top = e.clientY + 'px';
  edMenuEl.classList.add('show');
});

//剪贴板读取被拒时退回 execCommand
async function edPaste() {
  try {
    const txt = await navigator.clipboard.readText();
    if (txt) {
      taEl.setRangeText(txt, taEl.selectionStart, taEl.selectionEnd, 'end');
      taEl.dispatchEvent(new Event('input'));
      return;
    }
  } catch (e) { /*无权限时走兜底*/ }
  document.execCommand('paste');
}

edMenuEl.addEventListener('click', e => {
  const item = e.target.closest('[data-e]');
  if (!item) return;
  edMenuEl.classList.remove('show');
  const a = item.dataset.e;
  taEl.focus();
  if (a === 'undo') { undo(); return; }
  if (a === 'redo') { redo(); return; }
  if (a === 'paste') { edPaste(); return; }
  document.execCommand(a);
});

/* ---------- 文件操作 ---------- */
const underPath = (p, base) => p === base || p.startsWith(base + '\\') || p.startsWith(base + '/');

//目标及其子路径是否有未保存修改
function hasDirty(path) {
  for (const p of dirty) if (underPath(p, path)) return true;
  return false;
}

//删除或重命名后同步打开状态，to为空表示删除
function syncPaths(from, to) {
  const reopen = openTabs.includes(from);
  for (let i = openTabs.length - 1; i >= 0; i--) if (underPath(openTabs[i], from)) closeTab(openTabs[i]);
  for (const p of Object.keys(buffers)) if (underPath(p, from)) { delete buffers[p]; delete langs[p]; delete crlf[p]; }
  for (const p of [...dirty]) if (underPath(p, from)) dirty.delete(p);
  for (const p of [...expanded]) if (underPath(p, from)) expanded.delete(p);
  for (const p of Object.keys(children)) if (underPath(p, from)) delete children[p];
  if (underPath(selPath, from)) selPath = '';
  for (const p of [...selPaths]) if (underPath(p, from)) selPaths.delete(p);
  renderTree();
  renderTabs();
  if (reopen && to) openFile(to);
}

function doRename(from, name) {
  if (/[\\/:*?"<>|]/.test(name)) { toast('名称含非法字符', '⚠'); return; }
  const to = dirName(from) + '\\' + name;
  if (to === from) return;
  if (hasDirty(from)) { toast('有未保存的修改，请先保存', '⚠'); return; }
  syncPaths(from, to);
  send('rename', from, to);
}

//删除前确认，避开误删
function askDelete(path) {
  if (!path) return;
  if (hasDirty(path)) { toast('有未保存的修改，请先保存', '⚠'); return; }
  openDlg('删除 ' + baseName(path) + '？此操作不可恢复', false, () => {
    syncPaths(path, '');
    send('delete', path);
  });
}

//复制到剪贴板，tip为提示内容，省略时提示复制的文本
function copyText(t, tip) {
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  toast(ok ? '已复制' + (tip === undefined ? ' ' + t : tip) : '复制失败', ok ? '✓' : '⚠');
}

//把路径追加到AI输入框
function addToChat(path) {
  chatText.value = (chatText.value ? chatText.value.replace(/\s+$/, '') + '\n' : '') + path;
  toggleChat(true);
  chatText.selectionStart = chatText.selectionEnd = chatText.value.length;
}

//复制全部选中项的路径，rel为真取相对路径
function copySel(rel) {
  const list = selList().map(p => (rel ? relPath(p) : p));
  if (!list.length) return;
  copyText(list.join('\n'), list.length > 1 ? ' ' + list.length + ' 项路径' : undefined);
}

//选中项压成 zip 放到同目录，重名自动加序号
function doZip(paths) {
  if (!paths.length) return;
  const dir = dirName(paths[0]);
  const list = children[dir] || [];
  const used = new Set(list.map(e => e.name.toLowerCase()));
  const nm = baseName(paths[0]);
  const ent = list.find(e => e.name.toLowerCase() === nm.toLowerCase());
  //目录整名保留，文件去掉后缀，多选时以所在文件夹命名
  const base = paths.length > 1 ? baseName(dir) : ent && ent.dir ? nm : nm.replace(/\.[^.\\/]*$/, '');
  let name = base + '.zip';
  for (let i = 2; used.has(name.toLowerCase()); i++) name = base + ' (' + i + ').zip';
  const dest = dir + '\\' + name;
  toast('正在压缩 ' + name, 'ℹ');
  send('zip', dest, paths.join('\u0001'));
}

//解压到压缩包所在目录
function doUnzip(path) {
  toast('正在解压 ' + baseName(path), 'ℹ');
  send('unzip', path);
}

//按扩展名取图片类型，不是图片返回空串
function imgExt(name) {
  const i = (name || '').lastIndexOf('.');
  const e = i < 0 ? '' : name.slice(i + 1).toLowerCase();
  return IMG_EXT.has(e) ? e : '';
}

//刷新待发送的图片缩略图
function renderImgs() {
  chatImgs.innerHTML = pendImgs.map((p, i) =>
    `<div class="chat-img"><img src="${p.url}" title="${esc(p.name)}"><button data-imgi="${i}">×</button></div>`
  ).join('');
}

function addImg(url, name) {
  if (!mdlCap('multi')) { toast(t('imgNoMulti'), 'ℹ'); return; }
  pendImgs.push({ url, name });
  renderImgs();
}

//图片以 base64 直接进请求体
function readImg(blob, name) {
  const r = new FileReader();
  r.onload = () => addImg(r.result, name);
  r.onerror = () => toast(t('imgFail'), '⚠');
  r.readAsDataURL(blob);
}

//添加文件：图片且开启多模态就上传，其余把路径填进输入框
function addChatPath(path) {
  if (!imgExt(path)) { addToChat(path); return; }
  if (!mdlCap('multi')) { toast(t('imgNoMulti'), 'ℹ'); return; }
  fetch(fileUrl(path)).then(r => r.blob()).then(b => readImg(b, baseName(path)))
    .catch(() => toast(t('imgFail'), '⚠'));
}

document.addEventListener('click', () => {
  ctxEl.classList.remove('show');
  fileMenuEl.classList.remove('show');
  runMenuEl.classList.remove('show');
  edMenuEl.classList.remove('show');
});
document.addEventListener('contextmenu', e => {
  if (!e.target.closest('#tree')) ctxEl.classList.remove('show');
  if (!e.target.closest('.code-area')) edMenuEl.classList.remove('show');
  runMenuEl.classList.remove('show');
});

/* ---------- 新建对话框 ---------- */
//input为false时只显示标题用于确认，okFn收到输入框内容
let dlgOkFn = null;

function openDlg(title, input, okFn, value) {
  dlgTitle.textContent = title;
  dlgInput.style.display = input ? '' : 'none';
  dlgInput.value = value || '';
  dlgOkFn = okFn;
  maskEl.classList.add('show');
  if (input) dlgInput.focus();
}

function dlgOk() {
  const name = dlgInput.value.trim();
  if (dlgInput.style.display !== 'none' && !name) return;
  const f = dlgOkFn;
  maskEl.classList.remove('show');
  if (f) f(name);
}

$('dlgOk').onclick = dlgOk;
$('dlgCancel').onclick = () => maskEl.classList.remove('show');
maskEl.addEventListener('click', e => { if (e.target === maskEl) maskEl.classList.remove('show'); });
dlgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') dlgOk();
  if (e.key === 'Escape') maskEl.classList.remove('show');
});

/* ---------- 标签页 ---------- */
function renderTabs() {
  tabsEl.innerHTML = openTabs.map(p => {
    const on = p === active ? ' active' : '';
    const dot = dirty.has(p) ? '' : ' style="display:none"';
    return `<div class="tab${on}" data-path="${p}">
      <span class="dot"${dot}></span><span>${esc(baseName(p))}</span>
      <span class="close" data-close="${p}">×</span></div>`;
  }).join('');
  //标签超出宽度时把活动标签滚进可见区，否则AI面板打开后看不到它
  const t = tabsEl.querySelector('.tab.active');
  if (t && (t.offsetLeft < tabsEl.scrollLeft || t.offsetLeft + t.offsetWidth > tabsEl.scrollLeft + tabsEl.clientWidth)) {
    tabsEl.scrollLeft = t.offsetLeft + t.offsetWidth - tabsEl.clientWidth;
  }
  //exe/js/py 这类能跑的文件才亮出运行三角
  tabRun.classList.toggle('hidden', !(active && fileLangInfo(active).lang));
}

tabRun.addEventListener('click', runCurrent);

tabsEl.addEventListener('click', e => {
  const close = e.target.closest('[data-close]');
  if (close) {
    closeTab(close.dataset.close);
    return;
  }
  const tab = e.target.closest('.tab');
  if (tab) openFile(tab.dataset.path);
});

function closeTab(path) {
  const i = openTabs.indexOf(path);
  if (i < 0) return;
  if (editing && editing.path === path) editing = null;
  openTabs.splice(i, 1);
  if (active === path) {
    active = openTabs[Math.min(i, openTabs.length - 1)] || null;
  }
  if (active) {
    activate(active);
    return;
  }
  taEl.value = '';
  lastValue = '';
  lastSel = 0;
  resetFolds();
  hlEl.innerHTML = '';
  gutterEl.innerHTML = '';
  gutterSig = '';
  renderTabs();
  renderTree();
  updateStatus();
  syncPreview();
  saveSettings();
}

/* ---------- 编辑器 ---------- */
function openFile(path) {
  //用户主动打开，撤掉后台刷新标记
  bgReload = '';
  //图片与网页类文件直接进预览，源码仍可用按钮切回
  const k = previewKind(path);
  if (k && k !== 'md') previewOn = true;
  if (path in buffers) {
    activate(path);
    return;
  }
  send('openFile', path);
}

function activate(path) {
  resetFolds();
  hidePop();
  semRanges = [];
  inlayMarks = [];
  //标签被关掉但缓冲区还在时补回来，否则编辑区有内容而标签栏没有
  if (!openTabs.includes(path)) {
    const i = active ? openTabs.indexOf(active) : -1;
    //当前标签没改过就被新文件顶掉，原地换成新文件的预览
    if (i >= 0 && !restoring && !dirty.has(active) && !(editing && editing.path === active)) {
      openTabs[i] = path;
    } else {
      openTabs.push(path);
    }
  }
  seal();
  active = path;
  taEl.value = buffers[path] || '';
  lastValue = taEl.value;
  lastSel = 0;
  taEl.scrollTop = 0;
  taEl.scrollLeft = 0;
  renderTabs();
  renderTree();
  renderGutter();
  updateStatus();
  requestHighlight();
  syncScroll();
  syncPreview();
  //从树里点开时焦点留在树上，方便按 Delete 删除
  if (document.activeElement !== treeEl) taEl.focus();
  saveSettings();
}

/* ---------- 预览 ---------- */
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);

//按扩展名判断预览方式，空串表示不支持
function previewKind(path) {
  if (!path || !window.__WS) return '';
  const i = path.lastIndexOf('.');
  const e = i < 0 ? '' : path.slice(i + 1).toLowerCase();
  if (e === 'html' || e === 'htm' || e === 'svg') return 'frame';
  if (IMG_EXT.has(e)) return 'img';
  if (e === 'md' || e === 'markdown') return 'md';
  return '';
}

function fileUrl(path) {
  return window.__WS + encodeURIComponent(path);
}

//刷新预览面板，切换文件或内容变化时调用
function syncPreview() {
  const kind = active ? previewKind(active) : '';
  if (!kind) previewOn = false;
  pvBtn.classList.toggle('show', !!kind);
  pvBtn.textContent = previewOn ? t('source') : t('preview');
  pvEl.classList.toggle('show', previewOn);
  pvEl.innerHTML = '';
  if (!previewOn) return;
  if (kind === 'img') {
    const img = document.createElement('img');
    img.className = 'pv-img';
    img.onerror = () => toast('图片加载失败', '⚠');
    img.src = fileUrl(active);
    pvEl.appendChild(img);
  } else if (kind === 'md') {
    pvEl.innerHTML = `<div class="pv-md md">${renderMd(buffers[active] || '')}</div>`;
  } else {
    //相对资源由同一服务提供，脚本沙箱化避免反向调用IPC
    pvEl.innerHTML = `<iframe sandbox="allow-scripts" src="${fileUrl(active)}"></iframe>`;
  }
}

pvBtn.onclick = () => {
  if (!previewOn && previewKind(active) !== 'md' && dirty.has(active)) toast('预览的是已保存的内容', 'ℹ');
  previewOn = !previewOn;
  syncPreview();
};

//高亮在前端由hljs完成，超大文件退回纯文本避免卡顿
//节流刷新：字在透明textarea上，高亮层不刷就等于画面冻住
//连续按键时按约40ms一帧刷新，别一直等到停手
function requestHighlight() {
  clearTimeout(hlTimer);
  const wait = Math.max(0, 40 - (Date.now() - hlAt));
  hlTimer = setTimeout(() => {
    hlAt = Date.now();
    paintCode();
    lintCurrent();
    lspSync();
    //markdown预览跟随编辑内容，html与图片按磁盘内容渲染
    if (previewOn && previewKind(active) === 'md') syncPreview();
  }, wait);
}

function paintCode() {
  if (!active) return;
  const text = taEl.value;
  const id = langs[active];
  let html = '';
  if (id && text.length <= 400000 && window.hljs) {
    try {
      html = hljs.highlight(text, { language: id, ignoreIllegals: true }).value;
    } catch (e) {}
  }
  //ponytail: 逐字符着色，超大文件跳过，需要时再改成按可视区域着色
  let body = html || esc(text);
  if (text.length <= 200000) {
    body = rainbow(body);
    const fr = findRangesNow();
    if (fr.length) {
      const rz = fr.map((r, i) => ({ start:r.start, end:r.end, cls:i === findCur ? 'find-hit cur' : 'find-hit' }));
      body = decorateHtml(body, rz, null);
    }
    if (semRanges.length) body = decorateHtml(body, semRanges, null);
    if (inlayMarks.length) body = decorateHtml(body, null, inlayMarks);
  }
  hlEl.innerHTML = body + '\n';
  syncScroll();
}

//把纯文本区间或插入点映射到 hljs 的 HTML 上，实体算一个字符，区间按标签边界拆分保证嵌套合法
function decorateHtml(html, ranges, marks) {
  if ((!ranges || !ranges.length) && (!marks || !marks.length)) return html;
  const rs = ranges ? ranges.slice().sort((a, b) => a.start - b.start) : [];
  const ms = marks ? marks.slice().sort((a, b) => a.off - b.off) : [];
  let out = '', i = 0, pos = 0, ri = 0, mi = 0, open = false;
  while (i < html.length) {
    if (html[i] === '<') {
      if (open) { out += '</span>'; open = false; }
      const e = html.indexOf('>', i);
      if (e < 0) { out += html.slice(i); break; }
      out += html.slice(i, e + 1);
      i = e + 1;
      if (ri < rs.length && pos >= rs[ri].start && pos < rs[ri].end) { out += `<span class="${rs[ri].cls}">`; open = true; }
      continue;
    }
    if (open && pos >= rs[ri].end) { out += '</span>'; open = false; }
    while (ri < rs.length && rs[ri].end <= pos) ri++;
    while (mi < ms.length && ms[mi].off <= pos) { out += `<span class="inlay">${esc(ms[mi].text)}</span>`; mi++; }
    if (!open && ri < rs.length && pos >= rs[ri].start && pos < rs[ri].end) { out += `<span class="${rs[ri].cls}">`; open = true; }
    let unit;
    if (html[i] === '&') {
      const e = html.indexOf(';', i);
      if (e >= 0 && e - i <= 10) { unit = html.slice(i, e + 1); i = e + 1; }
      else { unit = html[i]; i++; }
    } else { unit = html[i]; i++; }
    out += unit;
    pos++;
  }
  if (open) out += '</span>';
  while (mi < ms.length) { out += `<span class="inlay">${esc(ms[mi].text)}</span>`; mi++; }
  return out;
}

//彩色括号，按嵌套深度轮换三种颜色，字符串与注释里的括号不着色
function rainbow(html) {
  const re = /<\/?span[^>]*>/g;
  const cls = [];
  let out = '';
  let i = 0;
  let depth = 0;
  const paint = s => {
    //hljs把字符串与注释也包在span里，这些段内的括号不参与配对
    if (cls.some(c => c.includes('string') || c.includes('comment') || c.includes('regexp'))) return s;
    return s.split(/([()[\]{}])/).map(ch => {
      if (ch === '(' || ch === '[' || ch === '{') {
        const k = depth++;
        return `<span class="br${k % 3}">${ch}</span>`;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        if (depth) depth--;
        return `<span class="br${depth % 3}">${ch}</span>`;
      }
      return ch;
    }).join('');
  };
  for (const m of html.matchAll(re)) {
    out += paint(html.slice(i, m.index));
    out += m[0];
    if (m[0].startsWith('</')) cls.pop();
    else {
      const c = /class="([^"]*)"/.exec(m[0]);
      cls.push(c ? c[1] : '');
    }
    i = m.index + m[0].length;
  }
  return out + paint(html.slice(i));
}

//语言显示名取自hljs注册表
function langName(id) {
  const l = id && window.hljs ? hljs.getLanguage(id) : null;
  return l ? l.name : (id || 'Plain Text');
}

//#rgb/#rrggbb/#rrggbbaa，每行只认第一个颜色
const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;
const COLOR_MAX = 5000;

//color 控件只吃6位hex，3位补开、8位丢透明度
function toHex6(s) {
  const h = s.slice(1);
  if (h.length === 3) return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return '#' + h.slice(0, 6);
}

//行号到该行第一个颜色的映射
function scanColors(lines) {
  const m = new Map();
  for (let i = 0; i < lines.length; i++) {
    const c = COLOR_RE.exec(lines[i]);
    if (c) m.set(i + 1, { raw: c[0], val: toHex6(c[0]) });
  }
  return m;
}

function renderGutter() {
  const lines = active ? taEl.value.split('\n') : [];
  const n = lines.length;
  const clr = n && n <= COLOR_MAX ? scanColors(lines) : null;
  const bpl = (active && bps[active]) || [];
  const bpSig = bpl.map(b => b.line + (b.cond ? 'c' : '') + (b.log ? 'l' : '') + (b.enabled === false ? 'x' : '')).join(',');
  const mark = dbgMark && dbgMark.path === active ? dbgMark.line : 0;
  //行数、颜色、折叠状态、断点、当前调试行任一变化都要重建
  const sig = n + (clr ? ',' + [...clr].map(([k, v]) => k + v.raw).join() : '') + (foldMeta ? ',f' : '') + '|' + bpSig + '|' + mark;
  if (sig === gutterSig) return;
  gutterSig = sig;
  //小文件先扫一遍，可折叠行的三角直接常驻，不用靠悬停猜
  const can = n && n <= FOLD_SCAN && !foldMeta ? scanFolds() : null;
  let h = '';
  for (let i = 1; i <= n; i++) {
    const m = foldMeta && foldMeta[i - 1];
    const ln = m ? m.n : i;
    //折叠块首行给展开三角，其余行给折叠三角
    const open = m && m.f >= 0;
    const mk = open ? `<span class="fa" data-unfold="${m.f}">▸</span>` : `<span class="fm" data-fold="${ln}">▾</span>`;
    const b = bpl.find(x => x.line === ln);
    const cls = b ? ' on' + (b.enabled === false ? ' off' : '') + ((b.cond || b.log) ? ' cond' : '') : '';
    const bp = `<span class="bp${cls}"></span>`;
    const c = clr && clr.get(ln);
    const sw = c ? `<input type="color" class="clr" value="${c.val}" data-ln="${ln}" data-old="${esc(c.raw)}" title="${esc(t('pickColor'))}">` : '';
    h += `<div data-ln="${ln}" class="${open ? 'fo' : can && can.has(ln) ? 'can' : ''}${ln === mark ? ' cur' : ''}">${bp}${mk}${sw}${ln}</div>`;
  }
  gutterEl.innerHTML = h;
}

//小文件预扫一遍，标出所有可折叠行
function scanFolds() {
  const lines = docLines();
  const s = new Set();
  for (let i = 1; i <= lines.length; i++) if (foldRange(lines, i)) s.add(i);
  return s;
}

gutterEl.addEventListener('click', e => {
  const fa = e.target.closest('.fa');
  if (fa) { unfoldFold(+fa.dataset.unfold); return; }
  const fm = e.target.closest('.fm');
  if (fm) { foldAt(+fm.dataset.fold); return; }
  if (e.target.closest('.clr')) return;
  const div = e.target.closest('[data-ln]');
  if (div && active) toggleBp(active, +div.dataset.ln);
});

//右键行号设置条件断点，log: 前缀表示日志断点
gutterEl.addEventListener('contextmenu', e => {
  const div = e.target.closest('[data-ln]');
  if (!div || !active) return;
  e.preventDefault();
  openBpCond(+div.dataset.ln);
});
gutterEl.addEventListener('click', e => {
  const fa = e.target.closest('.fa');
  if (fa) { unfoldFold(+fa.dataset.unfold); return; }
  const fm = e.target.closest('.fm');
  if (fm) foldAt(+fm.dataset.fold);
});

//折叠三角按需计算，鼠标划过的行才算一次块范围
gutterEl.addEventListener('mouseover', e => {
  const div = e.target.closest('[data-ln]');
  if (!div || !active || div.classList.contains('fo')) return;
  const lines = docLines();
  //ponytail: 每行都扫一遍全文会退化成 O(n²)，大文件先不提供折叠，需要时再做增量
  if (lines.length > FOLD_MAX) return;
  div.classList.toggle('can', !!foldRange(lines, +div.dataset.ln));
});

gutterEl.addEventListener('change', e => {
  const c = e.target.closest('.clr');
  if (c) setLineColor(+c.dataset.ln, c.value, c.dataset.old);
});

//把该行里的颜色换成新色值
function setLineColor(ln, val, raw) {
  if (!active || !raw) return;
  const lines = taEl.value.split('\n');
  const i = ln - 1;
  if (!lines[i] || lines[i].indexOf(raw) < 0) return;
  const before = taEl.value;
  lines[i] = lines[i].replace(raw, val);
  const after = lines.join('\n');
  if (after === before) return;
  seal();
  pushAction({ files:[{ path:active, before, after, sel:taEl.selectionStart, selAfter:taEl.selectionStart }], disk:false });
  putText(active, after, taEl.selectionStart, false);
  renderTabs();
}

function docText() {
  return folds.length ? foldFull : taEl.value;
}

let docSrc = null, docArr = null;
function docLines() {
  const s = docText();
  if (s !== docSrc) { docSrc = s; docArr = s.split('\n'); }
  return docArr;
}

//去掉字符串与行尾注释，避免里面的括号参与配对
function stripCode(s) {
  let out = '', q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && s[i + 1] === '/') break;
    out += c;
  }
  return out;
}

//先按花括号配对，配不上再按缩进块
function foldRange(lines, ln) {
  const i = ln - 1, line = lines[i];
  if (line === undefined || !line.trim()) return null;
  let d = 0;
  for (const c of stripCode(line)) { if (c === '{') d++; else if (c === '}') d--; }
  if (d > 0) {
    for (let j = i + 1; j < lines.length; j++) {
      for (const c of stripCode(lines[j])) { if (c === '{') d++; else if (c === '}') d--; }
      if (d <= 0) return { start: ln, end: j + 1 };
    }
  }
  const ind = line.length - line.trimStart().length;
  let end = i;
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim()) continue;
    if (l.length - l.trimStart().length <= ind) break;
    end = j;
  }
  return end > i ? { start: ln, end: end + 1 } : null;
}

//把折叠后的可见文本与行号映射组装出来
function buildView() {
  const lines = docLines();
  const hide = new Set();
  for (const f of folds) for (let i = f.start + 1; i <= f.end; i++) hide.add(i);
  const out = [], meta = [];
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    if (hide.has(n)) continue;
    out.push(lines[i]);
    meta.push({ n, f: folds.findIndex(f => f.start === n) });
  }
  return { text: out.join('\n'), meta };
}

//折叠态下编辑区只读，展开后完整文本原样恢复
function applyFold() {
  if (folds.length) {
    const v = buildView();
    foldMeta = v.meta;
    taEl.value = v.text;
    taEl.readOnly = true;
    taEl.classList.add('folded');
  } else {
    foldMeta = null;
    if (foldFull) taEl.value = foldFull;
    foldFull = '';
    taEl.readOnly = false;
    taEl.classList.remove('folded');
  }
  lastValue = taEl.value;
  gutterSig = '';
  renderGutter();
  updateStatus();
  requestHighlight();
  syncScroll();
}

function foldAt(ln) {
  if (folds.some(f => f.start === ln)) return;
  const r = foldRange(docLines(), ln);
  if (!r) return;
  if (!foldFull) foldFull = taEl.value;
  folds.push(r);
  applyFold();
}

function unfoldFold(fi) {
  if (fi < 0 || fi >= folds.length) return;
  folds.splice(fi, 1);
  applyFold();
}

function unfoldAll() {
  if (!folds.length) return;
  folds = [];
  applyFold();
}

function resetFolds() {
  folds = [];
  foldMeta = null;
  foldFull = '';
  taEl.readOnly = false;
  taEl.classList.remove('folded');
  gutterSig = '';
}

function syncScroll() {
  hlEl.scrollTop = taEl.scrollTop;
  hlEl.scrollLeft = taEl.scrollLeft;
  gutterEl.style.transform = `translateY(${-taEl.scrollTop}px)`;
}

function updateStatus() {
  let label = active ? langName(langs[active]) : '';
  const ls = active ? lspSrv[lspLang(active)] : null;
  if (ls) {
    if (ls.ready) label += ' · LSP';
    else if (ls.dead) label += ' · LSP已断';
    else label += ' · LSP启动中';
  } else if (active && lspLang(active)) {
    label += ' · LSP未启';
  }
  stLang.textContent = label;
  if (!active) {
    stPos.textContent = 'Ln 1, Col 1';
    return;
  }
  const lines = taEl.value.slice(0, taEl.selectionStart).split('\n');
  const m = foldMeta && foldMeta[lines.length - 1];
  stPos.textContent = `Ln ${m ? m.n : lines.length}, Col ${lines[lines.length - 1].length + 1}`;
}

/* ---------- 撤销与重做 ---------- */
let undoStack = [], redoStack = [];
let editing = null;   //正在合并的一步输入
let lastValue = '';   //当前文件上一次快照的文本
let lastSel = 0;
let lastTime = 0;

/* ---------- 代码折叠 ---------- */
const FOLD_MAX = 5000;
//超过这个行数的文件不预扫折叠，只留悬停按需计算
const FOLD_SCAN = 800;
//folds 用完整文本行号记录，start+1..end 为被隐藏的区间
let folds = [];
let foldFull = '';
let foldMeta = null;

//一步历史，files 里每项是某个文件的前后文本
function pushAction(a) {
  undoStack.push(a);
  redoStack.length = 0;
  //步数与总字数为双保险，避免大文件快照吃光内存
  let chars = 0;
  for (const x of undoStack) for (const f of x.files) chars += f.before.length + f.after.length;
  while (undoStack.length > (cfg.undoSteps || 200) || (chars > 8000000 && undoStack.length > 1)) {
    const d = undoStack.shift();
    for (const f of d.files) chars -= f.before.length + f.after.length;
  }
}

//结算正在合并的输入
function seal() {
  if (!editing) return;
  const a = editing;
  editing = null;
  if (a.before === a.after) return;
  pushAction({
    files:[{ path:a.path, before:a.before, after:a.after, sel:a.bSel, selAfter:a.aSel }],
    disk:false,
  });
}

//把文本写回缓冲区与编辑区，disk 为真时同时落盘
function putText(path, text, sel, disk) {
  if (path in buffers) {
    buffers[path] = text;
    if (disk) dirty.delete(path); else dirty.add(path);
    if (path === active) {
      unfoldAll();
      taEl.value = text;
      taEl.selectionStart = taEl.selectionEnd = Math.min(sel || 0, text.length);
      lastValue = text;
      renderGutter();
      updateStatus();
      requestHighlight();
    }
  }
  if (disk) return writeFile(path, text, crlf[path] ? 1 : 0);
}

function undo() {
  seal();
  const a = undoStack.pop();
  if (!a) return;
  redoStack.push(a);
  for (const f of a.files) putText(f.path, f.before, f.sel, a.disk);
  renderTabs();
  saveSettings();
}

function redo() {
  seal();
  const a = redoStack.pop();
  if (!a) return;
  undoStack.push(a);
  for (const f of a.files) putText(f.path, f.after, f.selAfter, a.disk);
  renderTabs();
  saveSettings();
}

window.addEventListener('keydown', e => {
  if (document.activeElement !== taEl || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  const isRedo = k === 'y' || (k === 'z' && e.shiftKey);
  if (k !== 'z' && !isRedo) return;
  e.preventDefault();
  if (isRedo) redo(); else undo();
});

/* ---------- 编辑辅助 ---------- */
//回车后跟随当前行的缩进
function autoIndent(e) {
  const v = taEl.value, s = taEl.selectionStart, en = taEl.selectionEnd;
  if (s !== en && v.slice(s, en).includes('\n')) return;
  const ind = /^[ \t]*/.exec(v.slice(v.lastIndexOf('\n', s - 1) + 1, s))[0];
  if (!ind) return;
  e.preventDefault();
  seal();
  taEl.setRangeText('\n' + ind, s, en, 'end');
  taEl.dispatchEvent(new Event('input'));
}

//Tab 缩进，Shift+Tab 反缩进，跨行选区按整块处理
function indentKey(e) {
  e.preventDefault();
  const n = cfg.tabSize || 4;
  const v = taEl.value, s = taEl.selectionStart, en = taEl.selectionEnd;
  seal();
  if (!e.shiftKey && !v.slice(s, en).includes('\n')) {
    taEl.setRangeText(' '.repeat(n), s, en, 'end');
    taEl.dispatchEvent(new Event('input'));
    return;
  }
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', en);
  if (le < 0) le = v.length;
  let out, head = 0, total = 0;
  if (e.shiftKey) {
    out = v.slice(ls, le).split('\n').map((l, i) => {
      const d = l.startsWith('\t') ? 1 : Math.min(/^ */.exec(l)[0].length, n);
      total += d;
      if (!i) head = d;
      return l.slice(d);
    }).join('\n');
  } else {
    const pad = ' '.repeat(n);
    out = v.slice(ls, le).split('\n').map(l => pad + l).join('\n');
    head = n;
    total = n * out.split('\n').length;
  }
  taEl.setRangeText(out, ls, le, 'preserve');
  const ns = e.shiftKey ? Math.max(ls, s - head) : s + head;
  taEl.setSelectionRange(ns, Math.max(ns, e.shiftKey ? en - total : en + total));
  taEl.dispatchEvent(new Event('input'));
}

//删除当前行（含行尾换行符，若无则删到行末）
function deleteLine() {
  const v = taEl.value, s = taEl.selectionStart, en = taEl.selectionEnd;
  seal();
  if (s !== en) { taEl.setRangeText('', s, en, 'end'); taEl.dispatchEvent(new Event('input')); return; }
  let lineStart = v.lastIndexOf('\n', s - 1) + 1;
  let lineEnd = v.indexOf('\n', s);
  if (lineEnd < 0) lineEnd = v.length;
  else lineEnd++;
  taEl.setRangeText('', lineStart, lineEnd, 'start');
  taEl.dispatchEvent(new Event('input'));
}

//切换行注释：单行加/去，多行块注释加/去
function toggleComment() {
  const v = taEl.value, s = taEl.selectionStart, en = taEl.selectionEnd;
  seal();
  if (s === en) {
    // 单行：取当前行
    const ls = lineStarts(v);
    let lineIdx = 0;
    for (let i = 0; i < ls.length; i++) { if (ls[i] <= s && (ls[i+1] || v.length) > s) { lineIdx = i; break; } }
    const lineStart = ls[lineIdx], lineEnd = ls[lineIdx + 1] || v.length;
    const line = v.slice(lineStart, lineEnd).replace(/\r$/, '');
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      taEl.setRangeText(line.slice(0, line.length - trimmed.length) + trimmed.slice(2), lineStart, lineEnd, 'preserve');
    } else {
      taEl.setRangeText(line.slice(0, line.length - trimmed.length) + '// ' + trimmed, lineStart, lineEnd, 'preserve');
    }
    taEl.dispatchEvent(new Event('input'));
    return;
  }
  // 多行选区：按整行加注释
  const ls = lineStarts(v);
  let firstLine = 0, lastLine = ls.length - 1;
  for (let i = 0; i < ls.length; i++) {
    if (ls[i] <= s) firstLine = i; else break;
  }
  for (let i = ls.length - 1; i >= 0; i--) {
    if (ls[i] < en) { lastLine = i; break; }
  }
  const blockStart = ls[firstLine];
  const blockEnd = ls[lastLine + 1] || v.length;
  const lines = v.slice(blockStart, blockEnd).split('\n');
  const allCommented = lines.every(l => l.trim().startsWith('//') || l.trim().startsWith('#') || l.trim() === '');
  if (allCommented) {
    const out = lines.map(l => l.trim().startsWith('//') ? ' ' + l.trim().slice(2) : l.trim().startsWith('#') ? ' ' + l.trim().slice(1) : l).join('\n');
    taEl.setRangeText(out, blockStart, blockEnd, 'preserve');
  } else {
    const out = lines.map(l => l ? '// ' + l : '').join('\n');
    taEl.setRangeText(out, blockStart, blockEnd, 'preserve');
  }
  taEl.dispatchEvent(new Event('input'));
}

function indentSelection() {
  indentKey({ shiftKey: false });
}
function dedentSelection() {
  indentKey({ shiftKey: true });
}

taEl.addEventListener('input', () => {
  if (!active) return;
  const now = Date.now();
  if (!editing || editing.path !== active || now - lastTime > 600) {
    seal();
    editing = { path:active, before:lastValue, bSel:lastSel, after:'', aSel:0 };
  }
  editing.after = taEl.value;
  editing.aSel = taEl.selectionStart;
  lastValue = taEl.value;
  lastSel = taEl.selectionStart;
  lastTime = now;
  buffers[active] = taEl.value;
  if (!dirty.has(active)) {
    dirty.add(active);
    renderTabs();
  }
  renderGutter();
  updateStatus();
  requestHighlight();
  if (findOpenFlag) findScan(true);
  semRanges = [];
  inlayMarks = [];
  if (sigWant) sigHelp();
  compShow();
});

taEl.addEventListener('scroll', syncScroll);
taEl.addEventListener('scroll', compHide);
taEl.addEventListener('scroll', () => inlaySync());
taEl.addEventListener('blur', compHide);
//鼠标在标识符上停顿就弹悬停信息
taEl.addEventListener('mousemove', e => {
  if (!active) return;
  clearTimeout(hoverTimer);
  const off = offsetFromPoint(e.clientX, e.clientY);
  if (off < 0) return;
  hoverTimer = setTimeout(() => hoverAt(off, e.clientX, e.clientY), 420);
});
taEl.addEventListener('mouseleave', hidePop);
taEl.addEventListener('click', e => {
  compHide();
  updateStatus();
  if (e.ctrlKey && !e.button) gotoDef();
});

//按当前文件语言挑关键字（search.rs 自定义正则引擎，|和\w支持，括号分组不支持）
const LANG_DEFS = {
  rust: 'fn\s+\w+|pub\s+fn\s+\w+|async\s+fn\s+\w+|trait\s+\w+|struct\s+\w+|enum\s+\w+|type\s+\w+|const\s+\w+',
  c:   'void\s+\w+|int\s+\w+|char\s+\w+|double\s+\w+|float\s+\w+|long\s+\w+|short\s+\w+|unsigned\s+\w+|struct\s+\w+|enum\s+\w+|typedef\s+\w+|static\s+\w+|inline\s+\w+|const\s+\w+|extern\s+\w+',
  cpp: 'class\s+\w+|struct\s+\w+|enum\s+\w+|template\s+\w+|namespace\s+\w+',
  python: 'def\s+\w+|class\s+\w+',
  go:  'func\s+\w+',
  java: 'public\s+\w+|private\s+\w+|protected\s+\w+|static\s+\w+|final\s+\w+|class\s+\w+|interface\s+\w+|enum\s+\w+',
  javascript: 'function\s+\w+',
  typescript: 'function\s+\w+|interface\s+\w+|class\s+\w+|enum\s+\w+|type\s+\w+',
  csharp: 'public\s+\w+|private\s+\w+|class\s+\w+|interface\s+\w+|struct\s+\w+|enum\s+\w+',
  bash: 'function\s+\w+',
};
function wordAtCare(at) {
  if (!active) return '';
  const v = taEl.value, pos = at === undefined ? taEl.selectionStart : at;
  let s = pos, e = pos;
  while (s > 0 && /\w/.test(v[s - 1])) s--;
  while (e < v.length && /\w/.test(v[e])) e++;
  return v.slice(s, e);
}
function gotoDef() {
  if (!active) { toast('没有打开的文件', '⚠'); return; }
  const name = wordAtCare();
  if (!name) { toast('光标不在标识符上', '⚠'); return; }
  const pat0 = LANG_DEFS[langs[active] || ''] || '\w+\s+\w+';
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\$&');
  const pat = pat0.replace(/\\w\+/g, escaped);
  toast('查找定义: ' + name, '🔍');
  send('search', root || dirName(active), pat, 'r');
}
taEl.addEventListener('keyup', updateStatus);

taEl.addEventListener('keydown', e => {
  if (folds.length) return;
  if (compKey(e)) return;
  if (e.key === '(' || e.key === ',') sigWant = true;
  if (e.key === ')' || e.key === 'Escape') hidePop();
  if (e.key === 'Tab') { indentKey(e); return; }
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) { autoIndent(e); return; }
  if (e.key.length > 1 && e.key !== 'Backspace' && e.key !== 'Delete') compHide();
});

/* ---------- 关键字补全 ---------- */
const compEl = document.createElement('div');
compEl.className = 'complete';
document.body.appendChild(compEl);

let compLang = '', compWords = null, compItems = [], compSel = 0, compStart = 0, charW = 0, compMute = false;

//等宽字符宽度，弹窗按行列换算像素位置
function measureChar() {
  const s = getComputedStyle(taEl);
  const d = document.createElement('span');
  d.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  d.style.fontFamily = s.fontFamily;
  d.style.fontSize = s.fontSize;
  d.textContent = '0'.repeat(50);
  document.body.appendChild(d);
  charW = d.getBoundingClientRect().width / 50 || 8;
  d.remove();
}

//hljs 编译后 keywords 变成 词->[类型,权重]，取键即词表
function wordsOf(id) {
  const l = id && window.hljs ? hljs.getLanguage(id) : null;
  if (!l || !l.keywords) return [];
  return Object.keys(l.keywords).filter(w => /^[A-Za-z_$][\w$]*$/.test(w));
}

function loadWords() {
  const id = active ? langs[active] : '';
  if (id === compLang && compWords && compWords.length) return compWords;
  compLang = id;
  compWords = wordsOf(id);
  return compWords;
}

/* ---------- TypeScript 类型服务 ---------- */
//JS/TS 走类型服务补全，带上下文与成员提示，未就绪或失败时用关键字兜底
const TS_EXT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx']);
let tsSvc = null, tsSvcFail = false, tsSvcWait = null;
const tsText = {}, tsVer = {};

function tsExt(path) {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i + 1).toLowerCase();
}

//打开的JS/TS缓冲区同步进类型服务，内容变了就升版本
function tsSync() {
  const names = [];
  for (const p of Object.keys(buffers)) {
    if (!TS_EXT.has(tsExt(p))) continue;
    if (tsText[p] !== buffers[p]) { tsText[p] = buffers[p]; tsVer[p] = (tsVer[p] || 0) + 1; }
    names.push(p);
  }
  return names;
}

//引擎与es5声明一次性载入，失败后下次再试
const TS_LIB = ['.es5', '.decorators', '.decorators.legacy'];
const tsLibs = {};

function loadTsSvc() {
  if (tsSvcWait) return tsSvcWait;
  tsSvcWait = Promise.all([loadResPath('ts')].concat(TS_LIB.map(n => loadResPath('tslib', n)))).then(r => {
    if (!r[0] || r.slice(1).some(u => !u)) throw new Error('ts');
    return loadResScript('ts', r[0]).then(() => Promise.all(r.slice(1).map(u => fetch(u).then(x => x.text()))));
  }).then(texts => {
    TS_LIB.forEach((n, i) => { tsLibs['/lib' + n + '.d.ts'] = texts[i]; });
    const TS = window.ts;
    const host = {
      getScriptFileNames: tsSync,
      getScriptVersion: p => String(tsVer[p] || 0),
      //声明文件走预置映射，打开的缓冲区走内存文本
      getScriptSnapshot: p => {
        const t = p in tsLibs ? tsLibs[p] : tsText[p];
        return t === undefined ? undefined : TS.ScriptSnapshot.fromString(t);
      },
      getCurrentDirectory: () => '/',
      getCompilationSettings: () => ({ allowJs:true, allowNonTsExtensions:true, noEmit:true, skipLibCheck:true, target:TS.ScriptTarget.ESNext, module:TS.ModuleKind.ESNext, jsx:TS.JsxEmit.Preserve }),
      getDefaultLibFileName: () => '/lib.es5.d.ts',
    };
    tsSvc = TS.createLanguageService(host, TS.createDocumentRegistry());
    return tsSvc;
  }).catch(e => { tsSvcWait = null; tsSvcFail = true; throw e; });
  return tsSvcWait;
}

//问类型服务要补全，返回标签与插入文本
function tsComplete(file, pos, prefix) {
  let r;
  try { r = tsSvc.getCompletionsAtPosition(file, pos, {}); } catch (e) { return []; }
  if (!r) return [];
  const low = prefix.toLowerCase();
  const out = [], seen = new Set();
  for (const e of r.entries) {
    const n = e.name;
    if (seen.has(n) || (prefix && !n.toLowerCase().startsWith(low))) continue;
    seen.add(n);
    out.push({ label:n, text:e.insertText && e.insertText.indexOf('$') < 0 ? e.insertText : n });
    if (out.length >= 60) break;
  }
  return out;
}

//关键字表兜底，返回标签与插入文本
function keyItems(prefix) {
  const words = loadWords();
  const low = prefix.toLowerCase();
  const out = [];
  for (const w of words) {
    if (w !== prefix && w.toLowerCase().startsWith(low)) out.push({ label:w, text:w });
    if (out.length >= 60) break;
  }
  return out;
}

/* ---------- 语言服务器客户端 ---------- */
//每种语言一个进程，按tid回推消息，未启用或已退出的语言不参与补全
const lspSrv = {};

//语义高亮的标准token类型与修饰符，服务器没给legend时用它
const SEM_TOKENS = ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
  'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro',
  'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator'];
const SEM_MODS = ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
  'async', 'modification', 'documentation', 'defaultLibrary'];

//大纲视图里符号类型对应的图标字符
const SYM_ICON = { 1:'', 2:'', 3:'', 4:'', 5:'M', 6:'V', 7:'C', 8:'C', 9:'M', 10:'V', 11:'I',
  12:'F', 13:'V', 14:'C', 15:'S', 16:'N', 17:'E', 18:'R', 19:'A', 20:'K', 21:'O', 22:'E', 23:'S', 24:'E', 25:'K', 26:'T' };

//按扩展名找语言，返回语言键或空
function lspLang(path) {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : (LSP_EXT[path.slice(i + 1).toLowerCase()] || '');
}

//本地路径与file链接互转
function lspUri(path) {
  return 'file:///' + path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function uriPath(u) {
  try {
    u = decodeURIComponent(u);
  } catch (e) {}
  return u.replace(/^file:\/\/\//, '').replace(/\//g, '\\');
}

//字符下标换算成LSP的行列
function lspPos(text, off) {
  const up = text.slice(0, off);
  return { line: up.split('\n').length - 1, character: up.length - up.lastIndexOf('\n') - 1 };
}

//发一条请求，返回Promise，ms为超时上限
function lspReq(s, method, params, ms) {
  return new Promise(res => {
    const id = s.seq++;
    const done = v => {
      if (!s.wait[id]) return;
      delete s.wait[id];
      res(v);
    };
    s.wait[id] = done;
    if (ms) setTimeout(() => done(undefined), ms);
    send('lspSend', s.tid, JSON.stringify({ jsonrpc:'2.0', id, method, params }));
  });
}

function lspNote(s, method, params) {
  send('lspSend', s.tid, JSON.stringify({ jsonrpc:'2.0', method, params }));
}

//确保服务器在跑，未启用的语言返回null
function lspEnsure(lang) {
  if (!lang) return null;
  const c = lspConf(lang);
  if (!c.on || !c.cmd) return null;
  let s = lspSrv[lang];
  if (s) return s.dead ? null : s;
  s = lspSrv[lang] = { lang, tid:'lsp:' + lang, ready:false, dead:false, seq:1, wait:{}, docs:{} };
  send('lspStart', s.tid, c.cmd, root || cwdPath || '.');
  //握手，就绪后打开当前文件
  lspReq(s, 'initialize', {
    processId: null,
    rootUri: root ? lspUri(root) : null,
    workspaceFolders: root ? [{ uri:lspUri(root), name:baseName(root) }] : null,
    capabilities: {
      textDocument: {
        synchronization: { dynamicRegistration:false },
        completion: { completionItem:{ snippetSupport:false } },
        hover: { contentFormat:['markdown', 'plaintext'] },
        signatureHelp: { signatureInformation:{ documentationFormat:['markdown', 'plaintext'] } },
        definition: {},
        references: {},
        rename: {},
        formatting: {},
        codeAction: {},
        documentSymbol: { hierarchicalDocumentSymbolSupport:true },
        inlayHint: {},
        semanticTokens: {
          requests: { full:true },
          tokenTypes: SEM_TOKENS,
          tokenModifiers: SEM_MODS,
          formats: ['relative'],
        },
      },
      workspace: { applyEdit:true, workspaceEdit:{ documentChanges:true } },
    },
  }).then(res => {
    const caps = (res && res.capabilities) || {};
    s.caps = caps;
    //语义高亮的token类型表由服务器给出，缺省用标准表
    s.semLegend = caps.semanticTokensProvider && caps.semanticTokensProvider.legend;
    lspNote(s, 'initialized', {});
    s.ready = true;
    updateStatus();
    if (active && lspLang(active) === lang) {
      lspPush(s, active);
      semSync(true);
      inlaySync(true);
      outlineSync(true);
    }
  });
  return s;
}

//把缓冲区内容推给服务器，首次打开发didOpen，之后发didChange
function lspPush(s, path) {
  const text = buffers[path] || '';
  const d = s.docs[path];
  if (!d) {
    s.docs[path] = { v:1, text };
    lspNote(s, 'textDocument/didOpen', {
      textDocument:{ uri:lspUri(path), languageId:s.lang, version:1, text },
    });
    return;
  }
  if (d.text === text) return;
  d.text = text;
  d.v++;
  lspNote(s, 'textDocument/didChange', {
    textDocument:{ uri:lspUri(path), version:d.v },
    contentChanges:[{ text }],
  });
}

//当前文件内容有变化就同步给服务器
function lspSync() {
  if (!active) return;
  const s = lspEnsure(lspLang(active));
  if (!s || !s.ready) return;
  lspPush(s, active);
  semSync();
  inlaySync();
  outlineSync();
}

//从纯文本下标还原行首表，语义高亮与inlay按行列换算需要
function lineStarts(text) {
  const out = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') out.push(i + 1);
  }
  return out;
}

//相对编码的语义token解成字符区间，deltaLine为0时列相对上一个token
function decodeSem(data, legend) {
  const types = (legend && legend.tokenTypes) || SEM_TOKENS;
  const ls = lineStarts(taEl.value);
  const out = [];
  let line = 0, ch = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const dl = data[i];
    line += dl;
    ch = dl ? data[i + 1] : ch + data[i + 1];
    const start = (ls[line] || 0) + ch;
    const cls = 'st-' + (types[data[i + 3]] || '');
    if (types[data[i + 3]]) out.push({ start, end:start + data[i + 2], cls });
  }
  return out;
}

//语义高亮：服务器支持时全量拉取，大文件跳过
function semSync(now) {
  clearTimeout(semTimer);
  const s = active && lspEnsure(lspLang(active));
  if (!s || !s.ready || !s.semLegend || taEl.value.length > 200000) {
    if (semRanges.length) { semRanges = []; paintCode(); }
    return;
  }
  const path = active;
  const run = async () => {
    const r = await lspReq(s, 'textDocument/semanticTokens/full', { textDocument:{ uri:lspUri(path) } }, 3000);
    if (!r || !r.data || active !== path) return;
    semRanges = decodeSem(r.data, s.semLegend);
    paintCode();
  };
  if (now) run(); else semTimer = setTimeout(run, 280);
}

//inlay hints：只请求当前可视行，滚动时才刷新
function inlaySync(now) {
  clearTimeout(inlayTimer);
  const s = active && lspEnsure(lspLang(active));
  if (!s || !s.ready || !s.caps || !s.caps.inlayHintProvider) {
    if (inlayMarks.length) { inlayMarks = []; paintCode(); }
    return;
  }
  const path = active;
  const run = async () => {
    if (active !== path) return;
    const first = Math.max(0, Math.floor(taEl.scrollTop / 20) - 1);
    const last = first + Math.ceil(editorEl.clientHeight / 20) + 2;
    const r = await lspReq(s, 'textDocument/inlayHint', {
      textDocument:{ uri:lspUri(path) },
      range:{ start:{ line:first, character:0 }, end:{ line:last, character:0 } },
    }, 2000);
    if (!Array.isArray(r) || active !== path) return;
    const ls = lineStarts(taEl.value);
    inlayMarks = r.map(h => {
      const tx = typeof h.label === 'string' ? h.label
        : (Array.isArray(h.label) ? h.label.map(x => x.value || '').join('') : '');
      return { off:(ls[h.position.line] || 0) + h.position.character, text:tx };
    }).filter(x => x.text);
    paintCode();
  };
  if (now) run(); else inlayTimer = setTimeout(run, 320);
}

//文档大纲节点（树形结构，保留 children）
function symNode(sy) {
  const rg = sy.range || (sy.location && sy.location.range) || { start:{ line:0 } };
  const out = { name:sy.name||'', line:rg.start.line+1, kind:sy.kind||0, depth:0, children:[], folded:false };
  if (sy.children) for (const c of sy.children) { const cn = symNode(c); cn.depth = 1; out.children.push(cn); }
  return out;
}

function renderOutline() {
  if (!outlineSyms.length) {
    outlineList.innerHTML = `<div class="outline-none">${esc(t('outlineNone'))}</div>`;
    return;
  }
  const render = (nodes, depth) => nodes.map((s, i) => {
    const hasChild = s.children && s.children.length > 0;
    const arrow = hasChild ? (s.folded ? '▶' : '▼') : ' ';
    const items = (s.children || []).map((c, ci) => {
      const ch = c.children && c.children.length;
      const carr = ch ? (c.folded ? '▶' : '▼') : ' ';
      return `<div class="outline-item outline-child" data-d="${s.depth+1}" data-ci="${ci}" style="padding-left:${10+(s.depth+1)*12}px">
        <span class="ic">${esc(SYM_ICON[c.kind]||'')}</span>
        <span class="arr ${ch?'':'none'}" data-d="${s.depth+1}" data-ci="${ci}">${esc(carr)}</span>
        <span class="nm">${esc(c.name)}</span><span class="ln">${c.line}</span></div>`
      + (ch ? render([c], s.depth+2) : '');
    }).join('');
    return `<div class="outline-item" data-d="${depth}" data-i="${i}" style="padding-left:${10+depth*12}px">
      <span class="ic">${esc(SYM_ICON[s.kind]||'')}</span>
      <span class="arr ${hasChild?'':'none'}" data-d="${depth}" data-i="${i}">${esc(arrow)}</span>
      <span class="nm">${esc(s.name)}</span><span class="ln">${s.line}</span></div>`
    + (hasChild ? `<div class="outline-children${s.folded?' folded':''}">${items}</div>` : '');
  }).join('');
  outlineList.innerHTML = render(outlineSyms, 0);
}

function outlineSync(now) {
  clearTimeout(outlineTimer);
  if (curView !== 'outline' && !now) return;
  const s = active && lspEnsure(lspLang(active));
  if (!s || !s.ready) {
    outlineSyms = [];
    renderOutline();
    return;
  }
  const path = active;
  const run = async () => {
    const r = await lspReq(s, 'textDocument/documentSymbol', { textDocument:{ uri:lspUri(path) } }, 3000);
    if (active !== path) return;
    outlineSyms = Array.isArray(r) ? r.map(symNode) : [];
    renderOutline();
  };
  if (now) run(); else outlineTimer = setTimeout(run, 260);
}

outlineList.addEventListener('click', e => {
  const arr = e.target.closest('.arr');
  if (arr) {
    e.preventDefault();
    const d = +arr.dataset.d;
    if (arr.hasAttribute('data-i')) {
      const s = outlineSyms[arr.dataset.i];
      if (s) { s.folded = !s.folded; renderOutline(); return; }
    }
    // 子节点箭头
    const ci = +arr.dataset.ci;
    const parent = outlineSyms[d] || outlineSyms[0];
    if (parent && parent.children[ci]) { parent.children[ci].folded = !parent.children[ci].folded; renderOutline(); }
    return;
  }
  const it = e.target.closest('.outline-item');
  if (!it) return;
  const sy = outlineSyms[it.dataset.i];
  if (sy) gotoLine(sy.line);
});

//向服务器要补全项
async function lspComplete(s, path, off, prefix) {
  const r = await lspReq(s, 'textDocument/completion', {
    textDocument:{ uri:lspUri(path) },
    position:lspPos(taEl.value, off),
  }, 1500);
  const list = Array.isArray(r) ? r : ((r && r.items) || []);
  const low = prefix.toLowerCase();
  const out = [];
  for (const it of list) {
    const lab = typeof it.label === 'string' ? it.label : (it.label && it.label.label) || '';
    if (!lab || (prefix && !lab.toLowerCase().startsWith(low))) continue;
    let tx = it.insertText || (it.textEdit && it.textEdit.newText) || '';
    if (!tx) tx = lab.replace(/\(.*$/, '');
    out.push({ label:lab, text:tx });
    if (out.length >= 60) break;
  }
  return out;
}

//停掉所有服务器，配置改动后按新配置重启
function lspReset() {
  for (const k in lspSrv) send('lspStop', lspSrv[k].tid);
  for (const k in lspSrv) delete lspSrv[k];
  lspDiag = {};
  semRanges = [];
  inlayMarks = [];
  outlineSyms = [];
  hidePop();
  renderOutline();
  renderProblems();
  lspSync();
}

//服务器消息分流：诊断、服务器请求、应答
function lspOnMsg(tid, json) {
  //空串表示进程已结束
  if (!json) {
    for (const k in lspSrv) {
      if (lspSrv[k].tid === tid) { lspSrv[k].dead = true; lspSrv[k].ready = false; }
    }
    updateStatus();
    return;
  }
  let m;
  try {
    m = JSON.parse(json);
  } catch (e) {
    return;
  }
  if (m.method === 'textDocument/publishDiagnostics') {
    const p = uriPath(m.params.uri);
    const list = (m.params.diagnostics || []).map(d => {
      const st = (d.range && d.range.start) || { line:0, character:0 };
      return { path:p, line:st.line + 1, col:st.character, msg:d.message || '' };
    });
    if (list.length) lspDiag[p] = list; else delete lspDiag[p];
    if (probMode === 'cur' && active === p) renderProblems();
    return;
  }
  //服务器发来的请求：应用编辑的请求要真的执行并回执，其余回空结果
  if (m.id !== undefined && m.method) {
    if (m.method === 'workspace/applyEdit') {
      applyWsEdit(m.params && m.params.edit).then(ok => {
        send('lspSend', tid, JSON.stringify({ jsonrpc:'2.0', id:m.id, result:{ applied:!!ok } }));
      });
      return;
    }
    send('lspSend', tid, JSON.stringify({ jsonrpc:'2.0', id:m.id, result:null }));
    return;
  }
  if (m.id === undefined) return;
  for (const k in lspSrv) {
    const s = lspSrv[k];
    if (s.tid !== tid) continue;
    const f = s.wait[m.id];
    if (f) f(m.result);
  }
}

/* ---------- 语言服务：悬停/签名/重命名/引用/格式化/代码操作 ---------- */
//悬停与签名共用的浮层，补全另有compEl，二者不冲突
const popEl = document.createElement('div');
popEl.className = 'lsp-pop';
document.body.appendChild(popEl);

//代码操作菜单独立于补全菜单，避免互相顶掉
const actEl = document.createElement('div');
actEl.className = 'complete';
document.body.appendChild(actEl);
let actItems = [];

function hidePop() {
  popEl.classList.remove('show');
  popEl.innerHTML = '';
}

//插入点相对编辑区的屏幕坐标，用于定位浮层
function caretXY(off) {
  if (!charW) measureChar();
  const r = taEl.getBoundingClientRect();
  const up = taEl.value.slice(0, off);
  const line = up.split('\n').length - 1;
  const col = up.length - up.lastIndexOf('\n') - 1;
  return {
    x: r.left + col * charW - taEl.scrollLeft,
    y: r.top + 10 + (line + 1) * 20 - taEl.scrollTop,
  };
}

//屏幕坐标反推字符下标，按行高与字符宽估算
function offsetFromPoint(cx, cy) {
  if (!charW) measureChar();
  const r = taEl.getBoundingClientRect();
  const lines = taEl.value.split('\n');
  const line = Math.floor((cy - r.top - 10 + taEl.scrollTop) / 20);
  if (line < 0 || line >= lines.length) return -1;
  const col = Math.round((cx - r.left + taEl.scrollLeft) / charW);
  let up = 0;
  for (let i = 0; i < line; i++) up += lines[i].length + 1;
  return up + Math.max(0, Math.min(col, lines[line].length));
}

function showPopAt(x, y) {
  popEl.classList.add('show');
  const w = popEl.offsetWidth, h = popEl.offsetHeight;
  popEl.style.left = Math.max(4, Math.min(window.innerWidth - w - 8, x)) + 'px';
  popEl.style.top = Math.max(4, Math.min(window.innerHeight - h - 8, y)) + 'px';
}

//hover/signature 返回的文档可能是字符串或{kind,value}
function docHtml(d) {
  if (!d) return '';
  const v = typeof d === 'string' ? d : (d.value || '');
  if (!v) return '';
  if (typeof d !== 'string' && d.kind === 'markdown' && window.marked && window.DOMPurify) {
    try { return DOMPurify.sanitize(marked.parse(v)); } catch (e) {}
  }
  return '<pre>' + esc(v) + '</pre>';
}

function hoverHtml(r) {
  if (!r || !r.contents) return '';
  let c = r.contents;
  if (typeof c === 'string') return '<pre>' + esc(c) + '</pre>';
  if (Array.isArray(c)) c = { kind:'markdown', value:c.map(x => typeof x === 'string' ? x : (x.value || '')).join('\n\n') };
  return docHtml(c);
}

//鼠标停顿或 Ctrl+I 时问服务器要悬停信息
async function hoverAt(off, x, y) {
  const s = active && lspEnsure(lspLang(active));
  if (!s || !s.ready || off < 0) return;
  if (!wordAtCare(off)) return;
  const path = active;
  const r = await lspReq(s, 'textDocument/hover', {
    textDocument:{ uri:lspUri(path) },
    position:lspPos(taEl.value, off),
  }, 2000);
  if (active !== path) return;
  const html = hoverHtml(r);
  if (!html) { hidePop(); return; }
  popEl.innerHTML = html;
  showPopAt(x + 12, y + 16);
}

async function keyboardHover() {
  if (!active) return;
  const xy = caretXY(taEl.selectionStart);
  await hoverAt(taEl.selectionStart, xy.x, xy.y);
  if (popEl.classList.contains('show')) showPopAt(xy.x, xy.y + 2);
}

//签名帮助：把当前参数在标签里高亮，并附参数说明
function renderSig() {
  const sig = sigItems[sigIdx];
  if (!sig) { hidePop(); return; }
  const ps = sig.parameters || [];
  const act = sig.activeParameter !== undefined && sig.activeParameter !== null ? sig.activeParameter : sigCount;
  const label = sig.label || '';
  let head;
  if (ps.length && Array.isArray(ps[0].label)) {
    let h = '', last = 0;
    ps.forEach((p, i) => {
      const a = p.label[0], b = p.label[1];
      h += esc(label.slice(last, a));
      h += `<span class="sig-param${i === act ? ' on' : ''}">${esc(label.slice(a, b))}</span>`;
      last = b;
    });
    head = h + esc(label.slice(last));
  } else {
    head = esc(label);
  }
  const cnt = sigItems.length > 1 ? ` <span class="sig-doc">${sigIdx + 1}/${sigItems.length}</span>` : '';
  const pd = ps[act] && ps[act].documentation;
  const doc = pd || sig.documentation;
  popEl.innerHTML = `<span class="sig-name">${head}</span>${cnt}<div class="sig-doc">${docHtml(doc)}</div>`;
  const xy = caretXY(taEl.selectionStart);
  showPopAt(xy.x, xy.y + 2);
}

async function sigHelp() {
  sigWant = false;
  const s = active && lspEnsure(lspLang(active));
  if (!s || !s.ready) return;
  const path = active, pos = taEl.selectionStart;
  const r = await lspReq(s, 'textDocument/signatureHelp', {
    textDocument:{ uri:lspUri(path) },
    position:lspPos(taEl.value, pos),
  }, 1500);
  if (active !== path) return;
  if (!r || !r.signatures || !r.signatures.length) { hidePop(); return; }
  sigItems = r.signatures;
  sigIdx = Math.min(r.activeSignature || 0, sigItems.length - 1);
  sigCount = r.activeParameter || 0;
  renderSig();
}

//把TextEdit列表应用到一段文本，按位置从后往前替换，range用行列表示
function applyEdits(text, edits) {
  const ls = lineStarts(text);
  const rs = edits.map(e => ({
    s:(ls[e.range.start.line] || 0) + e.range.start.character,
    e:(ls[e.range.end.line] || 0) + e.range.end.character,
    t:e.newText || '',
  })).sort((a, b) => b.s - a.s);
  let out = text;
  for (const r of rs) out = out.slice(0, r.s) + r.t + out.slice(r.e);
  return out;
}

//应用一个WorkspaceEdit，changes与documentChanges两种形态都支持
async function applyWsEdit(edit) {
  if (!edit) return false;
  const groups = new Map();
  const push = (uri, edits) => {
    if (!groups.has(uri)) groups.set(uri, []);
    groups.get(uri).push(...(edits || []));
  };
  if (edit.changes) {
    for (const u in edit.changes) push(u, edit.changes[u]);
  }
  for (const dc of edit.documentChanges || []) {
    if (dc.textDocument) push(dc.textDocument.uri, dc.edits);
  }
  const files = [];
  for (const [u, edits] of groups) {
    const path = uriPath(u);
    const text = await textOf(path);
    if (text === null) continue;
    const after = applyEdits(text, edits);
    if (after === text) continue;
    files.push({ path, before:text, after });
  }
  if (!files.length) return false;
  commit(files);
  return true;
}

//重命名当前符号，服务端推导出所有引用点后一起改
async function renameSymbol() {
  if (!active) return;
  const s = lspEnsure(lspLang(active));
  if (!s || !s.ready) { toast(t('lspNoSrv'), '⚠'); return; }
  const off = taEl.selectionStart;
  const name = wordAtCare(off);
  if (!name) { toast(t('renameNoRes'), '⚠'); return; }
  let cur = name;
  const r = await lspReq(s, 'textDocument/prepareRename', {
    textDocument:{ uri:lspUri(active) },
    position:lspPos(taEl.value, off),
  }, 1500);
  if (r && r.placeholder) cur = r.placeholder;
  openDlg(t('renameTitle'), true, async v => {
    if (!v || v === cur) return;
    const w = await lspReq(s, 'textDocument/rename', {
      textDocument:{ uri:lspUri(active) },
      position:lspPos(taEl.value, off),
      newName:v,
    }, 4000);
    if (!w) { toast(t('renameNoRes'), '⚠'); return; }
    if (await applyWsEdit(w)) toast(t('renamed'), '✓');
  }, cur);
}

//查找引用，结果复用搜索面板展示
async function findRefs() {
  if (!active) return;
  const s = lspEnsure(lspLang(active));
  if (!s || !s.ready) { toast(t('lspNoSrv'), '⚠'); return; }
  const off = taEl.selectionStart;
  if (!wordAtCare(off)) { toast(t('refsNone'), '⚠'); return; }
  const r = await lspReq(s, 'textDocument/references', {
    textDocument:{ uri:lspUri(active) },
    position:lspPos(taEl.value, off),
    context:{ includeDeclaration:true },
  }, 6000);
  if (!Array.isArray(r) || !r.length) { toast(t('refsNone'), '⚠'); return; }
  const out = [];
  for (const x of r) {
    const p = uriPath(x.uri);
    const text = await textOf(p);
    const lines = text === null ? [] : text.split('\n');
    out.push({ path:p, line:x.range.start.line + 1, text:lines[x.range.start.line] || '' });
  }
  srHits = out;
  srSel = -1;
  srCollapsed.clear();
  setView('search');
  searchResults.innerHTML = '';
  renderSr();
  toast(t('refsTitle') + ': ' + out.length, '🔍');
}

//格式化整个文档
async function formatDoc() {
  if (!active) return;
  const s = lspEnsure(lspLang(active));
  if (!s || !s.ready) { toast(t('lspNoSrv'), '⚠'); return; }
  const path = active, text = taEl.value;
  const r = await lspReq(s, 'textDocument/formatting', {
    textDocument:{ uri:lspUri(path) },
    options:{ tabSize:cfg.tabSize || 4, insertSpaces:true },
  }, 6000);
  if (!Array.isArray(r) || !r.length) { toast(t('fmtNone'), '⚠'); return; }
  const after = applyEdits(text, r);
  if (after === text) { toast(t('fmtNone'), '⚠'); return; }
  commit([{ path, before:text, after }]);
  toast(t('cmdFormat') + ' ✓', '✓');
}

//光标处的快速修复/代码操作菜单
async function codeActions() {
  if (!active) return;
  const s = lspEnsure(lspLang(active));
  if (!s || !s.ready) { toast(t('lspNoSrv'), '⚠'); return; }
  const off = taEl.selectionStart;
  const r = await lspReq(s, 'textDocument/codeAction', {
    textDocument:{ uri:lspUri(active) },
    range:{ start:lspPos(taEl.value, off), end:lspPos(taEl.value, off) },
    context:{ diagnostics:[] },
  }, 3000);
  const acts = (Array.isArray(r) ? r : []).filter(a => a && a.title && (a.edit || a.command));
  if (!acts.length) { toast(t('codeActionNone'), '⚠'); return; }
  actItems = acts;
  actEl.innerHTML = acts.map(a => `<div class="complete-item">${esc(a.title)}</div>`).join('');
  const xy = caretXY(off);
  actEl.classList.add('show');
  actEl.style.left = Math.max(4, xy.x) + 'px';
  actEl.style.top = xy.y + 'px';
}

async function runAction(a) {
  if (a.edit && await applyWsEdit(a.edit)) return;
  if (a.command) {
    const s = active && lspEnsure(lspLang(active));
    if (s) {
      const w = await lspReq(s, 'workspace/executeCommand', { command:a.command.command, arguments:a.command.arguments || [] }, 4000);
      if (w) applyWsEdit(w);
    }
  }
}

actEl.addEventListener('mousedown', e => {
  const it = e.target.closest('.complete-item');
  if (!it) return;
  e.preventDefault();
  const a = actItems[[...actEl.children].indexOf(it)];
  actEl.classList.remove('show');
  if (a) runAction(a);
});

document.addEventListener('mousedown', e => {
  if (!actEl.contains(e.target)) actEl.classList.remove('show');
});

//光标处的单词前缀，返回前缀与是否紧跟点号
function compPrefix() {
  if (taEl.selectionStart !== taEl.selectionEnd) return null;
  const v = taEl.value;
  let i = taEl.selectionStart;
  while (i > 0 && /[\w$]/.test(v[i - 1])) i--;
  const p = v.slice(i, taEl.selectionStart);
  if (p && !/^[A-Za-z_$][\w$]*$/.test(p)) return null;
  return { prefix:p, member:i > 0 && v[i - 1] === '.' };
}

function compHide() {
  compEl.classList.remove('show');
  compItems = [];
  actEl.classList.remove('show');
  hidePop();
}

//弹补全，JS/TS 用类型服务，其余用关键字表
async function compShow() {
  if (compMute) { compMute = false; compHide(); return; }
  const c = compPrefix();
  if (!c) { compHide(); return; }
  const p = c.prefix;
  //点后零前缀列出全部成员，普通标识符至少两个字符才弹
  if (!c.member && p.length < 2) { compHide(); return; }
  let items = [];
  const path = active;
  const ls = active ? lspEnsure(lspLang(active)) : null;
  if (ls && ls.ready) {
    //语言服务器补全：带类型与成员信息，等待期间光标移动就放弃这次结果
    const pos = taEl.selectionStart;
    items = await lspComplete(ls, path, pos, p);
    if (active !== path || taEl.selectionStart !== pos) return;
  } else if (active && TS_EXT.has(tsExt(active)) && !tsSvcFail) {
    if (!tsSvc) {
      //首次在JS/TS里补全时才拉类型服务，就绪后重算一次
      loadTsSvc().then(() => compShow(), () => compShow());
      compHide();
      return;
    }
    items = tsComplete(active, taEl.selectionStart, p);
  } else {
    items = keyItems(p);
  }
  if (!items.length) { compHide(); return; }
  if (!charW) measureChar();
  //光标可能被滚动到视野外，越界就不弹
  const r = taEl.getBoundingClientRect();
  const up = taEl.value.slice(0, taEl.selectionStart);
  const line = up.split('\n').length - 1;
  const col = up.length - up.lastIndexOf('\n') - 1;
  const top = r.top + 10 + (line + 1) * 20 - taEl.scrollTop;
  if (top < r.top + 10 || top > r.bottom - 20) { compHide(); return; }
  compItems = items;
  compSel = 0;
  compStart = taEl.selectionStart - p.length;
  compEl.innerHTML = items.map((w, i) => `<div class="complete-item${i ? '' : ' on'}">${esc(w.label)}</div>`).join('');
  compEl.style.left = Math.max(4, r.left + col * charW - taEl.scrollLeft) + 'px';
  compEl.style.top = top + 'px';
  compEl.classList.add('show');
}

//采纳当前选中的补全项
function compTake() {
  const it = compItems[compSel];
  if (!it) return;
  const end = taEl.selectionStart;
  compHide();
  compMute = true;
  seal();
  taEl.setRangeText(it.text, compStart, end, 'end');
  taEl.dispatchEvent(new Event('input'));
}

//弹窗打开时截获导航键，返回真表示已处理
function compKey(e) {
  if (!compItems.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const d = e.key === 'ArrowDown' ? 1 : compItems.length - 1;
    compSel = (compSel + d) % compItems.length;
    for (let i = 0; i < compEl.children.length; i++) compEl.children[i].classList.toggle('on', i === compSel);
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    compTake();
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    compHide();
    return true;
  }
  return false;
}

compEl.addEventListener('mousedown', e => {
  const it = e.target.closest('.complete-item');
  if (!it) return;
  e.preventDefault();
  compSel = [...compEl.children].indexOf(it);
  compTake();
});

/* ---------- 保存与运行 ---------- */
function save() {
  if (!active) { toast('没有打开的文件', 'ℹ'); return; }
  dirty.delete(active);
  delete statSeen[active];
  renderTabs();
  send('save', active, crlf[active] ? '1' : '0', docText());
}

let cwdPath = '';

//当前终端类型定义，自定义时按命令行推断语法家族
function shellDef() {
  if (cfg.shell === 'custom') {
    const line = cfg.shellCmd || '';
    const low = line.toLowerCase();
    const fam = low.includes('cmd.exe') ? 'cmd' : /(bash|wsl|zsh)/.test(low) ? 'sh' : 'ps';
    return { name:'', line, fam, tab:'sh' };
  }
  return SHELLS[cfg.shell] || SHELLS.powershell;
}

//终端类型下拉，选自定义时显示命令行输入框
function renderShells() {
  const cur = cfg.shell && (cfg.shell === 'custom' || SHELLS[cfg.shell]) ? cfg.shell : 'powershell';
  let h = '';
  for (const k in SHELLS) h += `<option value="${k}">${esc(SHELLS[k].name)}</option>`;
  h += `<option value="custom">${esc(t('shellCustom'))}</option>`;
  setShellEl.innerHTML = h;
  setShellEl.value = cur;
  const cmdEl = $('setShellCmd');
  cmdEl.value = cfg.shellCmd || '';
  cmdEl.classList.toggle('hidden', cur !== 'custom');
}

//按外壳连接两条命令：PowerShell 5.1 没有 &&，用 $? 判断上一步是否成功
function chain(a, b) {
  return shellDef().fam === 'ps' ? a + '; if ($?) { ' + b + ' }' : a + ' && ' + b;
}

function runCmd(cmd, tid, cwd) {
  //没有终端时自动开一个，保证运行有输出窗口
  showTerm();
  const t = tid ? termOf(tid) : activeTerm;
  if (!t) return;
  log('运行: ' + cmd);
  //编译/运行固定在工作区根目录，先切目录再执行
  const d = cwd || t.cwd;
  const fam = shellDef().fam;
  const cd = !d ? '' : fam === 'cmd' ? 'cd /d "' + d + '"' : fam === 'sh' ? 'cd "' + d.replace(/\\/g, '/') + '"' : 'Set-Location -LiteralPath "' + d + '"';
  writeTerm(t, (cd ? chain(cd, cmd) : cmd) + '\r');
}

//单引号包裹供 PowerShell 使用，内部单引号翻倍
const psQuote = s => "'" + String(s).replace(/'/g, "''") + "'";

//带参数运行，弹出输入框填参数
function runWithArgs() {
  openDlg(t('runArgsTitle'), true, v => {
    const c = detectRun('run');
    runCmd(c + (v ? ' ' + v : ''), null, root);
  });
}

//以管理员身份运行，用 PowerShell 提权在新控制台窗口执行
function runAdmin(cmd) {
  const dir = root || cwdPath || '';
  const line = 'powershell -NoProfile -Command "Start-Process -Verb RunAs cmd -ArgumentList ' + psQuote('/k') + ', ' + psQuote(cmd) + ' -WorkingDirectory ' + psQuote(dir) + '"';
  runCmd(line, null, null);
}

//可单文件直接运行的后缀
const RUN_EXT = {
  '.py':'python', '.pyw':'python', '.js':'node', '.mjs':'node', '.cjs':'node',
  '.c':'cpp', '.cpp':'cpp', '.cc':'cpp', '.cxx':'cpp', '.rs':'rust', '.cs':'csharp',
  '.go':'go', '.rb':'ruby', '.php':'php', '.lua':'lua', '.java':'java', '.sh':'shell',
  '.exe':'exe', '.bat':'exe', '.cmd':'exe',
};

//可运行语言：id、显示名、默认命令
const RUN_LANGS = [
  ['python', 'Python', 'python'],
  ['node', 'Node', 'node'],
  ['cpp', 'C / C++', 'g++'],
  ['rust', 'Rust', 'rustc'],
  ['csharp', 'C#', 'dotnet'],
  ['go', 'Go', 'go'],
  ['java', 'Java', 'java'],
  ['ruby', 'Ruby', 'ruby'],
  ['php', 'PHP', 'php'],
  ['lua', 'Lua', 'lua'],
  ['shell', 'Shell', 'bash'],
  //exe/bat 没有解释器，默认命令为空表示直接执行
  ['exe', 'Executable', ''],
];

//打开项目配置文件时才编译项目
const PROJECT_FILES = ['build.bat','build.cmd','build.ps1','cargo.toml','go.mod','package.json',
  'makefile','pom.xml','gradlew.bat','build.gradle','cmakelists.txt','*.sln','*.csproj'];

function defOf(id) {
  const r = RUN_LANGS.find(l => l[0] === id);
  return r ? r[2] : id;
}

//按设置里选的版本替换默认解释器，路径可能带空格
function runnerOf(id) {
  const p = (cfg.run || {})[id];
  return p ? '"' + p + '"' : defOf(id);
}

//新建项目可选语言与模板，id 与运行时扫描的分组同名，命令在项目目录内执行，返回空串表示只建目录
const NEW_LANGS = [
  { id:'blank', label:'projBlank', tmpl:[['projNone', () => '']] },
  { id:'python', label:'Python', tmpl:[['projNone', () => ''], ['projVenv', () => runnerOf('python') + ' -m venv .']] },
  { id:'node', label:'Node.js', tmpl:[['projNone', () => ''], ['projNpm', () => 'npm init -y']] },
  { id:'rust', label:'Rust', tmpl:[['projNone', () => ''], ['projCargo', () => 'cargo init'], ['projCargoLib', () => 'cargo init --lib']] },
  { id:'go', label:'Go', tmpl:[['projNone', () => ''], ['projGoMod', n => runnerOf('go') + ' mod init ' + n]] },
  { id:'cpp', label:'C / C++', tmpl:[['projNone', () => '']] },
  { id:'csharp', label:'C#', tmpl:[['projNone', () => ''], ['projConsole', () => 'dotnet new console'], ['projClassLib', () => 'dotnet new classlib']] },
  { id:'java', label:'Java', tmpl:[['projNone', () => '']] },
  { id:'ruby', label:'Ruby', tmpl:[['projNone', () => '']] },
  { id:'php', label:'PHP', tmpl:[['projNone', () => '']] },
  { id:'lua', label:'Lua', tmpl:[['projNone', () => '']] },
  { id:'shell', label:'Shell', tmpl:[['projNone', () => '']] },
];
let projLangs = NEW_LANGS;
let dotnetTmpls = [];

//语言带生成器时用本机已装的模板，dotnet 装了新模板也能直接用
function tmplOf(l) {
  if (l.id !== 'csharp' || !dotnetTmpls.length) return l.tmpl;
  return [['projNone', () => '']].concat(dotnetTmpls.map(x => [x[0], () => runnerOf('csharp') + ' new ' + x[1]]));
}

function openNewProj() {
  if (!scanned) send('scanRun');
  send('projTmpls', (cfg.run || {}).csharp || 'dotnet');
  if (!npDir.value) npDir.value = cwdPath;
  npName.value = '';
  renderNewProj();
  npMask.classList.add('show');
  npName.focus();
}

//只列出本机已装的运行时，扫描前不过滤
function renderNewProj() {
  const cur = projLangs[+npLang.value] ? projLangs[+npLang.value].id : 'blank';
  projLangs = !scanned ? NEW_LANGS
    : NEW_LANGS.filter(l => l.id === 'blank' || (runs[l.id] || []).length || (cfg.run || {})[l.id]);
  const i = projLangs.findIndex(l => l.id === cur);
  npLang.innerHTML = projLangs.map((l, j) => `<option value="${j}">${esc(t(l.label))}</option>`).join('');
  npLang.value = Math.max(i, 0);
  renderNewTmpl();
}

function renderNewTmpl() {
  const l = projLangs[+npLang.value] || projLangs[0];
  const list = tmplOf(l);
  npTmpl.innerHTML = list.map((x, i) => `<option value="${i}">${esc(t(x[0]))}</option>`).join('');
  npTmpl.disabled = list.length < 2;
}

//先建目录，再在项目里跑模板命令，命令结束后由后端打开该项目
function createProject() {
  const name = npName.value.trim();
  const parent = npDir.value.trim();
  if (!parent) { toast('请选择项目位置', 'ℹ'); return; }
  if (!name) { toast('请填写项目名', 'ℹ'); return; }
  if (/[\\/:*?"<>|]/.test(name)) { toast('项目名含有非法字符', 'ℹ'); return; }
  if (/^\d/.test(name)) { toast('项目名首字符不能是数字', 'ℹ'); return; }
  const l = projLangs[+npLang.value] || projLangs[0];
  const list = tmplOf(l);
  const cmd = (list[+npTmpl.value] || list[0])[1](name);
  npMask.classList.remove('show');
  let tid = '';
  if (cmd) {
    showTerm();
    const t = activeTerm || newTerm(false);
    tid = t.id;
    termLine(tid, 'cmd', '> ' + cmd);
  }
  send('newProject', parent, name, cmd, tid);
}

//编译产物的默认路径
function exeOf(path) {
  return path.replace(/\.[^./\\]+$/, '') + '.exe';
}

//编译型语言的三段命令：只编译、编译并运行、直接运行
const BUILD_CMD = {
  cpp: {
    compile: p => `${runnerOf('cpp')} "${p}" -o "${exeOf(p)}"`,
    buildrun: p => chain(`${runnerOf('cpp')} "${p}" -o "${exeOf(p)}"`, `"${exeOf(p)}"`),
    direct: p => chain(`${runnerOf('cpp')} "${p}" -o "${exeOf(p)}"`, `"${exeOf(p)}"`),
  },
  rust: {
    compile: p => `${runnerOf('rust')} "${p}" -o "${exeOf(p)}"`,
    buildrun: p => chain(`${runnerOf('rust')} "${p}" -o "${exeOf(p)}"`, `"${exeOf(p)}"`),
    direct: p => chain(`${runnerOf('rust')} "${p}" -o "${exeOf(p)}"`, `"${exeOf(p)}"`),
  },
  go: {
    compile: p => `${runnerOf('go')} build -o "${exeOf(p)}" "${p}"`,
    buildrun: p => chain(`${runnerOf('go')} build -o "${exeOf(p)}" "${p}"`, `"${exeOf(p)}"`),
    direct: p => `${runnerOf('go')} run "${p}"`,
  },
  java: {
    compile: p => `javac "${p}"`,
    buildrun: p => chain(`javac "${p}"`, `java -cp "${dirName(p)}" "${baseName(p).replace(/\.[^.]+$/, '')}"`),
    direct: p => `java "${p}"`,
  },
  csharp: {
    compile: p => `${runnerOf('csharp')} build`,
    buildrun: p => `${runnerOf('csharp')} run`,
    direct: p => `${runnerOf('csharp')} run`,
  },
};

function projectBuild() {
  const list = root ? (children[root] || []) : [];
  const has = n => list.some(e => !e.dir && e.name.toLowerCase() === n);
  if (has('cargo.toml')) return 'cargo build';
  if (has('go.mod')) return 'go build';
  if (has('package.json')) return 'npm run build';
  if (has('makefile')) return 'make';
  if (has('pom.xml')) return 'mvn -q compile';
  if (has('gradlew.bat')) return 'gradlew.bat build';
  return '';
}

function projectRun() {
  const list = root ? (children[root] || []) : [];
  const has = n => list.some(e => !e.dir && e.name.toLowerCase() === n);
  if (has('build.bat')) return 'build.bat';
  if (has('build.cmd')) return 'build.cmd';
  if (has('build.ps1')) return 'powershell -File build.ps1';
  if (has('cargo.toml')) return 'cargo run';
  if (has('go.mod')) return 'go run .';
  if (has('package.json')) return 'npm start';
  if (has('makefile')) return 'make run';
  if (has('pom.xml')) return 'mvn -q spring-boot:run';
  if (has('gradlew.bat')) return 'gradlew.bat run';
  const p = list.find(e => !e.dir && /\.py$/i.test(e.name));
  if (p) return runnerOf('python') + ' "' + root + '\\' + p.name + '"';
  return '';
}

//按后缀取语言 id
function langOfPath(path) {
  const name = baseName(path).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? RUN_EXT[name.slice(dot)] : null;
}

//mode: compile 只编译、buildrun 编译并运行、run 直接运行
function fileRunCmd(path, mode) {
  const lang = langOfPath(path);
  if (!lang) return '';
  const b = BUILD_CMD[lang];
  if (!b) {
    if (mode === 'compile') return '';
    const r = runnerOf(lang);
    return r ? r + ' "' + path + '"' : '"' + path + '"';
  }
  const key = mode === 'compile' ? 'compile' : mode === 'buildrun' ? 'buildrun' : 'direct';
  return b[key](path);
}

//运行指定文件
function runFile(path, mode) {
  const m = mode || 'run';
  const c = fileRunCmd(path, m);
  if (!c) { toast('该文件类型不支持' + (m === 'compile' ? '编译' : '运行'), '⚠'); return; }
  runCmd(c, null, root);
}

//运行当前打开的文件，无源码文件时按项目配置编译
function detectRun(mode) {
  const m = mode || 'run';
  const name = active ? baseName(active).toLowerCase() : '';
  if (name && !PROJECT_FILES.includes(name)) {
    const c = fileRunCmd(active, m);
    if (c) return c;
  }
  if (m === 'compile') {
    const b = projectBuild();
    if (b) return b;
  }
  if (m === 'buildrun') {
    const b = projectBuild(), r = projectRun();
    if (b && r) return b + ' && ' + r;
  }
  const p = projectRun();
  if (p) return p;
  return 'echo 未识别的运行方式，请先打开源码文件或添加 build.bat';
}

//文件是否编译型，供 UI 判要显示哪些菜单
function fileLangInfo(path) {
  const lang = langOfPath(path);
  return { lang, compiled: !!BUILD_CMD[lang] };
}

/* ---------- 终端 ---------- */

//终端输出里的路径：绝对/UNC 路径可带 :行:列，相对路径必须带 :行 才认
const PATH_RE = /[A-Za-z]:[\\/][^\s<>"|?*]*|\\\\[^\s<>"|?*]+|[^\s<>"|?*:\\]+(?:[\\/][^\s<>"|?*:\\]+)+:\d+(?::\d+)?/g;

//吃后端 vt100 JSON 快照的极简终端渲染器
class VTerm {
  constructor(body) {
    this.body = body;
    this.body.tabIndex = 0;
    //用classList保留selectTerm已加上的on，否则新建的终端被display:none藏住
    this.body.classList.add('term-body');
    this.cols = 120;
    this.rows = 40;
    this._onData = null;
    this._onResize = null;
    this._lastHash = '';
    this._bindKeys();
    const ro = new ResizeObserver(() => { this.fit(); });
    ro.observe(body);
    this._ro = ro;
    this.fit();
  }
  onData(fn) { this._onData = fn; }
  onResize(fn) { this._onResize = fn; }
  focus() { this.body.focus(); }
  dispose() {
    this._ro.disconnect();
    this.body.removeEventListener('keydown', this._kd);
    this.body.removeEventListener('keypress', this._kp);
    this.body.removeEventListener('contextmenu', this._cm);
  }
  clear() { this._lastHash = ''; this.body.innerHTML = ''; }
  //取终端内选中的文本，无选中共返回空串
  _selText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
    return this.body.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel.toString() : '';
  }
  //复制选中文本，有内容返回 true
  _copySel() {
    const s = this._selText();
    if (!s) return false;
    copyText(s);
    return true;
  }
  fit() {
    const h = this.body.clientHeight;
    //面板藏起来时高度为零，算出来是错的，等 ResizeObserver 再算
    if (!h) return;
    const w = this.body.clientWidth || 800;
    const cs = getComputedStyle(this.body);
    let lh = parseFloat(cs.lineHeight) || 0;
    //行高无单位时拿到的是倍数，换算成像素
    if (lh < 4) lh = (parseFloat(cs.fontSize) || 13) * (lh || 1.35);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const cols = Math.max(20, Math.floor(w / 8));
    const rows = Math.max(5, Math.floor((h - pad) / lh));
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols; this.rows = rows;
      if (this._onResize) this._onResize({ cols, rows });
    }
  }
  //后端给的 JSON 形如 {"rows":[[{s:"f7",t:"hello"}...],"cursor":[c,r]}
  render(json) {
    if (!json || !json.rows) return;
    const hash = JSON.stringify(json);
    if (hash === this._lastHash) return;
    this._lastHash = hash;
    const html = json.rows.map(line => this._lineHtml(line)).join('') +
      `<span class="t-cur" style="order:2"></span>`;
    this.body.innerHTML = html;
    this.body.querySelectorAll('.t-link').forEach(a => {
      a.onclick = () => openTermPath(a.dataset.p);
    });
    //后端屏幕就是当前可视区，始终从顶部对齐，否则拉高后会把内容顶出视野
    this.body.scrollTop = 0;
  }
  //一行渲染：后端已按 style 分段，前端只把 style 串转成 CSS 类
  _lineHtml(line) {
    if (!line || !line.length) return '<div></div>';
    let out = '';
    for (const seg of line) {
      const cls = this._styleClass(seg.s);
      const t = seg.t || '';
      if (!t) continue;
      //这段内部再按路径 regex 切一下，命中路径的块换成 <a>
      PATH_RE.lastIndex = 0;
      let last = 0, m, spanHtml = '';
      while ((m = PATH_RE.exec(t))) {
        spanHtml += '<span class="' + cls + '">' + esc(t.slice(last, m.index)) + '</span>';
        spanHtml += '<a class="t-link ' + cls + '" data-p="' + esc(m[0]) + '">' + esc(m[0]) + '</a>';
        last = PATH_RE.lastIndex;
      }
      spanHtml += '<span class="' + cls + '">' + esc(t.slice(last)) + '</span>';
      out += spanHtml;
    }
    return '<div>' + out + '</div>';
  }
  //style 串 "f0 b3 B" → "t-f0 t-b3 t-b"
  _styleClass(s) {
    let cls = '';
    const parts = s.split(/\s+/).filter(Boolean);
    for (const p of parts) {
      if (p === 'B') cls += ' t-b';
      else if (p === 'U') cls += ' t-u';
      else if (p === 'I') cls += ' t-i';
      else if (p.startsWith('f')) {
        const n = p.slice(1);
        cls += ' t-f' + n;
      } else if (p.startsWith('b')) {
        const n = p.slice(1);
        cls += ' t-b' + n;
      }
    }
    return cls.trim();
  }
  _bindKeys() {
    this._kd = e => {
      //选中文字时不抢焦点，由上层 handle
      if (e.target !== this.body || document.activeElement !== this.body) return;
      const map = {
        Backspace:'\x7f', Enter:'\r', Tab:'\t',
        ArrowUp:'\x1b[A', ArrowDown:'\x1b[B', ArrowRight:'\x1b[C', ArrowLeft:'\x1b[D',
        Home:'\x1b[H', End:'\x1b[F',
      };
      if (map[e.key]) { e.preventDefault(); if (this._onData) this._onData(map[e.key]); return; }
      //修饰键组合（Ctrl+C / Ctrl+D 等）
      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const c = e.key.toLowerCase();
        //有选中文本时 Ctrl+C 复制，否则原样发中断
        if (c === 'c' && this._copySel()) { e.preventDefault(); return; }
        const n = c.charCodeAt(0);
        if (n >= 97 && n <= 122) {
          e.preventDefault();
          if (this._onData) this._onData(String.fromCharCode(n - 96));
        }
      }
    };
    this._kp = e => {
      if (e.target !== this.body) return;
      const c = e.key;
      if (c.length === 1) {
        e.preventDefault();
        if (this._onData) this._onData(c);
      }
    };
    this.body.addEventListener('keydown', this._kd);
    this.body.addEventListener('keypress', this._kp);
    //右键复制选中文本，同时屏蔽原生菜单
    this._cm = e => { e.preventDefault(); this._copySel(); };
    this.body.addEventListener('contextmenu', this._cm);
    //点击 body 获得焦点
    this.body.addEventListener('mousedown', () => { setTimeout(() => this.body.focus(), 0); });
  }
}

const terms = [];
let activeTerm = null;
let termSeq = 0;

function termOf(id) {
  return terms.find(t => t.id === id) || null;
}

//把已建的终端实例真正跑起来：挂 VTerm、配回调、补攒下的输出、再启动外壳
function attachTerm(t) {
  t.term = new VTerm(t.body);
  t.term.onData(d => send('termWrite', t.id, d));
  t.term.onResize(({ cols, rows }) => send('termResize', t.id, cols, rows));
  t.pend.splice(0).forEach(s => t.term.render(JSON.parse(s)));
  send('termOpen', t.id, t.term.cols, t.term.rows, t.cwd || '.', shellDef().line);
  t.open = true;
  t.in.splice(0).forEach(s => send('termWrite', t.id, s));
  //30fps 主动拉屏幕快照
  t._poll = setInterval(() => send('termPoll', t.id), 33);
  if (t === activeTerm) t.term.focus();
}

function newTerm(focus) {
  const nt = { id: 't' + (++termSeq), name: (shellDef().tab || 'sh') + ' ' + termSeq, cwd: root || cwdPath, body: null, term: null, pend: [], in: [], open: false };
  nt.body = document.createElement('div');
  nt.body.className = 'term-body';
  termBodies.appendChild(nt.body);
  terms.push(nt);
  selectTerm(nt, focus);
  attachTerm(nt);
  return nt;
}

function selectTerm(t, focus) {
  activeTerm = t;
  terms.forEach(x => x.body.classList.toggle('on', x === t));
  cwdPath = t.cwd || cwdPath;
  renderTermTabs();
  fitTerm();
  if (focus && t.term) t.term.focus();
}

function closeTerm(t) {
  const i = terms.indexOf(t);
  if (i < 0) return;
  terms.splice(i, 1);
  if (t._poll) { clearInterval(t._poll); t._poll = 0; }
  send('termClose', t.id);
  if (t.term) t.term.dispose();
  t.body.remove();
  renderTermTabs();
  //全部关闭后收起终端面板
  if (!terms.length) {
    activeTerm = null;
    hideTerm();
    return;
  }
  if (activeTerm === t) selectTerm(terms[Math.min(i, terms.length - 1)], true);
}

function renderTermTabs() {
  termTabs.innerHTML = terms.map(t => `<div class="term-tab${t === activeTerm ? ' on' : ''}" data-t="${t.id}">${esc(t.name)}<span class="term-x" data-x="${t.id}">×</span></div>`).join('') + '<button class="term-new" id="termNew">+</button>';
}

termTabs.addEventListener('click', e => {
  const x = e.target.closest('.term-x');
  if (x) {
    const t = termOf(x.dataset.x);
    if (t) closeTerm(t);
    return;
  }
  if (e.target.closest('.term-new')) {
    newTerm(true);
    return;
  }
  const tab = e.target.closest('.term-tab');
  if (!tab) return;
  const t = termOf(tab.dataset.t);
  if (t) selectTerm(t, true);
});

//点终端里的路径：带行号直接跳到文件，否则交给后端判断文件还是目录
function openTermPath(p) {
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(p);
  let path = m ? m[1] : p, line = m ? +m[2] : 0;
  if (!/^[A-Za-z]:/.test(path) && !path.startsWith('\\\\')) {
    const b = (activeTerm && activeTerm.cwd) || cwdPath || root;
    if (!b) { toast('未知路径', 'ℹ'); return; }
    path = b.replace(/[\\/]+$/, '') + '\\' + path;
  }
  if (line) { openFileAt(path, line); return; }
  setView('explorer');
  //先把从根目录到目标的祖先展开，否则树里看不到这一项
  if (root && path.toLowerCase().startsWith(root.toLowerCase() + '\\')) {
    const segs = path.slice(root.length + 1).split('\\');
    let cur = root;
    for (let i = 0; i < segs.length - 1; i++) {
      cur += '\\' + segs[i];
      if (!children[cur]) send('readDir', cur);
      expanded.add(cur);
    }
  }
  send('reveal', path);
}

//把输入送进外壳，外壳未就绪时先攒着
function writeTerm(t, data) {
  if (t.open) send('termWrite', t.id, data);
  else t.in.push(data);
}

//往终端里追加一段装饰文本（echo/退出/错误提示），不影响 vt100 屏幕状态
function termText(t, cls, text) {
  const color = cls === 'err' ? 't-f1' : cls === 'cmd' ? 't-f6' : 't-f8';
  const html = '<div class="' + color + '">' + esc(text) + '</div>';
  if (t.term) {
    t.term.body.insertAdjacentHTML('beforeend', html);
    t.term.body.scrollTop = t.term.body.scrollHeight;
  }
}

function termLine(tid, cls, text) {
  const t = termOf(tid);
  if (t) termText(t, cls, text);
}

$('termClear').onclick = () => { if (activeTerm && activeTerm.term) activeTerm.term.clear(); };
$('outClear').onclick = () => { outBody.innerHTML = ''; };

function showTerm() {
  terminalEl.classList.remove('hidden');
  document.querySelector('[data-act="term"]').classList.add('on');
  if (!terms.length) newTerm(true);
  showPanel('term');
}

function hideTerm() {
  terminalEl.classList.add('hidden');
  document.querySelector('[data-act="term"]').classList.remove('on');
}

//终端要按可见区域重算行列，藏起来时算出来是零
function fitTerm() {
  if (terminalEl.classList.contains('hidden') || curPanel !== 'term') return;
  if (activeTerm && activeTerm.term) activeTerm.term.fit();
}

//当前底部面板，清空按钮按它决定清哪一页
let curPanel = 'term';

function showPanel(p) {
  curPanel = p;
  $('panelTerm').classList.toggle('on', p === 'term');
  $('panelProb').classList.toggle('on', p === 'prob');
  panelOutEl.classList.toggle('on', p === 'out');
  $('panelDbg').classList.toggle('on', p === 'dbg');
  termToolsEl.classList.toggle('hidden', p !== 'term');
  document.querySelector('.panel-term').classList.toggle('hidden', p !== 'term');
  $('panelProbBox').classList.toggle('hidden', p !== 'prob');
  panelOutBox.classList.toggle('hidden', p !== 'out');
  $('panelDbgBox').classList.toggle('hidden', p !== 'dbg');
  if (p === 'out') outBody.scrollTop = outBody.scrollHeight;
  if (p === 'prob') setProbMode(probMode);
  if (p === 'term') fitTerm();
  if (p === 'dbg') terminalEl.classList.remove('hidden');
}

document.querySelector('.panel-tabs').addEventListener('click', e => {
  const b = e.target.closest('.panel-tab');
  if (b) showPanel(b.dataset.panel);
});

function toggleTerm() {
  if (terminalEl.classList.contains('hidden')) showTerm();
  else hideTerm();
}

function toggleSide() {
  sidebarEl.classList.toggle('hidden');
  saveSettings();
}

/* ---------- 工具栏 ---------- */
document.querySelector('.toolbar').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'file' || act === 'run' || act === 'runmenu') e.stopPropagation();
  switch (act) {
    case 'file': toggleFileMenu(); break;
    case 'save': save(); break;
    case 'run': runCurrent(); break;
    case 'runmenu': openRunMenu(); break;
    case 'term': toggleTerm(); break;
    case 'debug': dbgStartFlow(); break;
    case 'palette': openPalette(); break;
    case 'set': openSet(); break;
  }
});

/* ---------- 运行方式菜单 ---------- */

//编译型文件先选运行方式，脚本语言直接运行
function runCurrent() {
  const info = active ? fileLangInfo(active) : null;
  if (info && info.compiled) { openRunMenu(); return; }
  runCmd(detectRun('run'), null, root);
}

function openRunMenu() {
  const r = document.querySelector('[data-act="run"]').getBoundingClientRect();
  runMenuEl.style.left = Math.min(r.left, window.innerWidth - 170) + 'px';
  runMenuEl.style.top = r.bottom + 2 + 'px';
  runMenuEl.classList.add('show');
}

runMenuEl.addEventListener('click', e => {
  const it = e.target.closest('[data-r]');
  if (!it) return;
  runMenuEl.classList.remove('show');
  const r = it.dataset.r;
  if (r === 'debug') { dbgStartFlow(); return; }
  if (r === 'runargs') { runWithArgs(); return; }
  if (r === 'admin') { runAdmin(detectRun('run')); return; }
  runCmd(detectRun(r), null, root);
});

/* ---------- 命令面板 ---------- */
const paletteMask = $('paletteMask');
const paletteInput = $('paletteInput');
const paletteList = $('paletteList');
let paletteSel = 0;

//关闭除当前外的所有编辑器
function closeOthers() {
  if (!active) return;
  const keep = active;
  for (const p of [...openTabs]) {
    if (p !== keep) closeTab(p);
  }
}

//关闭全部编辑器
function closeAll() {
  for (const p of [...openTabs]) closeTab(p);
}

//调整编辑器字号，d为0表示恢复默认
function zoomFont(d) {
  const cur = cfg.fontSize || 13;
  const next = d === 0 ? 13 : Math.min(40, Math.max(8, cur + d));
  if (next === cur) return;
  cfg.fontSize = next;
  applyEditor();
  saveSettings();
}

//导出当前文件的符号列表，走命令面板选择跳转
async function goToSymbol() {
  if (!active) { toast(t('noResult'), '⚠'); return; }
  let list = outlineSyms;
  const s = lspEnsure(lspLang(active));
  if (!list.length && s && s.ready) {
    const r = await lspReq(s, 'textDocument/documentSymbol', { textDocument:{ uri:lspUri(active) } }, 3000);
    list = Array.isArray(r) ? flatSyms(r) : [];
  }
  if (!list.length) { toast(t('outlineNone'), '⚠'); return; }
  openPalette(list.map(x => ({
    label: (x.depth ? '  '.repeat(x.depth) : '') + x.name + '  :' + x.line,
    fn: () => gotoLine(x.line),
  })));
}

const COMMANDS = [
  { k: 'cmdOpen', fn: openFolderCmd },
  { k: 'cmdOpenFile', fn: () => send('openFileDialog') },
  { k: 'cmdNewWindow', fn: () => send('newWindow') },
  { k: 'cmdNewProject', fn: openNewProj },
  { k: 'cmdNewFile', fn: () => { ctxDir = active ? dirName(active) : root; openDlg(t('newFile'), true, n => send('create', ctxDir, n, '0')); } },
  { k: 'cmdNewFolder', fn: () => { ctxDir = active ? dirName(active) : root; openDlg(t('newFolder'), true, n => send('create', ctxDir, n, '1')); } },
  { k: 'cmdSave', hint: 'Ctrl+S', fn: save },
  { k: 'cmdCloseTab', fn: () => { if (active) closeTab(active); } },
  { k: 'cmdCloseOthers', fn: closeOthers },
  { k: 'cmdCloseAll', fn: closeAll },
  { k: 'cmdRun', hint: 'Ctrl+Enter', fn: () => runCmd(detectRun('run'), null, root) },
  { k: 'cmdCompile', hint: 'Ctrl+Shift+Enter', fn: () => runCmd(detectRun('compile'), null, root) },
  { k: 'cmdSide', hint: 'Ctrl+B', fn: toggleSide },
  { k: 'cmdTerm', fn: toggleTerm },
  { k: 'cmdDebug', hint: 'F5', fn: () => dbgStartFlow() },
  { k: 'cmdDebugToggleBp', hint: 'F9', fn: () => { if (active) toggleBp(active, curLine()); } },
  { k: 'cmdDebugContinue', fn: () => dbgCmd('continue') },
  { k: 'cmdDebugStop', hint: 'Shift+F5', fn: dbgStop },
  { k: 'cmdDebugPanel', fn: () => showPanel('dbg') },
  { k: 'cmdDebugView', fn: () => setView('debug') },
  { k: 'cmdClearTerm', fn: () => { if (activeTerm && activeTerm.term) activeTerm.term.clear(); } },
  { k: 'cmdExplorer', fn: () => setView('explorer') },
  { k: 'cmdOutline', fn: () => setView('outline') },
  { k: 'cmdSearchWs', fn: () => setView('search') },
  { k: 'cmdRefresh', hint: 'F5', fn: refreshTree },
  { k: 'cmdFind', hint: 'Ctrl+F', fn: () => openFind(false) },
  { k: 'cmdGoLine', fn: () => openDlg(t('goLine'), true, n => { const v = parseInt(n, 10); if (v) gotoLine(v); }) },
  { k: 'cmdSymbol', fn: goToSymbol },
  { k: 'cmdPreview', fn: () => { if (active && previewKind(active)) pvBtn.onclick(); } },
  { k: 'cmdProbPanel', fn: () => { showTerm(); showPanel('prob'); } },
  { k: 'cmdOutPanel', fn: () => { showTerm(); showPanel('out'); } },
  { k: 'cmdUndo', fn: undo },
  { k: 'cmdRedo', fn: redo },
  { k: 'cmdSelectAll', fn: () => { if (active) { taEl.focus(); taEl.select(); } } },
  { k: 'cmdZoomIn', fn: () => zoomFont(1) },
  { k: 'cmdZoomOut', fn: () => zoomFont(-1) },
  { k: 'cmdZoomReset', fn: () => zoomFont(0) },
  { k: 'cmdGotoDef', fn: gotoDef },
  { k: 'cmdFormat', hint: 'Shift+Alt+F', fn: formatDoc },
  { k: 'cmdRename', hint: 'F2', fn: renameSymbol },
  { k: 'cmdRefs', hint: 'Shift+F12', fn: findRefs },
  { k: 'cmdRestartLsp', fn: lspReset },
  { k: 'cmdChat', hint: 'Ctrl+U', fn: () => toggleChat() },
  { k: 'cmdNewChat', fn: newChat },
  { k: 'cmdHistory', fn: () => { toggleChat(true); openHist(); } },
  { k: 'cmdGit', fn: () => setView('git') },
  { k: 'cmdGitRefresh', fn: gitRefresh },
  { k: 'cmdGitCommit', fn: gitCommit },
  { k: 'cmdGitPull', fn: gitPull },
  { k: 'cmdGitPush', fn: gitPush },
];

let paletteCmds = COMMANDS;

function openPalette(list) {
  paletteCmds = list || COMMANDS;
  paletteMask.classList.add('show');
  paletteInput.value = '';
  paletteSel = 0;
  renderPalette('');
  paletteInput.focus();
}

function closePalette() {
  paletteMask.classList.remove('show');
  paletteCmds = COMMANDS;
}

function renderPalette(q) {
  const tx = c => c.label || t(c.k);
  const list = paletteCmds.filter(c => tx(c).toLowerCase().includes(q.toLowerCase()));
  paletteList._list = list;
  paletteList.innerHTML = list.map((c, i) =>
    `<div class="palette-item${i === paletteSel ? ' sel' : ''}" data-i="${i}">
      ${esc(tx(c))}${c.hint ? `<span class="hint">${c.hint}</span>` : ''}
    </div>`
  ).join('') || `<div class="palette-item">${esc(t('cmdNoMatch'))}</div>`;
}

paletteInput.addEventListener('input', () => {
  paletteSel = 0;
  renderPalette(paletteInput.value);
});

paletteInput.addEventListener('keydown', e => {
  const list = paletteList._list || [];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    paletteSel = Math.min(paletteSel + 1, list.length - 1);
    renderPalette(paletteInput.value);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    paletteSel = Math.max(paletteSel - 1, 0);
    renderPalette(paletteInput.value);
  } else if (e.key === 'Enter') {
    const cmd = list[paletteSel];
    if (cmd) { closePalette(); cmd.fn(); }
  } else if (e.key === 'Escape') {
    closePalette();
  }
});

paletteList.addEventListener('click', e => {
  const item = e.target.closest('.palette-item');
  if (!item || item.dataset.i === undefined) return;
  const cmd = paletteList._list[+item.dataset.i];
  if (cmd) { closePalette(); cmd.fn(); }
});

paletteMask.addEventListener('click', e => { if (e.target === paletteMask) closePalette(); });

document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  //功能键交给IDE，避免WebView2的刷新/查找
  if (/^F\d+$/.test(e.key)) {
    e.preventDefault();
    if (e.key === 'F1') openPalette();
    if (e.key === 'F2') renameSymbol();
    if (e.key === 'F5') refreshTree();
    if (e.key === 'F12' && e.shiftKey) findRefs();
    return;
  }
  if (ctrl && k === 's') { e.preventDefault(); save(); return; }
  if (ctrl && k === 'f') { e.preventDefault(); openFind(false); return; }
  if (ctrl && k === 'h') { e.preventDefault(); openFind(true); return; }
  if (ctrl && k === 'i') { e.preventDefault(); keyboardHover(); return; }
  if (e.altKey && e.shiftKey && k === 'f') { e.preventDefault(); formatDoc(); return; }
  //焦点在终端里时，其余按键交给终端外壳
  if (document.activeElement && document.activeElement.classList.contains('term-body')) return;
  if (ctrl && k === 'b') { e.preventDefault(); toggleSide(); return; }
  if (e.ctrlKey && e.shiftKey) {
    if (k === '/') { e.preventDefault(); toggleComment(); return; }
    if (k === ']') { e.preventDefault(); indentSelection(); return; }
    if (k === '[') { e.preventDefault(); dedentSelection(); return; }
  }
  if (ctrl && k === 'd') { e.preventDefault(); deleteLine(); return; }
  if (ctrl && k === 'enter') {
    e.preventDefault();
    runCmd(detectRun(e.shiftKey ? 'compile' : 'run'), null, root);
    return;
  }
  if (ctrl && k === 'p') { e.preventDefault(); openPalette(); return; }
  if (ctrl && k === 'u') { e.preventDefault(); toggleChat(); return; }
  //焦点在输入框里时 Delete 还是删字符
  if (e.key === 'Delete' && selPath && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    askDelete(selPath);
    return;
  }
  if (e.key === 'Escape') {
    closePalette();
    ctxEl.classList.remove('show');
    fileMenuEl.classList.remove('show');
    closeSet();
    closeHist();
    closeFind();
    hidePop();
    actEl.classList.remove('show');
  }
});

/* ---------- 终端高度拖拽 ---------- */
const handle = $('handle');

handle.addEventListener('mousedown', e => {
  handle.classList.add('dragging');
  const startY = e.clientY;
  const startH = terminalEl.offsetHeight;

  const move = ev => {
    const h = Math.max(60, Math.min(window.innerHeight - 200, startH - (ev.clientY - startY)));
    terminalEl.style.height = h + 'px';
    requestAnimationFrame(fitTerm);
  };

  const up = () => {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };

  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  e.preventDefault();
});

window.addEventListener('resize', fitTerm);

/* ---------- 侧栏宽度拖拽 ---------- */
const vhandle = $('vhandle');

vhandle.addEventListener('mousedown', e => {
  vhandle.classList.add('dragging');
  const startX = e.clientX;
  const startW = sidebarEl.offsetWidth;
  //拖拽期间关掉过渡，否则宽度会滞后于鼠标
  sidebarEl.style.transition = 'none';

  const move = ev => {
    //最小 160 保证拖到最窄也不会消失
    const w = Math.max(160, Math.min(600, startW + (ev.clientX - startX)));
    sidebarEl.classList.remove('hidden');
    sidebarEl.style.setProperty('--side-w', w + 'px');
  };

  const up = () => {
  sideTitle.textContent = v === 'debug' ? t('dbg') : t(v);
    sidebarEl.style.transition = '';
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    saveSettings();
  };

  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  e.preventDefault();
});

/* ---------- AI 面板宽度拖拽 ---------- */
chatH.addEventListener('mousedown', e => {
  chatH.classList.add('dragging');
  const startX = e.clientX;
  const startW = chatEl.offsetWidth;
  //拖拽期间关掉过渡，否则宽度会滞后于鼠标
  chatEl.style.transition = 'none';

  const move = ev => {
    //最小 220，留出编辑区
    const w = Math.max(220, Math.min(window.innerWidth - 320, startW - (ev.clientX - startX)));
    chatEl.style.setProperty('--chat-w', w + 'px');
  };

  const up = () => {
    chatH.classList.remove('dragging');
    chatEl.style.transition = '';
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    saveSettings();
  };

  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  e.preventDefault();
});

/* ---------- 活动栏 ---------- */
function setView(v) {
  curView = v;
  sidebarEl.classList.remove('hidden');
  sideTitle.textContent = t(v);
  treeEl.style.display = v === 'explorer' ? '' : 'none';
  searchView.classList.toggle('hidden', v !== 'search');
  outlineView.classList.toggle('hidden', v !== 'outline');
  gitView.classList.toggle('hidden', v !== 'git');
  $('debugView').classList.toggle('hidden', v !== 'debug');
  //AI 图标由 toggleChat 单独维护，切视图不碰它
  document.querySelectorAll('#activity .act').forEach(b => {
    if (b.dataset.view !== 'ai') b.classList.toggle('on', b.dataset.view === v);
  });
  if (v === 'search') searchInput.focus();
  if (v === 'outline') outlineSync(true);
  if (v === 'git') gitRefresh();
  if (v === 'debug') { renderDbgConf(); renderBps(); renderWatch(); renderStack(); }
  saveSettings();
}

$('activity').addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  const v = b.dataset.view;
  if (v === 'ai') { toggleChat(); return; }
  setView(v);
});

/* ---------- 文件菜单 ---------- */
function toggleFileMenu() {
  if (fileMenuEl.classList.contains('show')) {
    fileMenuEl.classList.remove('show');
    return;
  }
  const r = document.querySelector('[data-act="file"]').getBoundingClientRect();
  fileMenuEl.style.left = r.left + 'px';
  fileMenuEl.style.top = (r.bottom + 2) + 'px';
  fileMenuEl.classList.add('show');
}

fileMenuEl.addEventListener('click', e => {
  const it = e.target.closest('[data-f]');
  if (!it) return;
  fileMenuEl.classList.remove('show');
  const a = it.dataset.f;
  if (a === 'newf') {
    ctxDir = root || (active ? dirName(active) : '');
    openDlg(t('newFile'), true, n => send('create', ctxDir, n, '0'));
  }
  if (a === 'neww') send('newWindow');
  if (a === 'newp') openNewProj();
  if (a === 'openf') send('openFileDialog');
  if (a === 'opend') openFolderCmd();
});

//已有文件夹时再开一个走新窗口，避免顶掉当前窗口
function openFolderCmd() {
  send(root ? 'openFolderNew' : 'openFolder');
}

/* ---------- 搜索 ---------- */
let srHits = [], srSel = -1;
//被折叠的文件分组
const srCollapsed = new Set();

//搜索选项拼成的标志串
function srFlags() {
  return (srRe.checked ? 'r' : '') + (srCase.checked ? 'c' : '') + (srWord.checked ? 'w' : '');
}

function doSearch() {
  const q = searchInput.value;
  srHits = [];
  srSel = -1;
  srCollapsed.clear();
  if (!q.trim()) { searchResults.innerHTML = ''; return; }
  if (!root) { searchResults.innerHTML = `<div class="sr-none">${esc(t('needFolder'))}</div>`; return; }
  searchResults.innerHTML = `<div class="sr-none">${esc(t('searching'))}</div>`;
  send('search', root, q, srFlags());
}

//结果按文件分组，点文件行可折叠该组
function renderSr() {
  if (!srHits.length) {
    searchResults.innerHTML = `<div class="sr-none">${esc(t('noResult'))}</div>`;
    return;
  }
  const groups = new Map();
  srHits.forEach((x, i) => {
    const g = groups.get(x.path);
    if (g) g.push(i);
    else groups.set(x.path, [i]);
  });
  let h = '';
  for (const [path, list] of groups) {
    const col = srCollapsed.has(path);
    h += `<div class="sr-file${col ? ' col' : ''}" data-file="${esc(path)}" title="${esc(path)}">
      <span class="arw">${col ? '▸' : '▾'}</span><span class="p">${esc(relPath(path))}</span><span class="cnt">${list.length}</span></div>`;
    if (col) continue;
    for (const i of list) {
      const x = srHits[i];
      h += `<div class="sr-hit" data-i="${i}" data-path="${esc(x.path)}" data-line="${x.line}">
        <span class="ln">${x.line}</span>${esc(x.text.trim())}</div>`;
    }
  }
  searchResults.innerHTML = h;
}

//按当前选项构造替换用正则，非法返回null
function srPattern(q) {
  if (q === undefined) q = searchInput.value;
  if (!q) return null;
  let p = srRe.checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (srWord.checked) p = `(?<![\\w$])(?:${p})(?![\\w$])`;
  try {
    return new RegExp(p, srCase.checked ? 'g' : 'gi');
  } catch (e) {
    toast('正则表达式不合法', '⚠');
    return null;
  }
}

//读取文件当前文本，已打开的标签用缓冲区内容
async function textOf(path) {
  if (path in buffers) return buffers[path];
  const r = await readFile(path);
  return r.ok ? r.text : null;
}

//把一组文件改动写成一步历史并落盘，返回写盘完成的 Promise
function commit(edits) {
  if (!edits.length) return Promise.resolve();
  seal();
  const files = edits.map(e => ({ path:e.path, before:e.before, after:e.after, sel:0, selAfter:0 }));
  pushAction({ files, disk:true });
  const writes = files.map(f => putText(f.path, f.after, 0, true));
  renderTabs();
  updateStatus();
  saveSettings();
  return Promise.all(writes);
}

//替换当前选中的那条结果，没选中就替换第一条
async function replaceOne() {
  const re = srPattern();
  if (!re) return;
  const hit = srHits[srSel >= 0 ? srSel : 0];
  if (!hit) { toast(t('replaceNone'), '⚠'); return; }
  const text = await textOf(hit.path);
  if (text === null) { toast(t('replaceFail'), '⚠'); return; }
  const lines = text.split('\n');
  const i = hit.line - 1;
  if (i < 0 || i >= lines.length) return;
  const one = new RegExp(re.source, re.flags.replace('g', ''));
  if (!one.test(lines[i])) { toast(t('replaceNone'), '⚠'); return; }
  lines[i] = lines[i].replace(one, () => replaceInput.value);
  await commit([{ path:hit.path, before:text, after:lines.join('\n') }]);
  //替换完在编辑区打开对应文件，方便直接看改动
  openFileAt(hit.path, hit.line, searchInput.value);
  doSearch();
}

//替换结果涉及的所有文件
async function replaceAll() {
  const re = srPattern();
  if (!re) return;
  if (!srHits.length) { toast(t('replaceNone'), '⚠'); return; }
  const edits = [];
  for (const p of [...new Set(srHits.map(h => h.path))]) {
    const text = await textOf(p);
    if (text === null) continue;
    let n = 0;
    const after = text.replace(re, () => { n++; return replaceInput.value; });
    if (n) edits.push({ path:p, before:text, after });
  }
  if (!edits.length) { toast(t('replaceNone'), '⚠'); return; }
  await commit(edits);
  toast(t('replaced', edits.length));
  //替换完在编辑区打开第一个被改的文件
  const first = srHits.find(h => h.path === edits[0].path);
  openFileAt(edits[0].path, first ? first.line : 1, searchInput.value);
  doSearch();
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 250);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(); }
});
srRe.addEventListener('change', doSearch);
srCase.addEventListener('change', doSearch);
srWord.addEventListener('change', doSearch);
srReplaceOne.onclick = replaceOne;
srReplaceAll.onclick = replaceAll;

searchResults.addEventListener('click', e => {
  const f = e.target.closest('.sr-file');
  if (f) {
    const p = f.dataset.file;
    if (srCollapsed.has(p)) srCollapsed.delete(p);
    else srCollapsed.add(p);
    const top = searchResults.scrollTop;
    renderSr();
    searchResults.scrollTop = top;
    return;
  }
  const it = e.target.closest('.sr-hit');
  if (!it) return;
  srSel = +it.dataset.i;
  openFileAt(it.dataset.path, +it.dataset.line, searchInput.value);
});

function openFileAt(path, line, q) {
  openFile(path);
  if (path in buffers) gotoLine(line, q);
  else pendingLine = { path, line, q };
}

//跳到指定行，给了查询词就把命中的那段选中，方便一眼看到
function gotoLine(n, q) {
  unfoldAll();
  const lines = taEl.value.split('\n');
  const i = Math.max(0, Math.min(n - 1, lines.length - 1));
  let idx = 0;
  for (let k = 0; k < i; k++) idx += lines[k].length + 1;
  let len = 0;
  const re = q ? srPattern(q) : null;
  if (re) {
    const m = re.exec(lines[i]);
    if (m && m[0]) {
      idx += m.index;
      len = m[0].length;
    }
  }
  taEl.focus();
  taEl.selectionStart = idx;
  taEl.selectionEnd = idx + len;
  taEl.scrollTop = Math.max(0, i * 20 - 60);
  syncScroll();
  updateStatus();
}

/* ---------- 文件内查找 ---------- */
function findRegex(q) {
  if (!q) return null;
  let p = findRe.checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (findWord.checked) p = `(?<![\\w$])(?:${p})(?![\\w$])`;
  try {
    return new RegExp(p, findCase.checked ? 'g' : 'gi');
  } catch (e) {
    return null;
  }
}

function findRangesNow() {
  if (!findOpenFlag || !active || !findInput.value) return [];
  const re = findRegex(findInput.value);
  findInput.classList.toggle('bad', !re);
  if (!re) return [];
  const text = taEl.value, out = [];
  let m;
  while ((m = re.exec(text))) {
    if (!m[0].length) { re.lastIndex++; continue; }
    out.push({ start:m.index, end:m.index + m[0].length });
    if (out.length >= FIND_MAX) break;
  }
  return out;
}

function findScan(keep) {
  findRanges = findRangesNow();
  if (!keep || findCur < 0 || findCur >= findRanges.length) {
    const pos = taEl.selectionStart;
    const i = findRanges.findIndex(r => r.start >= pos);
    findCur = i < 0 ? (findRanges.length ? 0 : -1) : i;
  }
  findCount.textContent = findRanges.length ? (findCur + 1) + '/' + findRanges.length : '';
  paintCode();
}

function findGo() {
  const r = findRanges[findCur];
  if (!r) return;
  taEl.focus();
  taEl.selectionStart = r.start;
  taEl.selectionEnd = r.end;
  const line = taEl.value.slice(0, r.start).split('\n').length - 1;
  taEl.scrollTop = Math.max(0, line * 20 - editorEl.clientHeight / 2 + 20);
  syncScroll();
  updateStatus();
  findCount.textContent = (findCur + 1) + '/' + findRanges.length;
  paintCode();
}

function findNext(dir) {
  if (!findRanges.length) findScan();
  if (!findRanges.length) return;
  if (findCur < 0) findCur = dir > 0 ? 0 : findRanges.length - 1;
  else findCur = (findCur + dir + findRanges.length) % findRanges.length;
  findGo();
}

function openFind(rep) {
  if (!active) return;
  findOpenFlag = true;
  findBar.classList.remove('hidden');
  if (rep) {
    findRepRow.classList.remove('hidden');
    findTogRep.textContent = '▴';
  }
  const sel = taEl.value.slice(taEl.selectionStart, taEl.selectionEnd);
  if (sel && !sel.includes('\n')) findInput.value = sel;
  findInput.focus();
  findInput.select();
  findScan();
}

function closeFind() {
  if (!findOpenFlag) return;
  findOpenFlag = false;
  findBar.classList.add('hidden');
  findRanges = [];
  findCur = -1;
  requestHighlight();
  taEl.focus();
}

//查找替换只标脏不落盘，与其它编辑一致
function findEdit(after, sel) {
  const before = taEl.value;
  if (after === before) return;
  seal();
  pushAction({ files:[{ path:active, before, after, sel, selAfter:sel }], disk:false });
  putText(active, after, sel, false);
  renderTabs();
  findScan();
}

function findReplaceOne() {
  if (!findRanges.length) findScan();
  const r = findRanges[findCur];
  if (!r) { findNext(1); return; }
  const text = taEl.value;
  const rep = findRepInput.value;
  findEdit(text.slice(0, r.start) + rep + text.slice(r.end), r.start + rep.length);
  findNext(1);
}

function findReplaceAll() {
  if (!findRanges.length) findScan();
  if (!findRanges.length) return;
  const text = taEl.value;
  const rep = findRepInput.value;
  let out = '', last = 0;
  for (const r of findRanges) { out += text.slice(last, r.start) + rep; last = r.end; }
  out += text.slice(last);
  findEdit(out, 0);
}

findInput.addEventListener('input', () => findScan());
findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); findScan(); findNext(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
findRepInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
findCase.addEventListener('change', () => findScan());
findWord.addEventListener('change', () => findScan());
findRe.addEventListener('change', () => findScan());
findPrevBtn.onclick = () => findNext(-1);
findNextBtn.onclick = () => findNext(1);
findRepOneBtn.onclick = findReplaceOne;
findRepAllBtn.onclick = findReplaceAll;
findCloseBtn.onclick = closeFind;
findTogRep.onclick = () => {
  const hide = !findRepRow.classList.contains('hidden');
  findRepRow.classList.toggle('hidden', hide);
  findTogRep.textContent = hide ? '▾' : '▴';
  if (!hide) findRepInput.focus();
};

/* ---------- Git ---------- */
//跑一条git命令，30秒内没结果就当失败，避免面板被卡死；带序号防止迟到结果错配
function gitRun(sub, args) {
  return new Promise(res => {
    const id = ++gitSeq;
    gitWait = { id, res };
    setTimeout(() => {
      if (!gitWait || gitWait.id !== id) return;
      gitWait = null;
      res(null);
    }, 30000);
    send('git', String(id), sub, (args || []).join('\u0002'));
  });
}

//解析 git status --porcelain=v1 -b 的输出
function parseGitStatus(out) {
  const st = { branch:'', detached:false, ahead:0, behind:0, staged:[], changes:[] };
  for (const ln of out.split(/\r?\n/)) {
    if (!ln) continue;
    if (ln.startsWith('## ')) {
      const s = ln.slice(3);
      if (s.startsWith('No commits yet on ')) { st.branch = s.replace(/^No commits yet on /, ''); continue; }
      if (s.startsWith('HEAD (no branch)')) { st.detached = true; st.branch = 'HEAD'; continue; }
      st.branch = s.split(' ')[0].split('...')[0];
      const a = s.match(/ahead (\d+)/); st.ahead = a ? +a[1] : 0;
      const b = s.match(/behind (\d+)/); st.behind = b ? +b[1] : 0;
      continue;
    }
    if (ln.length < 4) continue;
    const x = ln[0], y = ln[1];
    let p = ln.slice(3);
    if (p.includes(' -> ')) p = p.split(' -> ')[1];
    if (x === '?' && y === '?') { st.changes.push({ x:'?', y:'?', path:p }); continue; }
    if (x !== ' ') st.staged.push({ x, y, path:p });
    if (y !== ' ') st.changes.push({ x, y, path:p });
  }
  return st;
}

async function gitRefresh() {
  if (!root) { gitState = { noFolder:true }; renderGit(); return; }
  if (gitBusy) return;
  gitBusy = true;
  //porcelain输出恒相对仓库根，先拿到根目录再拼完整路径
  const top = await gitRun('rev-parse', ['--show-toplevel']);
  if (!top || top.code !== 0) {
    gitBusy = false;
    gitState = { repo:false, code:top ? top.code : -1, err:top ? top.err : '' };
    renderGit();
    return;
  }
  gitRoot = top.out.trim().replace(/\//g, '\\');
  const r = await gitRun('status', ['--porcelain=v1', '-b']);
  gitBusy = false;
  if (!r) return;
  if (r.code !== 0) { gitState = { repo:false, code:r.code, err:r.err }; renderGit(); return; }
  gitState = parseGitStatus(r.out);
  gitState.repo = true;
  renderGit();
}

//状态字母对应的颜色类
function gitStCls(c) {
  if (c === 'M' || c === 'R') return 'm';
  if (c === 'A') return 'a';
  if (c === 'D') return 'd';
  return c === '?' ? 'u' : '';
}

function gitFileRow(f, group) {
  const code = group === 'staged' ? f.x : f.y;
  const full = (gitRoot || root).replace(/[\\/]+$/, '') + '\\' + f.path.replace(/\//g, '\\');
  const i = f.path.lastIndexOf('/');
  const dir = i < 0 ? '' : f.path.slice(0, i);
  const name = i < 0 ? f.path : f.path.slice(i + 1);
  const p = esc(full);
  let act = group === 'staged'
    ? `<button class="f-act" data-a="unstage" data-p="${p}" title="${esc(t('gitUnstage'))}">−</button>`
    : `<button class="f-act" data-a="stage" data-p="${p}" title="${esc(t('gitStage'))}">+</button>`;
  //未跟踪文件用restore放弃不掉，得靠删除，这里不提供
  if (group === 'changes' && f.y !== '?') act += `<button class="f-act" data-a="discard" data-p="${p}" title="${esc(t('gitDiscard'))}">↶</button>`;
  return `<div class="git-file" data-a="open" data-t="${p}">
    <span class="st ${gitStCls(code)}">${esc(code)}</span>
    <span class="nm">${esc(name)}</span>${dir ? `<span class="dir">${esc(dir)}</span>` : ''}${act}</div>`;
}

function renderGit() {
  const st = gitState;
  if (!st || st.noFolder) {
    gitBranchEl.textContent = '';
    gitAbEl.textContent = '';
    gitList.innerHTML = `<div class="git-none">${esc(t('needFolder'))}</div>`;
    return;
  }
  if (!st.repo) {
    gitBranchEl.textContent = '';
    gitAbEl.textContent = '';
    let msg = t('gitErr'), showInit = true;
    if (st.code === -1 || /not found|cannot find/i.test(st.err || '')) { msg = t('gitNoGit'); showInit = false; }
    else if (!st.err || /not a git repo/i.test(st.err)) msg = t('gitNoRepo');
    gitList.innerHTML = `<div class="git-none">${esc(msg)}${showInit ? `<button id="gitInitBtn">${esc(t('gitInit'))}</button>` : ''}</div>`;
    const b = $('gitInitBtn');
    if (b) b.onclick = gitInit;
    return;
  }
  gitBranchEl.textContent = st.detached ? 'HEAD' : (st.branch || 'git');
  let ab = '';
  if (st.ahead) ab += '↑' + st.ahead;
  if (st.behind) ab += (ab ? ' ' : '') + '↓' + st.behind;
  gitAbEl.textContent = ab;
  let h = '';
  if (st.staged.length) {
    h += `<div class="git-group">${esc(t('gitStaged'))} (${st.staged.length})`
      + `<button class="g-act" data-a="unstage-all">${esc(t('gitUnstageAll'))}</button></div>`;
    h += st.staged.map(f => gitFileRow(f, 'staged')).join('');
  }
  if (st.changes.length) {
    h += `<div class="git-group">${esc(t('gitChanges'))} (${st.changes.length})`
      + `<button class="g-act" data-a="stage-all">${esc(t('gitStageAll'))}</button></div>`;
    h += st.changes.map(f => gitFileRow(f, 'changes')).join('');
  }
  if (!h) h = `<div class="git-none">${esc(t('gitClean'))}</div>`;
  gitList.innerHTML = h;
}

//执行一条会改变仓库状态的命令，完成后刷新面板
async function gitOp(sub, args, okMsg) {
  if (gitBusy) return false;
  gitBusy = true;
  const r = await gitRun(sub, args);
  gitBusy = false;
  const ok = !!r && r.code === 0;
  if (!ok) toast((r && r.err ? r.err.trim().split('\n')[0] : t('gitErr')), '⚠');
  else if (okMsg) toast(okMsg, '✓');
  await gitRefresh();
  return ok;
}

function gitStage(p) { return gitOp('add', p ? ['--', p] : ['-A', '--', gitRoot || root], null); }
function gitUnstage(p) { return gitOp('restore', p ? ['--staged', '--', p] : ['--staged', '--', gitRoot || root], null); }
function gitDiscard(p) { openDlg(t('gitDiscardAsk', baseName(p)), false, () => gitOp('restore', ['--', p], null)); }
function gitInit() { return gitOp('init', [], t('gitInitDone')); }
function gitPull() { return gitOp('pull', [], t('gitOpDone')); }
function gitPush() { return gitOp('push', [], t('gitOpDone')); }
async function gitCommit() {
  const msg = gitMsg.value.trim();
  if (!msg) { toast(t('gitCommitAsk'), '⚠'); return; }
  if (await gitOp('commit', ['-m', msg], t('gitCommitDone'))) gitMsg.value = '';
}

gitRefreshBtn.onclick = gitRefresh;
gitCommitBtn.onclick = gitCommit;
gitPullBtn.onclick = gitPull;
gitPushBtn.onclick = gitPush;
gitMsg.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); gitCommit(); }
});
gitList.addEventListener('click', e => {
  const btn = e.target.closest('.f-act, .g-act');
  if (btn) {
    e.stopPropagation();
    const a = btn.dataset.a;
    if (a === 'stage') gitStage(btn.dataset.p);
    else if (a === 'unstage') gitUnstage(btn.dataset.p);
    else if (a === 'discard') gitDiscard(btn.dataset.p);
    else if (a === 'stage-all') gitStage();
    else if (a === 'unstage-all') gitUnstage();
    return;
  }
  const row = e.target.closest('.git-file');
  if (row) openFileAt(row.dataset.t, 1, '');
});

/* ---------- 设置 ---------- */
const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, +v || d));

const DEFAULT_FONT = "'JetBrains Mono', 'Cascadia Code', 'SF Mono', Consolas, 'Liberation Mono', monospace";

let runs = {};
let scanned = false;

function curModel() {
  const l = cfg.models || [];
  return l[cfg.modelIdx] || l[0] || null;
}

//当前模型是否开启某项能力（tools/multi），每个模型单独设置
function mdlCap(k) {
  const m = curModel();
  return !!(m && m[k]);
}

function applyEditor() {
  editorEl.style.fontSize = (cfg.fontSize || 13) + 'px';
  document.documentElement.style.setProperty('--tab-size', cfg.tabSize || 4);
  document.documentElement.style.setProperty('--mono', cfg.fontFamily || DEFAULT_FONT);
  measureChar();
}

//自定义主题覆盖的结构色变量
const CUSTOM_VARS = ['--bg','--bg-side','--bg-pop','--bg-toolbar','--bg-tab','--bg-hover','--bg-active',
  '--border','--text','--text-dim','--text-bright','--text-hi','--text-in','--accent','--sel',
  '--bg-in','--in-border','--bg-btn','--bg-btn-hi','--bg-msg-ai','--bg-msg-tool','--scroll',
  '--scroll-hi','--hover-inv','--keyword','--type','--string','--number','--comment','--func','--err',
  '--var','--br0','--br1','--br2',
  '--t-f0','--t-f1','--t-f2','--t-f3','--t-f4','--t-f5','--t-f6','--t-f7','--t-f8',
  '--t-b0','--t-b1','--t-b2','--t-b3','--t-b4','--t-b5','--t-b6','--t-b7'];

//语法高亮默认色，自定义主题没单独指定时按背景明暗取一套
const SYN_DARK = { keyword:'#569cd6', type:'#4ec9b0', string:'#ce9178', number:'#b5cea8', comment:'#6a9955', func:'#dcdcaa', err:'#f48771' };
const SYN_LIGHT = { keyword:'#0000ff', type:'#267f99', string:'#a31515', number:'#098658', comment:'#008000', func:'#795e26', err:'#cd3131' };
const SYN_KEYS = ['keyword', 'type', 'string', 'number', 'comment', 'func', 'err'];
const synEls = () => ({ keyword:cKeyword, type:cType, string:cString, number:cNumber, comment:cComment, func:cFunc, err:cErr });

//两色按t比例混合
function mix(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const f = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return '#' + f(r1, r2) + f(g1, g2) + f(b1, b2);
}

//0-1 感知亮度
function lum(h) {
  const g = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return .2126 * g[0] + .7152 * g[1] + .0722 * g[2];
}

//由主色/副色/背景/文字推导整套结构色
function paintTheme(root, c) {
  const hex = (v, d) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : d;
  const bg = hex(c.bg, '#1e1e1e');
  const tx = hex(c.text, '#d4d4d4');
  const side = hex(c.side, mix(bg, tx, .06));
  const ac = hex(c.accent, '#007acc');
  const dark = lum(bg) < .5;
  const hi = dark ? '#ffffff' : '#000000';
  const s = (k, v) => root.style.setProperty(k, v);
  s('--accent', ac);
  s('--sel', mix(bg, ac, .38));
  s('--bg', bg);
  s('--bg-side', side);
  s('--bg-pop', side);
  s('--bg-toolbar', mix(side, bg, .5));
  s('--bg-tab', mix(bg, tx, .06));
  s('--bg-hover', mix(bg, tx, .1));
  s('--bg-active', mix(bg, tx, .16));
  s('--border', mix(bg, tx, .18));
  s('--bg-in', mix(bg, tx, .12));
  s('--in-border', mix(bg, tx, .3));
  s('--bg-btn', mix(bg, tx, .14));
  s('--bg-btn-hi', mix(bg, tx, .2));
  s('--bg-msg-ai', mix(bg, tx, .07));
  s('--bg-msg-tool', mix(bg, tx, .04));
  s('--scroll', mix(bg, tx, .22));
  s('--scroll-hi', mix(bg, tx, .3));
  s('--text', tx);
  s('--text-dim', mix(tx, bg, .45));
  s('--text-bright', mix(tx, hi, .35));
  s('--text-hi', mix(tx, hi, .7));
  s('--text-in', tx);
  s('--hover-inv', dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.1)');
  const syn = dark ? SYN_DARK : SYN_LIGHT;
  for (const k of SYN_KEYS) s('--' + k, hex(c[k], syn[k]));
  s('--var', hex(c.var, dark ? '#9cdcfe' : '#001080'));
}

//读回自定义主题的取色器，语法色与当前默认值相同时不落盘，换背景可以自动跟随
function readCustom() {
  const bg = cBg.value;
  const def = lum(bg) < .5 ? SYN_DARK : SYN_LIGHT;
  const el = synEls();
  const o = { accent:cAccent.value, side:cSide.value, bg, text:cText.value };
  for (const k of SYN_KEYS) {
    if (el[k].value.toLowerCase() !== def[k]) o[k] = el[k].value;
  }
  return o;
}

//把配置里的自定义主题填回取色器
function fillCustom(c) {
  cAccent.value = c.accent || '#007acc';
  cSide.value = c.side || '#252526';
  cBg.value = c.bg || '#1e1e1e';
  cText.value = c.text || '#d4d4d4';
  const def = lum(cBg.value) < .5 ? SYN_DARK : SYN_LIGHT;
  const el = synEls();
  for (const k of SYN_KEYS) el[k].value = c[k] || def[k];
}

//vscode颜色可能是#rgb/#rrggbb/#rrggbbaa，统一成6位十六进制
function vhex(v) {
  const h = String(v || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  if (/^#[0-9a-f]{8}$/i.test(h)) return h.slice(0, 7).toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : '';
}

//vscode主题是JSONC，解析时容忍注释与尾逗号
function parseJsonc(s) {
  //带BOM的文件JSON.parse会直接报错，先剥掉
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  let out = '';
  let i = 0;
  const n = s.length;
  let str = false;
  while (i < n) {
    const c = s[i];
    if (str) {
      out += c;
      if (c === '\\') { i++; if (i < n) { out += s[i]; i++; } continue; }
      if (c === '"') str = false;
      i++;
      continue;
    }
    if (c === '"') { str = true; out += c; i++; continue; }
    if (c === '/' && s[i + 1] === '/') {
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    //后面只剩空白再跟着 } 或 ] 就是尾逗号，丢掉
    if (c === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') { i++; continue; }
    }
    out += c;
    i++;
  }
  return JSON.parse(out);
}

//TextMate scope前缀归到MiniIDE的语法桶，长前缀优先
const VSC_SCOPES = [
  ['entity.name.function', 'func'], ['entity.name.method', 'func'], ['support.function', 'func'], ['meta.function', 'func'],
  ['entity.name.tag', 'keyword'], ['entity.name.type', 'type'], ['entity.name.class', 'type'],
  ['entity.name.struct', 'type'], ['entity.name.enum', 'type'], ['entity.name.interface', 'type'],
  ['entity.name.namespace', 'type'], ['support.type', 'type'], ['support.class', 'type'],
  ['storage.type', 'type'], ['storage.modifier', 'type'],
  ['constant.numeric', 'number'], ['constant.language', 'number'], ['constant.character', 'number'],
  ['constant.other', 'number'], ['support.constant', 'number'],
  ['entity.other.attribute-name', 'var'], ['meta.object-literal.key', 'var'], ['support.variable', 'var'], ['variable', 'var'],
  ['comment', 'comment'], ['string', 'string'], ['invalid', 'err'],
  ['keyword', 'keyword'], ['storage', 'keyword'],
].sort((a, b) => b[0].length - a[0].length);

//tokenColors按顺序覆盖，靠后的规则优先，和vscode一致
function vscSyntax(tc) {
  const o = {};
  for (const r of tc || []) {
    const fg = vhex(r && r.settings && r.settings.foreground);
    if (!fg) continue;
    for (const raw of Array.isArray(r.scope) ? r.scope : String(r.scope || '').split(',')) {
      const s = String(raw).trim().toLowerCase();
      const hit = VSC_SCOPES.find(([p]) => s.startsWith(p));
      if (hit) o[hit[1]] = fg;
    }
  }
  return o;
}

//把vscode主题映射成与自定义主题同形的配色对象
function vscTheme(j) {
  const c = j.colors || {};
  const pick = (...ks) => { for (const k of ks) { const v = vhex(c[k]); if (v) return v; } return ''; };
  const o = {
    name: j.name || 'VSCode',
    type: j.type || '',
    bg: pick('editor.background'),
    text: pick('editor.foreground', 'foreground'),
    side: pick('sideBar.background', 'activityBar.background', 'editorGroupHeader.tabsBackground'),
    accent: pick('button.background', 'activityBarBadge.background', 'focusBorder', 'progressBar.background', 'textLink.foreground'),
    vars: vscVars(c),
  };
  Object.assign(o, vscSyntax(j.tokenColors));
  return o;
}

//vscode工作区色直接落到MiniIDE变量，取不到就保留推导值
const VSC_MAP = [
  ['--bg-side', ['sideBar.background', 'activityBar.background']],
  ['--bg-toolbar', ['titleBar.activeBackground', 'editorGroupHeader.tabsBackground', 'activityBar.background']],
  ['--bg-tab', ['tab.activeBackground', 'tab.inactiveBackground', 'editorGroupHeader.tabsBackground']],
  ['--bg-hover', ['list.hoverBackground', 'toolbar.hoverBackground', 'tab.hoverBackground']],
  ['--bg-active', ['list.activeSelectionBackground', 'tab.activeBackground', 'list.focusBackground']],
  ['--border', ['panel.border', 'editorGroup.border', 'sideBar.border', 'widget.border', 'contrastBorder']],
  ['--text', ['editor.foreground', 'foreground']],
  ['--text-dim', ['descriptionForeground', 'editorLineNumber.foreground', 'list.inactiveSelectionForeground']],
  ['--text-bright', ['editor.foreground', 'foreground']],
  ['--sel', ['editor.selectionBackground']],
  ['--bg-in', ['input.background']],
  ['--in-border', ['input.border', 'inputOption.activeBorder', 'focusBorder']],
  ['--bg-pop', ['editorSuggestWidget.background', 'menu.background', 'dropdown.background']],
  ['--pop-border', ['editorSuggestWidget.border', 'menu.border', 'widget.border']],
  ['--text-hi', ['editor.foreground', 'foreground']],
  ['--text-in', ['input.foreground', 'editor.foreground']],
  ['--scroll', ['scrollbarSlider.background']],
  ['--scroll-hi', ['scrollbarSlider.hoverBackground', 'scrollbarSlider.activeBackground']],
  ['--bg-msg-ai', ['editorWidget.background']],
  ['--bg-msg-tool', ['panel.background']],
  ['--bg-btn', ['button.secondaryBackground']],
  ['--bg-btn-hi', ['button.secondaryHoverBackground']],
  ['--err', ['editorError.foreground', 'errorForeground']],
  ['--br0', ['editorBracketHighlight.foreground1']],
  ['--br1', ['editorBracketHighlight.foreground2']],
  ['--br2', ['editorBracketHighlight.foreground3']],
  ['--t-f0', ['terminal.ansiBlack']],
  ['--t-f1', ['terminal.ansiRed']],
  ['--t-f2', ['terminal.ansiGreen']],
  ['--t-f3', ['terminal.ansiYellow']],
  ['--t-f4', ['terminal.ansiBlue']],
  ['--t-f5', ['terminal.ansiMagenta']],
  ['--t-f6', ['terminal.ansiCyan']],
  ['--t-f7', ['terminal.ansiWhite']],
  ['--t-f8', ['terminal.ansiBrightBlack']],
  ['--t-b0', ['terminal.ansiBlack']],
  ['--t-b1', ['terminal.ansiRed']],
  ['--t-b2', ['terminal.ansiGreen']],
  ['--t-b3', ['terminal.ansiYellow']],
  ['--t-b4', ['terminal.ansiBlue']],
  ['--t-b5', ['terminal.ansiMagenta']],
  ['--t-b6', ['terminal.ansiCyan']],
  ['--t-b7', ['terminal.ansiWhite']],
];

//主题里取到的工作区色整理成 变量→色值 的小表，随配置一起存
function vscVars(c) {
  const o = {};
  for (const [v, ks] of VSC_MAP) {
    for (const k of ks) {
      const x = vhex(c[k]);
      if (x) { o[v] = x; break; }
    }
  }
  return o;
}

function paintVsc(root, vars) {
  for (const v in vars) root.style.setProperty(v, vars[v]);
}

//重建配色下拉：内置三项加导入的主题，顺带开关删除按钮
function renderThemeSelect() {
  const cur = cfg.theme || 'dark';
  const list = cfg.themes || [];
  let h = `<option value="dark">${esc(t('themeDark'))}</option>`
    + `<option value="light">${esc(t('themeLight'))}</option>`
    + `<option value="custom">${esc(t('themeCustom'))}</option>`;
  list.forEach((th, i) => { h += `<option value="vsc:${i}">${esc(th.name)}</option>`; });
  //选中的主题被删掉后旧值不再合法，退回深色
  const ok = cur === 'dark' || cur === 'light' || cur === 'custom' || (cur.startsWith('vsc:') && +cur.slice(4) < list.length);
  if (!ok) cfg.theme = 'dark';
  setTheme.innerHTML = h;
  setTheme.value = cfg.theme;
  themeDel.classList.toggle('hidden', !cfg.theme.startsWith('vsc:'));
}

function applyTheme() {
  const root = document.documentElement;
  const t = cfg.theme || 'dark';
  CUSTOM_VARS.forEach(v => root.style.removeProperty(v));
  //自定义与导入的vscode主题都走同一套推导，只是配色来源不同
  const vsc = t.startsWith('vsc:') ? (cfg.themes || [])[+t.slice(4)] : null;
  const pal = t === 'custom' ? cfg.custom : vsc;
  if (pal) paintTheme(root, pal);
  //vscode主题明确给出的工作区色覆盖掉推导值
  if (pal && pal.vars) paintVsc(root, pal.vars);
  const light = pal ? (pal.type ? pal.type === 'light' : lum(pal.bg || '#1e1e1e') >= .5) : t === 'light';
  root.dataset.theme = light ? 'light' : 'dark';
  //终端配色跟随 CSS 类，换主题后清 hash 缓存让下一次 render 必定套新样式
  terms.forEach(x => { if (x.term) { x.term._lastHash = ''; } });
}

//对话框里的模型草稿，取消时直接丢弃
let mdlDraft = [];

function renderModelList() {
  mdlList.innerHTML = mdlDraft.map((m, i) => `<div class="mdl" data-i="${i}">
    <div class="mdl-head"><span>${esc(t('modelN', i + 1))}</span><button class="mdl-del" data-del="${i}">${esc(t('del'))}</button></div>
    <label>${esc(t('mName'))}</label>
    <input data-f="name" value="${esc(m.name || '')}" spellcheck="false" autocomplete="off">
    <label>${esc(t('mUrl'))}</label>
    <input data-f="url" value="${esc(m.url || '')}" spellcheck="false" autocomplete="off">
    <label>${esc(t('mKey'))}</label>
    <input data-f="key" type="password" value="${esc(m.key || '')}" spellcheck="false" autocomplete="off">
    <label class="chk"><input type="checkbox" data-f="tools"${m.tools ? ' checked' : ''}><span>${esc(t('aiNativeTools'))}</span></label>
    <label class="chk"><input type="checkbox" data-f="multi"${m.multi ? ' checked' : ''}><span>${esc(t('aiMultiLabel'))}</span></label>
  </div>`).join('') || `<div class="set-tip">${esc(t('noModel'))}</div>`;
}

//把模型输入框的值读回草稿
function readModels() {
  mdlDraft = [...mdlList.querySelectorAll('.mdl')].map(b => ({
    name: b.querySelector('[data-f="name"]').value.trim(),
    url: b.querySelector('[data-f="url"]').value.trim(),
    key: b.querySelector('[data-f="key"]').value.trim(),
    tools: b.querySelector('[data-f="tools"]').checked,
    multi: b.querySelector('[data-f="multi"]').checked,
  }));
}

//配置里的路径不在扫描结果时补一项，避免选中值被清掉
function fillRun(sel, list, cur, defLabel) {
  let h = `<option value="">${defLabel}</option>`;
  let found = !cur;
  for (const r of list) {
    if (r.path === cur) found = true;
    h += `<option value="${esc(r.path)}">${esc((r.ver ? r.ver + '  ' : '') + r.path)}</option>`;
  }
  if (!found) h += `<option value="${esc(cur)}">${esc(cur)}</option>`;
  sel.innerHTML = h;
  sel.value = cur;
}

//只列出本机探测到的语言
function renderRuns() {
  const cur = cfg.run || {};
  let h = '';
  for (const [id, name] of RUN_LANGS) {
    if (!(runs[id] || []).length && !cur[id]) continue;
    h += `<label>${name}</label><select data-run="${id}"></select>`;
  }
  runList.innerHTML = h || `<div class="set-tip">${esc(t('noRuntime'))}</div>`;
  for (const sel of runList.querySelectorAll('[data-run]')) {
    const id = sel.dataset.run;
    fillRun(sel, runs[id] || [], cur[id] || '', t('defOf', defOf(id)));
  }
}

//把运行环境下拉的值读回配置
function readRuns() {
  const r = {};
  for (const sel of runList.querySelectorAll('[data-run]')) {
    if (sel.value) r[sel.dataset.run] = sel.value;
  }
  cfg.run = r;
}

function openSet() {
  mdlDraft = (cfg.models || []).map(m => ({ ...m }));
  renderModelList();
  setPrompt.value = cfg.prompt || PROMPTS.system;
  setTemp.value = typeof cfg.temp === 'number' ? cfg.temp : '';
  setMaxTok.value = typeof cfg.maxTokens === 'number' ? cfg.maxTokens : '';
  setExtra.value = cfg.extra ? JSON.stringify(cfg.extra, null, 2) : '';
  setHistory.checked = cfg.history !== false;
  setFontFamily.value = cfg.fontFamily || '';
  setFont.value = cfg.fontSize || 13;
  setTab.value = cfg.tabSize || 4;
  setUndo.value = cfg.undoSteps || 200;
  renderThemeSelect();
  fillCustom(cfg.custom || {});
  customBox.style.display = setTheme.value === 'custom' ? '' : 'none';
  renderResConf();
  resTransEl.value = transText(transMap());
  renderLsp();
  renderDbg();
  renderShells();
  renderLangs();
  renderRuns();
  if (!scanned) send('scanRun');
  memRefresh();
  setMask.classList.add('show');
}

function closeSet() {
  setMask.classList.remove('show');
}

//设置改动立即生效，非法值只忽略该项
function applySet() {
  customBox.style.display = setTheme.value === 'custom' ? '' : 'none';
  readModels();
  cfg.models = mdlDraft;
  cfg.modelIdx = Math.min(cfg.modelIdx || 0, Math.max(0, cfg.models.length - 1));
  cfg.prompt = setPrompt.value;
  cfg.temp = setTemp.value === '' ? '' : clamp(setTemp.value, 0, 2, 1);
  cfg.maxTokens = setMaxTok.value === '' ? '' : clamp(setMaxTok.value, 1, 1e6, 4096);
  const ex = setExtra.value.trim();
  if (!ex) {
    delete cfg.extra;
  } else {
    try {
      const p = JSON.parse(ex);
      if (p && typeof p === 'object' && !Array.isArray(p)) cfg.extra = p;
      else toast('其它参数需要是 JSON 对象', '⚠');
    } catch (e) { toast('其它参数不是合法 JSON', '⚠'); }
  }
  cfg.history = setHistory.checked;
  cfg.fontFamily = setFontFamily.value.trim();
  cfg.fontSize = clamp(setFont.value, 10, 20, 13);
  cfg.tabSize = clamp(setTab.value, 1, 8, 4);
  cfg.undoSteps = clamp(setUndo.value, 10, 1000, 200);
  cfg.theme = setTheme.value;
  themeDel.classList.toggle('hidden', !cfg.theme.startsWith('vsc:'));
  cfg.custom = readCustom();
  readRuns();
  cfg.shell = setShellEl.value === 'custom' || SHELLS[setShellEl.value] ? setShellEl.value : 'powershell';
  cfg.shellCmd = $('setShellCmd').value.trim();
  const beforeLsp = JSON.stringify(cfg.lsp || {});
  readLsp();
  const lspChanged = JSON.stringify(cfg.lsp || {}) !== beforeLsp;
  readDbg();
  renderDbgConf();
  const before = JSON.stringify(cfg.res || {});
  const nr = readResConf();
  const resChanged = JSON.stringify(nr) !== before;
  cfg.res = nr;
  const langChanged = setLangEl.value && setLangEl.value !== cfg.lang;
  cfg.lang = setLangEl.value || 'zh-CN';
  applyTheme();
  applyEditor();
  renderModels();
  saveSettings();
  if (resChanged) {
    //地址变了，已加载的大资源作废，下次用时按新地址重取
    for (const k of Object.keys(resUrls)) delete resUrls[k];
    initRes(false);
  }
  if (lspChanged) lspReset();
  if (langChanged) {
    loadTrans(cfg.lang, false);
    applyLang();
  }
}

mdlList.addEventListener('click', e => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  readModels();
  mdlDraft.splice(+b.dataset.del, 1);
  if (cfg.modelIdx >= mdlDraft.length) cfg.modelIdx = Math.max(0, mdlDraft.length - 1);
  renderModelList();
  applySet();
});

mdlAdd.onclick = () => {
  readModels();
  mdlDraft.push({ name: '', url: '', key: '' });
  renderModelList();
  const last = mdlList.lastElementChild;
  if (last) last.querySelector('[data-f="name"]').focus();
  applySet();
};

runScan.onclick = () => send('scanRun');

$('impTrans').onclick = () => send('resImport', 'trans', cfg.lang || 'zh-CN');
$('themeImport').onclick = () => send('themeImport');
//删除当前选中的导入主题，退回深色
themeDel.onclick = () => {
  const cur = cfg.theme || '';
  if (!cur.startsWith('vsc:')) return;
  const [rm] = (cfg.themes || []).splice(+cur.slice(4), 1);
  cfg.theme = 'dark';
  renderThemeSelect();
  applySet();
  if (rm) toast(t('themeDelDone', rm.name), '✓');
};
$('resUpdate').onclick = () => initRes(true);

//语言服务器下载：按当前填写的地址下载并解压，可执行路径回填后自动启用
lspListEl.addEventListener('click', e => {
  const b = e.target.closest('[data-lsp-get]');
  if (!b) return;
  const lang = b.dataset.lspGet;
  const urlEl = lspListEl.querySelector(`[data-lsp-url="${lang}"]`);
  const url = urlEl ? urlEl.value.trim() : '';
  if (!url) { toast(t('lspNoUrl'), '⚠'); return; }
  readLsp();
  saveSettings();
  toast(t('lspGoing', LSP_DEF[lang] ? LSP_DEF[lang].name : lang), '⭳');
  send('lspInstall', lang, url);
});

//调试会话状态与元素
let dbg = null;          //当前调试会话
let dbgLast = null;      //最近一次启动参数，供重启复用
let dbgMark = null;      //当前执行位置 {path, line}
let dbgStack = [];       //调用栈快照
let dbgScopes = [];      //当前帧的作用域与变量
let dbgVarCache = {};    //variablesReference -> 变量列表
let dbgExpand = new Set();
let dbgWatchList = [];   //监视表达式
let dbgWatchVals = [];   //监视求值结果
let dbgProbeWait = null;
let dbgBuildWait = null;

const dbgConfEl=$('dbgConf'), dbgBpsEl=$('dbgBps'), dbgWatchEl=$('dbgWatch'),
      dbgWatchInput=$('dbgWatchInput'), dbgStackEl=$('dbgStack'), dbgVarsEl=$('dbgVars'),
      dbgOut=$('dbgOut'), dbgRepl=$('dbgRepl'), dbgListEl=$('dbgList');

//调试适配器下载与检测
dbgListEl.addEventListener('click', e => {
  const g = e.target.closest('[data-dbg-get]');
  if (g) {
    const name = g.dataset.dbgGet;
    const urlEl = dbgListEl.querySelector(`[data-dbg-url="${name}"]`);
    const url = urlEl ? urlEl.value.trim() : '';
    //python 走 pip 安装，不需要下载地址
    if (!url && name !== 'python') { toast(t('lspNoUrl'), '⚠'); return; }
    readDbg();
    saveSettings();
    toast(t(name === 'python' ? 'dbgPip' : 'dbgGoing', DEBUG_DEF[name] ? DEBUG_DEF[name].name : name), '⭳');
    send('dbgInstall', name, url);
    return;
  }
  const c = e.target.closest('[data-dbg-check]');
  if (c) {
    const name = c.dataset.dbgCheck;
    const d = DEBUG_DEF[name] || {};
    if (!d.check) { toast(t('dbgProbeBad', d.name || name), '⚠'); return; }
    dbgProbeWait = null;
    send('dbgProbe', d.check);
    toast(t('dbgProbing', d.name || name));
    //检测结果到达后由 api.dbgProbe 提示，这里再兜一层
    const cmd = d.check;
    const timer = setTimeout(() => { if (dbgProbeWait && dbgProbeWait.cmd === cmd) dbgProbeWait = null; }, 8000);
    dbgProbeWait = { cmd, done: ok => { clearTimeout(timer); toast(t(ok ? 'dbgProbeOk' : 'dbgProbeBad', d.name || name), ok ? '✓' : '⚠'); } };
  }
});

probScanEl.onclick = scanWorkspace;
probTabsEl.addEventListener('click', e => {
  const b = e.target.closest('.prob-tab');
  if (b) setProbMode(b.dataset.k);
});
probListEl.addEventListener('click', e => {
  const it = e.target.closest('.prob-item');
  if (!it) return;
  const x = renderProblems._list && renderProblems._list[+it.dataset.i];
  if (x) openFileAt(x.path, x.line);
});

setNav.addEventListener('click', e => {
  const it = e.target.closest('.set-nav-item');
  if (!it) return;
  setNav.querySelectorAll('.set-nav-item').forEach(b => b.classList.toggle('on', b === it));
  document.querySelectorAll('.set-pane').forEach(p => p.classList.toggle('on', p.dataset.p === it.dataset.p));
  //切到 AI 页时刷新记忆列表
  if (it.dataset.p === 'ai') memRefresh();
});

$('setClose').onclick = closeSet;
//改动即生效，关掉设置不需要保存
setMask.addEventListener('change', applySet);
//取色器拖动过程只刷新配色，松手后的change再落盘
setMask.addEventListener('input', e => {
  if (e.target.type !== 'color') return;
  cfg.custom = readCustom();
  applyTheme();
});
setMask.addEventListener('click', e => { if (e.target === setMask) closeSet(); });

let restoring = false;
let restoreLeft = 0;
let restoreActive = '';

//当前工作区的会话数据，键为空时表示窗口还没打开文件夹
function ws() {
  const k = root || '';
  if (!cfg.ws || typeof cfg.ws !== 'object') cfg.ws = {};
  if (!cfg.ws[k] || typeof cfg.ws[k] !== 'object') cfg.ws[k] = {};
  const w = cfg.ws[k];
  if (!Array.isArray(w.files)) w.files = [];
  if (!Array.isArray(w.expanded)) w.expanded = [];
  if (typeof w.active !== 'string') w.active = '';
  if (!Array.isArray(w.chat)) w.chat = [];
  if (!Array.isArray(w.sessions)) w.sessions = [];
  if (!w.ui || typeof w.ui !== 'object') w.ui = {};
  return w;
}

function saveSettings() {
  //恢复过程中不写回，避免覆盖已存的会话
  if (restoring) return;
  const w = ws();
  //新建的空窗口还没开文件夹，别把已存的会话冲掉
  if (!(window.__FRESH && !root)) {
    w.files = openTabs;
    w.active = active;
    w.expanded = [...expanded];
  }
  w.ui = {
    side: !sidebarEl.classList.contains('hidden'),
    sideW: parseInt(sidebarEl.style.getPropertyValue('--side-w')) || 220,
    chat: !chatEl.classList.contains('hidden'),
    chatW: parseInt(chatEl.style.getPropertyValue('--chat-w')) || 340,
  };
  //ponytail: 图片只在内存里保留，写盘前剥掉，避免设置文件被base64撑爆；代价是重开窗口后历史里的图片不再回传
  const out = { ...cfg, ws: {} };
  for (const k in cfg.ws) {
    const x = cfg.ws[k];
    out.ws[k] = { ...x, chat: (x.chat || []).map(m => m.imgs ? { ...m, imgs: undefined } : m) };
  }
  send('saveSettings', JSON.stringify(out));
}

//恢复侧栏与 AI 面板的开关状态
function applyUi(u) {
  u = u || {};
  if (u.side === false) sidebarEl.classList.add('hidden');
  if (u.sideW) sidebarEl.style.setProperty('--side-w', u.sideW + 'px');
  if (u.chatW) chatEl.style.setProperty('--chat-w', u.chatW + 'px');
  toggleChat(u.chat !== false, true);
}

//恢复本窗口工作区上次打开的文件
function restoreSession() {
  const k = window.__ROOT || '';
  const w = (cfg.ws && cfg.ws[k]) || {};
  restoring = true;
  applyUi(w.ui);
  //新窗口带着指定文件夹启动时不恢复上次会话
  if (window.__OPEN_DIR) {
    send('openDir', window.__OPEN_DIR);
    restoring = false;
    return;
  }
  //新建的空窗口停在欢迎页，不恢复上次会话
  if (window.__FRESH) {
    restoring = false;
    return;
  }
  if (k) send('openDir', k);
  (w.expanded || []).forEach(p => { if (p !== k) send('readDir', p); });
  const files = w.files || [];
  if (!files.length) {
    restoring = false;
    return;
  }
  restoreLeft = files.length;
  restoreActive = w.active || '';
  files.forEach(openFile);
  //文件打不开时兜底结束恢复
  setTimeout(finishRestore, 1500);
}

function finishRestore() {
  if (!restoring) return;
  restoring = false;
  if (restoreActive && buffers[restoreActive] !== undefined) activate(restoreActive);
}

function applySettings(text) {
  if (!text) return;
  try {
    Object.assign(cfg, JSON.parse(text));
    if (!cfg.ws || typeof cfg.ws !== 'object') cfg.ws = {};
    //旧版按窗口存的会话迁移到按工作区
    if (cfg.session || cfg.ui || cfg.chat || cfg.sessions) {
      const k = (cfg.session && cfg.session.root) || '';
      const w = cfg.ws[k] = cfg.ws[k] || {};
      if (cfg.session) {
        w.files = cfg.session.files || [];
        w.active = cfg.session.active || '';
        w.expanded = cfg.session.expanded || [];
      }
      if (cfg.chat) w.chat = cfg.chat[k] || [];
      if (cfg.sessions) w.sessions = cfg.sessions[k] || [];
      if (cfg.ui) w.ui = cfg.ui;
      cfg.session = cfg.ui = cfg.chat = cfg.sessions = undefined;
    }
    if (!cfg.prompt) cfg.prompt = PROMPTS.system;
    if (!cfg.run || typeof cfg.run !== 'object') cfg.run = {};
    if (!cfg.res || typeof cfg.res !== 'object') cfg.res = { hljs:RES_DEF.hljs, trans:{} };
    if (cfg.shell !== 'custom' && !SHELLS[cfg.shell]) cfg.shell = 'powershell';
    if (typeof cfg.shellCmd !== 'string') cfg.shellCmd = '';
    if (!cfg.lsp || typeof cfg.lsp !== 'object') cfg.lsp = {};
    if (!cfg.lang) cfg.lang = 'zh-CN';
    //旧版单个vscode主题并入列表
    if (cfg.vscode) {
      cfg.themes = Array.isArray(cfg.themes) ? cfg.themes : [];
      let i = cfg.themes.findIndex(x => x.name === cfg.vscode.name);
      if (i < 0) i = cfg.themes.push(cfg.vscode) - 1;
      if (cfg.theme === 'vscode') cfg.theme = 'vsc:' + i;
      cfg.vscode = undefined;
    }
    if (!Array.isArray(cfg.themes)) cfg.themes = [];
    if (typeof cfg.undoSteps !== 'number') cfg.undoSteps = 200;
    if (typeof cfg.modelIdx !== 'number' || cfg.modelIdx >= cfg.models.length) cfg.modelIdx = 0;
    applyTheme();
    applyEditor();
    renderModels();
  } catch (e) {
    toast('设置文件解析失败', '⚠');
  }
}

/* ---------- AI 聊天 ---------- */
function tool(name, description, properties, required) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

const P_PATH = { path: { type: 'string', description: PROMPTS.arg.path } };

const TOOLS = [
  tool('read_file', PROMPTS.tool.read_file,
    { ...P_PATH, start_line: { type: 'integer', description: PROMPTS.arg.startLine },
      end_line: { type: 'integer', description: PROMPTS.arg.endLine } }, ['path']),
  tool('edit_file', PROMPTS.tool.edit_file,
    { ...P_PATH, start_line: { type: 'integer' }, end_line: { type: 'integer' }, new_text: { type: 'string' } },
    ['path', 'start_line', 'end_line', 'new_text']),
  tool('create_file', PROMPTS.tool.create_file,
    { ...P_PATH, content: { type: 'string' } }, ['path', 'content']),
  tool('list_files', PROMPTS.tool.list_files,
    { path: { type: 'string', description: PROMPTS.arg.dir } }, []),
  tool('search_files', PROMPTS.tool.search_files,
    { query: { type: 'string' }, regex: { type: 'boolean', description: PROMPTS.arg.regex },
      case_sensitive: { type: 'boolean' } }, ['query']),
  tool('rename_file', PROMPTS.tool.rename_file,
    { from: { type: 'string' }, to: { type: 'string' } }, ['from', 'to']),
  tool('run_command', PROMPTS.tool.run_command,
    { command: { type: 'string' } }, ['command']),
  tool('check_syntax', PROMPTS.tool.check_syntax,
    { path: { type: 'string', description: PROMPTS.arg.checkPath } }, []),
  tool('web_search', PROMPTS.tool.web_search,
    { query: { type: 'string', description: PROMPTS.arg.query } }, ['query']),
  tool('memory', PROMPTS.tool.memory,
    { action: { type: 'string', enum: ['save', 'read', 'delete'] },
      name: { type: 'string', description: PROMPTS.arg.memName },
      content: { type: 'string', description: PROMPTS.arg.memContent } }, ['action']),
  tool('ask_user', PROMPTS.tool.ask_user, {
    questions: {
      type: 'array', description: PROMPTS.arg.questions,
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          type: { type: 'string', enum: ['single', 'multi', 'text'] },
          options: { type: 'array', items: { type: 'string' } },
        },
        required: ['question', 'type'],
      },
    },
  }, ['questions']),
];

//工具名到schema的映射
const TOOLMAP = {};
TOOLS.forEach(t => { TOOLMAP[t.function.name] = t.function; });

//执行前校验工具名、必填参数、类型与枚举，非法时返回错误文本
function validateTool(name, args) {
  const f = TOOLMAP[name];
  if (!f) return '未知工具 ' + name + '，可用工具：' + Object.keys(TOOLMAP).join(', ');
  for (const k of (f.parameters.required || [])) {
    if (!(k in args)) return name + ' 缺少必填参数 ' + k;
  }
  for (const [k, v] of Object.entries(f.parameters.properties)) {
    const val = args[k];
    if (val === undefined || val === null) continue;
    if (v.type === 'integer' && !(typeof val === 'number' || (typeof val === 'string' && /^-?\d+$/.test(val)))) return name + '.' + k + ' 应为整数';
    if (v.type === 'string' && typeof val !== 'string') return name + '.' + k + ' 应为字符串';
    if (v.type === 'boolean' && typeof val !== 'boolean') return name + '.' + k + ' 应为布尔值';
    if (v.type === 'array' && !Array.isArray(val)) return name + '.' + k + ' 应为数组';
    if (v.enum && !v.enum.includes(val)) return name + '.' + k + ' 只能是 ' + v.enum.join('/');
  }
  return '';
}

//把工具清单写成提示词文本，含每个参数的类型、是否必填与说明
function toolsText() {
  return TOOLS.map(t => {
    const f = t.function;
    const req = f.parameters.required || [];
    const ps = Object.entries(f.parameters.properties)
      .map(([k, v]) => '  ' + k + ' (' + v.type + (req.includes(k) ? ', required' : '') + '): ' + (v.description || ''))
      .join('\n');
    return f.name + ': ' + f.description + (ps ? '\n' + ps : '');
  }).join('\n');
}

//提示词里始终写出工具参数，关闭原生调用时再给出文本块格式
function toolPrompt() {
  const s = 'Tools:\n' + toolsText();
  return mdlCap('tools') ? s : s + '\n\n' + PROMPTS.toolcall;
}

//把工具里的相对路径解析到工作区
function resolvePath(p) {
  p = String(p || '');
  if (p && !/^[A-Za-z]:[\\/]/.test(p) && !p.startsWith('/') && !p.startsWith('\\\\')) {
    return root ? root.replace(/[\\/]$/, '') + '\\' + p.replace(/^[\\/]+/, '') : p;
  }
  return p;
}

//等待后端回传的一次性回调
const pend = {};
function ask(key, ...a) {
  return new Promise(r => { pend[key] = r; send(...a); });
}
function answer(key, v) {
  if (pend[key]) { const r = pend[key]; delete pend[key]; r(v); }
}

const readFile = p => ask('read', 'readFile', p);
//自身写盘后清掉基线，避免下次轮询把自己的写入当成外部改动
const writeFile = (p, text, crlf) => {
  delete statSeen[p];
  return ask('write', 'writeFile', p, crlf ? '1' : '0', text);
};

//正在后台刷新缓冲区的文件，拿到内容后不抢当前视图
let bgReload = '';

//替换后更新编辑器中的同名文件
function reloadTab(path) {
  if (!openTabs.includes(path)) return;
  //磁盘内容已变，这条文件的历史作废
  if (editing && editing.path === path) editing = null;
  undoStack = undoStack.filter(a => !a.files.some(f => f.path === path));
  redoStack = redoStack.filter(a => !a.files.some(f => f.path === path));
  delete buffers[path];
  dirty.delete(path);
  bgReload = path;
  send('openFile', path);
}

//外部改动感知：定时取已打开文件与可见目录的修改时间，变化时重载或刷新
function statPoll() {
  if (document.hidden) return;
  const paths = Object.keys(buffers).filter((p, i, a) => a.indexOf(p) === i);
  //顺带盯住根目录与展开的目录，外部增删文件时刷新资源管理器
  const dirs = root ? [root, ...expanded].filter(p => !(p in buffers)) : [];
  const all = paths.concat(dirs).filter((p, i, a) => a.indexOf(p) === i);
  if (all.length) send('statFile', all.join('\u0002'));
  //git面板可见时顺带刷新状态，约6秒一次
  if (curView === 'git' && ++gitTick % 3 === 0) gitRefresh();
}

function chatMsgs() {
  return ws().chat;
}

//marked渲染markdown，代码块交给hljs，输出经DOMPurify净化后再插入
let MD = null;

//两个库都拉齐后才启用，重复调用只初始化一次
function initMd() {
  if (MD || !window.marked || !window.DOMPurify) return;
  marked.use({
    gfm: true,
    breaks: true,
    renderer: {
      code({ text, lang }) {
        const id = window.hljs && hljs.getLanguage(lang || '') ? lang : 'plaintext';
        const html = window.hljs ? hljs.highlight(text, { language: id, ignoreIllegals: true }).value : esc(text);
        return '<pre><code class="hljs">' + html + '</code></pre>';
      },
      //非 http/锚点链接视为工作区文件路径，打标记供点击拦截
      link({ href, text, tokens }) {
        const inner = tokens && this.parser ? this.parser.parseInline(tokens) : esc(text || href || '');
        const h = href || '';
        if (!h) return inner;
        if (/^(https?:|mailto:|#)/i.test(h)) {
          return '<a href="' + esc(h) + '" target="_blank" rel="noopener">' + inner + '</a>';
        }
        //支持 file#L42 或 file:42 的行号后缀
        const m = /^([^#]*?)(?:#L(\d+)|:(\d+))?$/.exec(h);
        const path = m ? m[1] : h;
        const line = m ? (m[2] || m[3] || '') : '';
        return '<a class="chat-file-link" data-filepath="' + esc(path) + '" data-line="' + esc(line) + '">' + inner + '</a>';
      },
    },
  });
  MD = window.marked;
  renderChat();
}

//渲染markdown，超长内容退回纯文本避免卡顿
function renderMd(text) {
  if (!MD || text.length > 200000) return esc(text);
  try { return DOMPurify.sanitize(MD.parse(text)); } catch (e) { return esc(text); }
}

//提示词协议里的工具调用块
const TOOLCALL_RE = /\/\/toolcall_start\/\/([\s\S]*?)\/\/toolcall_end\/\//g;
const TOOLCALL_OPEN = '//toolcall_start//';

//流式内容里最后一个调用块还没闭合时，先把工具名取出来显示
function pendingCall(s) {
  const parts = (s || '').split(TOOLCALL_OPEN);
  if (parts.length < 2 || parts.length % 2) return null;
  const m = /"name"\s*:\s*"([^"]*)"/.exec(parts[parts.length - 1]);
  return { name: m ? m[1] : '' };
}

function renderChat() {
  const msgs = chatMsgs();
  const open = new Set([...chatBody.querySelectorAll('details[data-k][open]')].map(d => d.dataset.k));
  //翻看历史时不要被自动滚到底打断
  const bottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 60;
  let h = '';
  msgs.forEach((m, i) => {
    if (m.sum) {
      h += `<div class="msg tool"><div class="who">${esc(t('summaryKeep'))}</div>${esc(m.content)}</div>`;
      return;
    }
    if (m.role === 'tool') return;
    if (m.role === 'user') {
      const im = (m.imgs || []).map(u => `<img src="${u}">`).join('');
      h += `<div class="msg user">${esc(m.content)}${im ? `<div class="msg-img">${im}</div>` : ''}${acts(i, true)}</div>`;
    } else if (m.role === 'assistant') {
      const pc = chatBusy ? pendingCall(m.content) : null;
      const calls = m.tool_calls && m.tool_calls.length ? m.tool_calls : parseToolBlocks(m.content);
      const text = stripToolBlocks(m.content);
      const rate = m.rate ? `<div class="tok">${m.rate} tok/s</div>` : '';
      if (text) h += `<div class="msg ai"><div class="md">${renderMd(text)}</div>${rate}${acts(i, false)}</div>`;
      calls.forEach((tc, k) => { h += toolHtml(tc, msgs, i, i + '-' + k, open); });
      if (pc) h += `<div class="msg tool live">▶ ${esc(pc.name || '调用工具')}</div>`;
    }
  });
  chatBody.innerHTML = h;
  for (const d of chatBody.querySelectorAll('details[data-k]')) if (open.has(d.dataset.k)) d.open = true;
  if (bottom) chatBody.scrollTop = chatBody.scrollHeight;
}

//调用链一行，拿到结果就把返回内容折进这一行里
function toolHtml(tc, msgs, from, key, open) {
  const f = tc.function || {};
  const a = f.arguments || '';
  const head = (f.name || '调用中') + (a ? '(' + (a.length > 200 ? a.slice(0, 200) + '…' : a) + ')' : '');
  let res = null;
  //向后查找配对的结果（可能跨过多条 assistant/user 消息）
  for (let k = from + 1; k < msgs.length; k++) {
    if (msgs[k].role === 'tool' && msgs[k].tool_call_id === tc.id) { res = msgs[k]; break; }
    //文本协议下工具结果被转成user消息，通过tool_call_id配对
    if (msgs[k].role === 'user' && msgs[k].tool_call_id === tc.id) {
      const body = (msgs[k].content || '').replace(/^[^\n]*?返回[：:]\n?/, '').trim();
      res = { content: body }; break;
    }
  }
  if (!res) return `<div class="msg tool live">▶ ${esc(head)}</div>`;
  const body = String(res.content || '');
  //结果可能很大，截断避免每次重绘都塞进去
  const shown = body.length > 8000 ? body.slice(0, 8000) + `\n…（共 ${body.length} 字，已截断）` : body;
  return `<details class="msg tool" data-k="${key}"${open.has(key) ? ' open' : ''}>`
    + `<summary>${esc(head)}</summary><pre>${esc(shown)}</pre></details>`;
}

//粗略估算token数：非ASCII按1个，ASCII每4个算1个
function tokOf(s) {
  let n = 0, a = 0;
  for (const ch of s) {
    if (ch.codePointAt(0) > 255) { n++; a = 0; }
    else if (++a === 4) { n++; a = 0; }
  }
  return n + (a ? 1 : 0);
}

//生成速度，token数除以从首个token起的秒数
function rateOf(m) {
  if (!m.t0) return 0;
  const s = (Date.now() - m.t0) / 1000;
  return s > 0 ? Math.round(m.tk / s) : 0;
}

//消息底部操作条，只有用户消息能撤回
function acts(i, undo) {
  return `<div class="msg-act"><button data-copy="${i}">复制</button>`
    + (undo ? `<button data-undo="${i}">撤回</button>` : '') + `</div>`;
}

//撤回用户消息及其之后的对话，一并还原期间的AI改动
function undoFrom(i) {
  const a = chatMsgs();
  const u = a[i];
  if (!u || u.role !== 'user') return;
  if (chatBusy) { toast('生成中，请稍后再试', 'ℹ'); return; }
  if ((u.snap || []).some(s => openTabs.includes(s.path) && dirty.has(s.path))) {
    toast('有未保存的修改，请先保存', '⚠');
    return;
  }
  const n = a.length - i;
  openDlg(n > 1 ? `撤回这条消息及之后 ${n - 1} 条内容？` : '撤回这条消息？', false, () => restoreAndCut(i));
}

//倒序还原改动，新建的文件直接删除，手动改过的文件跳过
async function restoreAndCut(i) {
  const a = chatMsgs();
  const snaps = (a[i] && a[i].snap) || [];
  let skip = 0;
  for (let k = snaps.length - 1; k >= 0; k--) {
    const s = snaps[k];
    if (buffers[s.path] !== undefined && buffers[s.path] !== s.now) { skip++; continue; }
    if (s.old === null) {
      syncPaths(s.path, '');
      send('delete', s.path);
    } else if ((await writeFile(s.path, s.old, s.crlf)).ok) {
      reloadTab(s.path);
    } else {
      skip++;
    }
  }
  a.splice(i);
  saveSettings();
  renderChat();
  toast(skip ? `已撤回，${skip} 个文件因已改动被跳过` : '已撤回', skip ? 'ℹ' : '✓');
}

function renderChatSoon() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = 0; renderChat(); }, 60);
}

function toggleChat(force, noFocus) {
  const show = force === undefined ? chatEl.classList.contains('hidden') : force;
  chatEl.classList.toggle('hidden', !show);
  document.querySelector('[data-view="ai"]').classList.toggle('on', show);
  if (show && !noFocus) chatText.focus();
  saveSettings();
}

//刷新发送框左侧的模型下拉
function renderModels() {
  const list = cfg.models || [];
  chatModel.innerHTML = list.map((m, i) =>
    `<option value="${i}"${i === cfg.modelIdx ? ' selected' : ''}>${esc(m.name || '未命名')}</option>`
  ).join('') || '<option value="0">未配置模型</option>';
  chatModel.disabled = !list.length;
}

chatModel.onchange = () => {
  cfg.modelIdx = +chatModel.value;
  saveSettings();
};

function doChatSend() {
  const v = chatText.value.trim();
  if (!v && !pendImgs.length) return;
  const m = curModel();
  if (!m || !m.url) { toast('请先配置模型接口', 'ℹ'); openSet(); return; }
  if (!m.key) { toast('请先配置 API Key', 'ℹ'); openSet(); return; }
  const imgs = pendImgs;
  chatText.value = '';
  pendImgs = [];
  renderImgs();
  if (chatBusy) {
    chatQueue.push({ text: v, imgs });
    chatHint.textContent = '排队中 ' + chatQueue.length + ' 条';
    return;
  }
  startTurn(v, imgs);
}

function startTurn(v, imgs) {
  toolRounds = 0;
  sumTried = false;
  const m = { role: 'user', content: v };
  if (imgs && imgs.length) m.imgs = imgs.map(i => i.url);
  chatMsgs().push(m);
  renderChat();
  saveSettings();
  chatTurn();
}

function drainQueue() {
  if (chatBusy || !chatQueue.length) return;
  const q = chatQueue.shift();
  startTurn(q.text, q.imgs);
}

//接口地址补全为OPENAI协议的chat/completions
function apiUrl() {
  const m = curModel();
  const u = ((m && m.url) || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/\/(chat\/)?completions$/.test(u)) return u;
  return u + '/chat/completions';
}

//当前界面语言的英文名，供系统提示里的 {lang} 使用
function langName() {
  const l = cfg.lang || 'zh-CN';
  if (l === 'zh-CN') return 'Chinese (Simplified)';
  if (l === 'en') return 'English';
  return l;
}

//替换系统提示里的 {lang} {system} {tools} {format}
function sysPrompt() {
  const p = cfg.prompt || PROMPTS.system;
  return p.replace(/\{lang\}/g, langName()).replace(/\{system\}/g, window.__OS || 'Windows').replace(/\{tools\}/g, toolPrompt()).replace(/\{format\}/g, PROMPTS.format);
}

//按用户轮次裁剪历史，保证 tool 调用与其结果成对保留
//总结过上下文时只带摘要及其之后的消息，并剥掉多余的字段
function packMsgs() {
  const all = chatMsgs();
  const i = all.map(m => !!m.sum).lastIndexOf(true);
  const list = i >= 0 ? all.slice(i) : all;
  //关闭历史时也要带上最后一条提问及其后的工具调用与结果，否则工具回传后上下文就断了
  let src = list;
  if (cfg.history === false) {
    let j = list.length - 1;
    while (j > 0 && list[j].role !== 'user') j--;
    src = list.slice(j);
  }
  const native = mdlCap('tools');
  return src.map(m => {
    if (m.role === 'tool') {
      //文本协议下模型不认识tool角色，结果改用user消息回传，否则模型看不到结果会反复调用
      if (!native) return { role: 'user', content: (m.name || '工具') + ' 返回：\n' + m.content, tool_call_id: m.tool_call_id || '', name: m.name };
      //没有tool_call_id的旧回传无法配对，直接丢弃，避免接口报错
      if (!m.tool_call_id) return null;
      return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
    }
    if (m.role === 'assistant') {
      //文本协议下保留原始调用块，改成原生tool_calls模型会对不上自己的输出
      if (!native) return { role: 'assistant', content: m.content || null };
      const o = { role: 'assistant', content: m.content || null };
      if (m.tool_calls && m.tool_calls.length) {
        o.tool_calls = m.tool_calls;
        //调用块已转成tool_calls，正文里去掉文本块
        o.content = stripToolBlocks(m.content) || null;
      }
      return o;
    }
    let content = m.sum ? t('summaryKeep') + '\n\n' + m.content : m.content;
    //带图片的用户消息改成多模态内容数组
    if (mdlCap('multi') && m.role === 'user' && m.imgs && m.imgs.length) {
      content = [{ type: 'text', text: m.content || '' }]
        .concat(m.imgs.map(u => ({ type: 'image_url', image_url: { url: u } })));
    }
    const o = { role: m.role, content };
    if (m.tool_call_id) o.tool_call_id = m.tool_call_id;
    return o;
  }).filter(Boolean);
}

//上下文超长的错误判定
function contextOverflow() {
  return /context length|maximum context|too many tokens|token limit|上下文|长度超|超出|上限/i.test(aiErr || '');
}

//先让模型总结上文，再用摘要替换历史重发
function summarizeThenRetry() {
  summarizing = true;
  sumBuf = '';
  aiErr = '';
  chatHint.textContent = t('summarizing');
  const m = curModel();
  const body = {
    model: m ? m.name : '',
    stream: true,
    messages: [
      { role: 'system', content: sysPrompt() },
      ...packMsgs(),
      { role: 'user', content: PROMPTS.summary.replace(/\{lang\}/g, langName()) },
    ],
  };
  send('ai', apiUrl(), m ? m.key : '', JSON.stringify(body));
}

//总结完成后把摘要插到当前提问之前，界面记录保留，再重发最后一个问题
function applySummary() {
  const s = sumBuf.trim();
  sumBuf = '';
  summarizing = false;
  const msgs = chatMsgs();
  let at = msgs.length;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { at = i; break; }
  msgs.splice(at, 0, { role: 'user', content: s, sum: true });
  renderChat();
  saveSettings();
  chatTurn();
}

function chatTurn() {
  const m = curModel();
  const body = {
    model: m ? m.name : '',
    stream: true,
    messages: [{ role: 'system', content: sysPrompt() }, ...packMsgs()],
  };
  if (mdlCap('tools')) body.tools = TOOLS;
  if (typeof cfg.temp === 'number') body.temperature = cfg.temp;
  if (typeof cfg.maxTokens === 'number') body.max_tokens = cfg.maxTokens;
  Object.assign(body, cfg.extra || {});
  cur = null;
  aiErr = '';
  chatBusy = true;
  setBusySend(true);
  chatHint.textContent = '生成中…';
  send('ai', apiUrl(), m ? m.key : '', JSON.stringify(body));
}

function onChunk(line) {
  if (!line.startsWith('data:')) return;
  const d = line.slice(5).trim();
  if (!d || d === '[DONE]') return;
  let j;
  try { j = JSON.parse(d); } catch (e) { return; }
  const ch = j.choices && j.choices[0];
  if (!ch) return;
  const delta = ch.delta || {};
  //总结阶段只收集文本，不写入对话
  if (summarizing) {
    if (delta.content) sumBuf += delta.content;
    return;
  }
  if (!cur) {
    cur = { role: 'assistant', content: '', tool_calls: [], tk: 0, t0: 0 };
    chatMsgs().push(cur);
  }
  if (delta.content) {
    //从第一个token开始计时，避免把首字延迟算进速度
    if (!cur.t0) cur.t0 = Date.now();
    cur.tk += tokOf(delta.content);
    cur.rate = rateOf(cur);
    cur.content += delta.content;
  }
  if (delta.tool_calls) {
    for (const t of delta.tool_calls) {
      const i = t.index || 0;
      if (!cur.tool_calls[i]) {
        cur.tool_calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
      }
      const tc = cur.tool_calls[i];
      if (t.id) tc.id = t.id;
      if (t.function) {
        if (t.function.name) tc.function.name = t.function.name;
        if (t.function.arguments) tc.function.arguments += t.function.arguments;
      }
    }
  }
  renderChatSoon();
}

//解析模型用文本块发起的工具调用（支持完整双标记、半闭合和裸JSON三种格式）
function parseToolBlocks(text) {
  const calls = [];
  let m;
  //完整块：两个标记配对
  const fullRE = /\/\/toolcall_start\/\/([\s\S]*?)\/\/toolcall_end\/\//g;
  while ((m = fullRE.exec(text || ''))) {
    let j;
    try { j = JSON.parse(m[1].trim()); } catch (e) { continue; }
    if (!j || !j.name) continue;
    calls.push({ id: '', type: 'function', function: { name: j.name, arguments: JSON.stringify(j.arguments || {}) } });
  }
  //fallback1：半闭合（只有一个开标记）
  if (!calls.length && text) {
    const looseRE = /\/\/toolcall_start\/\/\s*({[\s\S]*?})\s*/g;
    let lm;
    while ((lm = looseRE.exec(text))) {
      let j;
      try { j = JSON.parse(lm[1]); } catch (e) { continue; }
      if (j && j.name) calls.push({ id: '', type: 'function', function: { name: j.name, arguments: JSON.stringify(j.arguments || {}) } });
    }
  }
  //fallback2：裸JSON块（无标记，整行是合法JSON对象且含"name"字段）
  if (!calls.length && text) {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        let j;
        try { j = JSON.parse(trimmed); } catch (e) { continue; }
        if (j && j.name) calls.push({ id: '', type: 'function', function: { name: j.name, arguments: JSON.stringify(j.arguments || {}) } });
      }
    }
  }
  return calls;
}

//从文本中剥除所有toolcall块（含半闭合残留），供渲染时使用
function stripToolBlocks(text) {
  return (text || '').replace(/\/\/toolcall_start\/\/[\s\S]*?(?:\/\/toolcall_end\/\/)?/g, '').trim();
}

function onDone(code) {
  if (aiAbort) {
    aiAbort = false;
    cur = null;
    finishTurn();
    return;
  }
  if (summarizing) {
    if (code === 0 && sumBuf.trim()) { applySummary(); return; }
    summarizing = false;
    sumBuf = '';
    toast('上下文超限且总结失败', '⚠');
    finishTurn();
    return;
  }
  if (!cur) {
    //上下文超长时先总结再重发
    if (code !== 0 && !sumTried && contextOverflow()) {
      sumTried = true;
      summarizeThenRetry();
      return;
    }
    if (code !== 0) toast('AI 请求失败: ' + (aiErr || '请检查设置'), '⚠');
    renderChat();
    finishTurn();
    return;
  }
  if (cur.tool_calls) cur.tool_calls = cur.tool_calls.filter(Boolean);
  //生成结束只留速度，去掉统计用的临时字段
  if (cur.tk !== undefined) {
    if (cur.tk) cur.rate = rateOf(cur);
    delete cur.tk;
    delete cur.t0;
  }
  if (!cur.content) cur.content = '';
  const calls = (cur.tool_calls && cur.tool_calls.length) ? cur.tool_calls : parseToolBlocks(cur.content);
  //文本块发起的调用没有id，补一个，回传结果才能按tool角色配对
  for (const c of calls) if (!c.id) c.id = 'call_' + (++toolCallSeq);
  if (calls.length) { cur.tool_calls = calls; cur.content = stripToolBlocks(cur.content); }
  renderChat();
  saveSettings();
  if (!calls.length) {
    if (code !== 0 && !cur.content) toast('AI 请求失败: ' + (aiErr || '请检查设置'), '⚠');
    finishTurn();
    return;
  }
  if (++toolRounds > 60) {
    toast('工具调用次数过多，已停止', '⚠');
    finishTurn();
    return;
  }
  chatHint.textContent = '执行工具…';
  runTools(calls).then(chatTurn);
}

//本轮彻底结束后再放行下一条
function finishTurn() {
  chatBusy = false;
  setBusySend(false);
  chatHint.textContent = '';
  drainQueue();
}

//生成中把发送键切成圆圈停止键
function setBusySend(on) {
  chatSend.classList.toggle('stop', on);
  chatSend.textContent = on ? '■' : t('send');
  chatSend.title = on ? '停止生成' : '';
}

//中止正在生成的请求，等后端杀掉curl后走aiDone复位
function stopAi() {
  if (!chatBusy) return;
  aiAbort = true;
  chatHint.textContent = '正在停止…';
  send('aiStop');
}

async function runTools(calls) {
  for (const c of calls) {
    let args;
    try { args = JSON.parse(c.function.arguments || '{}'); } catch (e) { args = null; }
    let result;
    const bad = args ? validateTool(c.function.name, args) : '';
    if (!args) result = '参数解析失败，请检查 JSON 格式';
    else if (bad) result = '参数错误：' + bad;
    else if (c.function.name === 'run_command') result = await runCommand(args.command || '');
    else if (c.function.name === 'check_syntax') result = await checkSyntax(args);
    else if (c.function.name === 'read_file') result = await readFileTool(args);
    else if (c.function.name === 'edit_file') result = await editFile(args);
    else if (c.function.name === 'create_file') result = await createFile(args);
    else if (c.function.name === 'list_files') result = await listFiles(args);
    else if (c.function.name === 'search_files') result = await searchFiles(args);
    else if (c.function.name === 'rename_file') result = await renameFile(args);
    else if (c.function.name === 'web_search') result = await webSearch(args);
    else if (c.function.name === 'memory') result = await memoryTool(args);
    else if (c.function.name === 'ask_user') result = await askUser(args.questions);
    else result = '未知工具: ' + c.function.name;
    chatMsgs().push({ role: 'tool', tool_call_id: c.id || '', name: c.function.name, content: String(result) });
    renderChat();
  }
  saveSettings();
}

function runCommand(command) {
  if (!command.trim()) return Promise.resolve('命令为空');
  chatHint.textContent = '执行: ' + command;
  return new Promise(r => {
    execResolve = r;
    send('execCapture', activeTerm ? activeTerm.id : '', command, (activeTerm && activeTerm.cwd) || root || '.');
  });
}

//语法检查：给了 path 检查该文件，不给则扫描整个工作区
async function checkSyntax(a) {
  const p = a && a.path ? resolvePath(a.path) : '';
  if (p) {
    const text = p in buffers ? buffers[p] : null;
    let body = text;
    if (body === null) {
      const r = await readFile(p);
      if (!r.ok) return '读取失败: ' + r.text;
      body = r.text;
    }
    if (!grammarOf(p)) return baseName(p) + ': 没有可用的语法包，跳过检查';
    chatHint.textContent = '语法检查: ' + baseName(p);
    let errs;
    try { errs = await parseText(p, body); }
    catch (e) { chatHint.textContent = ''; return '语法检查引擎不可用，需要联网加载语法包'; }
    chatHint.textContent = '';
    if (!errs.length) return baseName(p) + ': 没有发现语法错误';
    return baseName(p) + ' 发现 ' + errs.length + ' 处问题:\n'
      + errs.map(e => e.line + ':' + (e.col + 1) + ' ' + e.msg).join('\n');
  }
  if (!root) return '未打开文件夹，请给出要检查的文件路径';
  chatHint.textContent = '扫描工作区…';
  const list = await lintWorkspace();
  chatHint.textContent = '';
  if (!list) return '语法检查引擎不可用，需要联网加载语法包';
  if (!list.length) return '工作区没有发现语法错误';
  const head = list.slice(0, 50)
    .map(x => relPath(x.path) + ':' + x.line + ':' + (x.col + 1) + ' ' + x.msg).join('\n');
  return '工作区发现 ' + list.length + ' 处问题:\n' + head + (list.length > 50 ? '\n...已截断' : '');
}

async function readFileTool(a) {
  const p = resolvePath(a.path);
  const r = await readFile(p);
  if (!r.ok) return '读取失败: ' + r.text;
  const lines = r.text.split('\n');
  const max = 3000;
  //给出行号区间时只取这一段，便于大文件按段查看
  let s = parseInt(a.start_line, 10), e = parseInt(a.end_line, 10);
  if (!(s > 0)) s = 1;
  if (!(e >= s)) e = lines.length;
  s = Math.min(s, lines.length);
  e = Math.min(e, s + max - 1, lines.length);
  const out = [];
  for (let i = s - 1; i < e; i++) out.push((i + 1) + '\t' + lines[i].replace(/\r$/, ''));
  if (e < lines.length) out.push('...共 ' + lines.length + ' 行，已截断');
  return out.join('\n');
}

async function listFiles(a) {
  const dir = a.path ? resolvePath(a.path) : (root || cwdPath || '.');
  const text = await ask('list', 'aiList', dir);
  return dir + '\n' + text;
}

async function searchFiles(a) {
  if (!a.query) return '搜索内容为空';
  const flags = (a.regex ? 'r' : '') + (a.case_sensitive ? 'c' : '');
  chatHint.textContent = '搜索: ' + a.query;
  const text = await ask('search', 'aiSearch', root || cwdPath || '.', String(a.query), flags);
  chatHint.textContent = '';
  return text;
}

//联网搜索，后端用系统curl抓结果页并解析
async function webSearch(a) {
  const q = String(a.query || '').trim();
  if (!q) return '搜索关键词为空';
  chatHint.textContent = '联网搜索: ' + q;
  const text = await ask('web', 'webSearch', q);
  chatHint.textContent = '';
  return text;
}

//长期记忆走本地文件，名字为空时读取全部
async function memoryTool(a) {
  const action = String(a.action || 'read').toLowerCase();
  if (action !== 'save' && action !== 'read' && action !== 'delete') return 'action 只能是 save/read/delete';
  const r = await ask('memory', 'memory', action, a.name || '', a.content || '');
  return r.ok ? (r.text || '完成') : '失败: ' + r.text;
}

async function renameFile(a) {
  const from = resolvePath(a.from);
  const to = resolvePath(a.to);
  if (!from || !to) return '路径为空';
  if (from === to) return '路径相同';
  if (openTabs.includes(from) && dirty.has(from)) return '目标文件有未保存修改，请先保存';
  chatHint.textContent = '重命名: ' + baseName(from);
  const r = await ask('rename', 'rename', from, to);
  chatHint.textContent = '';
  if (r.ok && openTabs.includes(from)) {
    closeTab(from);
  }
  return (r.ok ? '成功: ' : '失败: ') + r.msg;
}

//记录本轮改动前后的内容供撤回还原，old为null表示本轮新建
function snapFile(path, old, now, crlf0) {
  const a = chatMsgs();
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i].role !== 'user') continue;
    if (!a[i].snap) a[i].snap = [];
    a[i].snap.push({ path, old, now, crlf: !!crlf0 });
    return;
  }
}

//按行替换，直接写入不等确认，改动记进撤回栈
async function editFile(a) {
  const p = resolvePath(a.path);
  const s = parseInt(a.start_line, 10), e = parseInt(a.end_line, 10);
  if (!(s > 0) || !(e >= s)) return '行号不合法';
  const cur0 = await readFile(p);
  if (!cur0.ok) return '读取失败: ' + cur0.text;
  const crlf0 = cur0.text.includes('\r\n');
  const lines = cur0.text.split('\n').map(l => l.replace(/\r$/, ''));
  if (s > lines.length + 1) return '文件只有 ' + lines.length + ' 行';
  const end = Math.min(e, lines.length);
  const n = end - s + 1;
  const repl = String(a.new_text == null ? '' : a.new_text).split(/\r?\n/);
  lines.splice(s - 1, n, ...repl);
  const w = await writeFile(p, lines.join('\n'), crlf0);
  if (!w.ok) return w.msg;
  snapFile(p, cur0.text, lines.join('\n'), crlf0);
  reloadTab(p);
  return '已替换 ' + n + ' 行\n' + await checkSyntax({ path: p });
}

async function createFile(a) {
  const p = resolvePath(a.path);
  const cur0 = await readFile(p);
  if (cur0.ok) return '文件已存在: ' + p;
  const content = String(a.content == null ? '' : a.content);
  const w = await writeFile(p, content, false);
  if (!w.ok) return w.msg;
  snapFile(p, null, content, false);
  return '已新建 ' + baseName(p) + '\n' + await checkSyntax({ path: p });
}

/* ---------- AI 向用户提问 ---------- */
const askBox=$('askBox'), askBodyEl=$('askBody'), askOkEl=$('askOk');
let askResolve = null;

//一次可问多个问题，单选/多选自动补一个“其他”
function askUser(qs) {
  const list = (Array.isArray(qs) ? qs : []).filter(q => q && q.question);
  if (!list.length) return Promise.resolve('没有要问的问题');
  $('askTitle').textContent = t('askTitle');
  askBodyEl.innerHTML = list.map((q, i) => {
    const type = q.type === 'multi' ? 'multi' : q.type === 'text' ? 'text' : 'single';
    const head = `<div class="ask-q">${esc(String(q.question))}</div>`;
    if (type === 'text') {
      return `<div class="ask-item" data-i="${i}">${head}<div class="ask-opts">
        <label class="ask-opt"><input type="text" data-alone placeholder="${esc(t('askText'))}"></label></div></div>`;
    }
    const box = type === 'multi' ? 'checkbox' : 'radio';
    const rows = (Array.isArray(q.options) ? q.options : []).map(o =>
      `<label class="ask-opt"><input type="${box}" name="q${i}" value="${esc(String(o))}">${esc(String(o))}</label>`).join('');
    return `<div class="ask-item" data-i="${i}">${head}<div class="ask-opts">${rows}
      <label class="ask-opt"><input type="${box}" name="q${i}" data-other>${esc(t('askOther'))}
      <input type="text" data-othertext></label></div></div>`;
  }).join('');
  //提问卡片显示在聊天栏底部，聊天栏没开就自动打开
  toggleChat(true, true);
  askBox.classList.remove('hidden');
  chatBody.scrollTop = chatBody.scrollHeight;
  chatHint.textContent = '等待用户回答';
  return new Promise(r => { askResolve = r; });
}

function submitAsk() {
  const out = [];
  for (const it of askBodyEl.querySelectorAll('.ask-item')) {
    const q = it.querySelector('.ask-q').textContent;
    const vals = [];
    for (const c of it.querySelectorAll('input[type="checkbox"]:checked, input[type="radio"]:checked')) {
      const box = c.parentElement.querySelector('[data-othertext]');
      if (box) {
        const v = box.value.trim();
        if (v) vals.push(v);
      } else {
        vals.push(c.value);
      }
    }
    const alone = it.querySelector('[data-alone]');
    if (alone && alone.value.trim()) vals.push(alone.value.trim());
    out.push(q + ': ' + (vals.length ? vals.join('、') : '（未回答）'));
  }
  askBox.classList.add('hidden');
  chatHint.textContent = '';
  const r = askResolve;
  askResolve = null;
  if (r) r(out.join('\n'));
}

askOkEl.onclick = submitAsk;
askBox.addEventListener('keydown', e => { if (e.key === 'Enter') submitAsk(); });

chatSend.onclick = () => (chatBusy ? stopAi() : doChatSend());
chatBody.addEventListener('click', e => {
  //点击文件链接打开工作区文件
  const fl = e.target.closest('a.chat-file-link');
  if (fl) {
    e.preventDefault();
    const fp = fl.dataset.filepath || '';
    const ln = parseInt(fl.dataset.line, 10) || 0;
    if (fp) openFileAt(fp, ln, '');
    return;
  }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.copy !== undefined) {
    const m = chatMsgs()[+b.dataset.copy];
    if (m) copyText(m.content || '', '');
  } else if (b.dataset.undo !== undefined) {
    undoFrom(+b.dataset.undo);
  }
});
chatText.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doChatSend(); }
});
/* ---------- AI 会话管理 ---------- */
const histList = $('chatHistList');

function chatHist() {
  return ws().sessions;
}

//归档当前会话，空会话直接丢弃
function archiveChat() {
  const cur = chatMsgs();
  if (!cur.length) return;
  const u = cur.find(m => m.role === 'user');
  const w = ws();
  w.sessions.unshift({
    t: Date.now(),
    title: u && u.content ? u.content.slice(0, 30) : '（无提问）',
    msgs: cur,
  });
  //只留最近 30 条历史
  w.sessions = w.sessions.slice(0, 30);
  w.chat = [];
}

function closeHist() {
  histList.classList.add('hidden');
}

function newChat() {
  if (chatBusy) { toast('正在生成中，稍后再试', 'ℹ'); return; }
  archiveChat();
  closeHist();
  saveSettings();
  renderChat();
}

function renderHist() {
  const list = chatHist();
  histList.innerHTML = list.length
    ? list.map((h, i) => `<div class="chat-hist-item" data-h="${i}">
        <div class="h-main">
          <div class="h-t">${esc(h.title)}</div>
          <div class="t">${new Date(h.t).toLocaleString()}</div>
        </div>
        <button class="h-del" data-del="${i}" title="${esc(t('del'))}">×</button>
      </div>`).join('')
    : '<div class="chat-hist-none">还没有历史会话</div>';
}

function openHist() {
  if (chatBusy) { toast('正在生成中，稍后再试', 'ℹ'); return; }
  renderHist();
  histList.classList.toggle('hidden');
}

//取出历史会话继续聊，当前会话先归档
function pickHist(i) {
  const w = ws();
  const h = w.sessions[i];
  if (!h) return;
  w.sessions.splice(i, 1);
  archiveChat();
  w.chat = h.msgs;
  closeHist();
  saveSettings();
  renderChat();
}

histList.addEventListener('click', e => {
  const d = e.target.closest('[data-del]');
  if (d) {
    ws().sessions.splice(+d.dataset.del, 1);
    saveSettings();
    renderHist();
    return;
  }
  const it = e.target.closest('[data-h]');
  if (it) pickHist(+it.dataset.h);
});

document.addEventListener('click', e => {
  if (!e.target.closest('#chatHistList') && !e.target.closest('#chatHistory')) closeHist();
});

$('chatNew').onclick = newChat;
$('chatHistory').onclick = openHist;
$('chatClose').onclick = () => { closeHist(); toggleChat(false); };
chatUp.onclick = () => send('pickChatFile');

/* ---------- AI 长期记忆管理（设置页） ---------- */
const memListEl = $('memList'), memEditEl = $('memEdit');
const memNameEl = $('memName'), memTextEl = $('memText');
let memItems = [];
let memOrigin = '';

//拉全部记忆并渲染列表
async function memRefresh() {
  memItems = await ask('memList', 'memory', 'list', '', '');
  memListEl.innerHTML = memItems.length
    ? memItems.map((m, i) => `<div class="mem-item" data-i="${i}"><span class="m-name">${esc(m.name)}</span></div>`).join('')
    : `<div class="mem-none">${esc(t('memNone'))}</div>`;
}

//打开编辑表单，name 为空即新建
function memEdit(name) {
  const it = memItems.find(m => m.name === name);
  memOrigin = it ? it.name : '';
  memNameEl.value = it ? it.name : '';
  memTextEl.value = it ? (it.content || '') : '';
  memEditEl.classList.remove('hidden');
  memNameEl.focus();
}

function memCancelEdit() {
  memOrigin = '';
  memEditEl.classList.add('hidden');
}

async function memSave() {
  const name = memNameEl.value.trim();
  if (!name) { toast(t('memNeedName'), '⚠'); return; }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) { toast(t('memBadName'), '⚠'); return; }
  //改了名字先删旧的，避免留下两份
  if (memOrigin && memOrigin !== name) await ask('memory', 'memory', 'delete', memOrigin, '');
  const r = await ask('memory', 'memory', 'save', name, memTextEl.value);
  if (!r.ok) { toast(r.text || '保存失败', '⚠'); return; }
  toast(t('memSaved'), '✓');
  memCancelEdit();
  await memRefresh();
}

function memDelete() {
  if (!memOrigin) return;
  const name = memOrigin;
  openDlg(t('memDelAsk', name), false, async () => {
    await ask('memory', 'memory', 'delete', name, '');
    toast(t('memDeleted'), '✓');
    memCancelEdit();
    await memRefresh();
  });
}

$('memNew').onclick = () => memEdit('');
$('memCancel').onclick = memCancelEdit;
$('memSave').onclick = memSave;
$('memDel').onclick = memDelete;
memListEl.addEventListener('click', e => {
  const it = e.target.closest('.mem-item');
  if (it) memEdit(memItems[+it.dataset.i].name);
});

//资源管理器的节点可以拖进输入框，取到的是完整路径
treeEl.addEventListener('dragstart', e => {
  const node = e.target.closest('.node');
  if (node) e.dataTransfer.setData('text/plain', node.dataset.path);
});
const chatBox = chatText.closest('.chat-input');
//拖拽经过时高亮输入框，离开后自动熄灭
let dragTimer = 0;
chatEl.addEventListener('dragover', e => {
  e.preventDefault();
  chatBox.classList.add('drop-on');
  clearTimeout(dragTimer);
  dragTimer = setTimeout(() => chatBox.classList.remove('drop-on'), 120);
});
//系统拖入只能拿到文件内容，因此只收图片，其余靠资源管理器拖路径
chatEl.addEventListener('drop', e => {
  e.preventDefault();
  clearTimeout(dragTimer);
  chatBox.classList.remove('drop-on');
  const fs = e.dataTransfer.files;
  if (fs && fs.length) {
    for (const f of fs) {
      if (imgExt(f.name)) readImg(f, f.name);
      else toast(t('imgOnly'), 'ℹ');
    }
    return;
  }
  const p = e.dataTransfer.getData('text/plain');
  if (p) addToChat(p);
});
//系统拖入文件时阻止整页跳转到该文件
document.addEventListener('dragover', e => { if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault(); });

chatImgs.addEventListener('click', e => {
  const b = e.target.closest('[data-imgi]');
  if (!b) return;
  pendImgs.splice(+b.dataset.imgi, 1);
  renderImgs();
});

$('welOpen').onclick = openFolderCmd;
$('welNew').onclick = openNewProj;
$('npPick').onclick = () => send('pickDir');
$('npCancel').onclick = () => npMask.classList.remove('show');
$('npOk').onclick = createProject;
npLang.onchange = renderNewTmpl;
npMask.addEventListener('click', e => { if (e.target === npMask) npMask.classList.remove('show'); });

$('openGo').onclick = () => {
  const p = openPend;
  openMask.classList.remove('show');
  //确认后强制按文本打开
  if (p) send('openFileForce', p);
  openPend = '';
};

/* ---------- 调试器 ---------- */

//断点：path -> [{line, cond, log, enabled}]
let bps = {};

//把下载到的入口路径拼成启动命令，模板不含占位符时原样返回
function dbgCmdOf(d, exe) {
  return d.cmd && d.cmd.includes('{exe}') ? d.cmd.replace('{exe}', exe) : (d.cmd || '');
}

//当前文件的调试语言
function dbgLang(path) {
  const n = baseName(path || '').toLowerCase();
  const i = n.lastIndexOf('.');
  return i < 0 ? '' : (DEBUG_EXT[n.slice(i + 1)] || '');
}

//一种语言的调试配置，用户设置覆盖内置默认
function dbgConf(lang) {
  const d = DEBUG_DEF[lang] || { cmd:'', url:'' };
  const u = (cfg.dbg && cfg.dbg[lang]) || {};
  const pick = (k, fb) => u[k] !== undefined ? u[k] : fb;
  return { lang, def:d, cmd:pick('cmd', d.cmd || ''), url:pick('url', d.url || ''), on:pick('on', 1) };
}

//侧栏下拉选中的语言，默认跟随当前文件
function dbgSelLang() {
  const l = active ? dbgLang(active) : '';
  if (l && DEBUG_DEF[l]) return l;
  if (cfg.dbgSel && DEBUG_DEF[cfg.dbgSel]) return cfg.dbgSel;
  return Object.keys(DEBUG_DEF)[0] || '';
}

function renderDbgConf() {
  const cur = dbgSelLang();
  dbgConfEl.innerHTML = Object.keys(DEBUG_DEF).map(k => {
    const c = dbgConf(k);
    return `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(DEBUG_DEF[k].name)}${c.cmd.trim() ? '' : '（未配置）'}</option>`;
  }).join('');
}

/* ----- 断点 ----- */

function bpAt(path, line) {
  return (bps[path] || []).find(b => b.line === line) || null;
}

function saveBps() {
  cfg.bps = bps;
  saveSettings();
}

//点行号：已有断点就删掉，没有就加一个
function toggleBp(path, line) {
  const list = bps[path] || (bps[path] = []);
  const i = list.findIndex(b => b.line === line);
  if (i >= 0) list.splice(i, 1);
  else list.push({ line, enabled: true });
  if (!list.length) delete bps[path];
  saveBps();
  renderGutter();
  renderBps();
  if (dbg) dbgSetBps(path);
}

//右键行号：填条件，log: 前缀表示日志断点
function openBpCond(line) {
  if (!active) return;
  const p = active;
  const b = bpAt(p, line);
  openDlg(t('dbgCond'), true, v => {
    v = (v || '').trim();
    const list = bps[p] || (bps[p] = []);
    let it = list.find(x => x.line === line);
    if (!it) { it = { line, enabled: true }; list.push(it); }
    it.cond = '';
    it.log = '';
    if (v.startsWith('log:')) it.log = v.slice(4).trim();
    else it.cond = v;
    saveBps();
    renderGutter();
    renderBps();
    if (dbg) dbgSetBps(p);
  }, b ? (b.log ? 'log: ' + b.log : (b.cond || '')) : '');
}

function renderBps() {
  const rows = [];
  for (const p in bps) for (const b of bps[p]) rows.push({ p, b });
  renderBps._rows = rows;
  if (!rows.length) {
    dbgBpsEl.innerHTML = `<div class="dbg-none">${esc(t('dbgNoBps'))}</div>`;
    return;
  }
  dbgBpsEl.innerHTML = rows.map((r, i) => {
    const cond = r.b.log ? 'log: ' + r.b.log : (r.b.cond || '');
    return `<div class="dbg-item" data-i="${i}">
      <span class="ck${r.b.enabled === false ? '' : ' on'}"></span>
      <span>${esc(baseName(r.p))}</span><span class="bn">${r.b.line}</span>
      ${cond ? `<span class="bd">${esc(cond)}</span>` : ''}
      <span class="bx" data-x="${i}">×</span></div>`;
  }).join('');
}

//把某个文件的断点同步给适配器
function dbgSetBps(path) {
  if (!dbg || !dbg.ready) return;
  const list = (bps[path] || []).map(b => ({
    line: b.line,
    condition: b.cond || undefined,
    logMessage: b.log || undefined,
  }));
  dbgReq('setBreakpoints', {
    source: { name: baseName(path), path },
    breakpoints: list,
    sourceModified: false,
  }).catch(() => {});
}

dbgBpsEl.addEventListener('click', e => {
  const rows = renderBps._rows || [];
  const x = e.target.closest('[data-x]');
  if (x) {
    const r = rows[+x.dataset.x];
    if (!r) return;
    bps[r.p] = bps[r.p].filter(b => b !== r.b);
    if (!bps[r.p].length) delete bps[r.p];
    saveBps();
    renderGutter();
    renderBps();
    if (dbg) dbgSetBps(r.p);
    return;
  }
  const it = e.target.closest('.dbg-item');
  if (!it) return;
  const r = rows[+it.dataset.i];
  if (!r) return;
  if (e.target.closest('.ck')) {
    r.b.enabled = r.b.enabled === false;
    saveBps();
    renderGutter();
    renderBps();
    if (dbg) dbgSetBps(r.p);
    return;
  }
  setView('explorer');
  openFileAt(r.p, r.b.line);
});

/* ----- 监视 ----- */

function renderWatch() {
  dbgWatchEl.innerHTML = dbgWatchList.map((w, i) => {
    const v = dbgWatchVals.find(x => x.w === w) || {};
    return `<div class="dbg-item" data-w="${i}">
      <span>${esc(w)}</span>
      <span class="bd" style="margin-left:auto">${esc(v.v || '')}</span>
      <span class="bx" data-wx="${i}">×</span></div>`;
  }).join('');
}

dbgWatchEl.addEventListener('click', e => {
  const x = e.target.closest('[data-wx]');
  if (x) {
    dbgWatchList.splice(+x.dataset.wx, 1);
    renderWatch();
    return;
  }
});

dbgWatchInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const v = dbgWatchInput.value.trim();
  if (!v) return;
  dbgWatchList.push(v);
  dbgWatchInput.value = '';
  renderWatch();
  dbgWatchRefresh();
});

async function dbgWatchRefresh() {
  if (!dbg || !dbg.frameId || !dbgWatchList.length) { dbgWatchVals = []; renderWatch(); return; }
  const list = [];
  for (const w of dbgWatchList) {
    try {
      const r = await dbgReq('evaluate', { expression: w, frameId: dbg.frameId, context: 'watch' });
      list.push({ w, v: (r && r.result) || '' });
    } catch (err) {
      list.push({ w, v: String(err) });
    }
  }
  dbgWatchVals = list;
  renderWatch();
}

/* ----- 调用栈与变量 ----- */

function renderStack() {
  if (!dbgStack.length) {
    dbgStackEl.innerHTML = `<div class="dbg-none">${esc(t('dbgNoStack'))}</div>`;
    return;
  }
  dbgStackEl.innerHTML = dbgStack.map((f, i) => {
    const loc = f.source ? baseName(f.source.path) + ':' + f.line : '';
    const on = dbg && f.id === dbg.frameId ? ' on' : '';
    return `<div class="dbg-frame${on}" data-f="${i}">
      <span>${esc(f.name)}</span><span class="fl">${esc(loc)}</span></div>`;
  }).join('');
}

dbgStackEl.addEventListener('click', e => {
  const it = e.target.closest('.dbg-frame');
  if (!it) return;
  const f = dbgStack[+it.dataset.f];
  if (f) dbgSelectFrame(f, true);
});

function dbgSelectFrame(f, jump) {
  if (!dbg) return;
  dbg.frameId = f.id;
  renderStack();
  if (jump && f.source && f.source.path) {
    dbgMark = { path: f.source.path, line: f.line };
    openFileAt(f.source.path, f.line);
  }
  dbgVarsRefresh();
  dbgWatchRefresh();
}

async function dbgVarsRefresh() {
  dbgVarCache = {};
  dbgExpand = new Set();
  dbgScopes = [];
  if (!dbg || !dbg.frameId) { renderVars(); return; }
  try {
    const r = await dbgReq('scopes', { frameId: dbg.frameId });
    const scopes = (r && r.scopes) || [];
    const out = [];
    for (const s of scopes) {
      let vars = [];
      try {
        const v = await dbgReq('variables', { variablesReference: s.variablesReference });
        vars = (v && v.variables) || [];
        dbgVarCache[s.variablesReference] = vars;
      } catch (e) {}
      out.push({ scope: s, vars });
    }
    dbgScopes = out;
  } catch (e) {
    dbgScopes = [];
  }
  renderVars();
}

function renderVars() {
  if (!dbg || !dbg.frameId) {
    dbgVarsEl.innerHTML = `<div class="dbg-none">${esc(t('dbgNoStack'))}</div>`;
    return;
  }
  let h = '';
  for (const sc of dbgScopes) {
    h += `<div class="dbg-var" style="color:var(--text-dim)">${esc(sc.scope.name)}</div>`;
    if (!sc.vars.length) h += `<div class="dbg-none">${esc(t('dbgVarsEmpty'))}</div>`;
    else h += sc.vars.map(v => dbgVarHtml(v, 1)).join('');
  }
  dbgVarsEl.innerHTML = h || `<div class="dbg-none">${esc(t('dbgVarsEmpty'))}</div>`;
}

function dbgVarHtml(v, depth) {
  const can = v.variablesReference > 0;
  const open = can && dbgExpand.has(v.variablesReference);
  let h = `<div class="dbg-var" data-ref="${v.variablesReference}" style="padding-left:${10 + depth * 12}px">
    <span class="ar">${can ? (open ? '▾' : '▸') : ''}</span>
    <span class="vk">${esc(v.name)}</span>
    <span class="vv">${esc(v.value)}</span>
    ${v.type ? `<span class="vt">${esc(v.type)}</span>` : ''}</div>`;
  if (open && dbgVarCache[v.variablesReference]) {
    h += dbgVarCache[v.variablesReference].map(k => dbgVarHtml(k, depth + 1)).join('');
  }
  return h;
}

dbgVarsEl.addEventListener('click', async e => {
  const row = e.target.closest('.dbg-var[data-ref]');
  if (!row || !dbg) return;
  const ref = +row.dataset.ref;
  if (!ref) return;
  if (dbgExpand.has(ref)) {
    dbgExpand.delete(ref);
    renderVars();
    return;
  }
  dbgExpand.add(ref);
  if (!dbgVarCache[ref]) {
    try {
      const r = await dbgReq('variables', { variablesReference: ref });
      dbgVarCache[ref] = (r && r.variables) || [];
    } catch (err) {
      dbgVarCache[ref] = [];
    }
  }
  renderVars();
});

/* ----- DAP 通信 ----- */

function dbgNote(method, args) {
  if (!dbg) return;
  const msg = { seq: dbg.seq++, type: 'request', command: method };
  if (args !== undefined) msg.arguments = args;
  send('dbgSend', dbg.tid, JSON.stringify(msg));
}

function dbgReq(method, args, timeout) {
  if (!dbg) return Promise.reject(t('dbgNotReady'));
  const seq = dbg.seq++;
  const msg = { seq, type: 'request', command: method };
  if (args !== undefined) msg.arguments = args;
  send('dbgSend', dbg.tid, JSON.stringify(msg));
  return new Promise((res, rej) => {
    const w = { res, rej };
    dbg.wait[seq] = w;
    if (timeout) setTimeout(() => { if (dbg && dbg.wait[seq] === w) { delete dbg.wait[seq]; rej('超时'); } }, timeout);
  });
}

function dbgOnMsg(tid, json) {
  if (!dbg || dbg.tid !== tid) return;
  if (!json) { dbgEnd(t('dbgExited')); return; }
  let m;
  try { m = JSON.parse(json); } catch (e) { return; }
  if (m.type === 'response') {
    const w = dbg.wait[m.request_seq];
    if (!w) return;
    delete dbg.wait[m.request_seq];
    if (m.success) w.res(m.body);
    else w.rej(m.message || '错误');
    return;
  }
  if (m.type === 'event') dbgEvent(m.event, m.body || {});
}

function dbgEvent(ev, b) {
  if (ev === 'initialized') { dbgInit(); return; }
  if (ev === 'output') { dbgOutput(b); return; }
  if (ev === 'stopped') { dbgStopped(b); return; }
  if (ev === 'continued') { dbg.paused = false; dbgMark = null; dbgToolsRefresh(); renderGutter(); return; }
  if (ev === 'terminated') { dbgEnd(t('dbgTerminated')); return; }
}

function dbgInit() {
  for (const p in bps) dbgSetBps(p);
  dbgNote('setExceptionBreakpoints', { filters: [] });
  dbgNote('configurationDone', {});
  dbg.ready = true;
  dbgToolsRefresh();
  dbgLog(t('dbgReady'), false);
}

function dbgOutput(b) {
  if (!b || b.category === 'telemetry') return;
  let s = b.output || '';
  if (!s) return;
  dbgLog(s.replace(/\n$/, ''), b.category === 'stderr');
}

function dbgStopped(b) {
  if (!dbg) return;
  dbg.paused = true;
  dbg.threadId = b.threadId || dbg.threadId || 1;
  dbgToolsRefresh();
  dbgLog((b.description || b.reason || 'stopped'), false);
  dbgReq('stackTrace', { threadId: dbg.threadId, startFrame: 0, levels: 30 }).then(r => {
    if (!dbg) return;
    dbgStack = (r && r.stackFrames) || [];
    renderStack();
    if (dbgStack.length) dbgSelectFrame(dbgStack[0], true);
    else { dbgScopes = []; renderVars(); }
  }).catch(() => {});
}

/* ----- 会话控制 ----- */

function dbgLog(text, err) {
  const d = document.createElement('div');
  d.className = 'o-line' + (err ? ' o-err' : '');
  d.textContent = String(text);
  dbgOut.appendChild(d);
  while (dbgOut.childElementCount > 800) dbgOut.firstChild.remove();
  dbgOut.scrollTop = dbgOut.scrollHeight;
}

async function dbgEnsureThread() {
  if (dbg.threadId) return dbg.threadId;
  try {
    const r = await dbgReq('threads', {});
    dbg.threadId = (r && r.threads && r.threads[0] && r.threads[0].id) || 1;
  } catch (e) {
    dbg.threadId = 1;
  }
  return dbg.threadId;
}

async function dbgCmd(cmd, args) {
  if (!dbg) return;
  const tid = await dbgEnsureThread();
  if (!dbg) return;
  dbgNote(cmd, Object.assign({ threadId: tid }, args || {}));
  if (cmd !== 'pause') { dbg.paused = false; dbgToolsRefresh(); }
}

function dbgToolsRefresh() {
  const on = !!dbg;
  const paused = on && !!dbg.paused;
  const set = (id, off) => { const el = $(id); if (el) el.classList.toggle('off', off); };
  set('dbgStartBtn', on);
  set('dbgStopBtn', !on);
  set('dbgContinue', !paused);
  set('dbgNext', !paused);
  set('dbgStepIn', !paused);
  set('dbgStepOut', !paused);
  set('dbgPause', !(on && !paused));
  set('dbgRestart', !on);
}

function dbgProbe(c) {
  const check = c.def.check;
  if (!check) return Promise.resolve(true);
  return new Promise(res => {
    dbgProbeWait = { cmd: check, done: res };
    send('dbgProbe', check);
  });
}

function dbgBuild(cmd) {
  return new Promise(res => {
    showTerm();
    const term = activeTerm || newTerm(false);
    dbgBuildWait = { tid: term.id, done: code => res(code === 0) };
    send('exec', term.id, cmd, root || '');
  });
}

async function dbgStartFlow() {
  if (dbg) { toast(t('dbgRunning'), 'ℹ'); return; }
  if (!active) { toast(t('dbgNoFile'), '⚠'); return; }
  const lang = dbgConfEl.value || dbgSelLang();
  const c = dbgConf(lang);
  const d = c.def;
  if (!d || !c.cmd.trim()) { toast(t('dbgNoAdapter', (d && d.name) || lang), '⚠'); return; }
  if (d.check) {
    toast(t('dbgDetecting'));
    const ok = await dbgProbe(c);
    if (!ok) {
      toast(t('dbgNoAdapter', d.name), '⚠');
      if (d.tip) log(d.name + '：' + d.tip);
      return;
    }
  }
  const o = { file: active, root: root || dirName(active), program: (d.program || (p => p))(active) };
  if (d.build) {
    log(t('dbgBuild') + ' ' + d.name);
    const ok = await dbgBuild(d.build(active));
    if (!ok) { toast(t('dbgBuildFail'), '⚠'); return; }
  }
  dbgLast = { lang, c, o };
  dbgOpen(c, o);
}

function dbgOpen(c, o) {
  const tid = 'dbg' + Date.now().toString(36);
  dbg = { tid, lang: c.lang, def: c.def, cmd: c.cmd, root: o.root, o,
          seq: 1, wait: {}, ready: false, paused: false, threadId: 0, frameId: 0 };
  dbgStack = [];
  dbgScopes = [];
  dbgVarCache = {};
  dbgExpand = new Set();
  dbgWatchVals = [];
  renderStack();
  renderVars();
  renderWatch();
  const mode = c.def.mode || 'stdio';
  send('dbgStart', tid, c.cmd, o.root, mode, c.def.addr || '');
  dbgReq('initialize', {
    clientID: 'miniide', clientName: 'MiniIDE', adapterID: c.def.name || c.lang,
    linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path',
    supportsRunInTerminalRequest: false, supportsVariableType: true,
    supportsProgressReporting: true, supportsTerminateRequest: true,
  }).then(() => dbgReq('launch', c.def.launch(o)))
    .catch(e => dbgLog(t('dbgStartFail', String(e)), true));
  dbgToolsRefresh();
  showPanel('dbg');
  setView('debug');
}

function dbgEnd(msg) {
  const d = dbg;
  dbg = null;
  dbgMark = null;
  dbgStack = [];
  dbgScopes = [];
  dbgVarCache = {};
  dbgExpand = new Set();
  dbgWatchVals = [];
  if (d) send('dbgStop', d.tid);
  renderStack();
  renderVars();
  renderWatch();
  dbgToolsRefresh();
  renderGutter();
  if (msg) dbgLog(msg, true);
}

function dbgStop() {
  if (!dbg) return;
  const id = dbg.tid;
  dbgNote('disconnect', { terminateDebuggee: true });
  setTimeout(() => { if (dbg && dbg.tid === id) dbgEnd(t('dbgTerminated')); }, 200);
}

async function dbgRestart() {
  if (!dbg) return;
  const last = dbgLast;
  dbgEnd(null);
  if (last) setTimeout(() => dbgOpen(last.c, { file: last.o.file, root: last.o.root,
    program: (last.c.def.program || (p => p))(last.o.file) }), 350);
}

async function dbgReplRun() {
  const v = dbgRepl.value.trim();
  if (!v) return;
  dbgRepl.value = '';
  dbgLog('> ' + v, false);
  if (!dbg) { dbgLog(t('dbgNotReady'), true); return; }
  try {
    const r = await dbgReq('evaluate', { expression: v, context: 'repl' });
    dbgLog((r && r.result !== undefined) ? r.result : t('dbgEvalFail'), false);
  } catch (e) {
    dbgLog(String(e), true);
  }
}

/* ----- 调试 UI 接线 ----- */

$('dbgStartBtn').onclick = () => dbgStartFlow();
$('dbgStopBtn').onclick = () => dbgStop();
$('dbgContinue').onclick = () => dbgCmd('continue');
$('dbgNext').onclick = () => dbgCmd('next');
$('dbgStepIn').onclick = () => dbgCmd('stepIn');
$('dbgStepOut').onclick = () => dbgCmd('stepOut');
$('dbgPause').onclick = () => dbgCmd('pause');
$('dbgRestart').onclick = () => dbgRestart();
dbgRepl.addEventListener('keydown', e => { if (e.key === 'Enter') dbgReplRun(); });
dbgConfEl.addEventListener('change', () => { cfg.dbgSel = dbgConfEl.value; saveSettings(); });

//编辑器里按 F5/F9/F10/F11 等控制调试
window.addEventListener('keydown', e => {
  const k = e.key;
  if (k === 'F5') {
    e.preventDefault();
    if (e.shiftKey) dbgStop();
    else if (dbg && dbg.paused) dbgCmd('continue');
    else dbgStartFlow();
    return;
  }
  if (k === 'F9' && active) {
    e.preventDefault();
    toggleBp(active, curLine());
    return;
  }
  if (k === 'F10') { e.preventDefault(); dbgCmd('next'); return; }
  if (k === 'F11') { e.preventDefault(); if (e.shiftKey) dbgCmd('stepOut'); else dbgCmd('stepIn'); }
});

//光标所在行号
function curLine() {
  const v = taEl.value.slice(0, taEl.selectionStart);
  return v.split('\n').length;
}

$('openCancel').onclick = () => openMask.classList.remove('show');
openMask.addEventListener('click', e => { if (e.target === openMask) openMask.classList.remove('show'); });

/* ---------- 后端回调 ---------- */
window.api = {
  root(path, entries) {
    root = path;
    children[path] = entries;
    expanded.add(path);
    stRoot.textContent = path;
    cwdPath = path;
    if (activeTerm) activeTerm.cwd = path;
    renderTree();
    closeHist();
    renderChat();
    toast('已打开 ' + baseName(path));
    send('setRoot', path);
    saveSettings();
  },
  children(path, entries) {
    children[path] = entries;
    expanded.add(path);
    renderTree();
    saveSettings();
  },
  file(path, text, lang) {
    crlf[path] = text.includes('\r\n');
    buffers[path] = text;
    langs[path] = lang;
    //AI 后台改的别把编辑器切过去，只刷新缓冲区
    if (bgReload === path) {
      bgReload = '';
      if (active === path) activate(path);
      else renderTabs();
      return;
    }
    activate(path);
    if (restoreLeft > 0 && --restoreLeft === 0) finishRestore();
    if (pendingLine && pendingLine.path === path) {
      gotoLine(pendingLine.line, pendingLine.q);
      pendingLine = null;
    }
  },
  //附件：图片走上传，其余把路径填进输入框
  chatFile(path) {
    addChatPath(path);
  },
  pickDir(path) {
    npDir.value = path;
  },
  //二进制或非 UTF-8 的文件，问一下要不要硬当文本打开
  askOpen(path, why) {
    openPend = path;
    openMsg.innerHTML = esc(t(why === 'binary' ? 'openBinMsg' : 'openEncMsg')) + `<br><b>${esc(path)}</b>`;
    openMask.classList.add('show');
  },
  //一次性命令（新建项目、AI执行）的输出回显到终端
  term(tid, cls, line) {
    termLine(tid, cls, line);
  },
  execEnd(tid, code, dir) {
    if (dir) cwdPath = dir;
    if (dbgBuildWait && dbgBuildWait.tid === tid) {
      const f = dbgBuildWait.done;
      dbgBuildWait = null;
      f(code);
    }
  },
  pwd(path) {
    cwdPath = path;
  },
  //伪终端屏幕快照（来自 vt100 解析）
  termScreen(tid, json) {
    const t = termOf(tid);
    if (t && t.term) t.term.render(json);
  },
  termExit(tid) {
    termLine(tid, 'muted', t('termExitMsg'));
  },
  termFail(tid, msg) {
    termLine(tid, 'err', msg);
    toast(t('lspFail', '终端'), '⚠');
  },
  settings(text) {
    applySettings(text);
    applyLang();
    initRes(false);
    renderChat();
    //断点与调试配置随设置一起恢复
    bps = (cfg.bps && typeof cfg.bps === 'object') ? cfg.bps : {};
    renderGutter();
    renderBps();
    renderDbgConf();
    restoreSession();
  },
  settingsSaved() {},
  //工作区文件按扩展名选语法包逐个检查
  async lintFiles(files) {
    wsProb = [];
    let parser;
    let cur = '';
    let failed = false;
    for (const f of files) {
      const name = grammarOf(f.path);
      if (!name) continue;
      try {
        const mod = await loadTs();
        parser = parser || new mod.Parser();
        if (name !== cur) {
          parser.setLanguage(await tsLang(mod, name));
          cur = name;
        }
        const tree = parser.parse(f.text);
        for (const e of tsErrors(tree)) wsProb.push({ path:f.path, line:e.line, col:e.col, msg:e.msg });
        tree.delete();
      } catch (e) {
        failed = true;
        break;
      }
      if (wsProb.length >= 300) break;
    }
    if (probMode === 'ws') renderProblems();
    if (lintCapture) { const r = lintCapture; lintCapture = null; r(failed ? null : wsProb); }
  },
  runtimes(m) {
    runs = m || {};
    scanned = true;
    renderRuns();
    renderNewProj();
  },
  projTmpls(list) {
    dotnetTmpls = list || [];
    if (npMask.classList.contains('show')) renderNewTmpl();
  },
  searchResults(query, hits) {
    srHits = hits;
    srSel = -1;
    log('搜索 "' + query + '" 命中 ' + hits.length + ' 处');
    renderSr();
  },
  searchErr(msg) {
    searchResults.innerHTML = `<div class="sr-none">${esc(msg)}</div>`;
  },
  //git命令结果，序号对得上才唤醒等待中的请求
  gitResult(id, r) {
    if (gitWait && gitWait.id === id) {
      const f = gitWait.res;
      gitWait = null;
      f(r);
    }
  },
  execResult(text) {
    chatHint.textContent = '';
    if (execResolve) {
      const r = execResolve;
      execResolve = null;
      r(text);
    }
  },
  readDone(ok, text) {
    answer('read', { ok: ok === 1, text: text || '' });
  },
  //外部改动感知结果，m 为修改时间毫秒（0 表示文件不存在）
  stat(rows) {
    let treeDirty = false;
    for (const r of rows) {
      //根目录与已展开/已读取的目录走资源管理器刷新，其余按打开的文件处理
      const isDir = r.p === root || expanded.has(r.p) || (r.p in children);
      if (!r.m) {
        delete statSeen[r.p];
        if (isDir) {
          //目录已消失，清掉展开状态与缓存，避免继续读取
          if (r.p !== root) { expanded.delete(r.p); delete children[r.p]; }
          treeDirty = true;
        }
        continue;
      }
      const key = r.m + ':' + r.s;
      const prev = statSeen[r.p];
      if (prev === undefined) { statSeen[r.p] = key; continue; }
      if (prev === key) continue;
      statSeen[r.p] = key;
      if (isDir) { treeDirty = true; continue; }
      if (!(r.p in buffers)) continue;
      if (dirty.has(r.p)) { toast(t('statConflict', baseName(r.p)), '⚠'); continue; }
      toast(t('statChanged', baseName(r.p)), '⟳');
      reloadTab(r.p);
    }
    if (treeDirty) refreshTree();
  },
  writeDone(ok, msg) {
    answer('write', { ok: ok === 1, msg: msg || '' });
  },
  memoryDone(ok, text) {
    answer('memory', { ok: ok === 1, text: text || '' });
  },
  memList(items) {
    answer('memList', Array.isArray(items) ? items : []);
  },
  renameDone(ok, msg) {
    answer('rename', { ok: ok === 1, msg: msg || '' });
  },
  aiListDone(text) {
    answer('list', text || '目录为空或不存在');
  },
  aiSearchDone(text) {
    answer('search', text || '无匹配');
  },
  webSearchDone(text) {
    answer('web', text || '无搜索结果');
  },
  aiChunk(line) {
    onChunk(line);
  },
  aiError(text) {
    aiErr = aiErr ? aiErr + '\n' + text : text;
  },
  aiDone(code) {
    onDone(code);
  },
  lspMsg(tid, json) {
    lspOnMsg(tid, json);
  },
  lspFail(tid, msg) {
    let lang = '';
    for (const k in lspSrv) {
      if (lspSrv[k].tid === tid) lang = k;
    }
    if (lang && lspSrv[lang]) {
      lspSrv[lang].dead = true;
      lspSrv[lang].ready = false;
    }
    updateStatus();
    toast(t('lspFail', lang && LSP_DEF[lang] ? LSP_DEF[lang].name : tid), '⚠');
    log((lang || tid) + ' 语言服务器：' + msg);
  },
  //下载完成，把可执行路径回填到设置项并自动启用
  //LSP下载进度：cur/total 字节，total=0 时只有已下载数
  lspProgress(lang, cur, total) {
    const id = 'lsp-prog-' + lang;
    const el = outBody.querySelector('#' + id) || (() => {
      const d = document.createElement('div');
      d.id = id;
      d.className = 'out-line lsp-prog';
      outBody.appendChild(d);
      return d;
    })();
    let pct, bar;
    const fmtMB = b => (b / 1024 / 1024).toFixed(1) + 'MB';
    if (total > 0) {
      pct = (cur * 100 / total) | 0;
      const n = Math.max(0, Math.min(40, (pct * 40 / 100) | 0));
      bar = '[' + '='.repeat(n) + ' '.repeat(40 - n) + ']';
    } else {
      pct = '?';
      bar = `[  ${fmtMB(cur)} / ?MB  ]`;
    }
    const tail = total > 0 ? `${fmtMB(cur)}/${fmtMB(total)}` : fmtMB(cur);
    el.textContent = `${pct}% ${bar}  ${tail}  下载 ${LSP_DEF[lang]?.name || lang} 语言服务器`;
    outBody.scrollTop = outBody.scrollHeight;
  },
  lspInstalled(lang, exe, err) {
    //删掉那个进度条 div
    const old = outBody.querySelector('#lsp-prog-' + lang);
    if (old) old.remove();
    if (err) {
      toast(err, '⚠');
      return;
    }
    const d = LSP_DEF[lang] || {};
    //node类服务器用node解释js入口，路径可能含空格故加引号
    const prefix = d.node ? 'node "' + exe + '"' : '"' + exe + '"';
    const cmd = prefix + (d.args ? ' ' + d.args : '');
    const cmdEl = lspListEl.querySelector(`[data-lsp-cmd="${lang}"]`);
    const onEl = lspListEl.querySelector(`[data-lsp-on="${lang}"]`);
    if (cmdEl) cmdEl.value = cmd;
    if (onEl) onEl.checked = true;
    cfg.lsp[lang] = Object.assign(cfg.lsp[lang] || {}, { on:1, cmd });
    saveSettings();
    toast(t('lspDone', LSP_DEF[lang] ? LSP_DEF[lang].name : lang), '✓');
  },
  //收到后端读出的主题原文（vsix里可能有多套），按JSONC解析后合并进列表并即时套用
  //调试适配器发来的DAP消息
  dbgMsg(tid, json) {
    dbgOnMsg(tid, json);
  },
  dbgFail(tid, msg) {
    if (dbg && dbg.tid === tid) {
      dbgLog(t('dbgStartFail', msg), true);
      toast(t('dbgStartFail', msg), '⚠');
      dbgEnd(null);
    }
  },
  dbgProbe(cmd, ok, text) {
    if (dbgProbeWait && dbgProbeWait.cmd === cmd) {
      const f = dbgProbeWait.done;
      dbgProbeWait = null;
      f(ok === true);
    }
  },
  //下载完成，把可执行路径回填到设置项
  dbgInstalled(name, exe, err) {
    const old = outBody.querySelector('#dbg-prog-' + name);
    if (old) old.remove();
    if (err) { toast(err, '⚠'); return; }
    const d = DEBUG_DEF[name] || {};
    const cmd = dbgCmdOf(d, exe);
    cfg.dbg = cfg.dbg || {};
    cfg.dbg[name] = Object.assign(cfg.dbg[name] || {}, { on:1, cmd });
    const cmdEl = dbgListEl.querySelector(`[data-dbg-cmd="${name}"]`);
    if (cmdEl) cmdEl.value = cmd;
    saveSettings();
    renderDbgConf();
    toast(t('dbgDone', d.name || name), '✓');
  },
  dbgProgress(name, cur, total) {
    const id = 'dbg-prog-' + name;
    const el = outBody.querySelector('#' + id) || (() => {
      const d = document.createElement('div');
      d.id = id;
      d.className = 'out-line lsp-prog';
      outBody.appendChild(d);
      return d;
    })();
    const pct = total > 0 ? ((cur * 100 / total) | 0) + '%' : ((cur / 1048576).toFixed(1) + 'MB');
    el.textContent = `${pct} 下载 ${(DEBUG_DEF[name] && DEBUG_DEF[name].name) || name} 调试适配器`;
    outBody.scrollTop = outBody.scrollHeight;
  },
  themeFiles(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { toast(t('themeBad'), '⚠'); return; }
    if (!Array.isArray(raw)) raw = [raw];
    cfg.themes = cfg.themes || [];
    let idx = -1;
    for (const s of raw) {
      let j;
      try { j = typeof s === 'string' ? parseJsonc(s) : s; } catch (e) { continue; }
      if (!j || typeof j !== 'object' || !(j.colors || j.tokenColors)) continue;
      const th = vscTheme(j);
      const i = cfg.themes.findIndex(x => x.name === th.name);
      if (i >= 0) { cfg.themes[i] = th; idx = i; } else { idx = cfg.themes.push(th) - 1; }
    }
    if (idx < 0) { toast(t('themeBad'), '⚠'); return; }
    cfg.theme = 'vsc:' + idx;
    renderThemeSelect();
    customBox.style.display = 'none';
    applyTheme();
    saveSettings();
    toast(t('themeDone', cfg.themes[idx].name), '✓');
  }
};

renderTree();
renderTabs();
renderGutter();
updateStatus();

//浏览器模式轮询本地服务下发的脚本
if (BRIDGE) {
  (async () => {
    for (;;) {
      try {
        const r = await fetch('/poll');
        for (const js of await r.json()) {
          try {
            (0, eval)(js);
          } catch (e) {}
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 60));
    }
  })();
}

//高亮库由后端拉取后注入，就绪或失败时回调
window.resLoaded = function (kind, fresh) {
  if (kind === 'hljs') {
    updateStatus();
    requestHighlight();
    renderChat();
  }
  if (kind === 'marked' || kind === 'purify') initMd();
  if (fresh) toast(t('resDone', t('resN_' + kind)), '⭳');
};

//大资源就绪，把本地地址交给等待的一方
window.resPath = function (kind, name, path, fresh) {
  const key = name ? kind + ':' + name : kind;
  resUrls[key] = resUrl(path);
  const res = resWait[key];
  delete resWait[key];
  if (res) res(resUrls[key]);
  if (fresh) toast(t('resDone', t('resN_' + kind)), '⭳');
};

//大资源失败，唤醒等待者并提示
window.resFailed = function (kind, name, fresh) {
  const key = name ? kind + ':' + name : kind;
  const res = resWait[key];
  delete resWait[key];
  if (res) res(null);
  if (kind === 'hljs') toast(t('resFail', t('resN_hljs')), '⚠');
};

//翻译包是JSON键值对，合并到内置简中之上
window.transLoaded = function (lang, text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch (e) {
    toast(t('transBad', lang), '⚠');
    return;
  }
  if (!m || typeof m !== 'object') return;
  I18N[lang] = Object.assign({}, I18N['zh-CN'], m);
  renderLangs();
  if (cfg.lang === lang) applyLang();
};

window.transFailed = function (lang) {
  toast(t('resFail', lang), '⚠');
};

//断点与调试配置就绪后渲染一次
renderBps();
renderWatch();
renderStack();
renderVars();
dbgToolsRefresh();
renderDbgConf();
$('aboutVer').textContent = window.__VER ? 'v' + window.__VER : '';

send('cwd');
send('loadSettings');
setInterval(statPoll, 2000);
log('MiniIDE 已启动');
