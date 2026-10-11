use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

#[link(name = "kernel32")]
unsafe extern "system" {
    fn MultiByteToWideChar(cp: u32, flags: u32, s: *const u8, cb: i32, out: *mut u16, cch: i32) -> i32;
}

pub const OUT: &str = "out";
pub const ERR: &str = "err";

const NO_WINDOW: u32 = 0x08000000;
//命令结束后打印的cwd标记行
const MARK: &str = "#MIDE#";

//ponytail: 全局记录运行中的(终端id,pid)，取消按终端终止，不做窗口隔离
static PIDS: Mutex<Vec<(String, u32)>> = Mutex::new(Vec::new());
static CANCELED: Mutex<Vec<String>> = Mutex::new(Vec::new());

//cmd内置命令重定向时按OEM代码页输出，先试UTF-8失败再按OEM解码
fn decode(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    let n = unsafe { MultiByteToWideChar(1, 0, bytes.as_ptr(), bytes.len() as i32, std::ptr::null_mut(), 0) };
    if n <= 0 {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    let mut buf = vec![0u16; n as usize];
    unsafe { MultiByteToWideChar(1, 0, bytes.as_ptr(), bytes.len() as i32, buf.as_mut_ptr(), n) };
    String::from_utf16_lossy(&buf)
}

//真实执行命令，合并stderr，逐行回传，返回退出码与命令结束后的工作目录
pub fn run<F: FnMut(&str, &'static str)>(tid: &str, cmd: &str, cwd: &str, mut out: F) -> (i32, String) {
    //ponytail: 开启延迟展开取实时错误码与实时cd，代价是命令内的 ! 会被展开
    let line = format!("chcp 65001>nul & {cmd} 2>&1 & set EC=!ERRORLEVEL! & echo {MARK}&cd&exit /b !EC!");
    let mut child = match Command::new("cmd")
        //整行原样交给cmd，走参数转义会把命令里的引号转成cmd不认的形式
        .raw_arg("/V:ON")
        .raw_arg("/C")
        .raw_arg(&line)
        .current_dir(if cwd.is_empty() { "." } else { cwd })
        .env("CLICOLOR_FORCE", "1")
        .env("CARGO_TERM_COLOR", "always")
        .env("FORCE_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            out(&format!("启动失败: {e}"), ERR);
            return (-1, String::new());
        }
    };

    let pid = child.id();
    if let Ok(mut ps) = PIDS.lock() {
        ps.push((tid.to_string(), pid));
    }

    let mut new_cwd = String::new();
    let mut want_cwd = false;
    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout);
        let mut buf: Vec<u8> = Vec::new();
        //按行读取，遇非UTF-8不中断也不提前关管道
        while reader.read_until(b'\n', &mut buf).unwrap_or(0) > 0 {
            let raw = decode(&buf);
            buf.clear();
            let line = raw.trim_end_matches(|c| c == '\r' || c == '\n');
            if want_cwd {
                new_cwd = line.to_string();
                want_cwd = false;
            } else if line.ends_with(MARK) {
                //命令末尾无换行时标记会跟在同一行，截掉后仍输出前半段
                let head = &line[..line.len() - MARK.len()];
                if !head.is_empty() {
                    out(head, OUT);
                }
                want_cwd = true;
            } else {
                out(line, OUT);
            }
        }
    }
    let code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
    if let Ok(mut ps) = PIDS.lock() {
        ps.retain(|(t, _)| t.as_str() != tid);
    }
    let canceled = match CANCELED.lock() {
        Ok(mut v) => match v.iter().position(|t| t.as_str() == tid) {
            Some(i) => {
                v.remove(i);
                true
            }
            None => false,
        },
        Err(_) => false,
    };
    if canceled {
        out("[已取消]", ERR);
    } else if code != 0 {
        out(&format!("[退出码 {code}]"), ERR);
    }
    (code, new_cwd)
}

/* ---------- 伪终端 ---------- */

type Handle = isize;

#[repr(C)]
struct SECURITY_ATTRIBUTES {
    nLength: u32,
    lpSecurityDescriptor: *mut std::ffi::c_void,
    bInheritHandle: u32,
}

#[repr(C)]
struct Coord {
    x: i16,
    y: i16,
}

