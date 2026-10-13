# Quevra

**Stake together. Back independent validators. Keep your options open.**

Quevra is a validator-capital and incentive coordination layer for Monad. MON holders lock native MON into `veMON` positions, allocate that capital toward validators, earn native staking rewards and sponsored ERC-20 incentives, and reallocate support across cycles without unlocking and starting over.

The protocol binds capital to choice: allocations to validator vaults drive corresponding validator-gauge voting weight, while vaults and agents perform real Monad staking-precompile operations (`0x1000`) for registration, delegation, undelegation, withdrawal, and reward flows.

This repository is the Quevra monorepo. Protocol contracts, the local Monad Solonet harness, the Envio indexer, the user-facing dapp, and workspace ops tooling live here as workspace packages and Git submodules.

**Live Monad testnet dapp:** [https://quevra-pearl.vercel.app](https://quevra-pearl.vercel.app)

## Repository layout

| Path | Role |
| --- | --- |
| `apps/` | User-facing applications |
| `services/` | Backend services and local network tooling |
| `packages/` | Protocol and shared packages, including Solidity contracts |
| `tooling/` | Workspace-level development and operations tooling |

## Submodules

Clone with submodules initialized (see [Clone](#clone)). Each submodule has its own README for deeper setup and behavior:

| Path | Repository | Docs |
| --- | --- | --- |
| `packages/contracts` | [quevra-contracts](https://github.com/newtmex/quevra-contracts) | [README](./packages/contracts/README.md) · [deployment](./packages/contracts/docs/deployment.md) · [architecture](./packages/contracts/docs/architecture.md) |
| `apps/dapp` | [quevra-dapp](https://github.com/newtmex/quevra-dapp) | Package scripts in [`apps/dapp/package.json`](./apps/dapp/package.json); env template in [`apps/dapp/.env.example`](./apps/dapp/.env.example) |
| `services/indexer` | [quevra-indexer](https://github.com/newtmex/quevra-indexer) | [README](./services/indexer/README.md) |
| `services/solonet` | [monad-solonet](https://github.com/monad-crypto/monad-solonet) | [README](./services/solonet/README.md) |

Workspace ops live in-tree at [`tooling/ops`](./tooling/ops) ([README](./tooling/ops/README.md)). They wrap Solonet startup, contract deployment, tester funding, and validator key/signing workflows.

## Prerequisites

- Node.js `>=22.13`
- [pnpm](https://pnpm.io/) `10.x` (see root `packageManager`)
- Docker with Compose
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`) for Solonet deploy and funding
- Git with submodule support

On macOS (Apple Silicon), Solonet needs an x86_64 QEMU Colima VM with `cpu-type max` for 1 GB huge-page CPU support. Create a dedicated profile once:

```sh
brew install lima colima lima-additional-guestagents
colima --profile solonet start --vm-type qemu --arch x86_64 --cpu-type max --cpus 8 --memory 16 --disk 300
docker context use colima-solonet
```

Confirm Docker is reachable (`docker info`) before continuing. See [`tooling/ops/README.md`](./tooling/ops/README.md) for Docker context troubleshooting.

## Clone

```sh
git clone --recurse-submodules https://github.com/newtmex/quevra.git
cd quevra
```

If you already cloned without submodules:

```sh
git submodule update --init --recursive
```

Install workspace dependencies from the repository root:

```sh
pnpm install
```

Optional local overrides: copy [`.env.example`](./.env.example) to `.env` at the repo root.

## Run Solonet and deploy contracts

From the repository root, start local Monad Solonet, wait for chain ID `20143` at `http://127.0.0.1:48080`, deploy Quevra's core contracts and beacons, and fund configured tester wallets:

```sh
pnpm solonet:deploy
```

Requirements: initialized submodules, Docker (Colima profile above on macOS), Foundry on `PATH`, and installed workspace dependencies.

What the command does:

1. Starts `services/solonet` through its `solonetctl` wrapper
2. Waits until RPC reports chain ID `20143`
3. Runs the contracts package Hardhat Solonet deployment
4. Funds tester wallets from root `.env` (`SOLONET_TESTER_ADDRESSES`, `SOLONET_TESTER_FUND_AMOUNT_MON`)

Deployments are recorded in `packages/contracts/deployments/20143.json`.

Fund testers again without redeploying:

```sh
pnpm solonet:fund-testers
```

Solonet keeps running after deploy. Stop it with:

```sh
services/solonet/solonetctl -f services/solonet/network.toml down
```

More detail: [`tooling/ops/README.md`](./tooling/ops/README.md) and [`services/solonet/README.md`](./services/solonet/README.md).

## Run the dapp for development

The hosted Monad testnet deployment is available at [https://quevra-pearl.vercel.app](https://quevra-pearl.vercel.app). Use the steps below to run the dapp locally against Solonet or testnet.

Point the dapp at local Solonet after a successful `pnpm solonet:deploy`.

1. Copy the dapp env template and set the Solonet chain:

```sh
cp apps/dapp/.env.example apps/dapp/.env.local
```

Set at least:

```dotenv
NEXT_PUBLIC_CHAIN_ID=20143
NEXT_PUBLIC_SOLONET_RPC_URL=http://127.0.0.1:48082/rpc/
```

Optional faucet and burner-wallet settings are documented in [`apps/dapp/.env.example`](./apps/dapp/.env.example).

2. Sync contract artifacts into the dapp if needed:

```sh
pnpm --filter @quevra/dapp contracts:sync
```

3. Start the Next.js app:

```sh
pnpm --filter @quevra/dapp dev
```

The app serves on the Next.js default local port. Use chain ID `10143` and the Monad Testnet RPC settings from `.env.example` when developing against public testnet instead of Solonet.

### Optional: local indexer

For indexed activity and identity discovery against Solonet:

```sh
pnpm --filter @quevra/indexer indexer:solonet:dev
```

GraphQL is available at `http://127.0.0.1:8080/v1/graphql`. The dapp `/api/indexer` route defaults to that URL on Solonet; override with `ENVIO_SOLONET_GRAPHQL_ENDPOINT` if needed. See [`services/indexer/README.md`](./services/indexer/README.md).

## Useful root scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Run package `dev` scripts in parallel |
| `pnpm build` | Build all packages |
| `pnpm test` | Test all packages |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm check` | Full package checks |
| `pnpm solonet:deploy` | Start Solonet, deploy contracts, fund testers |
| `pnpm solonet:fund-testers` | Fund Solonet tester wallets only |
| `pnpm validator:keys` | Generate validator keystores (ops tooling) |
| `pnpm validator:sign` | Sign a Quevra validator registration request |

Target one package with pnpm filtering, for example `pnpm --filter @quevra/dapp test` or `pnpm --filter @quevra/contracts check`.

## Further reading

- Protocol overview and mechanism design: [`packages/contracts/README.md`](./packages/contracts/README.md)
- Contract deployment and upgrades: [`packages/contracts/docs/deployment.md`](./packages/contracts/docs/deployment.md)
- Solonet network operations: [`services/solonet/README.md`](./services/solonet/README.md)
- Indexer configuration and local GraphQL: [`services/indexer/README.md`](./services/indexer/README.md)
- Keystore, signing, and Solonet ops: [`tooling/ops/README.md`](./tooling/ops/README.md)
