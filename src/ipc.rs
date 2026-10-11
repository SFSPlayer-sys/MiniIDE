use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use tao::event_loop::EventLoopProxy;
use tao::window::WindowId;

use crate::tree::{self, Entry};
use crate::{ai, debug, highlight, lsp, res, search, terminal, web, Ev};

//字段分隔符
const SEP: char = '\u{1}';

//无webview时把脚本压入队列，由浏览器轮询取走
static BROWSER: AtomicBool = AtomicBool::new(false);
static QUEUE: Mutex<Vec<String>> = Mutex::new(Vec::new());

//各窗口当前打开的工作区，写windows.txt时用
static ROOTS: Mutex<Vec<(WindowId, String)>> = Mutex::new(Vec::new());

//各窗口正在进行的AI请求对应的curl进程号，用于中止
static AI_PIDS: Mutex<Vec<(WindowId, Arc<AtomicU32>)>> = Mutex::new(Vec::new());

pub fn set_root(id: WindowId, root: &str) {
    if let Ok(mut v) = ROOTS.lock() {
        v.retain(|(i, _)| *i != id);
        v.push((id, root.to_string()));
    }
}

//窗口当前工作区，未打开文件夹时为空串
pub fn root_of(id: WindowId) -> String {
    ROOTS
        .lock()
        .ok()
        .and_then(|v| v.iter().find(|(i, _)| *i == id).map(|(_, r)| r.clone()))
        .unwrap_or_default()
}

pub fn clear_root(id: WindowId) {
    if let Ok(mut v) = ROOTS.lock() {
        v.retain(|(i, _)| *i != id);
    }
}

pub fn handle(body: &str, id: WindowId, proxy: &EventLoopProxy<Ev>) {
    //终端输入是原始按键字节，可能带分隔符，单独切分保住分隔符之后的内容
    if let Some(rest) = body.strip_prefix("termWrite\u{1}") {
        let mut it = rest.splitn(2, SEP);
        let tid = it.next().unwrap_or("");
        terminal::write(tid, it.next().unwrap_or(""));
        return;
    }
    let mut it = body.splitn(8, SEP);
    let cmd = it.next().unwrap_or("");
    match cmd {
        "openFolder" => pick_folder(id, proxy),
        "openFolderNew" => pick_folder_new(proxy),
        "openDir" => open_dir(id, proxy, it.next().unwrap_or("")),
        "openFileDialog" => pick_file(id, proxy),
        "pickChatFile" => pick_chat_file(id, proxy),
        "pickDir" => pick_dir(id, proxy),
        "openFileForce" => open_file_force(id, proxy, it.next().unwrap_or("")),
        "projTmpls" => proj_tmpls(id, proxy, it.next().unwrap_or("")),
        "newProject" => new_project(
            id,
            proxy,
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
        ),
        "newWindow" => {
            let _ = proxy.send_event(Ev::New(None));
        }
        "readDir" => {
            let dir = it.next().unwrap_or("");
            let js = format!("api.children({}, {})", jstr(dir), items_json(&tree::read_dir(dir)));
            eval(id, proxy, js);
        }
        "openFile" => open_file(id, proxy, it.next().unwrap_or("")),
        "reveal" => reveal(id, proxy, it.next().unwrap_or("")),
        "save" => save(
            id,
            proxy,
            it.next().unwrap_or(""),
            it.next().unwrap_or("0") == "1",
            it.next().unwrap_or(""),
        ),
        "exec" => exec(id, proxy, it.next().unwrap_or(""), it.next().unwrap_or(""), it.next().unwrap_or("")),
        "execCapture" => exec_capture(
            id,
            proxy,
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
        ),
        "cancel" => terminal::cancel(it.next().unwrap_or("")),
        "termOpen" => term_open(
            id,
            proxy,
            it.next().unwrap_or(""),
            it.next().unwrap_or("80").parse().unwrap_or(80),
            it.next().unwrap_or("24").parse().unwrap_or(24),
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
        ),
        "termResize" => terminal::resize(
            it.next().unwrap_or(""),
            it.next().unwrap_or("80").parse().unwrap_or(80),
            it.next().unwrap_or("24").parse().unwrap_or(24),
        ),
        //前端主动取屏幕 JSON 快照
        "termPoll" => {
            let tid = it.next().unwrap_or("");
            let json = terminal::snapshot(tid).unwrap_or_default();
            eval(id, &proxy, format!("api.termScreen({}, {json})", jstr(tid)));
        }
        "termClose" => terminal::close(it.next().unwrap_or("")),
        "cwd" => {
            let p = std::env::current_dir().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
            eval(id, proxy, format!("api.pwd({})", jstr(&p)));
        }
        "create" => {
            let dir = it.next().unwrap_or("");
            let name = it.next().unwrap_or("");
            let is_dir = it.next().unwrap_or("0") == "1";
            create(id, proxy, dir, name, is_dir);
        }
        "loadSettings" => load_settings(id, proxy),
        "setRoot" => set_root(id, it.next().unwrap_or("")),
        "scanRun" => scan_run(id, proxy),
        "saveSettings" => save_settings(id, proxy, it.next().unwrap_or("")),
        "search" => {
            let root = it.next().unwrap_or("");
            let query = it.next().unwrap_or("");
            let flags = it.next().unwrap_or("");
            search_ws(id, proxy, root, query, flags);
        }
        "ai" => {
            let url = it.next().unwrap_or("");
            let key = it.next().unwrap_or("");
            let req = it.next().unwrap_or("");
            chat(id, proxy, url, key, req);
        }
        "aiStop" => ai_stop(id),
        "git" => {
            let seq = it.next().unwrap_or("");
            let sub = it.next().unwrap_or("");
            let args = it.next().unwrap_or("");
            git_cmd(id, proxy, seq, sub, args);
        }
        "readFile" => read_file(id, proxy, it.next().unwrap_or("")),
        "statFile" => stat_files(id, proxy, it.next().unwrap_or("")),
        "writeFile" => {
            let path = it.next().unwrap_or("");
            let crlf = it.next().unwrap_or("0") == "1";
            let text = it.next().unwrap_or("");
            write_file(id, proxy, path, crlf, text);
        }
        "rename" => {
            let from = it.next().unwrap_or("");
            let to = it.next().unwrap_or("");
            rename(id, proxy, from, to);
        }
        "delete" => delete(id, proxy, it.next().unwrap_or("")),
        "zip" => zip_paths(id, proxy, it.next().unwrap_or(""), it.next().unwrap_or("")),
        "unzip" => unzip_file(id, proxy, it.next().unwrap_or("")),
        "memory" => memory(
            id,
            proxy,
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
        ),
        "aiList" => ai_list(id, proxy, it.next().unwrap_or("")),
        "aiSearch" => {
            let root = it.next().unwrap_or("");
            let query = it.next().unwrap_or("");
            let flags = it.next().unwrap_or("");
            ai_search(id, proxy, root, query, flags);
        }
        "resLoad" => {
            let kind = it.next().unwrap_or("");
            let url = it.next().unwrap_or("");
            let name = it.next().unwrap_or("");
            let force = it.next().unwrap_or("0") == "1";
            res_load(id, proxy, kind, url, name, force);
        }
        "resImport" => {
            let kind = it.next().unwrap_or("");
            let name = it.next().unwrap_or("");
            res_import(id, proxy, kind, name);
        }
        "resScan" => res_scan(id, proxy, it.next().unwrap_or("")),
        "themeImport" => theme_import(id, proxy),
        "lspStart" => lsp_start(
            id,
            proxy,
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
        ),
        "lspSend" => lsp::send(it.next().unwrap_or(""), it.next().unwrap_or("")),
        "lspStop" => lsp::stop(it.next().unwrap_or("")),
        "lspInstall" => lsp_install(id, proxy, it.next().unwrap_or(""), it.next().unwrap_or("")),
        "dbgStart" => dbg_start(
            id,
            proxy,
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
        ),
        "dbgSend" => debug::send(it.next().unwrap_or(""), it.next().unwrap_or("")),
        "dbgStop" => debug::stop(it.next().unwrap_or("")),
        "dbgProbe" => dbg_probe(id, proxy, it.next().unwrap_or("")),
        "dbgInstall" => dbg_install(id, proxy, it.next().unwrap_or(""), it.next().unwrap_or("")),
        "webSearch" => web_search(id, proxy, it.next().unwrap_or("")),
        _ => {}
    }
}