#[repr(C)]
struct StartupInfoW {
    cb: u32,
    reserved: *mut u16,
    desktop: *mut u16,
    title: *mut u16,
    x: u32,
    y: u32,
    x_size: u32,
    y_size: u32,
    x_chars: u32,
    y_chars: u32,
    fill: u32,
    flags: u32,
    show: u16,
    reserved2: u16,
    reserved3: *mut u8,
    stdin: Handle,
    stdout: Handle,
    stderr: Handle,
}

#[repr(C)]
struct StartupInfoExW {
    info: StartupInfoW,
    attrs: *mut std::ffi::c_void,
}

#[repr(C)]
struct ProcInfo {
    hproc: Handle,
    hthread: Handle,
    pid: u32,
    tid: u32,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetModuleHandleA(name: *const u8) -> Handle;
    fn GetProcAddress(module: Handle, name: *const u8) -> Handle;
    fn GetLastError() -> u32;
    fn CreatePipe(read: *mut Handle, write: *mut Handle, sa: *mut std::ffi::c_void, size: u32) -> i32;
    fn ReadFile(h: Handle, buf: *mut u8, n: u32, got: *mut u32, ov: *mut std::ffi::c_void) -> i32;
    fn WriteFile(h: Handle, buf: *const u8, n: u32, put: *mut u32, ov: *mut std::ffi::c_void) -> i32;
    fn CloseHandle(h: Handle) -> i32;
    fn InitializeProcThreadAttributeList(list: *mut std::ffi::c_void, count: u32, flags: u32, size: *mut usize) -> i32;
    fn UpdateProcThreadAttribute(
        list: *mut std::ffi::c_void,
        flags: u32,
        attr: usize,
        value: *mut std::ffi::c_void,
        size: usize,
        prev: *mut std::ffi::c_void,
        ret: *mut usize,
    ) -> i32;
    fn DeleteProcThreadAttributeList(list: *mut std::ffi::c_void);
    fn CreateProcessW(
        app: *const u16,
        cmd: *mut u16,
        pa: *mut std::ffi::c_void,
        ta: *mut std::ffi::c_void,
        inherit: i32,
        flags: u32,
        env: *mut std::ffi::c_void,
        dir: *const u16,
        si: *mut StartupInfoW,
        pi: *mut ProcInfo,
    ) -> i32;
}

//伪终端输出结束的标记，与OUT区分
pub const EXIT: &str = "exit";

//屏幕快照编码成 JSON：{"rows":[[{s,t}...]], "cursor":[c,r]}
//style 串：f0-f8(默认) b0-b8(默认) B/U/I 拼起来
fn encode_screen(parser: &vt100::Parser) -> String {
    use vt100::Color;
    let mut out = String::with_capacity(512);
    out.push_str("{\"rows\":[");
    let s = parser.screen();
    let (rows, cols) = s.size();
    for r in 0..rows {
        if r > 0 { out.push(','); }
        out.push('[');
        let mut cur_style = String::new();
        let mut cur_text = String::new();
        let mut first = true;
        for c in 0..cols {
            let cell = match s.cell(r, c) { Some(c) => c, None => continue };
            let fg = match cell.fgcolor() {
                Color::Idx(n) => n,
                Color::Default => 8,
                _ => 9,
            };
            let bg = match cell.bgcolor() {
                Color::Idx(n) => n.min(7),
                Color::Default => 8,
                _ => 0,
            };
            let mut st = format!("f{}", fg);
            if bg != 8 { st.push_str(&format!(" b{}", bg)); }
            if cell.bold() { st.push_str(" B"); }
            if cell.underline() { st.push_str(" U"); }
            if cell.italic() { st.push_str(" I"); }
            let t = cell.contents();
            if cur_text.is_empty() {
                cur_style = st;
                cur_text = t.to_string();
            } else if st == cur_style {
                cur_text.push_str(t);
            } else {
                if !first { out.push(','); }
                first = false;
                out.push_str(&span(&cur_style, &cur_text));
                cur_style = st;
                cur_text = t.to_string();
            }
        }
        if !first { out.push(','); }
        out.push_str(&span(&cur_style, &cur_text));
        out.push(']');
    }
    out.push_str("],\"cursor\":[");
    let (cr, cc) = s.cursor_position();
    out.push_str(&cc.to_string());
    out.push(',');
    out.push_str(&cr.to_string());
    out.push(']');
    //补上最外层对象的右括号，否则前端 eval 的 JSON 不完整会直接语法报错
    out.push('}');
    out
}

