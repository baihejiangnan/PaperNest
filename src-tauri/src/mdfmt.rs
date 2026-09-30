//! Pretty-print GFM tables in a Markdown string: trim cells, pad every column
//! to a common width, keep per-column alignment. Everything else is untouched.

#[derive(Clone, Copy, PartialEq)]
enum Align {
    None,
    Left,
    Right,
    Center,
}

/// Reformat every GFM table found in `md`.
pub fn format_tables(md: &str) -> String {
    let lines: Vec<&str> = md.split('\n').collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut i = 0;

    while i < lines.len() {
        if i + 1 < lines.len()
            && looks_like_row(lines[i])
            && is_delimiter_row(lines[i + 1])
        {
            let start = i;
            let mut end = i + 2;
            while end < lines.len() && looks_like_row(lines[end]) {
                end += 1;
            }
            let block = &lines[start..end];
            out.extend(format_block(block));
            i = end;
        } else {
            out.push(lines[i].to_string());
            i += 1;
        }
    }

    out.join("\n")
}

fn looks_like_row(line: &str) -> bool {
    let t = line.trim();
    !t.is_empty() && t.contains('|') && !t.starts_with("```")
}

fn is_delimiter_row(line: &str) -> bool {
    let cells = split_row(line);
    if cells.is_empty() {
        return false;
    }
    cells.iter().all(|c| {
        let c = c.trim();
        let inner = c.trim_start_matches(':').trim_end_matches(':');
        !inner.is_empty() && inner.chars().all(|ch| ch == '-')
    })
}

/// Split a table row into raw (untrimmed) cell strings, honouring escaped pipes
/// and dropping the empty leading/trailing cell created by a bordering `|`.
fn split_row(line: &str) -> Vec<String> {
    let t = line.trim();
    let mut cells = Vec::new();
    let mut cur = String::new();
    let mut chars = t.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => {
                cur.push('\\');
                if let Some(&next) = chars.peek() {
                    cur.push(next);
                    chars.next();
                }
            }
            '|' => {
                cells.push(cur.clone());
                cur.clear();
            }
            _ => cur.push(ch),
        }
    }
    cells.push(cur);

    if cells.first().map(|s| s.trim().is_empty()).unwrap_or(false) {
        cells.remove(0);
    }
    if cells.len() > 1 && cells.last().map(|s| s.trim().is_empty()).unwrap_or(false) {
        cells.pop();
    }
    cells
}

fn parse_align(cell: &str) -> Align {
    let c = cell.trim();
    let left = c.starts_with(':');
    let right = c.ends_with(':');
    match (left, right) {
        (true, true) => Align::Center,
        (true, false) => Align::Left,
        (false, true) => Align::Right,
        (false, false) => Align::None,
    }
}

fn width(s: &str) -> usize {
    s.chars().count()
}

fn pad(cell: &str, w: usize, align: Align) -> String {
    let len = width(cell);
    if len >= w {
        return cell.to_string();
    }
    let extra = w - len;
    match align {
        Align::Right => format!("{}{}", " ".repeat(extra), cell),
        Align::Center => {
            let l = extra / 2;
            let r = extra - l;
            format!("{}{}{}", " ".repeat(l), cell, " ".repeat(r))
        }
        _ => format!("{}{}", cell, " ".repeat(extra)),
    }
}

fn delimiter(w: usize, align: Align) -> String {
    let w = w.max(3);
    match align {
        Align::None => "-".repeat(w),
        Align::Left => format!(":{}", "-".repeat(w - 1)),
        Align::Right => format!("{}:", "-".repeat(w - 1)),
        Align::Center => format!(":{}:", "-".repeat(w - 2)),
    }
}

fn format_block(block: &[&str]) -> Vec<String> {
    let header = split_row(block[0]);
    let delim = split_row(block[1]);
    let body: Vec<Vec<String>> = block[2..].iter().map(|l| split_row(l)).collect();

    let cols = header
        .len()
        .max(delim.len())
        .max(body.iter().map(|r| r.len()).max().unwrap_or(0));

    let aligns: Vec<Align> = (0..cols)
        .map(|c| delim.get(c).map(|s| parse_align(s)).unwrap_or(Align::None))
        .collect();

    let cell = |row: &[String], c: usize| row.get(c).map(|s| s.trim()).unwrap_or("").to_string();

    let mut widths = vec![3usize; cols];
    for c in 0..cols {
        widths[c] = widths[c].max(width(&cell(&header, c)));
        for row in &body {
            widths[c] = widths[c].max(width(&cell(row, c)));
        }
    }

    let render_row = |row: &[String]| -> String {
        let mut s = String::from("|");
        for c in 0..cols {
            s.push(' ');
            s.push_str(&pad(&cell(row, c), widths[c], aligns[c]));
            s.push_str(" |");
        }
        s
    };

    let mut out = Vec::with_capacity(block.len());
    out.push(render_row(&header));
    let mut d = String::from("|");
    for c in 0..cols {
        d.push(' ');
        d.push_str(&delimiter(widths[c], aligns[c]));
        d.push_str(" |");
    }
    out.push(d);
    for row in &body {
        out.push(render_row(row));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aligns_a_messy_table() {
        let input = "| a |bb|\n|:-|--:|\n|1|2222|\n";
        let want = "| a   |   bb |\n| :-- | ---: |\n| 1   | 2222 |\n";
        assert_eq!(format_tables(input), want);
    }

    #[test]
    fn leaves_prose_untouched() {
        let md = "# Title\n\nSome text with a | pipe.\n\nMore.";
        assert_eq!(format_tables(md), md);
    }

    #[test]
    fn keeps_surrounding_content() {
        let md = "before\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nafter";
        let out = format_tables(md);
        assert!(out.starts_with("before\n\n|"));
        assert!(out.ends_with("\n\nafter"));
        assert!(out.contains("| x   | y   |"));
        assert!(out.contains("| --- | --- |"));
    }

    #[test]
    fn handles_escaped_pipe() {
        let input = "| a | b |\n|---|---|\n| x \\| y | z |\n";
        let out = format_tables(input);
        assert!(out.contains("x \\| y"));
    }
}
