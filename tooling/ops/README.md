# Quevra operations tooling

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