//切换到浏览器兜底模式
pub fn set_browser() {
    BROWSER.store(true, Ordering::Relaxed);
}

//拉取或读取资源，完成后注入页面
fn res_load(id: WindowId, proxy: &EventLoopProxy<Ev>, kind: &str, src: &str, name: &str, force: bool) {
    let proxy = proxy.clone();
    let (kind, src, name) = (kind.to_string(), src.to_string(), name.to_string());
    std::thread::spawn(move || {
        //大文件与二进制资源只回传缓存路径，页面经本地服务自行加载
        if res::is_file_kind(&kind) {
            let (r, fresh) = res::fetch(&kind, &src, &name, force);
            deliver_path(id, &proxy, &kind, &name, r, fresh);
            return;
        }
        let (r, fresh) = res::load(&kind, &src, &name, force);
        deliver(id, &proxy, &kind, &name, r, fresh);
    });
}

//选本地文件当资源，覆盖缓存
fn res_import(id: WindowId, proxy: &EventLoopProxy<Ev>, kind: &str, name: &str) {
    let proxy = proxy.clone();
    let (kind, name) = (kind.to_string(), name.to_string());
    std::thread::spawn(move || {
        let Some(p) = rfd::FileDialog::new().pick_file() else { return };
        let src = p.to_string_lossy().to_string();
        if res::is_file_kind(&kind) {
            let (r, fresh) = res::fetch(&kind, &src, &name, true);
            deliver_path(id, &proxy, &kind, &name, r, fresh);
            return;
        }
        let (r, fresh) = res::load(&kind, &src, &name, true);
        deliver(id, &proxy, &kind, &name, r, fresh);
    });
}

//导入主题：vsix解包后扫出所有主题json，普通json直接读
fn theme_import(id: WindowId, proxy: &EventLoopProxy<Ev>) {
    let proxy = proxy.clone();
    std::thread::spawn(move || {
        let Some(p) = rfd::FileDialog::new().add_filter("主题", &["vsix", "json"]).pick_file() else { return };
        let vsix = p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("vsix")).unwrap_or(false);
        let files = if vsix {
            theme_from_vsix(&p)
        } else {
            match fs::read_to_string(&p) {
                Ok(t) => vec![t],
                Err(e) => {
                    toast(id, &proxy, &format!("读取失败: {e}"));
                    return;
                }
            }
        };
        if files.is_empty() {
            toast(id, &proxy, "没找到主题文件");
            return;
        }
        //原文按字符串逐个传，主题是JSONC可能带尾逗号或注释，交给页面按JSONC解析
        //整段拼成JSON文本后再转义成JS字符串，页面JSON.parse拿到的才是字符串数组
        let arr = format!("[{}]", files.iter().map(|f| jstr(f)).collect::<Vec<_>>().join(","));
        eval(id, &proxy, format!("api.themeFiles({})", jstr(&arr)));
    });
}

//vsix就是zip，交给系统tar解到临时目录再扫
fn theme_from_vsix(path: &Path) -> Vec<String> {
    let tmp = std::env::temp_dir().join(format!("miniide-theme-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    if fs::create_dir_all(&tmp).is_err() {
        return Vec::new();
    }
    let ok = Command::new("tar")
        .creation_flags(0x08000000)
        .arg("-x")
        .arg("-f")
        .arg(path)
        .arg("-C")
        .arg(&tmp)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    let mut out = Vec::new();
    if ok {
        collect_themes(&tmp, &mut out, 0);
    }
    let _ = fs::remove_dir_all(&tmp);
    out
}

//递归找主题json，带colors或tokenColors的才算，package.json之类跳过
fn collect_themes(dir: &Path, out: &mut Vec<String>, depth: u32) {
    if depth > 6 || out.len() >= 32 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_themes(&p, out, depth + 1);
            continue;
        }
        if p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("json")) != Some(true) {
            continue;
        }
        let Ok(t) = fs::read_to_string(&p) else { continue };
        if t.contains("\"tokenColors\"") || t.contains("\"colors\"") {
            out.push(t);
        }
    }
}

//把资源结果回传页面
fn deliver(id: WindowId, proxy: &EventLoopProxy<Ev>, kind: &str, name: &str, r: Option<String>, fresh: bool) {
    let f = if fresh { 1 } else { 0 };
    let js = match (kind, r) {
        ("trans", Some(t)) => format!("window.transLoaded&&window.transLoaded({}, {});", jstr(name), jstr(&t)),
        ("trans", None) => format!("window.transFailed&&window.transFailed({});", jstr(name)),
        (k, Some(t)) => format!("{t}\n;window.resLoaded&&window.resLoaded({}, {f});", jstr(k)),
        (k, None) => format!("window.resFailed&&window.resFailed({}, \"\", {f});", jstr(k)),
    };
    eval(id, proxy, js);
}

//把资源的缓存路径回传页面，页面再经本地服务加载
fn deliver_path(id: WindowId, proxy: &EventLoopProxy<Ev>, kind: &str, name: &str, r: Option<std::path::PathBuf>, fresh: bool) {
    let f = if fresh { 1 } else { 0 };
    let js = match r {
        Some(p) => format!("window.resPath&&window.resPath({}, {}, {}, {f});", jstr(kind), jstr(name), jstr(&p.to_string_lossy())),
        None => format!("window.resFailed&&window.resFailed({}, {}, {f});", jstr(kind), jstr(name)),
    };
    eval(id, proxy, js);
}

