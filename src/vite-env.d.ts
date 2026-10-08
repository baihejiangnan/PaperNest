/// <reference types="vite/client" />

declare module "*.css?inline" {
  const css: string;
  export default css;
}

// KaTeX ships no typings; only what the print view uses is declared.
declare module "katex" {
  const katex: {
    renderToString(tex: string, options?: { displayMode?: boolean; throwOnError?: boolean }): string;
  };
  export default katex;
}
