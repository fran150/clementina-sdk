import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const extension = new URL('../packages/vscode-extension/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', extension), 'utf8'));
const contributes = manifest.contributes;

test('the extension contributes a Clementina assembly language for .s and .inc', () => {
  const language = contributes.languages.find(entry => entry.id === 'clementina-asm');
  assert.deepEqual(language.extensions, ['.s', '.inc']);
  JSON.parse(readFileSync(new URL(language.configuration, extension), 'utf8'));
  const grammar = contributes.grammars.find(entry => entry.language === 'clementina-asm');
  assert.equal(JSON.parse(readFileSync(new URL(grammar.path, extension), 'utf8')).scopeName, grammar.scopeName);
  for (const file of [language.configuration, grammar.path]) {
    assert.ok(manifest.files.some(entry => file.replace(/^\.\//u, '').startsWith(entry)), `${file} is packaged`);
  }
});

test('assembly and BASIC sources accept gutter breakpoints for the Clementina debugger', () => {
  const languages = contributes.breakpoints.map(entry => entry.language);
  assert.deepEqual(languages.sort(), ['clementina-asm', 'clementina-basic']);
  const debuggerEntry = contributes.debuggers.find(entry => entry.type === 'clementina');
  assert.deepEqual([...debuggerEntry.languages].sort(), ['clementina-asm', 'clementina-basic']);
});

test('the assembly grammar names every public library macro', () => {
  const library = readFileSync(new URL('../packages/lib/asm/clementina-lib.inc', import.meta.url), 'utf8');
  const grammar = JSON.parse(readFileSync(new URL('syntaxes/clementina-asm.tmLanguage.json', extension), 'utf8'));
  const macroPattern = new RegExp(grammar.repository.clementina.patterns.find(entry => entry.name.startsWith('support.function.macro')).match, 'u');
  const macros = [...library.matchAll(/^\s*\.macro\s+(\w+)/gmu)].map(match => match[1]);
  for (const name of macros) assert.equal(macroPattern.test(name), !name.startsWith('cl__'), name);
});
