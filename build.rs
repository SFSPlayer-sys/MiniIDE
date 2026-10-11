const ASSETS: [(&str, &str); 5] = [
    ("html.gz", "ui/index.html"),
    ("style.gz", "ui/style.css"),
    ("res.gz", "ui/res.js"),
    ("app.gz", "ui/app.js"),
    ("icon.gz", "ui/icon.rgba"),
];

#[cfg(windows)]
fn main() {
    let mut res = winres::WindowsResource::new();
    res.set_icon("ui/icon.ico");
    res.compile().unwrap();
    for (name, src) in ASSETS {
        compress(name, src);
        println!("cargo:rerun-if-changed={src}");
    }
    println!("cargo:rerun-if-changed=ui/icon.ico");
}
#[cfg(not(windows))]
fn main() {}

#[cfg(windows)]
fn compress(name: &str, src: &str) {
    use std::io::Write;
    let dir = std::env::var("OUT_DIR").unwrap();
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    enc.write_all(&std::fs::read(src).unwrap()).unwrap();
    std::fs::write(std::path::Path::new(&dir).join(name), enc.finish().unwrap()).unwrap();
}