//扫描工作区源码，交给页面按语法包检查
fn res_scan(id: WindowId, proxy: &EventLoopProxy<Ev>, root: &str) {
    const MAX_FILES: usize = 400;
    let proxy = proxy.clone();
    let root = root.to_string();
    std::thread::spawn(move || {
        let files = res::src_files(&root, MAX_FILES);
        let mut s = String::from("[");
        for (i, (p, t)) in files.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            s.push_str(&format!("{{\"path\":{},\"text\":{}}}", jstr(p), jstr(t)));
        }
        s.push(']');
        eval(id, &proxy, format!("api.lintFiles({s})"));
    });
}

//起一个语言服务器，消息持续回推给页面
fn lsp_start(id: WindowId, proxy: &EventLoopProxy<Ev>, tid: &str, cmd: &str, cwd: &str) {
    let proxy = proxy.clone();
    let (tid, cmd, cwd) = (tid.to_string(), cmd.to_string(), cwd.to_string());
    std::thread::spawn(move || {
        let t = tid.clone();
        let p2 = proxy.clone();
        let out = move |json: &str| {
            eval(id, &p2, format!("api.lspMsg({}, {})", jstr(&t), jstr(json)));
        };
        if let Err(e) = lsp::start(&tid, &cmd, &cwd, out) {
            eval(id, &proxy, format!("api.lspFail({}, {})", jstr(&tid), jstr(&e)));
        }
    });
}

//下载并解压语言服务器，把可执行路径或错误回传页面；下载过程中实时 eval 进度到输出面板
fn lsp_install(id: WindowId, proxy: &EventLoopProxy<Ev>, lang: &str, url: &str) {
    let proxy = proxy.clone();
    let (lang, url) = (lang.to_string(), url.to_string());
    let pid = id;
    std::thread::spawn(move || {
        let lang2 = lang.clone();
        let mut last_perm: i32 = -1;
        let mut last_tick = std::time::Instant::now();
        let js = match lsp::install(&lang, &url, |cur, total| {
            let perm = if total > 0 { (cur * 100 / total) as i32 } else { -1 };
            let now = std::time::Instant::now();
            let throttle = perm != last_perm || now.duration_since(last_tick) > std::time::Duration::from_millis(120);
            if throttle {
                last_perm = perm;
                last_tick = now;
                let js = format!(
                    "api.lspProgress({}, {}, {})",
                    jstr(&lang2), cur, total
                );
                eval(pid, &proxy, js);
            }
        }) {
            Ok(exe) => format!("api.lspInstalled({}, {}, \"\")", jstr(&lang), jstr(&exe)),
            Err(e) => format!("api.lspInstalled({}, \"\", {})", jstr(&lang), jstr(&e)),
        };
        eval(id, &proxy, js);
    });
}

//起一个调试适配器，消息持续回推给页面；失败时通知页面
fn dbg_start(id: WindowId, proxy: &EventLoopProxy<Ev>, tid: &str, cmd: &str, cwd: &str, mode: &str, addr: &str) {
    let proxy = proxy.clone();
    let (tid, cmd, cwd, mode, addr) = (tid.to_string(), cmd.to_string(), cwd.to_string(), mode.to_string(), addr.to_string());
    std::thread::spawn(move || {
        let t = tid.clone();
        let p2 = proxy.clone();
        let out = move |json: &str| {
            eval(id, &p2, format!("api.dbgMsg({}, {})", jstr(&t), jstr(json)));
        };
        if let Err(e) = debug::start(&tid, &cmd, &cwd, &mode, &addr, out) {
            eval(id, &proxy, format!("api.dbgFail({}, {})", jstr(&tid), jstr(&e)));
        }
    });
}

//探测本机是否装了某适配器，结果回给页面用于提示安装
fn dbg_probe(id: WindowId, proxy: &EventLoopProxy<Ev>, cmd: &str) {
    let proxy = proxy.clone();
    let cmd = cmd.to_string();
    std::thread::spawn(move || {
        let (ok, text) = debug::probe(&cmd);
        eval(id, &proxy, format!("api.dbgProbe({}, {}, {})", jstr(&cmd), ok, jstr(&text)));
    });
}

//下载并解压调试适配器，把可执行路径或错误回传页面
fn dbg_install(id: WindowId, proxy: &EventLoopProxy<Ev>, name: &str, url: &str) {
    let proxy = proxy.clone();
    let (name, url) = (name.to_string(), url.to_string());
    std::thread::spawn(move || {
        //python 适配器 debugpy 是 pip 包，改用 pip 安装
        if name == "python" {
            let js = match Command::new("python")
                .args(["-m", "pip", "install", "-U", "debugpy"])
                .creation_flags(0x08000000)
                .output()
            {
                Ok(o) if o.status.success() => format!("api.dbgInstalled({}, \"\", \"\")", jstr(&name)),
                Ok(o) => {
                    let s = String::from_utf8_lossy(&o.stderr);
                    let e = s.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("pip 安装失败").trim().to_string();
                    format!("api.dbgInstalled({}, \"\", {})", jstr(&name), jstr(&e))
                }
                Err(e) => format!("api.dbgInstalled({}, \"\", {})", jstr(&name), jstr(&format!("无法启动 python: {e}"))),
            };
            eval(id, &proxy, js);
            return;
        }
        let n2 = name.clone();
        let mut last = -1i64;
        let js = match debug::install(&name, &url, |cur, total| {
            let pct = if total > 0 { (cur * 100 / total) as i64 } else { -1 };
            if pct != last {
                last = pct;
                eval(id, &proxy, format!("api.dbgProgress({}, {}, {})", jstr(&n2), cur, total));
            }
        }) {
            Ok(exe) => format!("api.dbgInstalled({}, {}, \"\")", jstr(&name), jstr(&exe)),
            Err(e) => format!("api.dbgInstalled({}, \"\", {})", jstr(&name), jstr(&e)),
        };
        eval(id, &proxy, js);
    });
}

//取走待执行的脚本，返回JSON数组

//取走待执行的脚本，返回JSON数组
pub fn take_queue() -> String {
    let list: Vec<String> = QUEUE.lock().map(|mut q| q.drain(..).collect()).unwrap_or_default();
    let mut s = String::from("[");
    for (i, js) in list.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&jstr(js));
    }
    s.push(']');
    s
}

pub fn eval(id: WindowId, proxy: &EventLoopProxy<Ev>, js: String) {
    if BROWSER.load(Ordering::Relaxed) {
        if let Ok(mut q) = QUEUE.lock() {
            //页面已关仍无上限堆积，超限丢弃最早的一半
            if q.len() >= 4096 {
                let d = q.len() - 2048;
                q.drain(..d);
            }
            q.push(js);
        }
        return;
    }
    let _ = proxy.send_event(Ev::Eval(id, js));
}

//按路径打开文件夹，路径不存在则忽略
fn open_dir(id: WindowId, proxy: &EventLoopProxy<Ev>, dir: &str) {
    if !Path::new(dir).is_dir() {
        return;
    }
    let js = format!("api.root({}, {})", jstr(dir), items_json(&tree::read_dir(dir)));
    eval(id, proxy, js);
}

