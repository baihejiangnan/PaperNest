fn main() {
    // ShellNew MenuText/ItemName require an indirect string resource. Plain
    // strings are ignored by Explorer, so keep these in the executable.
    let windows = tauri_build::WindowsAttributes::new().append_rc_content(
        r#"
#pragma code_page(65001)
LANGUAGE 0x09, 0x01
STRINGTABLE
BEGIN
42001 "MD File"
END
LANGUAGE 0x04, 0x02
STRINGTABLE
BEGIN
42001 "MD 文件"
END
LANGUAGE 0x07, 0x01
STRINGTABLE
BEGIN
42001 "MD-Datei"
END
LANGUAGE 0x11, 0x01
STRINGTABLE
BEGIN
42001 "MD ファイル"
END
"#,
    );
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("could not build Tauri resources");
}
