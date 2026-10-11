use std::fs;
use std::path::{Path, PathBuf};

//跳过的目录
const SKIP: [&str; 7] = ["target", "node_modules", ".git", ".svn", ".idea", ".vscode", "dist"];
const MAX_HITS: usize = 500;
const MAX_DEPTH: usize = 12;
const MAX_LINE: usize = 4096;

pub struct Hit {
    pub path: String,
    pub line: usize,
    pub text: String,
}

//搜索工作区，正则语法只支持常用子集
pub fn search(root: &str, query: &str, use_re: bool, case: bool, word: bool) -> Result<Vec<Hit>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let re = if use_re { Some(Re::new(query, case)?) } else { None };
    let needle = if case { query.to_string() } else { query.to_lowercase() };

    //先把候选文件收集齐，再切块丢给多个线程扫，读盘和匹配都能并行
    let mut files = Vec::new();
    walk(Path::new(root), 0, &mut |p: &Path| {
        files.push(p.to_path_buf());
        true
    });
    let n = std::thread::available_parallelism().map(|v| v.get()).unwrap_or(4).clamp(1, 8);
    let per = files.len().div_ceil(n).max(1);
    let mut out: Vec<Vec<Hit>> = Vec::new();
    std::thread::scope(|sc| {
        let hs: Vec<_> = files
            .chunks(per)
            .map(|part| sc.spawn(|| scan_files(part, &re, &needle, case, word)))
            .collect();
        for h in hs {
            out.push(h.join().unwrap_or_default());
        }
    });
    let mut hits: Vec<Hit> = out.into_iter().flatten().collect();
    hits.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    hits.truncate(MAX_HITS);
    Ok(hits)
}

//扫一组文件，单块最多凑 MAX_HITS 条
fn scan_files(files: &[PathBuf], re: &Option<Re>, needle: &str, case: bool, word: bool) -> Vec<Hit> {
    let mut hits = Vec::new();
    for p in files {
        if hits.len() >= MAX_HITS {
            break;
        }
        let Ok(bytes) = fs::read(p) else { continue };
        if bytes.contains(&0) {
            continue;
        }
        let Ok(text) = String::from_utf8(bytes) else { continue };
        for (i, line) in text.lines().enumerate() {
            if line.len() > MAX_LINE {
                continue;
            }
            if !hit_line(line, re, needle, case, word) {
                continue;
            }
            hits.push(Hit {
                path: p.to_string_lossy().to_string(),
                line: i + 1,
                text: line.chars().take(200).collect(),
            });
            if hits.len() >= MAX_HITS {
                break;
            }
        }
    }
    hits
}

//整行是否命中，word 为真时要求匹配两侧都是非单词字符
fn hit_line(line: &str, re: &Option<Re>, needle: &str, case: bool, word: bool) -> bool {
    if !word {
        return match re {
            Some(r) => r.is_match(line),
            None => {
                if case {
                    line.contains(needle)
                } else {
                    ci_contains(line, needle)
                }
            }
        };
    }
    if let Some(r) = re {
        let cs: Vec<char> = if case {
            line.chars().collect()
        } else {
            line.to_lowercase().chars().collect()
        };
        return r.find(line).map(|(s, e)| boundary(&cs, s, e)).unwrap_or(false);
    }
    let cs: Vec<char> = if case {
        line.chars().collect()
    } else {
        //先做一次廉价判断，不命中的行不用建字符表
        if !ci_contains(line, needle) {
            return false;
        }
        line.to_lowercase().chars().collect()
    };
    let ns: Vec<char> = needle.chars().collect();
    let mut i = 0;
    while i + ns.len() <= cs.len() {
        if cs[i..i + ns.len()] == ns[..] && boundary(&cs, i, i + ns.len()) {
            return true;
        }
        i += 1;
    }
    false
}

