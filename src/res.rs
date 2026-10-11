use std::fs;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};

//临时文件序号，避免并发下载互相覆盖
static SEQ: AtomicUsize = AtomicUsize::new(0);
//native-tls 只认手动配置的 Agent，快捷的 ureq::get 不会带上 TLS，故自建一个走系统 schannel 的 Agent
static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
    let tls = native_tls::TlsConnector::new().expect("初始化 TLS 失败");
    ureq::AgentBuilder::new().tls_connector(Arc::new(tls)).build()
});
//单个待检查文件的大小上限
const MAX_SIZE: u64 = 512 * 1024;
//语法检查支持的文件后缀
const SRC_EXT: [&str; 47] = [
    "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "rs", "go", "java", "cs", "rb", "php", "swift",
    "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "objc", "json", "html", "htm", "css", "vue", "yaml",
    "yml", "toml", "sh", "bash", "lua", "kt", "kts", "scala", "dart", "zig", "elm", "ex", "exs",
    "ml", "mli", "sol", "rdl", "tla", "res",
];

//缓存根目录，取不到exe路径时退回用户目录
fn fallback_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
    Path::new(&base).join("MiniIDE")
}

//资源缓存目录放在exe同级的Data下，无则创建
pub fn cache_dir() -> PathBuf {
    let d = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("Data")))
        .unwrap_or_else(fallback_dir);
    let _ = fs::create_dir_all(&d);
    d
}

//语言名转安全文件名，防止路径穿越
pub fn safe(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(48)
        .collect();
    if t.is_empty() { "default".to_string() } else { t }
}

fn cache_file(kind: &str, name: &str) -> Option<PathBuf> {
    let f = match kind {
        "hljs" => "highlight.min.js".to_string(),
        "marked" => "marked.min.js".to_string(),
        "purify" => "purify.min.js".to_string(),
        "trans" => format!("trans.{}.json", safe(name)),
        "ts" => "typescript.js".to_string(),
        "tslib" => format!("tslib{}.d.ts", safe(name)),
        "xterm" => "xterm.js".to_string(),
        "xtermcss" => "xterm.css".to_string(),
        "xtermfit" => "addon-fit.js".to_string(),
        "tscore" => "tree-sitter.js".to_string(),
        "tswasm" => "tree-sitter.wasm".to_string(),
        "grammar" => format!("tree-sitter-{}.wasm", safe(name)),
        _ => return None,
    };
    Some(cache_dir().join(f))
}

//文本注入之外的资源走缓存文件，由页面经本地服务自行加载
pub fn is_file_kind(kind: &str) -> bool {
    matches!(kind, "ts" | "tslib" | "xterm" | "xtermcss" | "xtermfit" | "tscore" | "tswasm" | "grammar")
}

//下载并缓存原始资源，返回缓存文件路径与是否本次新下载
pub fn fetch(kind: &str, src: &str, name: &str, force: bool) -> (Option<PathBuf>, bool) {
    let Some(cache) = cache_file(kind, name) else { return (None, false) };
    if !force && fs::metadata(&cache).map(|m| m.len() >= 16).unwrap_or(false) {
        return (Some(cache), false);
    }
    let tag = format!("{kind}.{}", SEQ.fetch_add(1, Ordering::Relaxed));
    let Some(file) = source(src, &tag) else { return (None, false) };
    if fs::copy(&file, &cache).is_err() {
        return (None, false);
    }
    (Some(cache), true)
}

//加载资源，命中缓存直接返回，force时重新获取，第二个值表示是否本次新下载
pub fn load(kind: &str, src: &str, name: &str, force: bool) -> (Option<String>, bool) {
    let Some(cache) = cache_file(kind, name) else { return (None, false) };
    if !force {
        if let Ok(t) = fs::read_to_string(&cache) {
            if t.len() >= 16 {
                return (Some(t), false);
            }
        }
    }
    let tag = format!("{kind}.{}", SEQ.fetch_add(1, Ordering::Relaxed));
    let Some(file) = source(src, &tag) else { return (None, false) };
    let text = match kind {
        "hljs" => hljs_text(&file),
        _ => fs::read_to_string(&file).ok(),
    };
    let Some(text) = text else { return (None, false) };
    if text.len() < 16 {
        return (None, false);
    }
    let _ = fs::write(&cache, &text);
    (Some(text), true)
}

//按URL或本地路径取一份文件，供LSP安装复用（忽略错误和进度）
pub fn download(src: &str, tag: &str) -> Option<PathBuf> {
    download_with_progress(src, tag, |_cur, _total| {}).ok().flatten()
}

