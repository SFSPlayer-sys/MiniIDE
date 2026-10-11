use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::res;

const NO_WINDOW: u32 = 0x08000000;

//适配器的写入端：stdio走子进程管道，tcp走本地套接字
enum Sink {
    Pipe(ChildStdin),
    Sock(TcpStream),
}

//一个调试会话，进程可空（连接外部已起的适配器时）
struct Proc {
    child: Option<Child>,
    sink: Arc<Mutex<Sink>>,
}

//各调试会话，键为页面给的标识
static PROCS: Mutex<Vec<(String, Proc)>> = Mutex::new(Vec::new());
//会话还没注册时先攒下的消息，注册后按序补发
static PENDING: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
const PEND_MAX: usize = 512;

//在字节流里找子串
fn find(h: &[u8], n: &[u8]) -> Option<usize> {
    h.windows(n.len()).position(|w| w == n)
}

//从缓冲里取出一条完整消息，不足一帧时返回None
fn frame(buf: &mut Vec<u8>) -> Option<String> {
    let p = find(buf, b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&buf[..p]).to_string();
    let len = head
        .to_ascii_lowercase()
        .split("content-length:")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .and_then(|s| s.parse::<usize>().ok())?;
    if buf.len() < p + 4 + len {
        return None;
    }
    let body = String::from_utf8_lossy(&buf[p + 4..p + 4 + len]).to_string();
    buf.drain(..p + 4 + len);
    Some(body)
}

//把命令行拆成程序与参数，按双引号规则切分
fn split_cmd(line: &str) -> (String, Vec<String>) {
    let mut args: Vec<String> = Vec::new();
    let mut cur = String::new();
    let (mut quoted, mut has) = (false, false);
    for ch in line.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                has = true;
            }
            c if c.is_whitespace() && !quoted => {
                if has {
                    args.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            c => {
                cur.push(c);
                has = true;
            }
        }
    }
    if has {
        args.push(cur);
    }
    let prog = if args.is_empty() { String::new() } else { args.remove(0) };
    (prog, args)
}

//启动调试适配器：mode为tcp时先起进程再连它的监听端口，其余按stdio管道
//cmd里的{port}会被替换成实际端口，addr缺省时按127.0.0.1自动分配
pub fn start<F: FnMut(&str) + Send + 'static>(
    tid: &str,
    cmd: &str,
    cwd: &str,
    mode: &str,
    addr: &str,
    out: F,
) -> Result<(), String> {
    kill(tid);
    let (host, port) = split_addr(addr);
    let port = if port == 0 { free_port() } else { port };
    let cmd = cmd.replace("{port}", &port.to_string());
    let proc = if mode == "tcp" {
        //适配器自己监听端口，先起进程再连上去
        let child = if cmd.trim().is_empty() { None } else { Some(spawn(&cmd, cwd)?) };
        let s = connect(&host, port)?;
        let r = s.try_clone().map_err(|e| format!("克隆套接字失败: {e}"))?;
        std::thread::spawn(move || pump(r, out));
        Proc { child, sink: Arc::new(Mutex::new(Sink::Sock(s))) }
    } else {
        let mut child = spawn(&cmd, cwd)?;
        let stdin = child.stdin.take().ok_or("无法写入调试适配器")?;
        let stdout = child.stdout.take().ok_or("无法读取调试适配器")?;
        std::thread::spawn(move || pump(stdout, out));
        Proc { child: Some(child), sink: Arc::new(Mutex::new(Sink::Pipe(stdin))) }
    };
    let sink = proc.sink.clone();
    //注册前页面可能已把initialize发来了，先补发攒下的消息
    let pend = drain_pending(tid);
    if let Ok(mut v) = PROCS.lock() {
        v.retain(|(t, _)| t != tid);
        v.push((tid.to_string(), proc));
    }
    if !pend.is_empty() {
        if let Ok(mut s) = sink.lock() {
            for m in &pend {
                let _ = write_frame(&mut s, m);
            }
        }
    }
    Ok(())
}

//持续读取适配器输出，按DAP分帧后逐条回推，结束时以空串通知
fn pump<R: Read, F: FnMut(&str)>(mut r: R, mut out: F) {
    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 8192];
    loop {
        let n = match r.read(&mut tmp) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        buf.extend_from_slice(&tmp[..n]);
        while let Some(m) = frame(&mut buf) {
            out(&m);
        }
    }
    out("");
}

//按DAP分帧写入，会话还没起来时先攒着，注册后补发
pub fn send(tid: &str, json: &str) {
    let h = match PROCS.lock() {
        Ok(v) => v.iter().find(|(t, _)| t == tid).map(|(_, p)| p.sink.clone()),
        Err(_) => None,
    };
    let Some(h) = h else {
        if let Ok(mut v) = PENDING.lock() {
            v.push((tid.to_string(), json.to_string()));
            let n = v.len();
            if n > PEND_MAX {
                v.drain(..n - PEND_MAX);
            }
        }
        return;
    };
    if let Ok(mut s) = h.lock() {
        let _ = write_frame(&mut s, json);
    }
}

