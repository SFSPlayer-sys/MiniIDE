use std::os::windows::process::CommandExt;
use std::process::Command;

use crate::ipc::jstr;

//伪装成浏览器，结果页才返回完整内容
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
//单次抓取的最多条数
const MAX_HITS: usize = 8;
//每个结果块的解析上限
const MAX_BLK: usize = 6000;

//一条搜索结果
struct Hit {
    title: String,
    url: String,
    snippet: String,
}

//联网搜索，按序尝试两个结果页，返回结构化JSON数组
pub fn search(query: &str) -> String {
    let q = encode(query);
    let urls = [
        format!("https://cn.bing.com/search?q={q}"),
        format!("https://html.duckduckgo.com/html/?q={q}"),
    ];
    for u in urls {
        let Some(html) = fetch(&u) else { continue };
        let mut hits = parse_bing(&html);
        if hits.is_empty() {
            hits = parse_ddg(&html);
        }
        if !hits.is_empty() {
            return to_json(&hits);
        }
    }
    "[]".to_string()
}

//序列化为JSON数组
fn to_json(hits: &[Hit]) -> String {
    let mut s = String::from("[");
    for (i, h) in hits.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&format!(
            "{{\"title\":{},\"url\":{},\"snippet\":{}}}",
            jstr(&h.title),
            jstr(&h.url),
            jstr(&h.snippet)
        ));
    }
    s.push(']');
    s
}

