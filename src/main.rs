#![windows_subsystem = "windows"]

mod ai;
mod debug;
mod highlight;
mod ipc;
mod lsp;
mod res;
mod search;
mod terminal;
mod tree;
mod web;

use std::collections::hash_map::RandomState;
use std::fs;
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use tao::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget};
use tao::platform::windows::WindowBuilderExtWindows;
use tao::window::{Icon, Window, WindowBuilder, WindowId};
use wry::{WebContext, WebView, WebViewBuilder, WebViewBuilderExtWindows};

//主线程事件
pub enum Ev {
    Eval(WindowId, String),
    //None为新窗口，Some为在新窗口里打开的文件夹
    New(Option<String>),
    Ipc(String),
}

//内嵌前端资源，编译期压过gzip，这里解压回文本
const HTML_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/html.gz"));
const STYLE_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/style.gz"));
const RES_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/res.gz"));
const APP_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/app.gz"));
const ICON_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/icon.gz"));
//浏览器兜底模式的监听地址
const URL: &str = "http://127.0.0.1:1728";
//预览文件服务起始端口，与IPC分开以隔离来源
const WS_PORT: u16 = 1729;
//预览服务来源前缀，端口被占用时顺延
const WS_PREFIX: &str = "http://127.0.0.1:";
//预览服务根地址，未启动时为空串
static WS: OnceLock<String> = OnceLock::new();
//预览服务来源，用于挡掉预览iframe发来的IPC
static WS_ORIGIN: OnceLock<String> = OnceLock::new();
//拼好的页面只算一次，多个窗口共用
static SHELL: OnceLock<String> = OnceLock::new();

fn unzip(data: &[u8]) -> String {
    let mut s = String::new();
    let _ = flate2::read::GzDecoder::new(data).read_to_string(&mut s);
    s
}

//把样式与脚本注入页面骨架
fn shell() -> &'static str {
    SHELL.get_or_init(|| {
        unzip(HTML_GZ)
            .replace("/*__STYLE__*/", &unzip(STYLE_GZ))
            .replace("/*__RES__*/", &unzip(RES_GZ))
            .replace("/*__APP__*/", &unzip(APP_GZ))
    })
}

fn icon() -> Icon {
    let mut rgba = Vec::new();
    let _ = flate2::read::GzDecoder::new(ICON_GZ).read_to_end(&mut rgba);
    Icon::from_rgba(rgba, 128, 128).unwrap()
}

//每个窗口的状态，按工作区随windows.txt一起持久化
struct WinState {
    id: Option<WindowId>,
    root: String,
    rect: Option<(i32, i32, u32, u32)>,
}

//windows.txt放在exe同级
fn windows_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("windows.txt")))
        .unwrap_or_else(|| PathBuf::from("windows.txt"))
}

//每行 工作区\tx\ty\宽\高，工作区为空表示还停在欢迎页
fn parse_windows(text: &str) -> Vec<(String, Option<(i32, i32, u32, u32)>)> {
    let mut out = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let f: Vec<&str> = line.split('\t').collect();
        let n = |i: usize| f.get(i).and_then(|s| s.parse::<i64>().ok());
        let rect = match (n(1), n(2), n(3), n(4)) {
            (Some(x), Some(y), Some(w), Some(h)) if w > 0 && h > 0 => Some((x as i32, y as i32, w as u32, h as u32)),
            _ => None,
        };
        //工作区已不存在时当欢迎页处理，顺带兼容旧版按槽位记录的windows.txt
        let root = f.first().copied().unwrap_or("").to_string();
        let root = if root.is_empty() || Path::new(&root).is_dir() { root } else { String::new() };
        out.push((root, rect));
    }
    out
}

fn load_windows() -> Vec<WinState> {
    let text = match fs::read_to_string(windows_path()) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    parse_windows(&text).into_iter().map(|(root, rect)| WinState { id: None, root, rect }).collect()
}

fn save_windows(list: &[WinState]) {
    let mut s = String::new();
    for w in list {
        let r = w.rect.unwrap_or((-1, -1, 0, 0));
        s.push_str(&format!("{}\t{}\t{}\t{}\t{}\n", w.root, r.0, r.1, r.2, r.3));
    }
    let _ = fs::write(windows_path(), s);
}

//取窗口当前的位置与客户区大小，最小化时可能取不到
fn rect_of(w: &Window) -> Option<(i32, i32, u32, u32)> {
    let p = w.outer_position().ok()?;
    let s = w.inner_size();
    Some((p.x, p.y, s.width, s.height))
}