//把一条消息按DAP分帧写到适配器
fn write_frame(sink: &mut Sink, json: &str) -> std::io::Result<()> {
    let w: &mut dyn Write = match sink {
        Sink::Pipe(s) => s,
        Sink::Sock(s) => s,
    };
    w.write_all(format!("Content-Length: {}\r\n\r\n{}", json.len(), json).as_bytes())?;
    w.flush()
}

//取走该会话攒下的消息
fn drain_pending(tid: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(mut v) = PENDING.lock() {
        v.retain(|(t, m)| {
            if t == tid {
                out.push(m.clone());
                false
            } else {
                true
            }
        });
    }
    out
}

//结束会话，并丢掉它攒下的消息
pub fn stop(tid: &str) {
    if let Ok(mut v) = PENDING.lock() {
        v.retain(|(t, _)| t != tid);
    }
    kill(tid);
}

//只终止进程并移除会话
fn kill(tid: &str) {
    let mut p = match PROCS.lock() {
        Ok(mut v) => match v.iter().position(|(t, _)| t == tid) {
            Some(i) => v.remove(i).1,
            None => return,
        },
        Err(_) => return,
    };
    if let Some(child) = p.child.as_mut() {
        let pid = child.id();
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW)
            .status();
        let _ = child.wait();
    }
}

//退出前停掉所有调试会话
pub fn shutdown() {
    let ids: Vec<String> = match PROCS.lock() {
        Ok(v) => v.iter().map(|(t, _)| t.clone()).collect(),
        Err(_) => return,
    };
    for t in ids {
        stop(&t);
    }
}

//按命令行起进程，bat/cmd交给cmd解释
fn spawn(cmd: &str, cwd: &str) -> Result<Child, String> {
    let (prog, args) = split_cmd(cmd);
    if prog.is_empty() {
        return Err("适配器启动命令为空".into());
    }
    let low = prog.to_ascii_lowercase();
    let mut c = if low.ends_with(".bat") || low.ends_with(".cmd") {
        let mut c = Command::new("cmd");
        c.raw_arg("/C").raw_arg(cmd);
        c
    } else {
        let mut c = Command::new(&prog);
        c.args(&args);
        c
    };
    c.current_dir(if cwd.is_empty() { "." } else { cwd })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .spawn()
        .map_err(|e| format!("启动调试适配器失败: {e}"))
}

