# Quevra operations tooling

## Docker setup and troubleshooting

The Monad keystore commands use Docker. On macOS, Docker Desktop must finish starting before these commands can connect to its daemon. Check which daemon the Docker CLI is targeting with:

```sh
docker context show
docker context ls
docker info
```

If Docker Desktop is running but `docker context show` reports `colima`, the CLI is targeting Colima instead. Select Docker Desktop's context and confirm the daemon is reachable:

```sh
docker context use desktop-linux
docker info
```

If you intend to use Colima, start the relevant Colima profile and keep its context selected instead. The `Docker daemon is unavailable` message means the script's `docker info` check could not reach the daemon selected by the CLI; opening Docker Desktop alone does not switch contexts.

The signer also needs a local image. Build it once before the first signing run:

```sh
pnpm --filter @quevra/ops keystore:build
```

If `pnpm validator:sign` reports `Unable to find image 'quevra-monad-keystore:local' locally` followed by a registry `pull access denied`, the image has not been built locally. Run the build command above, then retry signing. No Docker Hub login is needed. Rebuild after changing the keystore image's tools or Dockerfile. If `QUEVRA_KEYSTORE_IMAGE` is set, use the same value for the build and signing commands.

## Generate Monad consensus keystores

```sh
pnpm --filter @quevra/ops keystore:build
pnpm --filter @quevra/ops keystore:create
pnpm --filter @quevra/ops keystore:public
```

The Docker workflow installs Monad's official Ubuntu amd64 `monad-keystore` package and Monad's official `staking-sdk-cli`. `create` prompts twice for the keystore password and refuses to overwrite existing keys. `public` asks for the password and prints only the public keys. Key files are kept outside the checkout in `~/.quevra/validator/` by default, with directory mode `0700`; set `QUEVRA_KEYSTORE_DIR` to change the location. Key creation, public-key recovery, and signing run in a `--network none` container. Docker is required.

An alternative host-installed CLI command remains available as `pnpm validator:keys`; it reads `KEYSTORE_PASSWORD` from root `.env` or the shell (shell values take precedence) and writes keystores and sensitive recovery output under the ignored repository-root `validator-keys/` directory. Prefer the Docker workflow above for new key generation.

These commands follow the official [Monad full-node installation guide](https://docs.monad.xyz/node-ops/full-node-installation#generate-keystores), which creates separate encrypted SECP and BLS keystores. Use Monad's documented recovery flow to verify keys from the active keystores; do not use old backup files as the source of a new registration.

## Sign Quevra's copied request

Build or rebuild the image when setting up the workflow or updating its tools:

```sh
pnpm --filter @quevra/ops keystore:build
```

The container signer imports Monad's `KeyGenerator` and `generateCalldata.add_validator`, checks the returned selector, and decodes the official SDK calldata into the payload and signatures Quevra expects.

In the dapp, click **Generate signing data**, copy the JSON request, and save it as `quevra-validator-request.json` on the operator machine. Then run:

```sh
pnpm validator:sign
```

By default, the signer reads `./quevra-validator-request.json` and the SECP/BLS keystores under `~/.quevra/validator/`. Pass `-- --request PATH` or the keystore path options to use different files.

The signer prompts for the keystore password when `KEYSTORE_PASSWORD` is not set in the shell or repository-root `.env` (shell values take precedence). The password is sent to the container over stdin. Existing keystore files are mounted read-only, the request is mounted read-only, the output directory is the only writable host mount, and the container has no network access. The signer calls `monad-keystore recover` for both keys, captures private output only in container memory, then passes those keys to Monad's official SDK implementation. It does not log or export private keys. Monad's SDK signs the BLAKE3 hash of the packed payload with SECP256K1 and signs the payload with its BLS scheme, as implemented in official [`generateCalldata.py`](https://github.com/monad-developers/staking-sdk-cli/blob/main/src/staking_sdk_py/generateCalldata.py).

The signed JSON message is printed to stdout and saved to a new file under `validator-keys/` with mode `0600`. Copy the full JSON message printed by the command and paste it into the dapp. The dapp checks the network, contract-derived fields, payload bytes, key and signature lengths, and both signatures before enabling submission.

The request values come from Quevra's contracts. Do not change them: a different operator, salt, auth address, amount, or commission requires generating and signing a fresh request. The connected wallet signs only Quevra's `createValidator` transaction. The Monad consensus keys sign only the registration payload. This workflow ends at confirmed Quevra registration and does not execute Monad's later `addValidator` call or validator activation.

From the workspace root, start the local Monad Solonet and deploy Quevra's core contracts and beacons with:

```sh
pnpm solonet:deploy
```

The command starts `services/solonet` through its `solonetctl` wrapper, waits for chain ID `20143` at `http://127.0.0.1:48080`, then runs the contracts package's Hardhat deployment. It deploys and records a local reward token automatically when no token is configured. Deployments are recorded in `packages/contracts/deployments/20143.json`.

Requirements: initialized Git submodules, Docker with Compose, and installed workspace dependencies. On macOS, Solonet needs an x86_64 QEMU Colima VM with `cpu-type max` to provide the required 1 GB huge-page CPU support. Create a dedicated profile once and select its Docker context:

```sh
colima --profile solonet start --vm-type qemu --arch x86_64 --cpu-type max --cpus 8 --memory 16 --disk 300
docker context use colima-solonet
```

When that Colima profile is selected, the command starts it if its daemon is stopped. The command checks the active Colima VM type and explains this setup if it detects the incompatible macOS Virtualization.Framework VM. For other Docker contexts, start Docker before running the command. The default funded Solonet key is only for local development. To override local settings, use `SOLONET_RPC`, `SOLONET_NETWORK_FILE`, `SOLONET_START_TIMEOUT_MS`, `SOLONET_DEPLOYER_PRIVATE_KEY`, `SOLONET_PROTOCOL_OWNER_ADDRESS`, or `SOLONET_GAUGE_REWARD_TOKEN_ADDRESS`. The last two owner and token settings are intentionally scoped to this local workflow.

The Solonet remains running after deployment. Stop it with `services/solonet/solonetctl -f services/solonet/network.toml down`.