//创建窗口及webview，Window必须随webs存活，否则窗口立即被销毁
fn build(elwt: &EventLoopWindowTarget<Ev>, proxy: &EventLoopProxy<Ev>, ctx: &mut WebContext, open_dir: Option<&str>, fresh: bool, root: &str, rect: Option<(i32, i32, u32, u32)>) -> (WindowId, WebView, Window) {
    let mut wb = WindowBuilder::new()
        .with_title("MiniIDE")
        .with_min_inner_size(LogicalSize::new(720.0, 460.0))
        .with_window_icon(Some(icon()))
        .with_taskbar_icon(Some(icon()));
    //恢复上次的位置与大小
    match rect {
        Some((x, y, w, h)) => {
            wb = wb.with_inner_size(PhysicalSize::new(w, h)).with_position(PhysicalPosition::new(x, y));
        }
        None => wb = wb.with_inner_size(LogicalSize::new(1280.0, 800.0)),
    }
    let window = wb.build(elwt).unwrap();
    let id = window.id();
    let origin = WS_ORIGIN.get().cloned().unwrap_or_default();
    let nav_origin = origin.clone();
    let mut wb = WebViewBuilder::new_with_web_context(ctx)
        .with_html(shell())
        .with_initialization_script(ws_script())
        .with_devtools(cfg!(debug_assertions))
        .with_browser_accelerator_keys(false)
        .with_default_context_menus(false)
        //外部链接交给系统浏览器，避免整个 WebView 被导航走
        .with_navigation_handler(move |url| {
            if is_internal_url(&url, &nav_origin) {
                true
            } else {
                open_external(&url);
                false
            }
        })
        .with_new_window_req_handler(|url, _features| {
            open_external(&url);
            wry::NewWindowResponse::Deny
        });
    //新窗口指定了文件夹时让页面直接打开它
    if let Some(d) = open_dir {
        wb = wb.with_initialization_script(format!("window.__OPEN_DIR={};", ipc::jstr(d)));
    }
    //新建的空窗口停在欢迎页，不恢复上次会话
    if fresh {
        wb = wb.with_initialization_script("window.__FRESH=1;".to_string());
    }
    //本窗口的工作区，页面按它恢复该工作区的会话
    if !root.is_empty() {
        wb = wb.with_initialization_script(format!("window.__ROOT={};", ipc::jstr(root)));
    }
    let webview = wb
        .with_ipc_handler({
            let proxy = proxy.clone();
            move |req| {
                //只接受主文档发来的消息，预览iframe不参与IPC
                if req.uri().to_string().starts_with(&origin) {
                    return;
                }
                ipc::handle(req.body(), id, &proxy)
            }
        })
        .build(&window)
        .unwrap();
    ipc::set_root(id, root);
    (id, webview, window)
}

