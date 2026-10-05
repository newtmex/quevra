# Quevra

## Layout

- `apps/` — user-facing applications
- `services/` — backend services
- `packages/` — protocol and shared packages, including Solidity contracts
- `tooling/` — workspace-level development and operations tooling

Follow these directory patterns. Do not add new top-level directories without a strong architectural reason.

Git submodules:

- `packages/contracts` — https://github.com/newtmex/quevra-contracts
- `services/solonet` — https://github.com/monad-crypto/monad-solonet

Clone this repository with `--recurse-submodules`, or run `git submodule update --init --recursive` after a plain clone.

`apps/dapp` and `services/server` are self-contained workspace packages so they can later become Git submodules without moving them. Depend on other workspace packages by name with the `workspace:` protocol, not by relative file path.

## Package manager

Use pnpm only. Do not introduce npm, Yarn, Bun, or extra monorepo orchestrators unless explicitly asked.

Workspace members live in `pnpm-workspace.yaml`. There is a single root `pnpm-lock.yaml`. Internal dependencies use `workspace:`.

## Scripts

Root scripts orchestrate packages; they must not duplicate package implementation.

| Script | Root command |
| --- | --- |
| `dev` | `pnpm --recursive --parallel --stream run dev` |
| `build` | `pnpm --recursive run build` |
| `test` | `pnpm --recursive run test` |
| `typecheck` | `pnpm --recursive run typecheck` |
| `check` | `pnpm --recursive run check` |

Target a subset with pnpm filtering, for example `pnpm --filter @quevra/dapp test`.

## Before finishing

Run `pnpm check` from the repository root and ensure it succeeds.

Always use elevated access rpc dependent tasks

## Solidity contract organization

- Keep each contract focused on one responsibility. Put shared behavior in a library, interface, or abstract base contract instead of growing a controller with unrelated logic.
- Order Solidity files as: license and pragma, imports, contract documentation, inheritance and `using` declarations, storage, constructor, modifiers, external/public API, internal mechanics, private helpers, and receive/fallback handlers.
- Within a contract, organize functions by visibility and purpose: external state-changing entrypoints first, then external/public view functions, then internal state transitions, then internal accounting helpers, and private helpers last. Keep `receive` and `fallback` handlers in their own final section.
- Do not interleave view functions with mutating functions. A view should be placed in the read API section even when it supports an internal mutating path.
- Group related functions with clear section comments. Keep read-only views near the public API they describe, and keep state-changing entrypoints before their internal implementation helpers.
- Keep protocol-facing types, errors, and events in interfaces when they are part of the external contract; keep implementation-only errors and events in the implementing contract.
- Use libraries for storage-heavy bookkeeping or reusable transformations. Pass storage explicitly to libraries and avoid duplicating index maintenance in multiple contracts.
- Keep validator admission, stake movement, gauge accounting, reward accounting, and token ownership checks in separate logical sections or modules.
- Add focused tests beside the contract area they cover. Every new state transition should have tests for authorization, invalid inputs, accounting, and the normal success path.
- Preserve checks-effects-interactions ordering and place external calls behind the narrowest internal helper that owns the invariant being protected.
