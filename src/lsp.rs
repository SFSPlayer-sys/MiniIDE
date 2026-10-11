use std::fs;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use crate::res;

const NO_WINDOW: u32 = 0x08000000;

//运行中的服务器：进程与它的标准输入
struct Proc {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
}

//ponytail: 全局记录各终端的语言服务器，不做窗口隔离
static PROCS: Mutex<Vec<(String, Proc)>> = Mutex::new(Vec::new());

//进程还没注册时先攒下的消息，注册后按序补发
static PENDING: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
const PEND_MAX: usize = 256;

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
            '"' => { quoted = !quoted; has = true; }
            c if c.is_whitespace() && !quoted => {
                if has { args.push(std::mem::take(&mut cur)); has = false; }
            }
            c => { cur.push(c); has = true; }
        }
    }
    if has { args.push(cur); }
    let prog = if args.is_empty() { String::new() } else { args.remove(0) };
    (prog, args)
}

//启动语言服务器，按LSP分帧解析后逐条回推，进程结束时以空串通知
pub fn start<F: FnMut(&str) + Send + 'static>(tid: &str, cmd: &str, cwd: &str, mut out: F) -> Result<(), String> {
    //服务器平时以压缩包留存，启动前按需解压
    ensure_unpacked(tid);
    kill(tid);
    let (prog, args) = split_cmd(cmd);
    //bat/cmd只能交给cmd解释，其余直接起进程，任务管理器里就是miniide的直接子进程
    let mut command = if prog.to_ascii_lowercase().ends_with(".bat") || prog.to_ascii_lowercase().ends_with(".cmd") {
        let mut c = Command::new("cmd");
        c.raw_arg("/C").raw_arg(cmd);
        c
    } else {
        let mut c = Command::new(&prog);
        c.args(&args);
        c
    };
    let mut child = command
        .current_dir(if cwd.is_empty() { "." } else { cwd })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    let stdin = child.stdin.take().ok_or("无法写入语言服务器")?;
    let mut stdout = child.stdout.take().ok_or("无法读取语言服务器")?;
    let stdin = Arc::new(Mutex::new(stdin));
    //注册前页面可能已把initialize发来了，先补发攒下的消息
    let mut pend: Vec<String> = Vec::new();
    if let Ok(mut v) = PENDING.lock() {
        v.retain(|(t, m)| {
            if t == tid {
                pend.push(m.clone());
                false
            } else {
                true
            }
        });
    }
    if let Ok(mut v) = PROCS.lock() {
        v.retain(|(t, _)| t != tid);
        v.push((tid.to_string(), Proc { child, stdin: stdin.clone() }));
    }
    if !pend.is_empty() {
        if let Ok(mut s) = stdin.lock() {
            for m in &pend {
                write_msg(&mut *s, m);
            }
            let _ = s.flush();
        }
    }
    std::thread::spawn(move || {
        let mut buf: Vec<u8> = Vec::new();
        let mut tmp = [0u8; 8192];
        loop {
            let n = match stdout.read(&mut tmp) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            buf.extend_from_slice(&tmp[..n]);
            while let Some(m) = frame(&mut buf) {
                out(&m);
            }
        }
        out("");
    });
    Ok(())
}

//按LSP分帧写入
pub fn send(tid: &str, json: &str) {
    let h = match PROCS.lock() {
        Ok(v) => v.iter().find(|(t, _)| t == tid).map(|(_, p)| p.stdin.clone()),
        Err(_) => None,
    };
    let Some(h) = h else {
        //进程还没起来，先攒着，start注册后补发
        if let Ok(mut v) = PENDING.lock() {
            v.push((tid.to_string(), json.to_string()));
            let n = v.len();
            if n > PEND_MAX {
                v.drain(..n - PEND_MAX);
            }
        }
        return;
    };
    let Ok(mut s) = h.lock() else { return };
    write_msg(&mut *s, json);
    let _ = s.flush();
}

//把一条消息按LSP分帧写到标准输入
fn write_msg<W: Write>(s: &mut W, json: &str) {
    let _ = s.write_all(format!("Content-Length: {}\r\n\r\n{}", json.len(), json).as_bytes());
}

//终止语言服务器及其子进程，并丢掉它攒下的消息
pub fn stop(tid: &str) {
    if let Ok(mut v) = PENDING.lock() {
        v.retain(|(t, _)| t != tid);
    }
    kill(tid);
    //停掉后删掉解压目录，平时只留压缩包
    clean_dir(tid);
}

//删除按需解压出来的服务器目录，进程退出后文件才会解锁，失败就重试几次
fn clean_dir(tid: &str) {
    let Some(lang) = tid.strip_prefix("lsp:") else { return };
    let dir = res::cache_dir().join("lsp").join(res::safe(lang));
    for _ in 0..5 {
        if fs::remove_dir_all(&dir).is_ok() || !dir.exists() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(120));
    }
}