//连适配器监听端口，进程刚起可能还没就绪，重试若干次
fn connect(host: &str, port: u16) -> Result<TcpStream, String> {
    let addr = format!("{host}:{port}");
    let mut last = String::new();
    for _ in 0..80 {
        match TcpStream::connect(&addr) {
            Ok(s) => {
                let _ = s.set_nodelay(true);
                return Ok(s);
            }
            Err(e) => {
                last = e.to_string();
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
    Err(format!("连接调试适配器失败: {last}"))
}

//向系统要一个空闲端口
fn free_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(0)
}

//解析 host:port，缺端口表示自动分配
fn split_addr(a: &str) -> (String, u16) {
    let a = a.trim();
    if a.is_empty() {
        return ("127.0.0.1".into(), 0);
    }
    match a.rsplit_once(':') {
        Some((h, p)) => {
            let host = if h.is_empty() { "127.0.0.1".to_string() } else { h.to_string() };
            (host, p.trim().parse().unwrap_or(0))
        }
        None => (a.to_string(), 0),
    }
}

//探测本机命令是否可用，返回是否成功与输出
pub fn probe(cmd: &str) -> (bool, String) {
    if cmd.trim().is_empty() {
        return (false, String::new());
    }
    let (prog, args) = split_cmd(cmd);
    if prog.is_empty() {
        return (false, String::new());
    }
    match Command::new(&prog).args(&args).creation_flags(NO_WINDOW).output() {
        Ok(o) => {
            let mut t = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if t.is_empty() {
                t = String::from_utf8_lossy(&o.stderr).trim().to_string();
            }
            (o.status.success(), t)
        }
        Err(_) => (false, String::new()),
    }
}

//下载后要认出的适配器入口文件名
const EXES: &[&str] = &[
    "dlv.exe", "codelldb.exe", "lldb-vscode.exe", "dapDebugServer.js", "adapter.js", "debugpy",
];

//下载并解压调试适配器到Data/dap/<name>，返回入口路径
pub fn install<F: FnMut(u64, u64)>(name: &str, src: &str, mut on_progress: F) -> Result<String, String> {
    let root = res::cache_dir().join("dap");
    let dir = root.join(res::safe(name));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    let file = res::download_with_progress(src, &format!("dap.{}", res::safe(name)), |cur, total| {
        on_progress(cur, total);
    })
    .map_err(|e| format!("下载失败: {e}"))?
    .ok_or("下载失败")?;
    if !extract(&file, &dir) {
        return Err("解压失败".into());
    }
    find_exe(&dir).ok_or_else(|| "未找到适配器入口".to_string())
}

//压缩包按magic识别后交给系统tar解压，其余当作现成的可执行文件复制
fn extract(file: &Path, dir: &Path) -> bool {
    let mut m = [0u8; 4];
    let magic = fs::File::open(file).and_then(|mut f| f.read_exact(&mut m)).map(|_| m).unwrap_or([0; 4]);
    let packed = magic.starts_with(b"PK\x03\x04") || magic.starts_with(&[0x1f, 0x8b]) || magic.starts_with(b"7z\xbc\xaf");
    if packed {
        return Command::new("tar")
            .arg("-xf")
            .arg(file)
            .arg("-C")
            .arg(dir)
            .creation_flags(NO_WINDOW)
            .status()
            .is_ok_and(|s| s.success());
    }
    fs::copy(file, dir.join("adapter.exe")).is_ok()
}

//在解压目录里找适配器入口，认不出已知名字时退回第一个
fn find_exe(dir: &Path) -> Option<String> {
    let mut found = None;
    walk(dir, 0, &mut |p: &Path| {
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
        if !(name.ends_with(".exe") || name.ends_with(".bat") || name.ends_with(".cmd") || name.ends_with(".js")) {
            return true;
        }
        if EXES.contains(&name.as_str()) {
            found = Some(p.to_string_lossy().to_string());
            return false;
        }
        if found.is_none() {
            found = Some(p.to_string_lossy().to_string());
        }
        true
    });
    found
}

//递归遍历目录，回调返回false提前结束
fn walk(dir: &Path, depth: usize, f: &mut impl FnMut(&Path) -> bool) {
    if depth > 4 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, depth + 1, f);
        } else if !f(&p) {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    //按Content-Length切帧，半帧留到补齐后再出
    #[test]
    fn 按长度切分消息() {
        let mut b = b"Content-Length: 5\r\n\r\nhelloContent-Length: 2\r\n\r\n{}".to_vec();
        assert_eq!(frame(&mut b).as_deref(), Some("hello"));
        assert_eq!(frame(&mut b).as_deref(), Some("{}"));
        assert_eq!(frame(&mut b), None);
        assert_eq!(find(b"abc", b"bc"), Some(1));
    }

    //地址解析，缺端口时表示自动分配
    #[test]
    fn 解析监听地址() {
        assert_eq!(split_addr("127.0.0.1:4000"), ("127.0.0.1".to_string(), 4000));
        assert_eq!(split_addr(":4000"), ("127.0.0.1".to_string(), 4000));
        assert_eq!(split_addr(""), ("127.0.0.1".to_string(), 0));
        assert_eq!(split_addr("127.0.0.1"), ("127.0.0.1".to_string(), 0));
        assert!(free_port() > 0);
    }

    //命令行按双引号切分，程序名与参数分开
    #[test]
    fn 切分启动命令() {
        let (p, a) = split_cmd("python -m debugpy.adapter");
        assert_eq!(p, "python");
        assert_eq!(a, vec!["-m", "debugpy.adapter"]);
        let (p, a) = split_cmd("\"C:\\Program Files\\x\\a.exe\" --stdio");
        assert_eq!(p, "C:\\Program Files\\x\\a.exe");
        assert_eq!(a, vec!["--stdio"]);
    }

    //探测命令按退出码判定可用性
    #[test]
    fn 探测本机命令() {
        let (ok, _) = probe("cmd /c exit 0");
        assert!(ok);
        let (ok, _) = probe("cmd /c exit 3");
        assert!(!ok);
        let (ok, _) = probe("");
        assert!(!ok);
    }

    //分帧写入的头部格式正确
    #[test]
    fn 写入分帧头部() {
        let msg = r#"{"seq":1}"#;
        let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr = l.local_addr().unwrap();
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut b = [0u8; 64];
            let n = s.read(&mut b).unwrap();
            b[..n].to_vec()
        });
        let c = TcpStream::connect(addr).unwrap();
        let mut sink = Sink::Sock(c);
        write_frame(&mut sink, msg).unwrap();
        let out = h.join().unwrap();
        let want = format!("Content-Length: {}\r\n\r\n{}", msg.len(), msg);
        assert_eq!(String::from_utf8_lossy(&out), want);
    }
}