//选择文件夹，避免阻塞事件循环
fn pick_folder(id: WindowId, proxy: &EventLoopProxy<Ev>) {
    let proxy = proxy.clone();
    std::thread::spawn(move || {
        if let Some(dir) = rfd::FileDialog::new().pick_folder() {
            open_dir(id, &proxy, &dir.to_string_lossy());
        }
    });
}

//另开一个窗口打开文件夹
fn pick_folder_new(proxy: &EventLoopProxy<Ev>) {
    let proxy = proxy.clone();
    std::thread::spawn(move || {
        if let Some(dir) = rfd::FileDialog::new().pick_folder() {
            let _ = proxy.send_event(Ev::New(Some(dir.to_string_lossy().to_string())));
        }
    });
}

//选文件当对话附件，把路径回填到输入框
fn pick_chat_file(id: WindowId, proxy: &EventLoopProxy<Ev>) {
    let proxy = proxy.clone();
    std::thread::spawn(move || {
        if let Some(f) = rfd::FileDialog::new().pick_file() {
            eval(id, &proxy, format!("api.chatFile({})", jstr(&f.to_string_lossy())));
        }
    });
}

//选目录填进新建项目面板
fn pick_dir(id: WindowId, proxy: &EventLoopProxy<Ev>) {
    let proxy = proxy.clone();
    std::thread::spawn(move || {
        if let Some(d) = rfd::FileDialog::new().pick_folder() {
            eval(id, &proxy, format!("api.pickDir({})", jstr(&d.to_string_lossy())));
        }
    });
}

//新建项目：建目录、在项目里跑模板命令、跑完打开该项目
fn new_project(id: WindowId, proxy: &EventLoopProxy<Ev>, parent: &str, name: &str, cmd: &str, tid: &str) {
    let target = Path::new(parent).join(name);
    if let Err(e) = fs::create_dir_all(&target) {
        toast(id, proxy, &format!("创建失败: {e}"));
        return;
    }
    let dir = target.to_string_lossy().to_string();
    if cmd.is_empty() {
        open_dir(id, proxy, &dir);
        return;
    }
    let proxy = proxy.clone();
    let cmd = cmd.to_string();
    let tid = tid.to_string();
    std::thread::spawn(move || {
        terminal::run(&tid, &cmd, &dir, |line, cls| {
            eval(id, &proxy, format!("api.term({}, {}, {})", jstr(&tid), jstr(cls), jstr(line)));
        });
        open_dir(id, &proxy, &dir);
    });
}

fn pick_file(id: WindowId, proxy: &EventLoopProxy<Ev>) {
    let proxy = proxy.clone();
    std::thread::spawn(move || {
        if let Some(f) = rfd::FileDialog::new().pick_file() {
            open_file(id, &proxy, &f.to_string_lossy());
        }
    });
}

//图片没有可编辑的文本，打开后由页面走预览
fn is_image(path: &str) -> bool {
    let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "avif")
}

//终端里点路径：目录在资源管理器中展开，文件按普通文件打开
fn reveal(id: WindowId, proxy: &EventLoopProxy<Ev>, path: &str) {
    let p = Path::new(path);
    if p.is_dir() {
        let js = format!("api.children({}, {})", jstr(path), items_json(&tree::read_dir(path)));
        eval(id, proxy, js);
    } else if p.is_file() {
        open_file(id, proxy, path);
    } else {
        toast(id, proxy, "路径不存在");
    }
}

fn open_file(id: WindowId, proxy: &EventLoopProxy<Ev>, path: &str) {
    if is_image(path) {
        let lang = highlight::lang_of(path);
        eval(id, proxy, format!("api.file({}, {}, {})", jstr(path), jstr(""), jstr(lang)));
        return;
    }
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            toast(id, proxy, &format!("打开失败: {e}"));
            return;
        }
    };
    let lang = highlight::lang_of(path);
    //带 BOM 的 UTF-16 文本每隔一个字节就是 0，不能按字节判二进制
    if let Some(text) = utf16_text(&bytes) {
        eval(id, proxy, format!("api.file({}, {}, {})", jstr(path), jstr(&text), jstr(lang)));
        return;
    }
    if bytes.contains(&0) {
        eval(id, proxy, format!("api.askOpen({}, {})", jstr(path), jstr("binary")));
        return;
    }
    match String::from_utf8(bytes) {
        Ok(text) => eval(id, proxy, format!("api.file({}, {}, {})", jstr(path), jstr(&text), jstr(lang))),
        //非 UTF-8 时按 GBK/ANSI 再试一次，保存时统一写回 UTF-8
        Err(e) => match gbk_text(e.as_bytes()) {
            Some(text) => eval(id, proxy, format!("api.file({}, {}, {})", jstr(path), jstr(&text), jstr(lang))),
            None => eval(id, proxy, format!("api.askOpen({}, {})", jstr(path), jstr("encoding"))),
        },
    }
}

//GBK/ANSI 码页
const CP_GBK: u32 = 936;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn MultiByteToWideChar(cp: u32, flags: u32, s: *const u8, cb: i32, out: *mut u16, cch: i32) -> i32;
}

//按字节判断是否像 GBK：ASCII 或合法的双字节序列
fn is_gbk(b: &[u8]) -> bool {
    let mut i = 0;
    while i < b.len() {
        if b[i] < 0x80 {
            i += 1;
            continue;
        }
        if b[i] < 0x81 || b[i] > 0xFE || i + 1 >= b.len() {
            return false;
        }
        let t = b[i + 1];
        if !(0x40..=0xFE).contains(&t) || t == 0x7F {
            return false;
        }
        i += 2;
    }
    true
}

//GBK/ANSI 解码为 UTF-8，不像 GBK 返回 None
fn gbk_text(bytes: &[u8]) -> Option<String> {
    if !is_gbk(bytes) {
        return None;
    }
    let n = unsafe { MultiByteToWideChar(CP_GBK, 0, bytes.as_ptr(), bytes.len() as i32, std::ptr::null_mut(), 0) };
    if n <= 0 {
        return None;
    }
    let mut buf = vec![0u16; n as usize];
    unsafe { MultiByteToWideChar(CP_GBK, 0, bytes.as_ptr(), bytes.len() as i32, buf.as_mut_ptr(), n) };
    Some(String::from_utf16_lossy(&buf))
}

//带 BOM 的 UTF-16 转成 UTF-8，其它编码返回 None
fn utf16_text(bytes: &[u8]) -> Option<String> {
    let le = if bytes.starts_with(&[0xFF, 0xFE]) {
        true
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        false
    } else {
        return None;
    };
    let mut u: Vec<u16> = bytes[2..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    if !le {
        for c in u.iter_mut() {
            *c = c.swap_bytes();
        }
    }
    String::from_utf16(&u).ok()
}

//用户确认后不再挑编码，能读就读
fn open_file_force(id: WindowId, proxy: &EventLoopProxy<Ev>, path: &str) {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            toast(id, proxy, &format!("打开失败: {e}"));
            return;
        }
    };
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let lang = highlight::lang_of(path);
    eval(id, proxy, format!("api.file({}, {}, {})", jstr(path), jstr(&text), jstr(lang)));
}

