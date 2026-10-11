use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};


pub fn post<F: FnMut(&str, bool)>(url: &str, key: &str, body: &str, pid: &AtomicU32, mut out: F) -> i32 {
    let mut child = match Command::new("curl")
        .args([
            "-sS", "-N", "-m", "300",
            "-X", "POST", url,
            "-H", "Content-Type: application/json",
            "-H", &format!("Authorization: Bearer {key}"),
            "--data-binary", "@-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            out(&format!("启动 curl 失败: {e}"), true);
            return -1;
        }
    };

    pid.store(child.id(), Ordering::Relaxed);

    if let Some(mut si) = child.stdin.take() {
        let data = body.as_bytes().to_vec();
        std::thread::spawn(move || {
            let _ = si.write_all(&data);
        });
    }

    let err = child.stderr.take().map(|se| {
        std::thread::spawn(move || {
            let mut s = String::new();
            let _ = BufReader::new(se).read_to_string(&mut s);
            s
        })
    });

    if let Some(stdout) = child.stdout.take() {
        let mut r = BufReader::new(stdout);
        let mut buf = Vec::new();
        while r.read_until(b'\n', &mut buf).unwrap_or(0) > 0 {
            let line = String::from_utf8_lossy(&buf)
                .trim_end_matches(|c| c == '\r' || c == '\n')
                .to_string();
            out(&line, false);
            buf.clear();
        }
    }

    let code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
    if let Some(h) = err {
        if let Ok(s) = h.join() {
            let s = s.trim();
            if !s.is_empty() {
                out(s, true);
            }
        }
    }
    code
}
