//! Standalone HTML export. Markdown -> GFM HTML (comrak) wrapped in a
//! self-contained page: all CSS/JS/fonts are embedded, no network needed.
//! KaTeX renders `$...$` / `$$...$$` on load; highlight.js colours code blocks.

use comrak::{markdown_to_html, Options};

use crate::assets;

const TEMPLATE: &str = include_str!("../assets/export/template.html");
const DOC_CSS: &str = include_str!("../assets/export/doc.css");
const KATEX_CSS: &str = include_str!("../assets/export/katex.min.css");
const HLJS_CSS: &str = include_str!("../assets/export/hljs.css");
const KATEX_JS: &str = include_str!("../assets/export/katex.min.js");
const AUTO_RENDER_JS: &str = include_str!("../assets/export/auto-render.min.js");
const HLJS_JS: &str = include_str!("../assets/export/highlight.min.js");

fn markdown_options() -> Options<'static> {
    let mut opts = Options::default();
    opts.extension.table = true;
    opts.extension.strikethrough = true;
    opts.extension.tasklist = true;
    opts.extension.autolink = true;
    opts.extension.footnotes = true;
    opts.extension.superscript = true;
    opts.extension.math_dollars = true;
    // Raw HTML is kept so documents using <details>, <kbd>, sized <img> etc.
    // export faithfully; `sanitize` then removes anything executable.
    opts.render.r#unsafe = true;
    opts.render.github_pre_lang = true;
    opts
}

/// Strip scripts, event handlers, `javascript:` URLs and other active content
/// from the rendered body. Documents may come from anyone, and the export is
/// opened in a browser or printed inside the app.
fn sanitize(html: &str) -> String {
    ammonia::Builder::default()
        .add_tags(["input", "section"])
        .add_tag_attributes("input", ["type", "checked", "disabled"])
        .add_tag_attributes("img", ["data-align"])
        .add_tag_attributes("pre", ["lang"])
        .add_generic_attributes([
            "class",
            "id",
            "data-math-style",
            "data-footnotes",
            "data-footnote-ref",
            "data-footnote-backref",
        ])
        .link_rel(None)
        .clean(html)
        .to_string()
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Render `markdown` to a complete HTML document titled `title`.
/// `doc_path`, when given, is the base for resolving relative image paths —
/// they are read and inlined as `data:` URLs so the output stands alone
/// (needed for HTML export and printing).
///
/// `for_print` omits the embedded scripts: the print view runs in a sandboxed
/// frame where scripts are disabled, and the app renders math and code
/// highlighting into it from outside.
pub fn render_html(markdown: &str, title: &str, doc_path: Option<&str>, for_print: bool) -> String {
    let body = inline_images(&sanitize(&markdown_to_html(markdown, &markdown_options())), doc_path);
    let template = if for_print {
        let (head, _scripts) = TEMPLATE
            .split_once("<script>")
            .expect("export template has scripts");
        format!("{head}</body>\n</html>\n")
    } else {
        TEMPLATE.to_string()
    };

    template
        .replace("{{TITLE}}", &escape_html(title))
        .replace("{{DOC_CSS}}", DOC_CSS)
        .replace("{{KATEX_CSS}}", KATEX_CSS)
        .replace("{{HLJS_CSS}}", HLJS_CSS)
        .replace("{{KATEX_JS}}", KATEX_JS)
        .replace("{{AUTO_RENDER_JS}}", AUTO_RENDER_JS)
        .replace("{{HLJS_JS}}", HLJS_JS)
        .replace("{{BODY}}", &body)
}

/// Rewrite every `<img src="…">` whose target is a local path to a `data:` URL.
/// comrak emits one double-quoted `src` per `<img>`; raw HTML `<img>` passed
/// through by `render.unsafe` is handled the same way. On failure (missing file,
/// too large) the original tag is kept.
fn inline_images(html: &str, doc_path: Option<&str>) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(pos) = rest.find("<img ") {
        out.push_str(&rest[..pos]);
        rest = &rest[pos..];
        let tag_end = rest.find('>').map(|i| i + 1).unwrap_or(rest.len());
        out.push_str(&rewrite_src(&rest[..tag_end], doc_path));
        rest = &rest[tag_end..];
    }
    out.push_str(rest);
    out
}

