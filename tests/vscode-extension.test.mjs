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

test('assembly sources get the bundled Clementina assembly language server and its settings', () => {
  assert.ok(manifest.activationEvents.includes('onLanguage:clementina-asm'));
  assert.ok(manifest.files.includes('dist/asm-lsp.mjs'));
  assert.equal(manifest.devDependencies['@clementina/asm-lsp'], manifest.version);
  const properties = contributes.configuration.properties;
  assert.deepEqual(properties['clementina.assembly.diagnostics'].enum, ['onType', 'onSave', 'off']);
  assert.equal(properties['clementina.assembly.ca65Path'].type, 'string');
  const source = readFileSync(new URL('src/extension.ts', extension), 'utf8');
  assert.match(source, /serverPath\('asm-lsp'\)/u);
  assert.match(source, /language: 'clementina-asm'/u);
  assert.match(readFileSync(new URL('scripts/bundle.mjs', extension), 'utf8'), /'asm-lsp': bin\('@clementina\/asm-lsp', 'clementina-asm-lsp\.mjs'\)/u);
});
