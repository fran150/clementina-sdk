import test from 'node:test';
import assert from 'node:assert/strict';
import {assertValid, diagnostic, result, schemaDiagnostics, ValidationError} from '@clementina/core';

const palette = {
  format: 'clementina-palette',
  version: 1,
  id: 'palette:main',
  name: 'Main',
  colors: [0x0000, 0xffff, 0xf800, 0x07e0, 0x001f, 0xffe0, 0xf81f, 0x07ff],
};

test('results retain warnings and values, but omit values when errors exist', () => {
  const warning = {...diagnostic('test.warning', '/name', 'Review name'), severity: 'warning'};
  const warnings = [warning];
  const success = result(palette, warnings);
  assert.deepEqual(success, {ok: true, value: palette, diagnostics: warnings});
  assert.equal(assertValid(success), palette);

  const error = diagnostic('test.error', '/colors', 'Invalid colors');
  const diagnostics = [warning, error];
  const failure = result(palette, diagnostics);
  assert.deepEqual(failure, {ok: false, diagnostics});
  assert.throws(() => assertValid(failure), thrown => {
    assert.ok(thrown instanceof ValidationError);
    assert.equal(thrown.name, 'ValidationError');
    assert.equal(thrown.message, '/name: Review name\n/colors: Invalid colors');
    assert.equal(thrown.diagnostics, diagnostics);
    return true;
  });
});

test('root diagnostics display a slash in ValidationError messages', () => {
  const entry = diagnostic('test.root', '', 'Invalid document');
  assert.deepEqual(entry, {severity: 'error', code: 'test.root', path: '', message: 'Invalid document'});
  assert.equal(new ValidationError([entry]).message, '/: Invalid document');
});

test('schema diagnostics report all errors without changing input or leaking earlier errors', () => {
  const invalid = {...palette, id: 12, colors: [0x10000], extra: true};
  const before = structuredClone(invalid);
  const errors = schemaDiagnostics('palette', invalid);
  assert.deepEqual(invalid, before);
  assert.ok(errors.some(entry => entry.code === 'schema.type' && entry.path === '/id'));
  assert.ok(errors.some(entry => entry.code === 'schema.minItems' && entry.path === '/colors'));
  assert.ok(errors.some(entry => entry.code === 'schema.maximum' && entry.path === '/colors/0'));
  assert.ok(errors.some(entry => entry.code === 'schema.additionalProperties'));
  assert.ok(errors.every(entry => entry.severity === 'error'));
  assert.deepEqual(schemaDiagnostics('palette', palette), []);
  assert.deepEqual(schemaDiagnostics('palette', null).map(entry => entry.path), ['']);
});