//crlf为原文件换行风格，保存时还原
fn save(id: WindowId, proxy: &EventLoopProxy<Ev>, path: &str, crlf: bool, text: &str) {
    let data = if crlf { text.replace('\n', "\r\n") } else { text.to_string() };
    match fs::write(path, data) {
        Ok(_) => toast(id, proxy, &format!("{} 已保存", tree::name_of(path))),
        Err(e) => toast(id, proxy, &format!("保存失败: {e}")),
    }
}

fn create(id: WindowId, proxy: &EventLoopProxy<Ev>, dir: &str, name: &str, is_dir: bool) {
    let path = Path::new(dir).join(name);
    let r = if is_dir { fs::create_dir_all(&path) } else { fs::write(&path, "") };
    if let Err(e) = r {
        toast(id, proxy, &format!("创建失败: {e}"));
        return;
    }
    let js = format!("api.children({}, {})", jstr(dir), items_json(&tree::read_dir(dir)));
    eval(id, proxy, js);
}

fn toast(id: WindowId, proxy: &EventLoopProxy<Ev>, msg: &str) {
    eval(id, proxy, format!("api.toast({})", jstr(msg)));
}

//子线程执行命令，逐行回推，结束时回传退出码与新的工作目录
fn exec(id: WindowId, proxy: &EventLoopProxy<Ev>, tid: &str, cmd: &str, cwd: &str) {
    let proxy = proxy.clone();
    let tid = tid.to_string();
    let cmd = cmd.to_string();
    let cwd = cwd.to_string();
    std::thread::spawn(move || {
        let (code, dir) = terminal::run(&tid, &cmd, &cwd, |line, cls| {
            eval(id, &proxy, format!("api.term({}, {}, {})", jstr(&tid), jstr(cls), jstr(line)));
        });
        eval(id, &proxy, format!("api.execEnd({}, {code}, {})", jstr(&tid), jstr(&dir)));
    });
}

//起一个伪终端，输出持续回推，外壳退出时通知页面
fn term_open(id: WindowId, proxy: &EventLoopProxy<Ev>, tid: &str, cols: u16, rows: u16, cwd: &str, shell: &str) {
    let proxy = proxy.clone();
    let tid = tid.to_string();
    let cwd = cwd.to_string();
    let shell = shell.to_string();
    std::thread::spawn(move || {
        let out = {
            let proxy = proxy.clone();
            let tid = tid.clone();
            move |data: &str, cls: &'static str| {
                if cls == terminal::EXIT {
                    eval(id, &proxy, format!("api.termExit({})", jstr(&tid)));
                }
                //普通输出不再 eval，屏幕快照由前端主动 termPoll 取
                let _ = (data, cls);
            }
        };
        if let Err(e) = terminal::open(&tid, cols, rows, &cwd, &shell, out) {
            eval(id, &proxy, format!("api.termFail({}, {})", jstr(&tid), jstr(&e)));
        }
    });
}

//执行命令并收集输出回传，同时回显终端
fn exec_capture(id: WindowId, proxy: &EventLoopProxy<Ev>, tid: &str, cmd: &str, cwd: &str) {
    const MAX: usize = 20000;
    let proxy = proxy.clone();
    let tid = tid.to_string();
    let cmd = cmd.to_string();
    let cwd = cwd.to_string();
    std::thread::spawn(move || {
        let mut acc = String::new();
        terminal::run(&tid, &cmd, &cwd, |line, cls| {
            eval(id, &proxy, format!("api.term({}, {}, {})", jstr(&tid), jstr(cls), jstr(line)));
            if acc.len() < MAX {
                acc.push_str(line);
                acc.push('\n');
            }
        });
        if acc.len() > MAX {
            let mut end = MAX;
            while !acc.is_char_boundary(end) {
                end -= 1;
            }
            acc.truncate(end);
        }
        eval(id, &proxy, format!("api.execResult({})", jstr(&acc)));
    });
}

//setting.txt放在exe同级，全局设置与各工作区的会话都在这里
fn setting_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("setting.txt")))
        .unwrap_or_else(|| PathBuf::from("setting.txt"))
}

fn load_settings(id: WindowId, proxy: &EventLoopProxy<Ev>) {
    let text = fs::read_to_string(setting_path()).unwrap_or_default();
    eval(id, proxy, format!("api.settings({})", jstr(&text)));
}

fn save_settings(id: WindowId, proxy: &EventLoopProxy<Ev>, json: &str) {
    if let Err(e) = fs::write(setting_path(), json) {
        toast(id, proxy, &format!("设置保存失败: {e}"));
        return;
    }
    eval(id, proxy, "api.settingsSaved()".into());
}

//AI长期记忆目录，与setting.txt同级
fn memory_dir() -> PathBuf {
    setting_path().with_file_name("memory")
}

//名称只允许字母数字与 . _ -，避免跳出记忆目录
fn memory_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let n = name.trim();
    if n.is_empty() || !n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) {
        return None;
    }
    Some(dir.join(format!("{n}.md")))
}

//save写一条，read读取（不给名字则列出全部），delete删除，list 供面板返回 [{name,content}]
fn memory(id: WindowId, proxy: &EventLoopProxy<Ev>, action: &str, name: &str, text: &str) {
    let dir = memory_dir();
    //list 给 AI 面板做记忆管理，返回结构化 JSON
    if action == "list" {
        let mut items: Vec<(String, String)> = Vec::new();
        if let Ok(rd) = fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|s| s.to_str()) == Some("md") {
                    if let Some(n) = p.file_stem().and_then(|s| s.to_str()) {
                        items.push((n.to_string(), fs::read_to_string(&p).unwrap_or_default()));
                    }
                }
            }
        }
        items.sort();
        let json: Vec<String> = items
            .iter()
            .map(|(n, t)| format!("{{\"name\":{},\"content\":{}}}", jstr(n), jstr(t)))
            .collect();
        eval(id, proxy, format!("api.memList([{}])", json.join(",")));
        return;
    }
    if action == "save" {
        let Some(path) = memory_file(&dir, name) else {
            eval(id, proxy, format!("api.memoryDone(0, {})", jstr("记忆名称只能包含字母、数字与 . _ -")));
            return;
        };
        match fs::create_dir_all(&dir).and_then(|_| fs::write(&path, text)) {
            Ok(_) => eval(id, proxy, format!("api.memoryDone(1, {})", jstr(&format!("已记住 {name}")))),
            Err(e) => eval(id, proxy, format!("api.memoryDone(0, {})", jstr(&format!("保存失败: {e}")))),
        }
        return;
    }
    if action == "delete" {
        let Some(path) = memory_file(&dir, name) else {
            eval(id, proxy, format!("api.memoryDone(0, {})", jstr("记忆名称只能包含字母、数字与 . _ -")));
            return;
        };
        match fs::remove_file(&path) {
            Ok(_) => eval(id, proxy, format!("api.memoryDone(1, {})", jstr(&format!("已删除 {name}")))),
            Err(e) => eval(id, proxy, format!("api.memoryDone(0, {})", jstr(&format!("删除失败: {e}")))),
        }
        return;
    }
    let mut names: Vec<String> = Vec::new();
    if !name.trim().is_empty() {
        names.push(name.trim().to_string());
    } else if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("md") {
                if let Some(n) = p.file_stem().and_then(|s| s.to_str()) {
                    names.push(n.to_string());
                }
            }
        }
        names.sort();
    }
    if names.is_empty() {
        eval(id, proxy, format!("api.memoryDone(1, {})", jstr("暂无长期记忆")));
        return;
    }
    let mut out = String::new();
    for n in &names {
        let Some(p) = memory_file(&dir, n) else { continue };
        match fs::read_to_string(&p) {
            Ok(t) => out.push_str(&format!("## {n}\n{}\n", t.trim())),
            Err(e) => out.push_str(&format!("## {n}\n读取失败: {e}\n")),
        }
    }
    eval(id, proxy, format!("api.memoryDone(1, {})", jstr(&out)));
}