//带进度回调的下载：cur 已下载字节，total 总字节（服务端没发 Content-Length 时为 0）
pub fn download_with_progress<F: FnMut(u64, u64)>(src: &str, tag: &str, mut on_progress: F) -> Result<Option<PathBuf>, String> {
    if !(src.starts_with("http://") || src.starts_with("https://")) {
        let p = PathBuf::from(src);
        return Ok(if p.is_file() { Some(p) } else { None });
    }
    let dir = std::env::temp_dir().join("MiniIDE.res");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(format!("{tag}.bin"));
    let _ = fs::remove_file(&out);
    let resp = AGENT.get(src).set("User-Agent", "MiniIDE").call().map_err(|e| format!("{e}"))?;
    let total = resp.header("content-length").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let mut body = resp.into_reader();
    let mut file = fs::File::create(&out).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 65536];
    let mut got: u64 = 0;
    loop {
        let n = body.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        on_progress(got, total);
    }
    if got == 0 { return Ok(None); }
    Ok(Some(out))
}

//内部：按URL或本地路径取一份文件，忽略错误和进度
fn source(src: &str, tag: &str) -> Option<PathBuf> {
    download_with_progress(src, tag, |_, _| {}).ok().flatten()
}

//按gzip魔数判断是否是压缩包
fn is_tgz(p: &Path) -> bool {
    let mut b = [0u8; 2];
    fs::File::open(p).and_then(|mut f| f.read_exact(&mut b)).map(|_| b == [0x1f, 0x8b]).unwrap_or(false)
}

//解包tgz，返回解包目录
fn untar(tgz: &Path) -> Option<PathBuf> {
    let dir = tgz.with_extension("x");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).ok()?;
    let ok = Command::new("tar")
        .arg("-xzf")
        .arg(tgz)
        .arg("-C")
        .arg(&dir)
        .creation_flags(0x08000000)
        .status()
        .is_ok_and(|s| s.success());
    if ok { Some(dir) } else { None }
}

//高亮库，核心加全部语言
fn hljs_text(p: &Path) -> Option<String> {
    if !is_tgz(p) {
        return fs::read_to_string(p).ok();
    }
    let dir = untar(p)?;
    let pkg = dir.join("package");
    let mut js = fs::read_to_string(pkg.join("highlight.min.js")).ok()?;
    let mut langs: Vec<PathBuf> = fs::read_dir(pkg.join("languages")).ok()?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    langs.sort();
    for f in langs {
        if let Ok(t) = fs::read_to_string(&f) {
            js.push('\n');
            js.push_str(&t);
        }
    }
    let _ = fs::remove_dir_all(&dir);
    Some(js)
}

//收集工作区里能检查的源文件，返回路径与内容
pub fn src_files(root: &str, limit: usize) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if root.is_empty() {
        return out;
    }
    crate::search::walk(Path::new(root), 0, &mut |p: &Path| {
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if !SRC_EXT.contains(&ext.as_str()) {
            return true;
        }
        if fs::metadata(p).map(|m| m.len() > MAX_SIZE).unwrap_or(true) {
            return true;
        }
        if let Ok(t) = fs::read_to_string(p) {
            out.push((p.to_string_lossy().to_string(), t));
        }
        out.len() < limit
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    //本地文件当资源时直接复制进缓存，命中缓存不再重读
    #[test]
    fn 缓存原始资源() {
        let src = std::env::temp_dir().join("MiniIDE.src.wasm");
        fs::write(&src, b"\0asm\x01\0\0\0payload").unwrap();
        let (p, fresh) = fetch("tswasm", &src.to_string_lossy(), "", true);
        let p = p.unwrap();
        assert!(fresh);
        assert!(p.ends_with("tree-sitter.wasm"));
        assert_eq!(fs::read(&p).unwrap(), b"\0asm\x01\0\0\0payload");
        //语法包按名字分开缓存
        let (g, _) = fetch("grammar", &src.to_string_lossy(), "python", true);
        assert!(g.unwrap().ends_with("tree-sitter-python.wasm"));
        assert!(is_file_kind("ts") && is_file_kind("tslib") && is_file_kind("grammar") && !is_file_kind("hljs"));
        //类型声明按声明文件名分开缓存
        let (d, _) = fetch("tslib", &src.to_string_lossy(), ".es5", true);
        assert!(d.unwrap().ends_with("tslib_es5.d.ts"));
        let _ = fs::remove_file(&src);
    }

    //语言名不能带出路径分隔与点
    #[test]
    fn 语言名转安全文件名() {
        assert_eq!(safe("ja"), "ja");
        assert_eq!(safe(""), "default");
        let s = safe("../../etc/passwd");
        assert!(!s.contains('/') && !s.contains('.') && !s.contains('\\'));
    }

    //只收集支持的源文件，跳过node_modules与其他文件
    #[test]
    fn 扫描源文件() {
        let d = std::env::temp_dir().join("MiniIDE.jstest");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("node_modules")).unwrap();
        fs::write(d.join("a.js"), "let a = 1").unwrap();
        fs::write(d.join("a.py"), "x = 1").unwrap();
        fs::write(d.join("b.txt"), "x").unwrap();
        fs::write(d.join("node_modules").join("c.js"), "let c = 1").unwrap();
        let got = src_files(&d.to_string_lossy(), 10);
        assert_eq!(got.len(), 2);
        assert!(got.iter().any(|f| f.0.ends_with("a.js")));
        assert!(got.iter().any(|f| f.0.ends_with("a.py")));
        let _ = fs::remove_dir_all(&d);
    }
}