fn span(st: &str, t: &str) -> String {
    format!("{{\"s\":\"{}\",\"t\":{}}}", vt100_escape(st), serde_json_str(t))
}

//把 style 串里的双引号等转义掉（style 只含字母数字，一般不会触发）
fn vt100_escape(s: &str) -> String { s.replace('\\', "\\\\").replace('"', "\\\"") }
//把普通字符串转 JSON 字面量，单引号包裹更短
fn serde_json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            _ if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

//PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
const ATTR_PTY: usize = 0x0002_0016;
//EXTENDED_STARTUPINFO_PRESENT
const STARTF_EX: u32 = 0x0008_0000;
//STARTF_USESTDHANDLES：配合下面把子进程 std 句柄全置 NULL
const STARTF_USE_STD: u32 = 0x0000_0100;

type PfnCreate = unsafe extern "system" fn(Coord, Handle, Handle, u32, *mut Handle) -> i32;
type PfnResize = unsafe extern "system" fn(Handle, Coord) -> i32;
type PfnClose = unsafe extern "system" fn(Handle);

struct ConPty {
    create: PfnCreate,
    resize: PfnResize,
    close: PfnClose,
}

//伪终端会话持有的句柄 + vt100 解析器
struct Session {
    hpc: Handle,
    hin: Handle,
    hproc: Handle,
    parser: vt100::Parser,
}

//全局屏幕快照，key=tid；resize 请求队列：key=tid -> (cols,rows)
static SCREENS: Mutex<Option<std::collections::HashMap<String, String>>> = Mutex::new(None);
static RESIZES: Mutex<Option<std::collections::HashMap<String, (u16, u16)>>> = Mutex::new(None);

//ponytail: 全局记录各终端的伪终端会话，不做窗口隔离
static PROCS: Mutex<Vec<(String, Session)>> = Mutex::new(Vec::new());

//ConPTY只在Win10 1809起才有，动态取符号，避免旧系统连exe都起不来
fn conpty() -> Option<&'static ConPty> {
    static SYM: OnceLock<Option<ConPty>> = OnceLock::new();
    SYM.get_or_init(|| unsafe {
        let m = GetModuleHandleA(c"kernel32.dll".as_ptr() as *const u8);
        if m == 0 {
            return None;
        }
        let (a, b, c) = (
            GetProcAddress(m, c"CreatePseudoConsole".as_ptr() as *const u8),
            GetProcAddress(m, c"ResizePseudoConsole".as_ptr() as *const u8),
            GetProcAddress(m, c"ClosePseudoConsole".as_ptr() as *const u8),
        );
        if a == 0 || b == 0 || c == 0 {
            return None;
        }
        Some(ConPty {
            create: std::mem::transmute(a),
            resize: std::mem::transmute(b),
            close: std::mem::transmute(c),
        })
    })
    .as_ref()
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

//按UTF-8增量解码，跨包的半个字符留到下一包
fn drain_utf8(buf: &mut Vec<u8>) -> String {
    let mut s = String::new();
    loop {
        let err = match std::str::from_utf8(buf) {
            Ok(v) => {
                s.push_str(v);
                buf.clear();
                return s;
            }
            Err(e) => e,
        };
        let good = err.valid_up_to();
        s.push_str(std::str::from_utf8(&buf[..good]).unwrap_or(""));
        buf.drain(..good);
        match err.error_len() {
            //尾部是半个字符，等下一包补齐
            None => return s,
            Some(n) => {
                s.push('\u{FFFD}');
                buf.drain(..n);
            }
        }
    }
}

