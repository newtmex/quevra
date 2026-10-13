import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const opsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("keystore wrapper advertises local commands without Docker", () => {
  const result = execFileSync("bash", [path.join(opsDir, "scripts/monad-keystore.sh"), "help"], {
    encoding: "utf8",
  });
  assert.match(result, /build/);
  assert.match(result, /create/);
  assert.match(result, /public/);
});

test("keystore workflow never mounts the entire repository", () => {
  const wrapper = readFileSync(path.join(opsDir, "scripts/monad-keystore.sh"), "utf8");
  assert.match(wrapper, /\$HOME\/\.quevra\/validator/);
  assert.match(wrapper, /request_path="\$REPO_DIR\/quevra-validator-request\.json"/);
  assert.match(wrapper, /pass --request PATH/);
  assert.match(wrapper, /--network none/);
  assert.match(wrapper, /Refusing to keep validator keys anywhere inside/);
  assert.match(wrapper, /--read-only/);
  assert.match(wrapper, /-v "\$secp_path:\/secp-keystore:ro"/);
  assert.match(wrapper, /-v "\$bls_path:\/bls-keystore:ro"/);
  assert.match(wrapper, /-v "\$request_path:\/request\.json:ro"/);
  assert.doesNotMatch(wrapper, /-v "\$REPO_DIR:/);
  assert.doesNotMatch(wrapper, /-v "\$request_dir:/);
  assert.match(wrapper, /--password-stdin/);
  assert.match(wrapper, /--network none/);
});

test("signing image installs the official SDK and runs the container signer", () => {
  const dockerfile = readFileSync(path.join(opsDir, "docker/monad-keystore/Dockerfile"), "utf8");
  const entrypoint = readFileSync(path.join(opsDir, "docker/monad-keystore/entrypoint.sh"), "utf8");
  assert.match(dockerfile, /github\.com\/monad-developers\/staking-sdk-cli/);
  assert.match(dockerfile, /pip install --no-cache-dir \/opt\/staking-sdk-cli/);
  assert.match(entrypoint, /\/opt\/quevra\/sign-validator-registration\.py/);
});

test("public output is filtered and existing keystores cannot be overwritten", () => {
  const entrypoint = readFileSync(path.join(opsDir, "docker/monad-keystore/entrypoint.sh"), "utf8");
  assert.match(entrypoint, /public_only\(\)/);
  assert.match(entrypoint, /\/public key\//);
  assert.match(entrypoint, /Refusing to overwrite existing keys/);
});