//大小写不敏感的包含判断，needle 需为小写，全 ASCII 时按字节折叠比较，避免逐行分配小写副本
fn ci_contains(hay: &str, needle: &str) -> bool {
    if hay.contains(needle) {
        return true;
    }
    let n = needle.as_bytes();
    if n.is_empty() || n.len() > hay.len() {
        return false;
    }
    if !hay.is_ascii() || !needle.is_ascii() {
        return hay.to_lowercase().contains(needle);
    }
    let h = hay.as_bytes();
    for i in 0..=h.len() - n.len() {
        if h[i].to_ascii_lowercase() != n[0] {
            continue;
        }
        if (1..n.len()).all(|j| h[i + j].to_ascii_lowercase() == n[j]) {
            return true;
        }
    }
    false
}

fn boundary(cs: &[char], s: usize, e: usize) -> bool {
    let w = |c: char| c.is_alphanumeric() || c == '_';
    (s == 0 || !w(cs[s - 1])) && (e >= cs.len() || !w(cs[e]))
}

//递归遍历，返回false表示提前结束
pub(crate) fn walk(dir: &Path, depth: usize, f: &mut impl FnMut(&Path) -> bool) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        if ft.is_dir() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || SKIP.contains(&name.as_str()) {
                continue;
            }
            walk(&p, depth + 1, f);
        } else if ft.is_file() && !f(&p) {
            return;
        }
    }
}

enum Node {
    Ch(char),
    Any,
    Class { neg: bool, set: Vec<(char, char)> },
    Start,
    End,
    Alt(Vec<Vec<Node>>),
    Opt(Box<Node>),
    Star(Box<Node>),
    Plus(Box<Node>),
}

pub struct Re {
    alts: Vec<Vec<Node>>,
    case: bool,
}

impl Re {
    pub fn new(pat: &str, case: bool) -> Result<Re, String> {
        let cs: Vec<char> = pat.chars().collect();
        let mut p = P { c: &cs, i: 0, case };
        let alts = p.alts()?;
        if p.i < cs.len() {
            return Err("括号不匹配".into());
        }
        Ok(Re { alts, case })
    }

    pub fn is_match(&self, s: &str) -> bool {
        self.find(s).is_some()
    }

    //返回首个匹配的字符下标区间
    pub fn find(&self, s: &str) -> Option<(usize, usize)> {
        let cs: Vec<char> = if self.case {
            s.chars().collect()
        } else {
            s.to_lowercase().chars().collect()
        };
        for a in &self.alts {
            let head = a.first().and_then(|n| match n {
                Node::Ch(c) => Some(*c),
                _ => None,
            });
            for start in 0..=cs.len() {
                if let Some(c) = head {
                    if cs.get(start) != Some(&c) {
                        continue;
                    }
                }
                let mut out = Vec::new();
                m_seq(a, &cs, start, &mut out);
                //取最长的结束位置，贪婪量词的边界判断才准确
                if let Some(end) = out.iter().max() {
                    return Some((start, *end));
                }
            }
        }
        None
    }
}

//返回节点所有可能的结束位置
fn m(node: &Node, s: &[char], pos: usize, out: &mut Vec<usize>) {
    match node {
        Node::Ch(c) => {
            if s.get(pos) == Some(c) {
                out.push(pos + 1);
            }
        }
        Node::Any => {
            if pos < s.len() {
                out.push(pos + 1);
            }
        }
        Node::Class { neg, set } => {
            if let Some(c) = s.get(pos) {
                let inside = set.iter().any(|(a, b)| c >= a && c <= b);
                if inside != *neg {
                    out.push(pos + 1);
                }
            }
        }
        Node::Start => {
            if pos == 0 {
                out.push(0);
            }
        }
        Node::End => {
            if pos == s.len() {
                out.push(pos);
            }
        }
        Node::Alt(alts) => {
            for a in alts {
                m_seq(a, s, pos, out);
            }
        }
        Node::Opt(n) => {
            out.push(pos);
            m(n, s, pos, out);
        }
        Node::Star(n) => star(n, s, pos, out),
        Node::Plus(n) => {
            let mut first = Vec::new();
            m(n, s, pos, &mut first);
            for p in first {
                star(n, s, p, out);
            }
        }
    }
}

