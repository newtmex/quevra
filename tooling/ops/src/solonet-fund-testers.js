#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile } from "./env.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SOLONET_CHAIN_ID = 20143;
const DEFAULT_RPC = "http://127.0.0.1:48080";
// Public Anvil/Hardhat account #0 — funded by Solonet genesis for local development only.
const SOLONET_DEV_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEFAULT_FUND_AMOUNT_MON = 200_000_000n;
const DEFAULT_TESTER_ADDRESSES = [
  "0x41Cbf317fcF3d5128ECF46e1B9f96dDf2994850A",
  "0xa5189F3058CC50443eB9b3A39A2CcDA56f1b6bF1",
  "0x8fFd5b0d5C76FC19CBd7198571Be8b8b814F1676",
];

function log(message) {
  process.stdout.write(`\n==> ${message}\n`);
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
      else reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? `code ${code}`}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export function parseTesterAddresses(raw) {
  if (raw == null || String(raw).trim() === "") return [...DEFAULT_TESTER_ADDRESSES];
  const addresses = String(raw)
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (addresses.length === 0) {
    throw new Error("SOLONET_TESTER_ADDRESSES must list at least one address");
  }
  for (const address of addresses) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error(`Invalid Solonet tester address: ${address}`);
    }
  }
  return addresses;
}

export function parseFundAmountMon(raw) {
  if (raw == null || String(raw).trim() === "") return DEFAULT_FUND_AMOUNT_MON;
  const value = BigInt(String(raw).trim());
  if (value <= 0n) throw new Error("SOLONET_TESTER_FUND_AMOUNT_MON must be a positive integer");
  return value;
}

async function readChainId(rpcUrl) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC error: ${payload.error.message ?? JSON.stringify(payload.error)}`);
  return Number.parseInt(payload.result, 16);
}

async function readBalance(rpcUrl, address) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC error: ${payload.error.message ?? JSON.stringify(payload.error)}`);
  return BigInt(payload.result);
}

function formatMon(wei) {
  const whole = wei / 10n ** 18n;
  const fraction = wei % 10n ** 18n;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

/**
 * Fund Solonet tester accounts with native MON.
 * @param {{ rpcUrl?: string, privateKey?: string, addresses?: string[], amountMon?: bigint, env?: NodeJS.ProcessEnv }} [options]
 */
export async function fundSolonetTesters(options = {}) {
  const env = options.env ?? process.env;
  const rpcUrl = options.rpcUrl ?? env.SOLONET_RPC ?? DEFAULT_RPC;
  const privateKey = options.privateKey ?? env.SOLONET_DEPLOYER_PRIVATE_KEY ?? SOLONET_DEV_PRIVATE_KEY;
  const addresses = options.addresses ?? parseTesterAddresses(env.SOLONET_TESTER_ADDRESSES);
  const amountMon = options.amountMon ?? parseFundAmountMon(env.SOLONET_TESTER_FUND_AMOUNT_MON);
  const amountWei = amountMon * 10n ** 18n;

  const chainId = await readChainId(rpcUrl);
  if (chainId !== SOLONET_CHAIN_ID) {
    throw new Error(`RPC at ${rpcUrl} reports chain ID ${chainId}; expected Solonet chain ID ${SOLONET_CHAIN_ID}`);
  }

  log(`funding ${addresses.length} Solonet tester(s) with ${amountMon.toString()} MON each via ${rpcUrl}`);

  const results = [];
  for (const address of addresses) {
    const before = await readBalance(rpcUrl, address);
    const txHash = await capture("cast", [
      "send",
      address,
      "--value",
      `${amountMon.toString()}ether`,
      "--private-key",
      privateKey,
      "--rpc-url",
      rpcUrl,
      "--chain",
      String(SOLONET_CHAIN_ID),
      "--json",
    ], { env });

    let hash = txHash;
    try {
      const parsed = JSON.parse(txHash);
      hash = parsed.transactionHash ?? parsed.hash ?? txHash;
    } catch {
      // cast --json may still print a bare hash on some versions
      const match = txHash.match(/0x[0-9a-fA-F]{64}/);
      if (match) hash = match[0];
    }

    const after = await readBalance(rpcUrl, address);
    process.stdout.write(`  ${address}: ${formatMon(before)} → ${formatMon(after)} MON (tx ${hash})\n`);
    results.push({ address, before, after, txHash: hash });
  }

  log("Solonet tester funding complete");
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: pnpm solonet:fund-testers\n" +
        "Funds SOLONET_TESTER_ADDRESSES with SOLONET_TESTER_FUND_AMOUNT_MON native MON on local Solonet.\n" +
        "Reads repository-root .env when present. Defaults to the Quevra Solonet tester set and 200000000 MON.\n",
    );
    return;
  }
  if (args.length) throw new Error(`Unknown option(s): ${args.join(", ")}`);

  await loadEnvFile(path.resolve(ROOT, ".env"));
  await fundSolonetTesters();
}

const isMain = process.argv[1] != null
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
