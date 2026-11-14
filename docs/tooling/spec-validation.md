# Spec validation

Run:

```sh
npm run validate:specs
```

The dependency-free validator checks JSON readability and cross-spec invariants.
`npm test` also checks generated schema freshness and TypeScript conformance;
run `npm run generate:schemas` after changing a schema,
`npm run generate:basic-keywords` after changing the keyword entries in
`specs/basic.json`, and `npm run generate:basic-charset` after changing the
default charset, text palette or glyph modes in `specs/video.json` or the console
control codes in `specs/kernel-abi.json`.