fn rewrite_src(tag: &str, doc_path: Option<&str>) -> String {
    const KEY: &str = "src=\"";
    let Some(s) = tag.find(KEY).map(|i| i + KEY.len()) else {
        return tag.to_string();
    };
    let Some(e) = tag[s..].find('"').map(|i| i + s) else {
        return tag.to_string();
    };
    let src = tag[s..e].replace("&amp;", "&");
    if assets::is_external(&src) {
        return tag.to_string();
    }
    match assets::to_data_url(doc_path, &src) {
        Ok(data) => format!("{}{}{}", &tag[..s], data, &tag[e..]),
        Err(_) => tag.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_basic_markdown() {
        let out = render_html("# Hello\n\n- a\n- b\n", "Doc", None, false);
        assert!(out.contains("<h1>Hello</h1>"));
        assert!(out.contains("<title>Doc</title>"));
        assert!(out.contains("data:font/woff2;base64"));
    }

    #[test]
    fn keeps_math_delimiters_for_katex() {
        let out = render_html("Euler: $e^{i\\pi}+1=0$\n", "Doc", None, false);
        assert!(out.contains("renderMathInElement"));
    }

    #[test]
    fn print_variant_has_no_scripts() {
        let out = render_html("Euler: $e^{i\\pi}+1=0$\n", "Doc", None, true);
        assert!(!out.contains("<script"));
        assert!(out.contains("Euler"));
        assert!(out.contains("data:font/woff2;base64"));
        assert!(out.trim_end().ends_with("</html>"));
    }

    #[test]
    fn active_content_is_removed_and_markup_kept() {
        let md = concat!(
            "<script>alert(1)</script>\n\n",
            "<img src=\"https://example.com/x.png\" onerror=\"alert(2)\" width=\"40\">\n\n",
            "[bad](javascript:alert(3)) <a href=\"javascript:alert(4)\">raw</a>\n\n",
            "<iframe src=\"https://example.com\"></iframe>\n\n",
            "<details><summary>More</summary><kbd>Ctrl</kbd></details>\n\n",
            "- [x] done\n\n",
            "Note[^1]\n\n[^1]: Footnote.\n\n",
            "```rust\nfn main() {}\n```\n",
        );
        let out = render_html(md, "t", None, false);
        let body = &out[out.find("<article").unwrap()..out.find("</article>").unwrap()];

        for banned in ["<script", "onerror", "javascript:", "<iframe", "alert(1)"] {
            assert!(!body.contains(banned), "{banned} survived: {body}");
        }
        for kept in [
            "width=\"40\"",
            "<details>",
            "<summary>More</summary>",
            "<kbd>Ctrl</kbd>",
            "type=\"checkbox\"",
            "checked",
            "href=\"#fn-1\"",
            "id=\"fn-1\"",
            "<section class=\"footnotes\"",
            "<pre lang=\"rust\">",
        ] {
            assert!(body.contains(kept), "{kept} missing: {body}");
        }
    }

    #[test]
    fn table_extension_active() {
        let md = "| a | b |\n|---|---|\n| 1 | 2 |\n";
        assert!(render_html(md, "t", None, false).contains("<table>"));
    }

    #[test]
    fn inlines_a_local_image_and_leaves_remote_ones() {
        let dir = std::env::temp_dir().join("mdmeow-export-test");
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("pic.png");
        std::fs::write(&img, b"\x89PNG\r\n\x1a\n").unwrap();
        let doc = dir.join("doc.md");

        let md = "![local](pic.png)\n\n![remote](https://example.com/x.png)\n";
        let out = render_html(md, "t", doc.to_str(), false);

        assert!(out.contains("src=\"data:image/png;base64,"));
        assert!(out.contains("src=\"https://example.com/x.png\""));
        assert!(!out.contains("src=\"pic.png\""));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