//打开伪终端并启动外壳，输出持续经out回传，外壳退出时以EXIT结束
pub fn open<F: FnMut(&str, &'static str) + Send + 'static>(tid: &str, cols: u16, rows: u16, cwd: &str, shell: &str, mut out: F) -> Result<(), String> {
    let pty = conpty().ok_or("当前系统不支持伪终端，需要 Windows 10 1809 及以上")?;
    let mut hpc: Handle = 0;
    let mut hin: Handle = 0;
    let mut hout: Handle = 0;
    //管道句柄要可继承：CreatePseudoConsole 会把它们交给 conhost，不可继承会直接 E_HANDLE
    let mut sa: SECURITY_ATTRIBUTES = unsafe { std::mem::zeroed() };
    sa.nLength = std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32;
    sa.bInheritHandle = 1;
    unsafe {
        let mut in_r = 0;
        let mut out_w = 0;
        let mut sa_ptr = &mut sa as *mut SECURITY_ATTRIBUTES as *mut std::ffi::c_void;
        if CreatePipe(&mut in_r, &mut hin, sa_ptr, 0) == 0 {
            return Err(format!("创建管道失败 (代码 {})", GetLastError()));
        }
        if CreatePipe(&mut hout, &mut out_w, sa_ptr, 0) == 0 {
            CloseHandle(in_r);
            CloseHandle(hin);
            return Err(format!("创建管道失败 (代码 {})", GetLastError()));
        }
        let hr = (pty.create)(Coord { x: cols as i16, y: rows as i16 }, in_r, out_w, 0, &mut hpc);
        //伪终端已复制这两个句柄，关掉本进程的副本
        CloseHandle(in_r);
        CloseHandle(out_w);
        if hr < 0 {
            CloseHandle(hin);
            CloseHandle(hout);
            return Err(format!("创建伪终端失败 (0x{:08x}) in={:#x} out={:#x} err={}", hr as u32, in_r, out_w, GetLastError()));
        }
    }

    //shell 为完整启动命令行，为空时回退到 Windows PowerShell
    let cmdline = if shell.trim().is_empty() {
        r#""powershell.exe" -NoLogo -NoExit -Command "chcp 65001 > $null""#
    } else {
        shell
    };
    let mut line = wide(cmdline);
    let dir = wide(if cwd.is_empty() { "." } else { cwd });
    //显式指定桌面，避免用户级 GUI 子进程无 Desktop ACL 导致子进程 0xC0000142
    let mut desktop = wide("winsta0\\default");
    let mut si: StartupInfoExW = unsafe { std::mem::zeroed() };
    si.info.cb = std::mem::size_of::<StartupInfoExW>() as u32;
    si.info.desktop = desktop.as_mut_ptr();
    //std 句柄全置 NULL：ConPTY 经属性列表接管控制台，若继承父进程的控制台句柄，外壳输出会跑到那个控制台去
    si.info.flags = STARTF_USE_STD;
    si.info.stdin = 0;
    si.info.stdout = 0;
    si.info.stderr = 0;
    let mut pi: ProcInfo = unsafe { std::mem::zeroed() };
    let mut attr: Vec<u8> = Vec::new();
    let spawned = unsafe {
        let mut need: usize = 0;
        InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut need);
        attr.resize(need, 0);
        let list = attr.as_mut_ptr() as *mut std::ffi::c_void;
        let mut ok = InitializeProcThreadAttributeList(list, 1, 0, &mut need) != 0
            && UpdateProcThreadAttribute(
                list,
                0,
                ATTR_PTY,
                //传 HPCON 句柄值本身，传它的地址会被当成无效伪终端导致子进程 0xC0000142
                hpc as *mut std::ffi::c_void,
                std::mem::size_of::<Handle>(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            ) != 0;
        si.attrs = list;
        if ok {
            //只加 EXTENDED_STARTUPINFO_PRESENT：CREATE_NO_WINDOW 会让子进程拿不到 console，ConPTY 收不到任何输出
            ok = CreateProcessW(
                std::ptr::null(),
                line.as_mut_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                //0 = 不继承：伪终端只经属性列表传句柄，管道留给本进程读写
                0,
                STARTF_EX,
                std::ptr::null_mut(),
                dir.as_ptr(),
                &mut si.info,
                &mut pi,
            ) != 0;
        }
        DeleteProcThreadAttributeList(list);
        ok
    };
    if !spawned {
        let code = unsafe { GetLastError() };
        unsafe {
            (pty.close)(hpc);
            CloseHandle(hin);
            CloseHandle(hout);
        }
        return Err(format!("启动外壳失败 (代码 {code})"));
    }
    unsafe { CloseHandle(pi.hthread) };

    let session = Session {
        hpc, hin, hproc: pi.hproc,
        parser: vt100::Parser::new(rows.min(500), cols.min(200), 3000),
    };
    if let Ok(mut v) = PROCS.lock() {
        v.retain(|(t, _)| t != tid);
        v.push((tid.to_string(), session));
    }
    let tid2 = tid.to_string();
    let tid3 = tid2.clone();
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 8192];
        //解析器在本线程独占，从 PROCS 里拿出所有权
        let mut parser = match PROCS.lock() {
            Ok(mut v) => match v.iter_mut().find(|(t, _)| t == &tid3).map(|(_, s)| std::mem::replace(&mut s.parser, vt100::Parser::new(24, 80, 0))) {
                Some(p) => p,
                None => return,
            },
            Err(_) => return,
        };
        loop {
            let mut got: u32 = 0;
            let ok = unsafe { ReadFile(hout, buf.as_mut_ptr(), buf.len() as u32, &mut got, std::ptr::null_mut()) };
            if ok == 0 || got == 0 { break; }
            parser.process(&buf[..got as usize]);
            //线程独占 parser，每帧先吃 resize 请求再编码快照
            if let Ok(mut g) = RESIZES.lock() {
                if let Some(m) = g.as_mut() {
                    if let Some((c, r)) = m.remove(&tid2) {
                        if c > 0 && r > 0 {
                            parser.screen_mut().set_size(r.min(500), c.min(200));
                        }
                    }
                }
            }
            let json = encode_screen(&parser);
            if let Ok(mut g) = SCREENS.lock() {
                g.get_or_insert_with(std::collections::HashMap::new).insert(tid2.clone(), json);
            }
        }
        //最后一帧确保快照落盘
        let json = encode_screen(&parser);
        if let Ok(mut g) = SCREENS.lock() {
            g.get_or_insert_with(std::collections::HashMap::new).insert(tid2.clone(), json);
        }
        unsafe { CloseHandle(hout) };
        out("", EXIT);
        close(&tid2);
    });
    Ok(())
}

