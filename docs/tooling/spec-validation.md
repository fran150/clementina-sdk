# Spec validation

Run:

```sh
npm run validate:specs
```

The dependency-free validator checks JSON readability and cross-spec invariants.
`npm test` also checks generated schema freshness and TypeScript conformance;
run `npm run generate:schemas` after changing a schema.
