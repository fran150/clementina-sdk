# Spec validation

Run:

```sh
npm run validate:specs
```

The initial validator is dependency-free and checks JSON readability plus important
cross-spec invariants. Phase 2 should add full schema validation and generated types.