//语言与探测用的可执行文件，顺序即候选优先级
const TOOLS: [(&str, &[&str]); 11] = [
    ("python", &["python", "python3"]),
    ("node", &["node"]),
    ("cpp", &["g++", "clang++", "gcc", "clang"]),
    ("rust", &["rustc"]),
    ("csharp", &["dotnet", "csc"]),
    ("go", &["go"]),
    ("java", &["java"]),
    ("ruby", &["ruby"]),
    ("php", &["php"]),
    ("lua", &["lua"]),
    ("shell", &["bash"]),
];

//扫描本机已安装的运行时，按语言分组供设置里选择
fn scan_run(id: WindowId, proxy: &EventLoopProxy<Ev>) {
    let proxy = proxy.clone();
    std::thread::spawn(move || {
        let mut items: Vec<(&str, Vec<(String, String)>)> = Vec::new();
        for (lang, progs) in TOOLS {
            let v = match lang {
                "python" => scan_python(),
                "node" => scan_node(),
                "rust" => scan_rust(),
                _ => {
                    let mut v = Vec::new();
                    for p in progs {
                        for line in out_of("where", &[p]).lines() {
                            add_run(&mut v, "", line);
                        }
                    }
                    v
                }
            };
            items.push((lang, v));
        }
        eval(id, &proxy, format!("api.runtimes({})", runtimes_json(&items)));
    });
}

fn add_run(v: &mut Vec<(String, String)>, ver: &str, path: &str) {
    let p = path.trim();
    if !p.to_lowercase().ends_with(".exe") {
        return;
    }
    if v.iter().any(|(_, x)| x.eq_ignore_ascii_case(p)) {
        return;
    }
    v.push((ver.to_string(), p.to_string()));
}

//执行命令取stdout，失败返回空
fn out_of(program: &str, args: &[&str]) -> String {
    Command::new(program)
        .args(args)
        .creation_flags(0x08000000)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

//项目生成器能列出已装的模板，装了新的模板也能直接用
fn proj_tmpls(id: WindowId, proxy: &EventLoopProxy<Ev>, exe: &str) {
    let proxy = proxy.clone();
    let exe = if exe.trim().is_empty() { "dotnet".to_string() } else { exe.to_string() };
    std::thread::spawn(move || {
        let out = out_of(&exe, &["new", "list"]);
        eval(id, &proxy, format!("api.projTmpls({})", dotnet_tmpls_json(&out)));
    });
}

//dotnet new list 的列：模板名 短名 语言 标签，列之间是两个以上空格
fn dotnet_tmpls_json(out: &str) -> String {
    let mut v: Vec<String> = Vec::new();
    for line in out.lines() {
        let c: Vec<&str> = line.split("  ").map(str::trim).filter(|s| !s.is_empty()).collect();
        if c.len() < 3 || !c[2].contains("C#") {
            continue;
        }
        v.push(format!("[{},{}]", jstr(c[0]), jstr(c[1])));
    }
    format!("[{}]", v.join(","))
}

//py -0p 列出行格式： -V:3.12 *  C:\...\python.exe
fn parse_py_listing(out: &str) -> Vec<(String, String)> {
    let mut v = Vec::new();
    for line in out.lines() {
        let ver = line
            .split_whitespace()
            .find_map(|t| t.strip_prefix("-V:"))
            .map(|r| r.trim_end_matches('*').to_string())
            .unwrap_or_default();
        if ver.is_empty() {
            continue;
        }
        add_run(&mut v, &ver, line.split_whitespace().last().unwrap_or(""));
    }
    v
}

fn scan_python() -> Vec<(String, String)> {
    let mut v = parse_py_listing(&out_of("py", &["-0p"]));
    for name in ["python", "python3"] {
        for line in out_of("where", &[name]).lines() {
            add_run(&mut v, "", line);
        }
    }
    v
}

//nvm list 列出版本，逐个拼出nvm目录下的node.exe
fn scan_node() -> Vec<(String, String)> {
    let mut v = Vec::new();
    let nvm = std::env::var("NVM_HOME")
        .ok()
        .or_else(|| std::env::var("APPDATA").ok().map(|a| format!("{a}\\nvm")))
        .unwrap_or_default();
    if !nvm.is_empty() {
        for line in out_of("nvm", &["list"]).lines() {
            let ver = line.trim().trim_start_matches('*').trim().split_whitespace().next().unwrap_or("");
            if !ver.starts_with(|c: char| c.is_ascii_digit()) {
                continue;
            }
            add_run(&mut v, ver, &format!("{nvm}\\v{ver}\\node.exe"));
        }
    }
    for line in out_of("where", &["node"]).lines() {
        add_run(&mut v, "", line);
    }
    v
}

//rustup toolchain list --verbose 输出：名称 [(active, default)]  路径
fn scan_rust() -> Vec<(String, String)> {
    let mut v = Vec::new();
    for line in out_of("rustup", &["toolchain", "list", "--verbose"]).lines() {
        let t: Vec<&str> = line.split_whitespace().collect();
        if t.len() < 2 { continue; }
        //最后一段是路径
        let path = t[t.len() - 1];
        let ver = t[0].to_string();
        let exe = Path::new(path).join("bin").join("rustc.exe").to_string_lossy().to_string();
        add_run(&mut v, &ver, &exe);
    }
    for line in out_of("where", &["rustc"]).lines() {
        add_run(&mut v, "", line);
    }
    v
}

//{语言:[{ver,path}]}
fn runtimes_json(items: &[(&str, Vec<(String, String)>)]) -> String {
    let mut out = String::from("{");
    for (i, (lang, list)) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!("{}:{}", jstr(lang), run_list_json(list)));
    }
    out.push('}');
    out
}

fn run_list_json(list: &[(String, String)]) -> String {
    let mut out = String::from("[");
    for (i, (ver, path)) in list.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!("{{\"ver\":{},\"path\":{}}}", jstr(ver), jstr(path)));
    }
    out.push(']');
    out
}

