# Quevra Envio indexer

Indexes Quevra's Monad Testnet veMON lock lifecycle, validator identities and backing, staking intent and settlement, validator vote weights, reward funding and claims, and vault reward accounting. It starts at the deployed contract blocks recorded in `packages/contracts/deployments/monadTestnet/` and registers vault, gauge, and bribe instances from their factory events.

## Local development

Requirements: Node.js 22+, pnpm, Docker, and an Envio HyperSync API token.

1. Set `ENVIO_API_TOKEN` in `services/indexer/.env` (create this file locally; do not commit it).
2. From the repository root, run `pnpm --filter @quevra/indexer codegen` once after changing `config.yaml` or `schema.graphql`.
3. Run `pnpm --filter @quevra/indexer indexer:dev`. The local GraphQL endpoint is `http://127.0.0.1:8080/v1/graphql`.
4. In another terminal, run `pnpm --filter @quevra/dapp dev`.

The dapp's `/api/indexer` route proxies a wallet-scoped GraphQL query. For Envio Cloud, set `ENVIO_GRAPHQL_ENDPOINT` to the deployed GraphQL URL and configure any endpoint authentication with `ENVIO_GRAPHQL_AUTH_TOKEN` or `ENVIO_GRAPHQL_ADMIN_SECRET` in the dapp server environment.

## Indexed data

- `Position` tracks veMON ownership, locked MON, expiry/permanent-lock changes, and validator identity NFTs.
- `Validator` tracks veValidator ownership and its linked operator, vault, gauge, bribe, reward token, and Monad validator ID.
- `Activity` records lock and approval actions, MON deposits, stake intent and settlement, backing changes, vote-weight changes, reward funding/claims, validator configuration, and vault reward sync/payment events.
- `DynamicRewardContract` associates each created gauge or bribe instance with its validator identity so dynamic contract events can be joined to Quevra positions.

The indexer provides historical activity and identity discovery. Use direct contract reads for current balances and claimable amounts.

`NonStakingGauge` is present in the Solidity source but has no deployed instance or factory event in the current Monad Testnet deployments, so Envio has no address from which to discover and index `RewardsBeneficiarySwitched` yet. Add it when that contract receives an on-chain registration path or deployment.
