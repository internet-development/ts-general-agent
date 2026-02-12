# Common

Shared utilities used across all layers (adapters, modules, local-tools). Everything here is pure infrastructure with no business logic and no external API calls.

It should be also where all global constants live so everything makes sense.

## Purpose

Common provides foundational utilities that any layer can import without creating dependency issues. If a utility is used by more than one layer, it belongs here.

## Design Rules

1. **No external API calls** — common never imports adapters or calls external services
2. **No business logic** — decisions about what to do belong in modules or local-tools
3. **Stateless** — no module-level mutable state
4. **Barrel export** — `index.ts` re-exports everything; consumers import from `@common/index.js`

## Adding to Common

1. Create `common/{name}.ts`
2. Add `export * from '@common/{name}.js'` to `index.ts`
3. Verify barrel export matches directory contents
