#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, chmod, access, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./env.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function getOutDir(argv) {
  let output;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--out-dir") output = argv[++index];
    else if (argument === "--help") return null;
    else throw new Error(`Unknown argument: ${argument}`);
    if (argument === "--out-dir" && (!output || output.startsWith("--"))) throw new Error("--out-dir requires a directory.");
  }
  return resolve(output ?? `${repoRoot}/validator-keys`);
}

async function ensureMissing(paths) {
  for (const path of paths) {
    try {
      await access(path);
      throw new Error(`Refusing to overwrite existing keystore or backup: ${path}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function createKeystore(type, keystorePath, password) {
  const result = spawnSync("monad-keystore", [
    "create", "--key-type", type, "--keystore-path", keystorePath, "--password", password,
  ], { encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) {
    // monad-keystore output can contain backup secrets; never echo captured output.
    if (result.error?.code === "ENOENT") {
      throw new Error("monad-keystore is not installed or is missing from PATH. Build the official binary from category-labs/monad-bft/monad-keystore and retry.");
    }
    throw new Error(`monad-keystore failed to create the ${type} keystore. Check the installed tool and key directory.`);
  }
  return result.stdout;
}

function publicKeyLines(output) {
  return output.split(/\r?\n/).filter((line) => /public key/i.test(line) && !/(private|secret|backup|ikm)/i.test(line));
}

async function main() {
  const outputDir = getOutDir(process.argv.slice(2));
  if (!outputDir) {
    process.stdout.write("Usage: pnpm validator:keys [-- --out-dir <directory>]\nReads KEYSTORE_PASSWORD from the environment or repository .env; requires monad-keystore in PATH.\n");
    return;
  }
  await loadEnvFile(resolve(repoRoot, ".env"));
  const password = process.env.KEYSTORE_PASSWORD;
  if (!password) throw new Error("Set KEYSTORE_PASSWORD in the environment or repository .env before generating keystores.");
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await chmod(outputDir, 0o700);
  const outputs = {
    secpKeystore: resolve(outputDir, "id-secp"),
    blsKeystore: resolve(outputDir, "id-bls"),
    secpBackup: resolve(outputDir, "secp-backup.txt"),
    blsBackup: resolve(outputDir, "bls-backup.txt"),
  };
  await ensureMissing(Object.values(outputs));

  try {
    const secpOutput = createKeystore("secp", outputs.secpKeystore, password);
    await writeFile(outputs.secpBackup, secpOutput, { flag: "wx", mode: 0o600 });
    await chmod(outputs.secpKeystore, 0o600);
    const blsOutput = createKeystore("bls", outputs.blsKeystore, password);
    await writeFile(outputs.blsBackup, blsOutput, { flag: "wx", mode: 0o600 });
    await chmod(outputs.blsKeystore, 0o600);

    process.stdout.write("Monad SECP and BLS keystores created.\n");
    for (const line of [...publicKeyLines(secpOutput), ...publicKeyLines(blsOutput)]) process.stdout.write(`${line}\n`);
    process.stdout.write(`Encrypted keystores and restricted backups: ${outputDir}\n`);
  } catch (error) {
    await Promise.all(Object.values(outputs).map((path) => rm(path, { force: true })));
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Keystore generation failed."}\n`);
  process.exitCode = 1;
});