//只终止进程，攒下的消息留给下次启动补发
fn kill(tid: &str) {
    let mut p = match PROCS.lock() {
        Ok(mut v) => match v.iter().position(|(t, _)| t == tid) {
            Some(i) => v.remove(i).1,
            None => return,
        },
        Err(_) => return,
    };
    let pid = p.child.id();
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .status();
    let _ = p.child.wait();
}

//退出前停掉所有语言服务器
pub fn shutdown() {
    let ids: Vec<String> = match PROCS.lock() {
        Ok(v) => v.iter().map(|(t, _)| t.clone()).collect(),
        Err(_) => return,
    };
    for t in ids {
        stop(&t);
    }
}

//下载后要认出的服务器入口文件名
const EXES: &[&str] = &[
    "rust-analyzer.exe", "clangd.exe", "lua-language-server.exe", "ruff.exe",
    "zls.exe", "taplo.exe", "marksman.exe", "clojure-lsp.exe",
    "nimlangserver.exe", "texlab.exe", "neocmakelsp.exe", "v-analyzer.exe",
    "omnisharp.exe", "kotlin-language-server.bat",
    "pyright-langserver.js",
];

//下载并解压语言服务器到Data/lsp/<lang>，返回可执行文件路径
//on_progress(cur, total) 进度回调，total=0 表示服务端没给 Content-Length
pub fn install<F: FnMut(u64, u64)>(lang: &str, src: &str, mut on_progress: F) -> Result<String, String> {
    let root = res::cache_dir().join("lsp");
    let dir = root.join(res::safe(lang));
    //重装前清掉旧的解压目录
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    let file = res::download_with_progress(src, &format!("lsp.{}", res::safe(lang)), |cur, total| {
        on_progress(cur, total);
    }).map_err(|e| format!("下载失败: {e}"))?.ok_or("下载失败")?;
    if !extract(&file, &dir, src) {
        return Err("解压失败".into());
    }
    cleanup_lsp(&dir);
    let exe = find_exe(&dir).ok_or_else(|| "未找到可执行文件".to_string())?;
    //js入口交由node解释，缺node时提前报错
    if exe.to_ascii_lowercase().ends_with(".js") && !has_node() {
        return Err("未找到 node.exe，Python 补全需先安装 Node.js".into());
    }
    //服务器压成包留存，平时不占空间，启动时再解开
    if keep_pkg(&file, &dir, &root.join(format!("{}.zip", res::safe(lang)))) {
        let _ = fs::remove_dir_all(&dir);
    }
    Ok(exe)
}

//删除解压出来的 .pdb / .ilk / .obj / .dSYM / .debug / .dwarf 调试符号文件
fn cleanup_lsp(dir: &Path) {
    let exts = ["pdb", "ilk", "obj", "dSYM", "debug", "dwarf", "a", "lib"];
    let mut v = Vec::new();
    walk(dir, 0, &mut |p| {
        if let Some(e) = p.extension().and_then(|s| s.to_str()) {
            if exts.iter().any(|x| x.eq_ignore_ascii_case(e)) {
                v.push(p.to_path_buf());
            }
        }
        true
    });
    for p in v { let _ = fs::remove_file(&p); }
}

//改用压缩包留存，UPX 压缩方案停用
//尝试用系统 UPX 压缩 exe，失败不致命（某些 Rust/Go 编出来的二进制 UPX 会拒绝，跳过即可）
//fn upx_compress(exe: &str) -> Result<(), String> {
//    let upx = upx_path();
//    let st = Command::new(&upx)
//        .arg("--best").arg("--lzma").arg("--no-progress")
//        .arg(exe)
//        .creation_flags(NO_WINDOW)
//        .status()
//        .map_err(|e| format!("upx 调用失败: {e}"))?;
//    if st.success() { Ok(()) } else { Err(format!("upx 返回非零: {:?}", st.code())) }
//}

//探测系统是否装了node
fn has_node() -> bool {
    Command::new("node")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .status()
        .is_ok_and(|s| s.success())
}

//UPX 方案停用，路径探测一并保留备用
//fn upx_path() -> String {
//    for p in ["upx",
//        &format!("{}\\Microsoft\\WinGet\\Links\\upx.exe", std::env::var("LOCALAPPDATA").unwrap_or_default()),
//        "C:\\Program Files\\UPX\\upx.exe",
//        "C:\\Program Files (x86)\\UPX\\upx.exe",
//    ] {
//        let path = Path::new(p);
//        if p == "upx" || path.is_file() { return p.to_string(); }
//    }
//    "upx".into()
//}

