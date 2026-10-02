/** Windows dialogs and Rust canonicalization can name the same file differently. */
export function tabPathKey(path: string): string {
  return path
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/, "")
    .replace(/[\\/]+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}