//把输入写进伪终端
pub fn write(tid: &str, data: &str) {
    let h = match PROCS.lock() {
        Ok(v) => v.iter().find(|(t, _)| t == tid).map(|(_, s)| s.hin),
        Err(_) => None,
    };
    let Some(h) = h else { return };
    let b = data.as_bytes();
    let mut off = 0;
    while off < b.len() {
        //单次写入别超过管道缓冲
        let n = (b.len() - off).min(32768) as u32;
        let mut put: u32 = 0;
        if unsafe { WriteFile(h, b[off..].as_ptr(), n, &mut put, std::ptr::null_mut()) } == 0 {
            return;
        }
        off += n as usize;
    }
}

//窗口尺寸变化时同步给伪终端 + 解析器（解析器跑在独立线程，靠 RESIZES 通道发请求）
pub fn resize(tid: &str, cols: u16, rows: u16) {
    let Some(pty) = conpty() else { return };
    let mut guard = match PROCS.lock() { Ok(v) => v, Err(_) => return };
    let Some((_, s)) = guard.iter_mut().find(|(t, _)| t == tid) else { return };
    unsafe { (pty.resize)(s.hpc, Coord { x: cols as i16, y: rows as i16 }) };
    if cols > 0 && rows > 0 {
        if let Ok(mut g) = RESIZES.lock() {
            g.get_or_insert_with(std::collections::HashMap::new).insert(tid.to_string(), (cols.min(200), rows.min(500)));
        }
    }
}

pub fn snapshot(tid: &str) -> Option<String> {
    SCREENS.lock().ok().and_then(|g| g.as_ref().and_then(|m| m.get(tid).cloned()))
}

fn clear_screen(tid: &str) {
    if let Ok(mut g) = SCREENS.lock() {
        if let Some(m) = g.as_mut() { m.remove(tid); }
    }
}

//关闭伪终端，外壳随之结束，读取线程读到EOF退出
pub fn close(tid: &str) {
    clear_screen(tid);
    if let Ok(mut g) = RESIZES.lock() {
        if let Some(m) = g.as_mut() { m.remove(tid); }
    }
    let s = match PROCS.lock() {
        Ok(mut v) => match v.iter().position(|(t, _)| t == tid) {
            Some(i) => v.remove(i).1,
            None => return,
        },
        Err(_) => return,
    };
    if let Some(pty) = conpty() {
        unsafe { (pty.close)(s.hpc) };
    }
    unsafe {
        CloseHandle(s.hin);
        CloseHandle(s.hproc);
    }
}