fn search_ws(id: WindowId, proxy: &EventLoopProxy<Ev>, root: &str, query: &str, flags: &str) {
    let proxy = proxy.clone();
    let root = root.to_string();
    let query = query.to_string();
    let flags = flags.to_string();
    std::thread::spawn(move || {
        let r = search::search(&root, &query, flags.contains('r'), flags.contains('c'), flags.contains('w'));
        let js = match r {
            Ok(hits) => format!("api.searchResults({}, {})", jstr(&query), hits_json(&hits)),
            Err(e) => format!("api.searchErr({})", jstr(&e)),
        };
        eval(id, &proxy, js);
    });
}

//在工作区根目录跑一条git命令，参数用U+0002分隔，回传序号与返回码/输出/错误
fn git_cmd(id: WindowId, proxy: &EventLoopProxy<Ev>, seq: &str, sub: &str, args: &str) {
    let proxy = proxy.clone();
    let seq: u64 = seq.parse().unwrap_or(0);
    let sub = sub.to_string();
    let args = args.to_string();
    let cwd = root_of(id);
    std::thread::spawn(move || {
        let mut c = Command::new("git");
        c.creation_flags(0x08000000).arg(&sub);
        if !cwd.is_empty() {
            c.current_dir(&cwd);
        }
        for a in args.split('\u{2}') {
            if !a.is_empty() {
                c.arg(a);
            }
        }
        let js = match c.output() {
            Ok(o) => format!(
                "api.gitResult({seq}, {{\"code\":{},\"out\":{},\"err\":{}}})",
                o.status.code().unwrap_or(-1),
                jstr(&String::from_utf8_lossy(&o.stdout)),
                jstr(&String::from_utf8_lossy(&o.stderr))
            ),
            Err(e) => format!(
                "api.gitResult({seq}, {{\"code\":-1,\"out\":\"\",\"err\":{}}})",
                jstr(&e.to_string())
            ),
        };
        eval(id, &proxy, js);
    });
}

fn chat(id: WindowId, proxy: &EventLoopProxy<Ev>, url: &str, key: &str, req: &str) {
    let proxy = proxy.clone();
    let url = url.to_string();
    let key = key.to_string();
    let req = req.to_string();
    let pid = Arc::new(AtomicU32::new(0));
    if let Ok(mut v) = AI_PIDS.lock() {
        v.retain(|(i, _)| *i != id);
        v.push((id, pid.clone()));
    }
    std::thread::spawn(move || {
        let code = ai::post(&url, &key, &req, &pid, |line, err| {
            let f = if err { "api.aiError" } else { "api.aiChunk" };
            eval(id, &proxy, format!("{f}({})", jstr(line)));
        });
        if let Ok(mut v) = AI_PIDS.lock() {
            v.retain(|(i, p)| !(*i == id && Arc::ptr_eq(p, &pid)));
        }
        eval(id, &proxy, format!("api.aiDone({code})"));
    });
}

//中止该窗口正在进行的AI请求，杀掉curl后post会正常返回
fn ai_stop(id: WindowId) {
    let pid = AI_PIDS
        .lock()
        .ok()
        .and_then(|v| v.iter().find(|(i, _)| *i == id).map(|(_, p)| p.load(Ordering::Relaxed)))
        .unwrap_or(0);
    if pid == 0 {
        return;
    }
    let _ = Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .creation_flags(0x08000000)
        .output();
}

//读取文本文件回传，供AI工具与编辑预览使用
fn read_file(id: WindowId, proxy: &EventLoopProxy<Ev>, path: &str) {
    let r = match fs::read(path) {
        Ok(b) => match String::from_utf8(b) {
            Ok(t) => Ok(t),
            //非 UTF-8 时按 GBK/ANSI 再试一次
            Err(e) => gbk_text(e.as_bytes()).ok_or_else(|| "文件不是 UTF-8 或 GBK 编码".to_string()),
        },
        Err(e) => Err(format!("{e}")),
    };
    match r {
        Ok(t) => eval(id, proxy, format!("api.readDone(1, {})", jstr(&t))),
        Err(e) => eval(id, proxy, format!("api.readDone(0, {})", jstr(&e))),
    }
}