//贪婪重复，按位置集合去重避免零宽死循环
fn star(n: &Node, s: &[char], start: usize, out: &mut Vec<usize>) {
    let mut seen = vec![start];
    out.push(start);
    let mut i = 0;
    while i < seen.len() {
        let p = seen[i];
        let mut nx = Vec::new();
        m(n, s, p, &mut nx);
        for q in nx {
            if !seen.contains(&q) {
                seen.push(q);
                out.push(q);
            }
        }
        i += 1;
    }
}

fn m_seq(seq: &[Node], s: &[char], pos: usize, out: &mut Vec<usize>) {
    let mut cur = vec![pos];
    for n in seq {
        let mut next = Vec::new();
        for p in &cur {
            m(n, s, *p, &mut next);
        }
        next.sort_unstable();
        next.dedup();
        if next.is_empty() {
            return;
        }
        cur = next;
    }
    out.extend(cur);
}

struct P<'a> {
    c: &'a [char],
    i: usize,
    case: bool,
}

impl P<'_> {
    fn peek(&self) -> Option<char> {
        self.c.get(self.i).copied()
    }

    fn next(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.i += 1;
        }
        c
    }

    fn lit(&self, c: char) -> char {
        if self.case {
            c
        } else {
            low(c)
        }
    }

    fn alts(&mut self) -> Result<Vec<Vec<Node>>, String> {
        let mut res = vec![self.seq()?];
        while self.peek() == Some('|') {
            self.i += 1;
            res.push(self.seq()?);
        }
        Ok(res)
    }

    fn seq(&mut self) -> Result<Vec<Node>, String> {
        let mut out = Vec::new();
        while let Some(ch) = self.peek() {
            if ch == '|' || ch == ')' {
                break;
            }
            out.push(self.atom()?);
        }
        Ok(out)
    }

    fn atom(&mut self) -> Result<Node, String> {
        let mut n = self.prim()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.i += 1;
                    n = Node::Star(Box::new(n));
                }
                Some('+') => {
                    self.i += 1;
                    n = Node::Plus(Box::new(n));
                }
                Some('?') => {
                    self.i += 1;
                    n = Node::Opt(Box::new(n));
                }
                _ => return Ok(n),
            }
        }
    }

    fn prim(&mut self) -> Result<Node, String> {
        let ch = match self.next() {
            Some(c) => c,
            None => return Ok(Node::Ch('\0')),
        };
        Ok(match ch {
            '.' => Node::Any,
            '^' => Node::Start,
            '$' => Node::End,
            '(' => {
                let sub = self.alts()?;
                if self.peek() == Some(')') {
                    self.i += 1;
                }
                Node::Alt(sub)
            }
            '[' => self.class()?,
            '\\' => self.esc()?,
            c => Node::Ch(self.lit(c)),
        })
    }

    fn esc(&mut self) -> Result<Node, String> {
        let c = self.next().unwrap_or('\\');
        let mut set = Vec::new();
        if !push_escape(c, &mut set, self.case) {
            return Err(format!("暂不支持 \\{c}"));
        }
        Ok(Node::Class { neg: false, set })
    }

    fn class(&mut self) -> Result<Node, String> {
        let neg = self.peek() == Some('^');
        if neg {
            self.i += 1;
        }
        let mut set = Vec::new();
        while let Some(c) = self.next() {
            if c == ']' {
                return Ok(Node::Class { neg, set });
            }
            if c == '\\' {
                let e = self.next().unwrap_or('\\');
                let mut one = Vec::new();
                if !push_escape(e, &mut one, self.case) {
                    return Err(format!("暂不支持 \\{e}"));
                }
                set.extend(one);
                continue;
            }
            let lo = self.lit(c);
            if self.peek() == Some('-') && self.c.get(self.i + 1).copied() != Some(']') {
                self.i += 1;
                let hc = self.next().unwrap_or(' ');
                let hi = if hc == '\\' { self.next().unwrap_or(' ') } else { hc };
                set.push((lo, self.lit(hi)));
            } else {
                set.push((lo, lo));
            }
        }
        Err("字符类缺少 ]".into())
    }
}