//用系统curl抓页面，失败返回None
fn fetch(url: &str) -> Option<String> {
    let out = Command::new("curl")
        .args(["-sSL", "--max-time", "20", "-A", UA, url])
        .creation_flags(0x08000000)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

//百分号编码
pub fn encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

//百分号解码，非法的%原样保留
fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let d = |c: u8| (c as char).to_digit(16);
            if let (Some(x), Some(y)) = (d(b[i + 1]), d(b[i + 2])) {
                out.push((x * 16 + y) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn between(s: &str, a: &str, b: &str) -> Option<String> {
    let i = s.find(a)? + a.len();
    let j = s[i..].find(b)? + i;
    Some(s[i..j].to_string())
}

//去掉标签与转义，压缩空白
fn strip(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let t = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&ensp;", " ")
        .replace("&emsp;", " ");
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

//从<a>开头处解析链接与文字
fn anchor(rest: &str) -> Option<(String, String)> {
    let href = between(rest, "href=\"", "\"")?;
    let gt = rest.find('>')? + 1;
    let close = rest[gt..].find("</a>")?;
    let text = strip(&rest[gt..gt + close]);
    if text.is_empty() {
        return None;
    }
    Some((href, text))
}

//块内首个<a>
fn first_anchor(blk: &str) -> Option<(String, String)> {
    let s = blk.find("<a ")?;
    anchor(&blk[s..])
}

//带标记的那个<a>，标记位于标签属性或紧随其后
fn marker_anchor(blk: &str, marker: &str) -> Option<(String, String)> {
    let m = blk.find(marker)?;
    let s = blk[..m].rfind("<a ")?;
    anchor(&blk[s..])
}

//带标记的<a>内的文字，允许无href
fn marker_text(blk: &str, marker: &str) -> String {
    let Some(m) = blk.find(marker) else { return String::new() };
    let Some(s) = blk[..m].rfind("<a ") else { return String::new() };
    let rest = &blk[s..];
    let Some(gt) = rest.find('>') else { return String::new() };
    let body = &rest[gt + 1..];
    let end = body.find("</a>").unwrap_or(body.len().min(400));
    strip(&body[..end])
}

//块内首个段落作为摘要
fn first_p(blk: &str) -> String {
    let Some(i) = blk.find("<p") else { return String::new() };
    let rest = &blk[i..];
    let Some(gt) = rest.find('>') else { return String::new() };
    let body = &rest[gt + 1..];
    let end = body.find("</p>").unwrap_or(body.len().min(400));
    strip(&body[..end])
}

//Bing结果页，每条结果在 class="b_algo" 的块里
fn parse_bing(html: &str) -> Vec<Hit> {
    const MARK: &str = "class=\"b_algo\"";
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find(MARK) {
        rest = &rest[i + MARK.len()..];
        let end = rest.find(MARK).unwrap_or(rest.len());
        let blk = &rest[..end.min(MAX_BLK)];
        //标题是块内首个链接，摘要取首个段落
        if let Some((url, title)) = first_anchor(blk) {
            out.push(Hit { title, url: url.trim().to_string(), snippet: first_p(blk) });
        }
        if out.len() >= MAX_HITS {
            break;
        }
        rest = &rest[end..];
    }
    out
}

//DuckDuckGo无脚本结果页，标题带 result__a，摘要带 result__snippet
fn parse_ddg(html: &str) -> Vec<Hit> {
    const MARK: &str = "class=\"result__a\"";
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find(MARK) {
        //回到<a>开头，href 在标记之前
        let start = rest[..i].rfind("<a ").unwrap_or(i);
        rest = &rest[start..];
        let end = rest[1..].find(MARK).map(|x| x + 1).unwrap_or(rest.len());
        let blk = &rest[..end.min(MAX_BLK)];
        if let Some((url, title)) = marker_anchor(blk, MARK) {
            let snippet = marker_text(blk, "result__snippet");
            out.push(Hit { title, url: real_url(&url), snippet });
        }
        if out.len() >= MAX_HITS {
            break;
        }
        rest = &rest[end..];
    }
    out
}

//DDG的链接是 /l/?uddg= 跳转，取出真实地址
fn real_url(u: &str) -> String {
    let Some(i) = u.find("uddg=") else { return u.to_string() };
    let rest = &u[i + 5..];
    let end = rest.find('&').unwrap_or(rest.len());
    decode(&rest[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 百分号编码解码() {
        assert_eq!(encode("a b&c"), "a%20b%26c");
        assert_eq!(encode("中文"), "%E4%B8%AD%E6%96%87");
        assert_eq!(decode("%E4%B8%AD%E6%96%87"), "中文");
        assert_eq!(decode("a%2"), "a%2");
    }

    #[test]
    fn 去标签与转义() {
        assert_eq!(strip("<b>a&amp;b</b>  c"), "a&b c");
        assert_eq!(strip("<div class=\"x\">标题</div>"), "标题");
    }

    #[test]
    fn 解析Bing结果() {
        let html = concat!(
            r#"<li class="b_algo"><h2><a href="https://a.com">标题一</a></h2>"#,
            r#"<div><p class="b_lineclamp">摘要 一</p></div></li>"#,
            r#"<li class="b_algo"><h2><a href="https://b.com">标题二</a></h2><p>摘要二</p></li>"#
        );
        let h = parse_bing(html);
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].title, "标题一");
        assert_eq!(h[0].url, "https://a.com");
        assert_eq!(h[0].snippet, "摘要 一");
        assert_eq!(h[1].title, "标题二");
    }

    #[test]
    fn 解析DDG结果并还原真实链接() {
        let html = concat!(
            r#"<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.com%2Fx&rut=1">标题</a>"#,
            r#"<a class="result__snippet">摘要</a>"#
        );
        let h = parse_ddg(html);
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].title, "标题");
        assert_eq!(h[0].url, "https://b.com/x");
        assert_eq!(h[0].snippet, "摘要");
    }

    #[test]
    fn 结果序列化为JSON() {
        let hits = vec![Hit { title: "含\"引号".to_string(), url: "https://a.com".to_string(), snippet: "换\n行".to_string() }];
        assert_eq!(to_json(&hits), r#"[{"title":"含\"引号","url":"https://a.com","snippet":"换\n行"}]"#);
        assert_eq!(to_json(&[]), "[]");
    }
}