//无webview时的小提示窗，关闭即退出进程
fn info_window(elwt: &EventLoopWindowTarget<Ev>, bound: bool, _forced: bool) -> (WindowId, Window) {
    let title = if !bound {
        "MiniIDE 端口1728被占用"
    } //else if forced {
        //"MiniIDE已按 --browser 用浏览器打开 http://127.0.0.1:1728 关闭本窗口即退出"
    //} 
    else {
        "MiniIDE 未检测到WebView2退出此窗口即退出程序"
    };
    let window = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(560.0, 120.0))
        .with_min_inner_size(LogicalSize::new(420.0, 90.0))
        .with_window_icon(Some(icon()))
        .with_taskbar_icon(Some(icon()))
        .build(elwt)
        .unwrap();
    let id = window.id();
    (id, window)
}
//检测WebView2运行时是否已安装
fn has_webview2() -> bool {
    const ID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let keys = [
        format!("HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{ID}"),
        format!("HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{ID}"),
        format!("HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{ID}"),
    ];
    for k in keys {
        let out = Command::new("reg").args(["query", &k, "/v", "pv"]).creation_flags(0x08000000).output();
        if let Ok(o) = out {
            let s = String::from_utf8_lossy(&o.stdout);
            //pv为0.0.0.0表示占位未安装
            if let Some(v) = s.split("REG_SZ").nth(1) {
                let v = v.trim();
                if !v.is_empty() && v != "0.0.0.0" {
                    return true;
                }
            }
        }
    }
    false
}
//预览服务地址，未启动时为空串
fn ws_base() -> String {
    WS.get().cloned().unwrap_or_default()
}
//把预览服务地址注入页面
fn ws_script() -> String {
    format!("window.__WS=\"{}\";window.__OS=\"Windows\";window.__VER=\"{}\";", ws_base(), env!("CARGO_PKG_VERSION"))
}
//内部地址与空/内联地址放行，其余视为外部链接
fn is_internal_url(url: &str, origin: &str) -> bool {
    url.is_empty()
        || url.starts_with("about:")
        || url.starts_with("data:")
        || url.starts_with("blob:")
        || (!origin.is_empty() && url.starts_with(origin))
}
//用系统默认浏览器打开，explorer 不展开 shell 元字符
fn open_external(url: &str) {
    if url.starts_with("http://") || url.starts_with("https://") {
        let _ = Command::new("explorer").arg(url).spawn();
    }
}
//浏览器模式在页面里补上脚本资源
fn page() -> String {
    let tags = format!("<script>{}</script>\n", ws_script());
    shell().replacen("<body>", &(tags + "<body>"), 1)
}
//浏览器兜底模式的本地服务
fn serve(listener: TcpListener, proxy: EventLoopProxy<Ev>) {
    std::thread::spawn(move || {
        for s in listener.incoming() {
            let proxy = proxy.clone();
            let mut s = match s {
                Ok(s) => s,
                Err(_) => continue,
            };
            std::thread::spawn(move || {
                let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(10)));
                let (path, body, same_origin) = match read_req(&mut s) {
                    Some(r) => r,
                    None => return,
                };
                let guarded = path.starts_with("/ipc") || path.starts_with("/poll");
                let (code, ct, out) = if guarded && !same_origin {
                    (403, "text/plain; charset=utf-8", String::new())
                } else if path.starts_with("/ipc") {
                    let _ = proxy.send_event(Ev::Ipc(body));
                    (200, "text/plain; charset=utf-8", String::new())
                } else if path.starts_with("/poll") {
                    (200, "application/json; charset=utf-8", ipc::take_queue())
                } else {
                    (200, "text/html; charset=utf-8", page())
                };
                respond(&mut s, code, ct, out.as_bytes());
            });
        }
    });
}
fn respond(s: &mut TcpStream, code: u16, ct: &str, body: &[u8]) {
    let reason = match code {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: {ct}\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(body);
    let _ = s.flush();
}
//随机文件服务token
fn token() -> String {
    let mut h = RandomState::new().build_hasher();
    h.write_u64(std::process::id() as u64);
    format!("{:016x}", h.finish())
}
//预览文件服务，按 /ws/token/百分号编码的路径 读取本地文件
fn ws_serve(listener: TcpListener, base: String) {
    std::thread::spawn(move || {
        for s in listener.incoming() {
            let base = base.clone();
            let mut s = match s {
                Ok(s) => s,
                Err(_) => continue,
            };
            std::thread::spawn(move || {
                let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(10)));
                let Some((path, _, _)) = read_req(&mut s) else { return };
                let Some(rest) = path.strip_prefix(&base) else {
                    respond(&mut s, 404, "text/plain; charset=utf-8", b"not found");
                    return;
                };
                let Some(file) = pct(rest) else {
                    respond(&mut s, 400, "text/plain; charset=utf-8", b"bad path");
                    return;
                };
                match fs::metadata(&file) {
                    Ok(m) if m.is_file() && m.len() <= 64 * 1024 * 1024 => {}
                    _ => {
                        respond(&mut s, 404, "text/plain; charset=utf-8", b"not found");
                        return;
                    }
                }
                match fs::read(&file) {
                    Ok(data) => respond(&mut s, 200, mime(&file), &data),
                    Err(_) => respond(&mut s, 404, "text/plain; charset=utf-8", b"not found"),
                }
            });
        }
    });
}

