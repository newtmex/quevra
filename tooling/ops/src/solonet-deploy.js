import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SOLONET_CHAIN_ID = 20143;
const DEFAULT_RPC = "http://127.0.0.1:48080";
const DEFAULT_WAIT_MS = 10 * 60 * 1000;
// This key is public and funded only by the local Solonet development genesis.
const SOLONET_DEV_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function log(message) {
  process.stdout.write(`\n==> ${message}\n`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? `code ${code}`}: ${stderr.trim()}`));
    });
  });
}

async function dockerIsReady() {
  try {
    await capture("docker", ["info", "--format", "{{.ServerVersion}}"]);
    return true;
  } catch {
    return false;
  }
}

async function verifyColimaCpu(context) {
  if (process.platform !== "darwin" || !/^colima(?:-.+)?$/.test(context)) return;

  const profile = context === "colima" ? "default" : context.slice("colima-".length);
  let status;
  try {
    status = await capture("colima", ["--profile", profile, "status", "--verbose"]);
  } catch {
    return;
  }

  if (status.includes("macOS Virtualization.Framework")) {
    throw new Error(
      "Solonet requires 1 GB huge-page CPU support, which the active Colima Virtualization.Framework VM does not provide. Start a QEMU profile with `colima --profile solonet start --vm-type qemu --arch x86_64 --cpu-type max --cpus 8 --memory 16 --disk 300`, switch Docker to it with `docker context use colima-solonet`, then rerun pnpm solonet:deploy.",
    );
  }
}

async function ensureDocker() {
  let context = "";
  try {
    context = await capture("docker", ["context", "show"]);
  } catch {
    throw new Error("Docker CLI is unavailable. Install Docker and start its daemon before running Solonet.");
  }

  if (await dockerIsReady()) {
    await verifyColimaCpu(context);
    return;
  }

  const colimaProfile = context === "colima"
    ? "default"
    : (context.startsWith("colima-") ? context.slice("colima-".length) : null);
  if (process.platform === "darwin" && colimaProfile) {
    log("Docker is unavailable; starting the configured Colima VM");
    try {
      const colimaArgs = colimaProfile === "default" ? ["start"] : ["--profile", colimaProfile, "start"];
      await run("colima", colimaArgs);
    } catch (error) {
      throw new Error(
        `Could not start Colima: ${error.message}. Set up the QEMU profile and Docker context from tooling/ops/README.md, then rerun pnpm solonet:deploy.`,
      );
    }
    if (await dockerIsReady()) {
      await verifyColimaCpu(context);
      return;
    }
  }

  throw new Error(`Docker daemon is unavailable for context '${context || "unknown"}'. Start Docker (or run 'colima start' for the Colima context), then rerun pnpm solonet:deploy.`);
}

async function readChainId(rpcUrl) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC error: ${payload.error.message ?? JSON.stringify(payload.error)}`);
  if (typeof payload.result !== "string" || !/^0x[0-9a-f]+$/i.test(payload.result)) {
    throw new Error("RPC returned an invalid eth_chainId result");
  }
  return Number.parseInt(payload.result, 16);
}

async function probeSolonet(rpcUrl) {
  try {
    const chainId = await readChainId(rpcUrl);
    if (chainId !== SOLONET_CHAIN_ID) {
      throw new Error(`RPC at ${rpcUrl} reports chain ID ${chainId}; expected Solonet chain ID ${SOLONET_CHAIN_ID}`);
    }
    return true;
  } catch (error) {
    if (error.message.includes("expected Solonet chain ID")) throw error;
    return false;
  }
}

async function waitForSolonet(rpcUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    if (await probeSolonet(rpcUrl)) return;
    const elapsed = Date.now() - (deadline - timeoutMs);
    if (elapsed - lastLog >= 10_000) {
      log(`waiting for Solonet RPC at ${rpcUrl} (${Math.floor(elapsed / 1000)}s)`);
      lastLog = elapsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Solonet RPC did not become ready at ${rpcUrl} within ${Math.ceil(timeoutMs / 1000)}s`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length) throw new Error(`Unknown option(s): ${args.join(", ")}`);

  const rpcUrl = process.env.SOLONET_RPC ?? DEFAULT_RPC;
  const networkFile = path.resolve(ROOT, process.env.SOLONET_NETWORK_FILE ?? "services/solonet/network.toml");
  const waitMs = Number(process.env.SOLONET_START_TIMEOUT_MS ?? DEFAULT_WAIT_MS);
  if (!Number.isSafeInteger(waitMs) || waitMs < 1000) {
    throw new Error("SOLONET_START_TIMEOUT_MS must be an integer of at least 1000 milliseconds");
  }
  await access(networkFile);

  await ensureDocker();

  if (await probeSolonet(rpcUrl)) {
    log(`Solonet is already serving chain ${SOLONET_CHAIN_ID} at ${rpcUrl}`);
  } else {
    const solonetCtl = path.join(ROOT, "services/solonet/solonetctl");
    log("starting Solonet with services/solonet/solonetctl");
    await run(solonetCtl, ["-f", networkFile, "up", "-d"]);
    await waitForSolonet(rpcUrl, waitMs);
    log(`Solonet is ready at ${rpcUrl}`);
  }

  const deployEnv = { ...process.env };
  deployEnv.SOLONET_RPC = rpcUrl;
  deployEnv.DEPLOYER_PRIVATE_KEY = process.env.SOLONET_DEPLOYER_PRIVATE_KEY ?? SOLONET_DEV_PRIVATE_KEY;
  delete deployEnv.PROTOCOL_OWNER_ADDRESS;
  delete deployEnv.GAUGE_REWARD_TOKEN_ADDRESS;
  if (process.env.SOLONET_PROTOCOL_OWNER_ADDRESS) {
    deployEnv.PROTOCOL_OWNER_ADDRESS = process.env.SOLONET_PROTOCOL_OWNER_ADDRESS;
  }
  if (process.env.SOLONET_GAUGE_REWARD_TOKEN_ADDRESS) {
    deployEnv.SOLONET_GAUGE_REWARD_TOKEN_ADDRESS = process.env.SOLONET_GAUGE_REWARD_TOKEN_ADDRESS;
  }

  log("deploying Quevra contracts to Solonet");
  await run("pnpm", ["--filter", "@quevra/contracts", "deploy:solonet", "--", "--network", "solonet"], {
    cwd: ROOT,
    env: deployEnv,
  });
  log("Solonet and Quevra contracts are ready");
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