//把服务器留存为压缩包：原始已是压缩包的直接复制，裸文件重新压成zip
fn keep_pkg(file: &Path, dir: &Path, pkg: &Path) -> bool {
    let mut m = [0u8; 4];
    let magic = fs::File::open(file).and_then(|mut f| f.read_exact(&mut m)).map(|_| m).unwrap_or([0; 4]);
    let packed = magic.starts_with(b"PK\x03\x04") || magic.starts_with(&[0x1f, 0x8b]) || magic.starts_with(b"7z\xbc\xaf");
    if packed {
        return fs::copy(file, pkg).is_ok();
    }
    //zip压到最高级别，体积优先
    Command::new("tar")
        .arg("-a").arg("-cf").arg(pkg)
        .arg("--options=zip:compression-level=9")
        .arg("-C").arg(dir).arg(".")
        .creation_flags(NO_WINDOW)
        .status()
        .is_ok_and(|s| s.success()) && pkg.is_file()
}

//启动前把留存的压缩包解压到工作目录
fn ensure_unpacked(tid: &str) {
    let Some(lang) = tid.strip_prefix("lsp:") else { return };
    let root = res::cache_dir().join("lsp");
    let dir = root.join(res::safe(lang));
    if dir.is_dir() {
        return;
    }
    let pkg = root.join(format!("{}.zip", res::safe(lang)));
    if !pkg.is_file() {
        return;
    }
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    if !extract(&pkg, &dir, "") {
        let _ = fs::remove_dir_all(&dir);
    }
}

//压缩包按magic识别后交给系统tar解压，其余当作现成的可执行文件复制
fn extract(file: &Path, dir: &Path, src: &str) -> bool {
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
    //裸可执行文件：下载时统一存成.bin，这里按链接后缀还原成exe
    fs::copy(file, dir.join(format!("server.{}", link_ext(src)))).is_ok()
}

//从链接里取扩展名，取不到就用exe
fn link_ext(src: &str) -> String {
    let name = src.rsplit(|c| c == '/' || c == '\\').next().unwrap_or("");
    let name = name.split('?').next().unwrap_or("");
    let ext = Path::new(name).extension().and_then(|s| s.to_str()).unwrap_or("");
    if (2..=4).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        ext.to_ascii_lowercase()
    } else {
        "exe".to_string()
    }
}

//在解压目录里找服务器入口文件，认不出已知名字时退回第一个
fn find_exe(dir: &Path) -> Option<String> {
    let mut found = None;
    walk(dir, 0, &mut |p: &Path| {
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
        //启动器可能是exe，也可能是bat/cmd包装脚本，或node的js入口
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
    if depth > 3 {
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
        let mut h = b"Content-Length: 3\r\n\r\nab".to_vec();
        assert_eq!(frame(&mut h), None);
        h.push(b'c');
        assert_eq!(frame(&mut h).as_deref(), Some("abc"));
        assert_eq!(find(b"abc", b"bc"), Some(1));
    }

    //下载的裸文件按链接后缀还原可执行名
    #[test]
    fn 链接后缀还原() {
        assert_eq!(link_ext("https://x/a/marksman.exe"), "exe");
        assert_eq!(link_ext("https://x/a/tool.exe?v=1"), "exe");
        assert_eq!(link_ext("https://x/a/run.bat"), "bat");
        assert_eq!(link_ext("https://x/a/run.cmd"), "cmd");
        assert_eq!(link_ext("https://x/a/noext"), "exe");
        assert_eq!(link_ext("C:\\a\\b\\tool.EXE"), "exe");
    }

    //下载目录里优先认出已知的服务器可执行文件
    #[test]
    fn 查找服务器可执行文件() {
        let d = std::env::temp_dir().join("MiniIDE.lsptest");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("bin")).unwrap();
        fs::write(d.join("bin").join("clangd.exe"), b"x").unwrap();
        fs::write(d.join("readme.txt"), b"x").unwrap();
        let got = find_exe(&d).unwrap();
        assert!(got.ends_with("clangd.exe"));
        let e = std::env::temp_dir().join("MiniIDE.lsptest2");
        let _ = fs::remove_dir_all(&e);
        fs::create_dir_all(e.join("server").join("bin")).unwrap();
        fs::write(e.join("server").join("bin").join("kotlin-language-server.bat"), b"x").unwrap();
        assert!(find_exe(&e).unwrap().ends_with("kotlin-language-server.bat"));
        let f = std::env::temp_dir().join("MiniIDE.lsptest3");
        let _ = fs::remove_dir_all(&f);
        fs::create_dir_all(&f).unwrap();
        fs::write(f.join("other.exe"), b"x").unwrap();
        assert!(find_exe(&f).unwrap().ends_with("other.exe"));
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&e);
        let _ = fs::remove_dir_all(&f);
    }
}
