# BitSentry plugin SDK

`@bitsentry/plugin-sdk` holds the TypeScript types and Zod schemas that every BitSentry plugin compiles against. BitSentry Desktop owns plugin discovery, installation, credential storage, execution and UI. This package only defines the boundary between the two.

Every first-party plugin repository depends on it, and third-party plugins can too. A change here is a change to a public contract.

## What we never compromise on

### 1. Contract stability

Plugins built against an older SDK must keep loading in newer hosts, and a newer host must not break older plugins. New host-supplied context is optional (see `DesktopPluginOperationContext`). New descriptor fields are optional or defaulted. Removing or renaming an export, tightening a schema, or changing a result shape is a breaking change.

### 2. Secrets stay out of persisted state

Credentials belong in auth fields. The persistence schema rejects secret configuration fields on purpose, and `PluginPersistenceError` never carries plugin exceptions or configuration values. Keep it that way.

### 3. Small on purpose

The SDK has no runtime besides `zod` and does no I/O. It does not import from the desktop app. If a feature needs host behavior, the host implements it and the SDK only describes the shape.

## How to work

Make the smallest change that lets plugins and hosts agree. Prefer adding an optional field over adding a new concept. Measure twice, cut once, and YAGNI.

These are good defaults, not hard rules. The developer's instructions override anything here.

## A small glossary

- **host** means the BitSentry app that loads and runs plugins.
- **plugin** means a code plugin: a descriptor plus `actions[]` with `execute` handlers.
- **descriptor** means the plugin's id, name, version, description, type, auth and metadata.
- **action** means one operation a plugin exposes, with declared `fields` and a `riskLevel` of `read` or `write`.
- **data source** means the only plugin `type` today, with optional setup fields, OAuth and auth hooks.
- **persistence contract** means the optional, versioned description of a plugin's saved connection configuration and resources.

## The ways to hurt yourself

1. **Silent breaking changes.** Before you change an exported schema or type, check what the plugins and the host send and expect. If it breaks old plugins or old hosts, it needs a major version (after `1.0.0`) or an explicit upgrade path (before).
2. **Letting secrets into config or errors.** Never weaken the secret, reserved-key or uniqueness checks in the persistence schema, and never put configuration values or plugin exception text into errors.
3. **Shipping without a version bump.** Plugins pin the published version. A contract change that is not released does not reach anyone.

## Verifying

CI runs these in order. Run them before you push:

```sh
pnpm install --frozen-lockfile
pnpm run format
pnpm run lint
pnpm test
pnpm run build
pnpm pack --dry-run
pnpm knip
```

- Contract changes ship with tests in `src/index.spec.ts` or `src/persistence.spec.ts`: one that the new shape is accepted, and one that old payloads still parse.
- `pnpm run format:fix` and `pnpm run lint:fix` fix most style failures.

## Releasing

Pushing a `v*` tag runs the full check, packs the tarball and publishes a GitHub release. Bump `version` in `package.json` in the same PR as the contract change.

## Pull requests

- Never open a PR unless the developer asks.
- Branch from the latest `origin/main`.
- Titles and every commit subject are conventional commits in lowercase: `fix(sdk): accept plain configuration objects`. `change-guardrails.yml` rejects anything else.
- Body: `## Problem`, `## Change`, `## Tests`. Say whether the change is breaking for plugins or hosts.
- Do not add `Co-Authored-By` lines or AI attribution footers.

## Where code lives

- `src/index.ts`: descriptor, field, action, auth, data-source, execution and install schemas and types.
- `src/persistence.ts`: the persistence contract helpers and `PluginPersistenceError`.
- `src/*.spec.ts`: Vitest tests beside the code they cover.
- `scripts/eslint/`: the TypeScript 6 lint bridge used by `pnpm run lint`.

## Taste

- Schemas are the source of truth. Derive types with `z.infer`; do not hand-write a parallel type.
- Validate at the boundary and fail with a specific message.
- Comments say why: a compatibility constraint or an invariant the schema cannot show.
- Plain language in error messages. No em-dashes.