//批量取文件的修改时间与大小，前端用来感知外部改动，路径用U+0002分隔
fn stat_files(id: WindowId, proxy: &EventLoopProxy<Ev>, list: &str) {
    let mut out = String::from("[");
    let mut first = true;
    for p in list.split('\u{2}') {
        if p.is_empty() {
            continue;
        }
        if !first {
            out.push(',');
        }
        first = false;
        let (m, s) = match fs::metadata(p) {
            Ok(md) => {
                let t = md
                    .modified()
                    .ok()
                    .and_then(|x| x.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                (t, md.len())
            }
            Err(_) => (0, 0),
        };
        out.push_str(&format!("{{\"p\":{},\"m\":{},\"s\":{}}}", jstr(p), m, s));
    }
    out.push(']');
    eval(id, proxy, format!("api.stat({out})"));
}

//写入文件后回传结果并刷新所在目录
fn write_file(id: WindowId, proxy: &EventLoopProxy<Ev>, path: &str, crlf: bool, text: &str) {
    let data = if crlf { text.replace('\n', "\r\n") } else { text.to_string() };
    match fs::write(path, data) {
        Ok(_) => {
            eval(id, proxy, "api.writeDone(1, \"已写入\")".into());
            refresh_parent(id, proxy, path);
        }
        Err(e) => eval(id, proxy, format!("api.writeDone(0, {})", jstr(&format!("写入失败: {e}")))),
    }
}

//重命名或移动文件
fn rename(id: WindowId, proxy: &EventLoopProxy<Ev>, from: &str, to: &str) {
    match fs::rename(from, to) {
        Ok(_) => {
            eval(id, proxy, "api.renameDone(1, \"已重命名\")".into());
            refresh_parent(id, proxy, from);
        }
        Err(e) => eval(id, proxy, format!("api.renameDone(0, {})", jstr(&format!("重命名失败: {e}")))),
    }
}

//删除文件或目录
fn delete(id: WindowId, proxy: &EventLoopProxy<Ev>, path: &str) {
    let r = if Path::new(path).is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    match r {
        Ok(_) => {
            toast(id, proxy, &format!("{} 已删除", tree::name_of(path)));
            refresh_parent(id, proxy, path);
        }
        Err(e) => toast(id, proxy, &format!("删除失败: {e}")),
    }
}

fn refresh_parent(id: WindowId, proxy: &EventLoopProxy<Ev>, path: &str) {
    let Some(dir) = Path::new(path).parent() else { return };
    let dir = dir.to_string_lossy().to_string();
    if dir.is_empty() {
        return;
    }
    let js = format!("api.children({}, {})", jstr(&dir), items_json(&tree::read_dir(&dir)));
    eval(id, proxy, js);
}

//命令报错的最后一行，给toast用
fn err_of(out: &[u8]) -> String {
    let s = String::from_utf8_lossy(out);
    s.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string()
}

//调用系统 tar 打 zip，选中项各异时以最近公共目录为归档基准
fn zip_paths(id: WindowId, proxy: &EventLoopProxy<Ev>, dest: &str, list: &str) {
    let paths: Vec<PathBuf> = list.split(SEP).filter(|s| !s.is_empty()).map(PathBuf::from).collect();
    let Some(first) = paths.first() else {
        toast(id, proxy, "没有可压缩的文件");
        return;
    };
    let mut base = match first.parent() {
        Some(p) => p.to_path_buf(),
        None => return,
    };
    while paths.iter().any(|p| !p.starts_with(&base)) {
        let Some(up) = base.parent().map(|p| p.to_path_buf()) else { return };
        base = up;
    }
    let names: Vec<String> = paths
        .iter()
        .filter_map(|p| p.strip_prefix(&base).ok().map(|r| r.to_string_lossy().to_string()))
        .collect();
    let dest = dest.to_string();
    let proxy = proxy.clone();
    std::thread::spawn(move || {
        let mut c = Command::new("tar");
        c.creation_flags(0x08000000).arg("-a").arg("-c").arg("-f").arg(&dest).arg("-C").arg(&base);
        for n in &names {
            c.arg(n);
        }
        match c.output() {
            Ok(o) if o.status.success() => {
                toast(id, &proxy, &format!("已压缩为 {}", tree::name_of(&dest)));
                refresh_parent(id, &proxy, &dest);
            }
            Ok(o) => toast(id, &proxy, &format!("压缩失败: {}", err_of(&o.stderr))),
            Err(e) => toast(id, &proxy, &format!("压缩失败: {e}")),
        }
    });
}

//调用系统 tar 解压到压缩包所在目录
fn unzip_file(id: WindowId, proxy: &EventLoopProxy<Ev>, path: &str) {
    let dir = tree::name_of(path);
    let Some(parent) = Path::new(path).parent().map(|d| d.to_string_lossy().to_string()) else {
        return;
    };
    let path = path.to_string();
    let proxy = proxy.clone();
    std::thread::spawn(move || {
        let r = Command::new("tar")
            .creation_flags(0x08000000)
            .arg("-x")
            .arg("-f")
            .arg(&path)
            .arg("-C")
            .arg(&parent)
            .output();
        match r {
            Ok(o) if o.status.success() => {
                toast(id, &proxy, &format!("{} 已解压", dir));
                eval(id, &proxy, format!("api.children({}, {})", jstr(&parent), items_json(&tree::read_dir(&parent))));
            }
            Ok(o) => toast(id, &proxy, &format!("解压失败: {}", err_of(&o.stderr))),
            Err(e) => toast(id, &proxy, &format!("解压失败: {e}")),
        }
    });
}

//列出目录给AI
fn ai_list(id: WindowId, proxy: &EventLoopProxy<Ev>, dir: &str) {
    let dir = if dir.trim().is_empty() { "." } else { dir };
    let mut s = String::new();
    for e in tree::read_dir(dir) {
        s.push_str(if e.dir { "[目录] " } else { "[文件] " });
        s.push_str(&e.name);
        s.push('\n');
    }
    if s.is_empty() {
        s.push_str("目录为空或不存在");
    }
    eval(id, proxy, format!("api.aiListDone({})", jstr(&s)));
}

//搜索并格式化为文本回传给AI
fn ai_search(id: WindowId, proxy: &EventLoopProxy<Ev>, root: &str, query: &str, flags: &str) {
    const MAX: usize = 100;
    let proxy = proxy.clone();
    let root = root.to_string();
    let query = query.to_string();
    let flags = flags.to_string();
    std::thread::spawn(move || {
        let text = match search::search(&root, &query, flags.contains('r'), flags.contains('c'), false) {
            Ok(hits) => {
                let mut s = String::new();
                for h in hits.iter().take(MAX) {
                    s.push_str(&format!("{}:{}: {}\n", h.path, h.line, h.text.trim()));
                }
                if hits.len() > MAX {
                    s.push_str(&format!("共 {} 条命中，已截断\n", hits.len()));
                }
                if s.is_empty() { "无匹配".to_string() } else { s }
            }
            Err(e) => format!("搜索失败: {e}"),
        };
        eval(id, &proxy, format!("api.aiSearchDone({})", jstr(&text)));
    });
}

//联网搜索并回传AI
fn web_search(id: WindowId, proxy: &EventLoopProxy<Ev>, query: &str) {
    let proxy = proxy.clone();
    let query = query.to_string();
    std::thread::spawn(move || {
        let text = web::search(&query);
        eval(id, &proxy, format!("api.webSearchDone({})", jstr(&text)));
    });
}

fn items_json(items: &[Entry]) -> String {
    let mut out = String::from("[");
    for (i, e) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"name\":{},\"path\":{},\"dir\":{}}}",
            jstr(&e.name),
            jstr(&e.path),
            e.dir
        ));
    }
    out.push(']');
    out
}

fn hits_json(hits: &[search::Hit]) -> String {
    let mut out = String::from("[");
    for (i, h) in hits.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"path\":{},\"line\":{},\"text\":{}}}",
            jstr(&h.path),
            h.line,
            jstr(&h.text)
        ));
    }
    out.push(']');
    out
}

//转义为JSON字符串字面量
pub fn jstr(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            //U+2028/U+2029是JS行终止符，必须转义
            c if (c as u32) < 0x20 || c == '\u{2028}' || c == '\u{2029}' => {
                out.push_str(&format!("\\u{:04x}", c as u32))
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 转义JSON字符串() {
        assert_eq!(jstr("a\"b\\c\nd"), "\"a\\\"b\\\\c\\nd\"");
        assert_eq!(jstr("中文"), "\"中文\"");
    }

    #[test]
    fn 拼装目录项() {
        let items = vec![Entry { name: "a.rs".into(), path: "C:\\x\\a.rs".into(), dir: false }];
        assert_eq!(items_json(&items), "[{\"name\":\"a.rs\",\"path\":\"C:\\\\x\\\\a.rs\",\"dir\":false}]");
    }

    #[test]
    fn 解析python版本列表() {
        let out = " -V:3.11 *        C:\\Python311\\python.exe\n  -V:3.12 *        C:\\Python312\\python.exe\n";
        assert_eq!(
            parse_py_listing(out),
            vec![
                ("3.11".to_string(), "C:\\Python311\\python.exe".to_string()),
                ("3.12".to_string(), "C:\\Python312\\python.exe".to_string()),
            ]
        );
    }

    #[test]
    fn GBK解码() {
        assert!(is_gbk(b"plain ascii"));
        //"中文"的 GBK 编码
        assert_eq!(gbk_text(&[0xD6, 0xD0, 0xCE, 0xC4]).as_deref(), Some("中文"));
        //落单的前导字节与非法尾字节都不算 GBK
        assert!(!is_gbk(&[0x81]));
        assert!(!is_gbk(&[0x81, 0x7F]));
        assert_eq!(gbk_text(&[0x81, 0x7F]), None);
    }
}
