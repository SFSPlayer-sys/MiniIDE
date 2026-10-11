use std::fs;
use std::path::Path;

pub struct Entry {
    pub name: String,
    pub path: String,
    pub dir: bool,
}

//列出单层目录，目录优先
pub fn read_dir(dir: &str) -> Vec<Entry> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<Entry> = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let link = entry.file_type().map(|t| t.is_symlink()).unwrap_or(false);
        if link {
            continue;
        }
        let path = entry.path();
        out.push(Entry {
            name: entry.file_name().to_string_lossy().to_string(),
            dir: path.is_dir(),
            path: path.to_string_lossy().to_string(),
        });
    }
    out.sort_by_key(|e| (!e.dir, e.name.to_lowercase()));
    out
}

//取路径最后一段
pub fn name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}