//终止指定终端运行中的命令及其子进程
pub fn cancel(tid: &str) {
    if let Ok(mut v) = CANCELED.lock() {
        v.push(tid.to_string());
    }
    let pids: Vec<u32> = match PIDS.lock() {
        Ok(mut ps) => {
            let hit: Vec<u32> = ps.iter().filter(|(t, _)| t.as_str() == tid).map(|(_, p)| *p).collect();
            ps.retain(|(t, _)| t.as_str() != tid);
            hit
        }
        Err(_) => return,
    };
    for pid in pids {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(NO_WINDOW)
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 增量解码UTF8() {
        let raw = "中a文";
        let b = raw.as_bytes();
        //首字节是"中"的前半截，补齐前不输出
        let mut buf = b[..1].to_vec();
        assert_eq!(drain_utf8(&mut buf), "");
        assert_eq!(buf.len(), 1);
        buf.extend_from_slice(&b[1..]);
        assert_eq!(drain_utf8(&mut buf), raw);
        assert!(buf.is_empty());
        //非法字节替换成U+FFFD，后面的正常字符继续输出
        let mut bad = vec![0xff, b'a'];
        assert_eq!(drain_utf8(&mut bad), "\u{FFFD}a");
    }

    #[test]
    fn 宽字符串补零结尾() {
        assert_eq!(wide("ab"), vec![97, 98, 0]);
    }

    #[test]
    fn 屏幕快照是完整JSON() {
        let mut p = vt100::Parser::new(2, 8, 0);
        p.process(b"hi");
        let s = encode_screen(&p);
        //括号必须配平，否则前端 eval 会因 JSON 不完整而语法报错
        let mut depth = 0i32;
        let mut in_str = false;
        let mut esc = false;
        for c in s.chars() {
            if in_str {
                if esc {
                    esc = false;
                } else if c == '\\' {
                    esc = true;
                } else if c == '"' {
                    in_str = false;
                }
                continue;
            }
            match c {
                '"' => in_str = true,
                '{' | '[' => depth += 1,
                '}' | ']' => depth -= 1,
                _ => {}
            }
        }
        assert_eq!(depth, 0, "JSON 括号不配平: {s}");
    }

    #[test]
    fn 伪终端句柄诊断() {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetFileType(h: Handle) -> u32;
            fn CreatePseudoConsole(size: Coord, hin: Handle, hout: Handle, flags: u32, hpc: *mut Handle) -> i32;
        }
        unsafe {
            let mut in_r: Handle = 0;
            let mut in_w: Handle = 0;
            let mut out_r: Handle = 0;
            let mut out_w: Handle = 0;
            assert_ne!(CreatePipe(&mut in_r, &mut in_w, std::ptr::null_mut(), 0), 0);
            assert_ne!(CreatePipe(&mut out_r, &mut out_w, std::ptr::null_mut(), 0), 0);
            eprintln!(
                "in_r={:#x} type={} out_w={:#x} type={}",
                in_r, GetFileType(in_r), out_w, GetFileType(out_w)
            );
            let pty = conpty().expect("conpty");
            eprintln!("pfn={:#x}", pty.create as usize);
            let mut hpc: Handle = 0;
            let hr = (pty.create)(Coord { x: 80, y: 24 }, in_r, out_w, 0, &mut hpc);
            eprintln!("动态 hr={:#x} hpc={:#x}", hr as u32, hpc);
            let mut hpc2: Handle = 0;
            let hr2 = CreatePseudoConsole(Coord { x: 80, y: 24 }, in_r, out_w, 0, &mut hpc2);
            eprintln!("静态 hr={:#x} hpc={:#x}", hr2 as u32, hpc2);
        }
    }

    #[test]
    fn 伪终端flags诊断() {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn CreatePseudoConsole(size: Coord, hin: Handle, hout: Handle, flags: u32, hpc: *mut Handle) -> i32;
            fn IsProcessInJob(p: Handle, j: Handle, r: *mut i32) -> i32;
            fn GetCurrentProcess() -> Handle;
        }
        unsafe {
            eprintln!("coord_size={} coord_bytes={:?}", std::mem::size_of::<Coord>(), std::slice::from_raw_parts(&Coord { x: 80, y: 24 } as *const Coord as *const u8, 4));
            let mut inj = 0;
            IsProcessInJob(GetCurrentProcess(), 0, &mut inj);
            eprintln!("in_job={}", inj);
            for flags in [0u32, 1, 2, 4, 7] {
                let (mut a, mut b, mut c, mut d) = (0, 0, 0, 0);
                CreatePipe(&mut a, &mut b, std::ptr::null_mut(), 0);
                CreatePipe(&mut c, &mut d, std::ptr::null_mut(), 0);
                let mut hpc = 0;
                let hr = CreatePseudoConsole(Coord { x: 80, y: 24 }, a, d, flags, &mut hpc);
                eprintln!("flags={} hr={:#x} hpc={:#x}", flags, hr as u32, hpc);
            }
        }
    }

    #[test]
    fn 伪终端命名管道诊断() {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn CreateNamedPipeW(name: *const u16, mode: u32, pmode: u32, max: u32, obuf: u32, ibuf: u32, timeout: u32, sa: *mut std::ffi::c_void) -> Handle;
            fn CreatePseudoConsole(size: Coord, hin: Handle, hout: Handle, flags: u32, hpc: *mut Handle) -> i32;
        }
        unsafe {
            //匿名、不可继承
            let mut a_in_r = 0; let mut a_in_w = 0; let mut a_out_r = 0; let mut a_out_w = 0;
            CreatePipe(&mut a_in_r, &mut a_in_w, std::ptr::null_mut(), 0);
            CreatePipe(&mut a_out_r, &mut a_out_w, std::ptr::null_mut(), 0);
            let mut hpc = 0;
            eprintln!("anon-noninherit hr={:#x}", CreatePseudoConsole(Coord { x: 80, y: 24 }, a_in_r, a_out_w, 0, &mut hpc) as u32);
            //匿名、可继承
            let mut sa: SECURITY_ATTRIBUTES = std::mem::zeroed();
            sa.nLength = std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32;
            sa.bInheritHandle = 1;
            let sap = &mut sa as *mut SECURITY_ATTRIBUTES as *mut std::ffi::c_void;
            let (mut b_in_r, mut b_in_w, mut b_out_r, mut b_out_w) = (0, 0, 0, 0);
            CreatePipe(&mut b_in_r, &mut b_in_w, sap, 0);
            CreatePipe(&mut b_out_r, &mut b_out_w, sap, 0);
            let mut hpc2 = 0;
            eprintln!("anon-inherit hr={:#x}", CreatePseudoConsole(Coord { x: 80, y: 24 }, b_in_r, b_out_w, 0, &mut hpc2) as u32);
            //命名管道、可继承
            let pid = std::process::id();
            let nin = wide(&format!("\\\\.\\pipe\\mide{pid}in"));
            let nout = wide(&format!("\\\\.\\pipe\\mide{pid}out"));
            let mode: u32 = 3 | 0x0008_0000;
            let h_in = CreateNamedPipeW(nin.as_ptr(), mode, 0, 1, 128 * 1024, 128 * 1024, 0, sap);
            let h_out = CreateNamedPipeW(nout.as_ptr(), mode, 0, 1, 128 * 1024, 128 * 1024, 0, sap);
            let mut hpc3 = 0;
            eprintln!("named-inherit hr={:#x}", CreatePseudoConsole(Coord { x: 80, y: 24 }, h_in, h_out, 0, &mut hpc3) as u32);
        }
    }

    #[test]
    fn 伪终端能读到外壳输出() {
        let tid = "testpty";
        open(tid, 80, 24, ".", r#""cmd.exe" /K chcp 65001>nul"#, |_, _| {}).expect("打开伪终端");
        //等外壳打印提示符
        let mut json = String::new();
        for _ in 0..50 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Some(s) = snapshot(tid) {
                //屏幕里出现非空的文字段（不是全空白的 "t":""）
                if s.match_indices("\"t\":\"").any(|(i, _)| s.as_bytes().get(i + 5) != Some(&b'"')) {
                    json = s;
                    break;
                }
            }
        }
        close(tid);
        assert!(!json.is_empty(), "伪终端没有读到任何可见输出");
    }
}
