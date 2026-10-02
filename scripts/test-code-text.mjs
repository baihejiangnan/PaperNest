import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { EditorState } from '@codemirror/state';

const source = await readFile(new URL('../src/code-text.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { serializeCodeText } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

for (const original of ['a\r\nb\r\n', 'a\nb\n', 'a\rb\r', 'a\r\nb\nc\r', '', '中文']) {
  const state = EditorState.create({ doc: original });
  assert.equal(serializeCodeText(state.doc, state.doc, original), original, 'untouched text must remain exact');
  const changed = state.update({ changes: { from: 0, insert: 'edited\n' } }).state;
  const separator = original.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  assert.equal(serializeCodeText(changed.doc, state.doc, original), `edited${separator}${state.doc.sliceString(0, state.doc.length, separator)}`);
  const undone = changed.update({ changes: { from: 0, to: 7 } }).state;
  assert.equal(serializeCodeText(undone.doc, state.doc, original), original, 'undo must restore the exact clean baseline');
}
console.log('PASS: CRLF, LF, CR, mixed endings, empty and Unicode text; edit and undo round trips.');
