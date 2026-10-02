// Prepare an isolated browser benchmark of actual source from a fixed baseline and the
// working tree. Generated files and results stay in ignored output/tmp.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = path.resolve('output/tmp', process.argv[2] ?? 'performance');
fs.mkdirSync(root, { recursive: true });
for (const variant of ['before', 'after']) {
  const folder = path.join(root, variant);
  fs.mkdirSync(folder, { recursive: true });
  for (const file of fs.readdirSync('src')) {
    if (fs.statSync(path.join('src', file)).isFile()) fs.copyFileSync(path.join('src', file), path.join(folder, file));
  }
  if (variant === 'before') {
    for (const file of ['editor.ts', 'image-toolbar.ts', 'workspace-sidebar.ts']) {
      fs.writeFileSync(path.join(folder, file), execFileSync('git', ['show', `8a5416b493c8ad9306570e0c2fb940b7ea8e380f:src/${file}`]));
    }
  }
  const toolbar = path.join(folder, 'image-toolbar.ts');
  let source = fs.readFileSync(toolbar, 'utf8');
  source = source.replace(/(function syncImageAlignDom\([^\n]+\): void \{)/, '$1\n  const benchmarkStart = performance.now(); window.__scans++;');
  const start = source.indexOf('function syncImageAlignDom(');
  const end = source.indexOf('\nfunction imageBlockPosFromTarget', start);
  const body = source.slice(start, end).replace(/\n}\s*$/, '\n  window.__scanMs += performance.now() - benchmarkStart;\n}\n');
  source = source.slice(0, start) + body + source.slice(end);
  fs.writeFileSync(toolbar, source);

  const main = variant === 'before' ? execFileSync('git', ['show', '8a5416b493c8ad9306570e0c2fb940b7ea8e380f:src/main.ts'], { encoding: 'utf8' }) : fs.readFileSync('src/main.ts', 'utf8');
  const ast = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
  const names = ['fileReadable', 'restoreTabs', 'saveDoc'];
  const fragments = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
  const factory = `export function makeOperations(env) { const {secondaryWindow,settings,tabBar,isImagePath,invoke,readView,codeViewVisible,writeView,viewScrollTop,message,updateTitle,persistSoon,saveAs}=env; ${fragments}; return {restoreTabs,saveDoc}; }`;
  fs.writeFileSync(path.join(folder, 'operations.js'), ts.transpileModule(factory, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const regressions=process.argv[3]==='regressions';
fs.copyFileSync(`scripts/performance-${regressions?'regressions':'browser'}.js`, path.join(root, 'benchmark.js'));
const html=regressions
  ? fs.readFileSync('index.html','utf8').replace(/<script[^>]+src="\/src\/main.ts"[^>]*><\/script>/, '')
    .replace('<body>', '<body><div style="position:fixed;top:0;left:0;z-index:99;background:white"><button id="run">Run regressions</button><button id="preview">Image gestures</button><button id="nested">Nested modal</button><pre id="status">Ready</pre></div>')
    .replace('</body>', '<script type="module" src="./benchmark.js"></script></body>')
  : `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>PaperNest performance benchmark</title></head><body><button id="run">Run benchmark</button><pre id="status">Ready</pre><div id="tabs"></div><div id="editor" style="height:600px;overflow:auto"></div><script type="module" src="./benchmark.js"></script></body></html>`;
fs.writeFileSync(path.join(root, 'index.html'),html);
console.log(`Prepared ${path.relative(process.cwd(),root)}; open its index.html through Vite.`);