//百分号解码，非法编码返回None
fn pct(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 2 >= b.len() {
                return None;
            }
            let d = |c: u8| (c as char).to_digit(16);
            out.push((d(b[i + 1])? * 16 + d(b[i + 2])?) as u8);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

//按扩展名给出内容类型
fn mime(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "md" | "markdown" | "txt" | "log" | "csv" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

//校验来源，只放行本页面发来的请求，防止其他网页调用本地服务
fn origin_ok(head: &str) -> bool {
    let low = head.to_ascii_lowercase();
    match low.split("origin:").nth(1).and_then(|s| s.split("\r\n").next()) {
        Some(o) => {
            let o = o.trim();
            o == URL || o == "http://localhost:1728"
        }
        None => true,
    }
}

//读取一条HTTP请求，返回路径、请求体、来源是否合法
fn read_req(s: &mut TcpStream) -> Option<(String, String, bool)> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];
    let head_end = loop {
        let n = s.read(&mut tmp).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(p) = find_sub(&buf, b"\r\n\r\n") {
            break p + 4;
        }
        if buf.len() > 1 << 24 {
            return None;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let ok = origin_ok(&head);
    let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
    let len = head
        .to_ascii_lowercase()
        .split("content-length:")
        .nth(1)
        .and_then(|s| s.split("\r\n").next())
        .and_then(|s| s.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = buf[head_end..].to_vec();
    while body.len() < len {
        let n = s.read(&mut tmp).ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }
    body.truncate(len.min(body.len()));
    Some((path, String::from_utf8_lossy(&body).to_string(), ok))
}

fn find_sub(h: &[u8], n: &[u8]) -> Option<usize> {
    h.windows(n.len()).position(|w| w == n)
}

//用默认浏览器打开页面
fn open_browser() {
    let _ = Command::new("explorer").arg(URL).spawn();
}

fn main() {
    //--browser 强制走浏览器模式，忽略WebView2检测
    let forced = std::env::args().any(|a| a == "--browser");
    let web = forced || !has_webview2();
    let event_loop = EventLoopBuilder::<Ev>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let mut ctx = WebContext::new(Some(std::env::temp_dir().join("MiniIDE.WebView2")));
    let mut webs: Vec<(WindowId, Option<WebView>, Window)> = Vec::new();
    //上次退出时的窗口清单，空了就开一个默认窗口
    let mut wins = load_windows();
    if wins.is_empty() {
        wins.push(WinState { id: None, root: String::new(), rect: None });
    }
    let mut bound = false;
    //预览文件服务与高亮库在两种运行模式下都要就绪
    let tok = format!("/ws/{}/", token());
    //端口被占用时顺延，多开窗口才能各有自己的预览服务
    let ws = (WS_PORT..WS_PORT + 16).find_map(|p| TcpListener::bind(("127.0.0.1", p)).ok().map(|l| (p, l)));
    let port = match ws {
        Some((p, l)) => {
            ws_serve(l, tok.clone());
            p
        }
        None => 0,
    };
    let origin = format!("{WS_PREFIX}{port}");
    let _ = WS_ORIGIN.set(origin.clone());
    let _ = WS.set(if port == 0 { String::new() } else { format!("{origin}{tok}") });
    if web {
        ipc::set_browser();
        if let Ok(l) = TcpListener::bind(("127.0.0.1", 1728)) {
            serve(l, proxy.clone());
            open_browser();
            bound = true;
        }
    }
    event_loop.run(move |event, elwt, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::NewEvents(StartCause::Init) => {
                if web {
                    let (id, window) = info_window(elwt, bound, forced);
                    webs.push((id, None, window));
                } else {
                    //按上次退出的窗口逐个重建
                    for w in wins.iter_mut() {
                        let (id, webview, window) = build(elwt, &proxy, &mut ctx, None, false, &w.root, w.rect);
                        w.id = Some(id);
                        webs.push((id, Some(webview), window));
                    }
                }
            }
            Event::UserEvent(Ev::New(dir)) => {
                if !web {
                    //新窗口以传入的文件夹为工作区，没传则停在欢迎页，会话互不影响
                    let root = dir.clone().unwrap_or_default();
                    let (id, webview, window) = build(elwt, &proxy, &mut ctx, dir.as_deref(), true, &root, None);
                    wins.push(WinState { id: Some(id), root, rect: None });
                    webs.push((id, Some(webview), window));
                    save_windows(&wins);
                }
            }
            Event::UserEvent(Ev::Eval(id, js)) => {
                if let Some((_, Some(w), _)) = webs.iter().find(|(i, _, _)| *i == id) {
                    let _ = w.evaluate_script(&js);
                }
            }
            //浏览器请求转交主线程处理，拿到窗口标识
            Event::UserEvent(Ev::Ipc(body)) => {
                if let Some((id, _, _)) = webs.first() {
                    ipc::handle(&body, *id, &proxy);
                }
            }
            Event::WindowEvent { window_id, event: WindowEvent::CloseRequested, .. } => {
                //关闭前记下窗口的工作区、位置与大小
                if !web {
                    let rect = webs.iter().find(|(i, _, _)| *i == window_id).and_then(|(_, _, w)| rect_of(w));
                    if let Some(x) = wins.iter_mut().find(|x| x.id == Some(window_id)) {
                        x.root = ipc::root_of(window_id);
                        if rect.is_some() {
                            x.rect = rect;
                        }
                    }
                }
                //最后一个窗口关闭直接结束进程
                if webs.len() <= 1 {
                    if !web {
                        save_windows(&wins);
                    }
                    lsp::shutdown();
                    debug::shutdown();
                    std::process::exit(0);
                }
                //还有其它窗口时只移除当前这个
                webs.retain(|(i, _, _)| *i != window_id);
                ipc::clear_root(window_id);
                if !web {
                    wins.retain(|x| x.id != Some(window_id));
                    save_windows(&wins);
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    //按Content-Length读取完整请求体
    #[test]
    fn 读取请求体() {
        let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr = l.local_addr().unwrap();
        let t = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            read_req(&mut s).unwrap()
        });
        let body = "save\u{1}C:\\测试\\a.txt\u{1}1\u{1}内容";
        let mut c = TcpStream::connect(addr).unwrap();
        let req = format!(
            "POST /ipc HTTP/1.1\r\nHost: x\r\nOrigin: {URL}\r\nContent-Length: {}\r\n\r\n{}",
            body.as_bytes().len(),
            body
        );
        c.write_all(req.as_bytes()).unwrap();
        let (path, got, ok) = t.join().unwrap();
        assert_eq!(path, "/ipc");
        assert_eq!(got, body);
        assert!(ok);
    }

    //跨站来源的请求被拒绝
    #[test]
    fn 来源校验() {
        assert!(origin_ok(&format!("POST /ipc HTTP/1.1\r\nOrigin: {URL}\r\n\r\n")));
        assert!(origin_ok("POST /ipc HTTP/1.1\r\n\r\n"));
        assert!(!origin_ok("POST /ipc HTTP/1.1\r\nOrigin: https://evil.com\r\n\r\n"));
    }

    //浏览器模式页面注入工作区地址
    #[test]
    fn 页面注入脚本() {
        let p = page();
        assert!(p.find("window.__WS=").unwrap() < p.find("<body>").unwrap());
        assert_eq!(find_sub(b"ab\r\n\r\ncd", b"\r\n\r\n"), Some(2));
    }

    //windows.txt按工作区解析，旧版槽位记录与失效目录都退回欢迎页
    #[test]
    fn 解析窗口清单() {
        let d = std::env::temp_dir().to_string_lossy().to_string();
        let text = format!("{d}\t10\t20\t800\t600\n7\t-1\t-1\t0\t0\n   \n");
        assert_eq!(
            parse_windows(&text),
            vec![(d.clone(), Some((10, 20, 800, 600))), (String::new(), None)]
        );
    }

    //样式与脚本占位符全部被替换
    #[test]
    fn 页面拼装完整() {
        let p = shell();
        for k in ["/*__STYLE__*/", "/*__RES__*/", "/*__APP__*/"] {
            assert!(!p.contains(k), "{k} 未替换");
        }
        assert!(p.contains("const I18N"));
        assert!(p.contains("window.AI_PROMPTS"));
    }

    //预览路径的百分号解码
    #[test]
    fn 预览路径解码() {
        assert_eq!(pct("C%3A%5Cdir%5Ca%20b.png").as_deref(), Some("C:\\dir\\a b.png"));
        assert_eq!(pct("abc%"), None);
        assert_eq!(pct("%zz"), None);
    }

    //按扩展名给出内容类型
    #[test]
    fn 预览内容类型() {
        assert_eq!(mime("C:\\a\\b.PNG"), "image/png");
        assert_eq!(mime("a.html"), "text/html; charset=utf-8");
        assert_eq!(mime("a.unknown"), "application/octet-stream");
    }

    //预览服务按token前缀取本地文件，前缀不符返回404
    #[test]
    fn 预览服务取文件() {
        let dir = std::env::temp_dir().join("MiniIDE.wstest");
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a b.txt");
        fs::write(&f, "hello").unwrap();
        let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr = l.local_addr().unwrap();
        ws_serve(l, "/ws/t/".into());
        let enc: String = f.to_string_lossy().bytes().map(|b| format!("%{b:02X}")).collect();
        for (path, want) in [("/ws/t/", 200), ("/other/", 404)] {
            let mut c = TcpStream::connect(addr).unwrap();
            c.set_read_timeout(Some(std::time::Duration::from_secs(10))).unwrap();
            let req = format!("GET {path}{enc} HTTP/1.1\r\nHost: x\r\n\r\n");
            c.write_all(req.as_bytes()).unwrap();
            let mut buf = Vec::new();
            let _ = c.read_to_end(&mut buf);
            let s = String::from_utf8_lossy(&buf);
            assert!(s.starts_with(&format!("HTTP/1.1 {want}")), "{path} -> {s}");
            if want == 200 {
                assert!(s.ends_with("hello"));
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