//转义序列展开为字符范围
fn push_escape(c: char, set: &mut Vec<(char, char)>, case: bool) -> bool {
    match c {
        'd' => set.push(('0', '9')),
        'w' => {
            set.push(('0', '9'));
            set.push(('a', 'z'));
            if case {
                set.push(('A', 'Z'));
            }
            set.push(('_', '_'));
        }
        's' => {
            set.push((' ', ' '));
            set.push(('\t', '\t'));
            set.push(('\r', '\r'));
            set.push(('\n', '\n'));
        }
        'D' | 'W' | 'S' => return false,
        c => set.push((if case { c } else { low(c) }, if case { c } else { low(c) })),
    }
    true
}

fn low(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(pat: &str, s: &str) -> bool {
        Re::new(pat, true).unwrap().is_match(s)
    }

    #[test]
    fn 工作区关键词搜索() {
        assert!(search(".", "", false, true, false).unwrap().is_empty());
        let hs = search("./src", "fn ", false, true, false).unwrap();
        assert!(hs.iter().any(|h| h.path.ends_with("main.rs")));
    }

    #[test]
    fn 全词匹配() {
        let line = "let foo = foobar + _foo;";
        assert!(hit_line(line, &None, "foo", true, true));
        assert!(hit_line("foo", &None, "foo", true, true));
        assert!(hit_line("a foo b", &None, "foo", true, true));
        assert!(!hit_line("foobar", &None, "foo", true, true));
        assert!(!hit_line("_foo", &None, "foo", true, true));
        //大小写不敏感时先转小写再比边界
        assert!(hit_line("A FOO B", &None, "foo", false, true));
        assert!(!hit_line("A FOOBAR", &None, "foo", false, true));
        //正则同样受全词约束
        let r = Some(Re::new("fo+", true).unwrap());
        assert!(hit_line("a foo b", &r, "", true, true));
        assert!(!hit_line("afoob", &r, "", true, true));
    }

    #[test]
    fn 正则字面量() {
        assert!(hit("fn", "pub fn main() {"));
        assert!(!hit("fn", "let x2"));
        assert!(hit("^fn", "fn main"));
        assert!(!hit("^fn", " pub fn"));
        assert!(hit("main$", "pub fn main"));
    }

    #[test]
    fn 正则量词与字符类() {
        assert!(hit("a*b", "aaab"));
        assert!(hit("a+b", "ab"));
        assert!(!hit("a+b", "b"));
        assert!(hit("a?b", "b"));
        assert!(hit("f\\w+\\(", "fn foo("));
        assert!(hit("[0-9]+", "x12"));
        assert!(!hit("[^0-9]+", "12"));
        assert!(hit("\\s", "a b"));
    }

    #[test]
    fn 正则分组与或() {
        assert!(hit("(foo|bar)baz", "barbaz"));
        assert!(hit("(a|b)+c", "abbac"));
        assert!(!hit("(foo|bar)baz", "foobat"));
        assert!(hit("a.c", "abc"));
        assert!(!hit("a.c", "ac"));
    }

    #[test]
    fn 大小写不敏感() {
        assert!(Re::new("FN", false).unwrap().is_match("pub fn main"));
        assert!(!Re::new("FN", true).unwrap().is_match("pub fn main"));
    }

    #[test]
    fn 不支持语法报错() {
        assert!(Re::new("\\D", true).is_err());
        assert!(Re::new("[abc", true).is_err());
    }
}
