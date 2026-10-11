//扩展名到highlight.js语言id，高亮在前端由hljs完成
const LANGS: &[(&str, &str)] = &[
    ("js", "javascript"),
    ("mjs", "javascript"),
    ("cjs", "javascript"),
    ("jsx", "javascript"),
    ("ts", "typescript"),
    ("tsx", "typescript"),
    ("mts", "typescript"),
    ("cts", "typescript"),
    ("vue", "xml"),
    ("svelte", "xml"),
    ("py", "python"),
    ("pyw", "python"),
    ("rb", "ruby"),
    ("php", "php"),
    ("java", "java"),
    ("kt", "kotlin"),
    ("kts", "kotlin"),
    ("scala", "scala"),
    ("groovy", "groovy"),
    ("gradle", "gradle"),
    ("c", "c"),
    ("h", "c"),
    ("cpp", "cpp"),
    ("cc", "cpp"),
    ("cxx", "cpp"),
    ("hpp", "cpp"),
    ("hh", "cpp"),
    ("hxx", "cpp"),
    ("inl", "cpp"),
    ("ipp", "cpp"),
    ("mm", "objectivec"),
    ("m", "objectivec"),
    ("cs", "csharp"),
    ("cshtml", "xml"),
    ("razor", "xml"),
    ("go", "go"),
    ("swift", "swift"),
    ("dart", "dart"),
    ("nim", "nim"),
    ("cr", "crystal"),
    ("d", "d"),
    ("v", "verilog"),
    ("lua", "lua"),
    ("sh", "bash"),
    ("bash", "bash"),
    ("zsh", "bash"),
    ("fish", "bash"),
    ("ps1", "powershell"),
    ("psm1", "powershell"),
    ("bat", "dos"),
    ("cmd", "dos"),
    ("vbs", "vbscript"),
    ("vb", "vbnet"),
    ("json", "json"),
    ("jsonc", "json"),
    ("yaml", "yaml"),
    ("yml", "yaml"),
    ("toml", "ini"),
    ("ini", "ini"),
    ("cfg", "ini"),
    ("conf", "ini"),
    ("md", "markdown"),
    ("markdown", "markdown"),
    ("rs", "rust"),
    ("txt", "plaintext"),
    ("log", "plaintext"),
    ("csv", "plaintext"),
    ("tsv", "plaintext"),
    ("rst", "plaintext"),
    ("gitignore", "plaintext"),
    ("dockerignore", "plaintext"),
    ("reg", "plaintext"),
    ("properties", "properties"),
    ("env", "properties"),
    ("sql", "sql"),
    ("proto", "protobuf"),
    ("thrift", "thrift"),
    ("graphql", "graphql"),
    ("gql", "graphql"),
    ("http", "http"),
    ("html", "xml"),
    ("htm", "xml"),
    ("xml", "xml"),
    ("svg", "xml"),
    ("xsl", "xml"),
    ("rss", "xml"),
    ("tex", "latex"),
    ("sty", "latex"),
    ("css", "css"),
    ("scss", "scss"),
    ("sass", "scss"),
    ("less", "less"),
    ("styl", "stylus"),
    ("hs", "haskell"),
    ("lhs", "haskell"),
    ("ml", "ocaml"),
    ("mli", "ocaml"),
    ("fs", "fsharp"),
    ("fsx", "fsharp"),
    ("fsi", "fsharp"),
    ("erl", "erlang"),
    ("hrl", "erlang"),
    ("ex", "elixir"),
    ("exs", "elixir"),
    ("elm", "elm"),
    ("clj", "clojure"),
    ("cljs", "clojure"),
    ("cljc", "clojure"),
    ("edn", "clojure"),
    ("lisp", "lisp"),
    ("el", "lisp"),
    ("scm", "scheme"),
    ("ss", "scheme"),
    ("rkt", "scheme"),
    ("jl", "julia"),
    ("r", "r"),
    ("pl", "perl"),
    ("pm", "perl"),
    ("coffee", "coffeescript"),
    ("pas", "delphi"),
    ("pp", "delphi"),
    ("dpr", "delphi"),
    ("f", "fortran"),
    ("f90", "fortran"),
    ("f95", "fortran"),
    ("f03", "fortran"),
    ("asm", "x86asm"),
    ("s", "x86asm"),
    ("sv", "verilog"),
    ("svh", "verilog"),
    ("vhd", "vhdl"),
    ("vhdl", "vhdl"),
    ("glsl", "glsl"),
    ("vert", "glsl"),
    ("frag", "glsl"),
    ("nix", "nix"),
    ("cmake", "cmake"),
    ("mk", "makefile"),
    ("makefile", "makefile"),
    ("dockerfile", "dockerfile"),
    ("containerfile", "dockerfile"),
    ("diff", "diff"),
    ("patch", "diff"),
];

//按扩展名或文件名取highlight.js语言id，未知返回空
pub fn lang_of(path: &str) -> &'static str {
    let name = path.rsplit(|c| c == '/' || c == '\\').next().unwrap_or("").to_ascii_lowercase();
    //无扩展名或扩展名有歧义的文件按文件名识别
    let ext = if name == "cmakelists.txt" || name == "cmakelists" {
        "cmake"
    } else {
        name.rsplit('.').next().unwrap_or("")
    };
    LANGS.iter().find(|(e, _)| *e == ext).map_or("", |(_, id)| *id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lang_of_扩展名() {
        assert_eq!(lang_of("a.rs"), "rust");
        assert_eq!(lang_of("a.toml"), "ini");
        assert_eq!(lang_of("a.md"), "markdown");
        assert_eq!(lang_of("a.py"), "python");
        assert_eq!(lang_of("a.css"), "css");
        assert_eq!(lang_of("a.unknownext"), "");
        assert_eq!(lang_of("a.CPP"), "cpp");
        assert_eq!(lang_of("a.cs"), "csharp");
        assert_eq!(lang_of("a.hs"), "haskell");
        assert_eq!(lang_of("a.lua"), "lua");
        assert_eq!(lang_of("Dockerfile"), "dockerfile");
        assert_eq!(lang_of("C:\\x\\CMakeLists.txt"), "cmake");
        assert_eq!(lang_of("C:\\x\\Makefile"), "makefile");
    }
}
