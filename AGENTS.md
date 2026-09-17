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
