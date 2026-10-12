# Quevra operations tooling

## Generate Monad consensus keystores

```sh
pnpm validator:keys
```

The command reads `KEYSTORE_PASSWORD` from the repository-root `.env` file, or from the shell environment (shell values take precedence). It parses the file as dotenv data and does not execute it as shell code. This runs Monad's official `monad-keystore create` once for each key type, refusing to overwrite existing files. It creates encrypted `id-secp` and `id-bls` keystores plus the tool's recovery backups under the ignored repository-root `validator-keys/` directory. The directory is mode `0700`; files are mode `0600`. Backups contain private key material: keep the directory on the operator machine, keep a protected off-machine backup, and never commit or paste these files. Existing validator operators should continue using their existing keystores.

These commands follow the official [Monad full-node installation guide](https://docs.monad.xyz/node-ops/full-node-installation#generate-keystores), which creates separate encrypted SECP and BLS keystores. Use Monad's documented recovery flow to verify keys from the active keystores; do not use old backup files as the source of a new registration.

## Sign Quevra's copied request

Install Monad's official [staking-sdk-cli](https://github.com/monad-developers/staking-sdk-cli) into a Python virtual environment on the operator machine. From the Quevra repo root:

```sh
git clone https://github.com/monad-developers/staking-sdk-cli.git /tmp/staking-sdk-cli
python3 -m venv validator-keys/staking-sdk-venv
source validator-keys/staking-sdk-venv/bin/activate
pip install /tmp/staking-sdk-cli
```

Keep that environment activated when using `pnpm validator:sign`. The signer imports Monad's `KeyGenerator` and `generateCalldata.add_validator`, checks the returned selector, and decodes the official SDK calldata into the payload and signatures Quevra expects.

In the dapp, click **Generate signing data**, copy the JSON request, and save it as `quevra-validator-request.json` on the operator machine. Then run:

```sh
pnpm validator:sign -- --request ./quevra-validator-request.json \
  --secp-keystore-path ./validator-keys/id-secp \
  --bls-keystore-path ./validator-keys/id-bls
```

The signer reads `KEYSTORE_PASSWORD` from the repository-root `.env` file or the shell environment (shell values take precedence). You can pass different existing keystore paths. The signer calls `monad-keystore recover` for both keys, captures private output only in process memory, then passes those keys to Monad's official SDK implementation. It does not log or export private keys. Monad's SDK signs the BLAKE3 hash of the packed payload with SECP256K1 and signs the payload with its BLS scheme, as implemented in official [`generateCalldata.py`](https://github.com/monad-developers/staking-sdk-cli/blob/main/src/staking_sdk_py/generateCalldata.py).

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
