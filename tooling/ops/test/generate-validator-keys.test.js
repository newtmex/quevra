import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("key generation invokes monad-keystore for both types without printing backups", async () => {
  const temp = await mkdtemp(join(tmpdir(), "quevra-monad-keystore-"));
  const bin = join(temp, "bin");
  const out = join(temp, "keys");
  await mkdir(bin);
  const fake = join(bin, "monad-keystore");
  await writeFile(fake, `#!/bin/sh\nkey_type=\nkeystore=\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in --key-type) shift; key_type="$1";; --keystore-path) shift; keystore="$1";; esac\n  shift\ndone\n: > "$keystore"\nprintf 'Public key: %s\\nKeystore secret: TEST-PRIVATE-OUTPUT\\n' "$key_type"\n`);
  await chmod(fake, 0o700);
  const result = spawnSync(process.execPath, [resolve("src/generate-validator-keys.js"), "--out-dir", out], {
    encoding: "utf8",
    env: { ...process.env, KEYSTORE_PASSWORD: "test-password", PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes("TEST-PRIVATE-OUTPUT"), false);
  assert.equal((await stat(out)).mode & 0o777, 0o700);
  assert.equal((await stat(join(out, "secp-backup.txt"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(out, "bls-backup.txt"))).mode & 0o777, 0o600);
  assert.match(await readFile(join(out, "secp-backup.txt"), "utf8"), /TEST-PRIVATE-OUTPUT/);
  assert.match(result.stdout, /Public key: secp/);
  assert.match(result.stdout, /Public key: bls/);
  await rm(temp, { recursive: true, force: true });
});

test("cleans up a partial key pair when the second keystore command fails", async () => {
  const temp = await mkdtemp(join(tmpdir(), "quevra-monad-keystore-rollback-"));
  const bin = join(temp, "bin");
  const out = join(temp, "keys");
  await mkdir(bin);
  const fake = join(bin, "monad-keystore");
  await writeFile(fake, [
    "#!/bin/sh",
    "while [ \"$#\" -gt 0 ]; do",
    "  case \"$1\" in --key-type) shift; key_type=\"$1\";; --keystore-path) shift; keystore=\"$1\";; esac",
    "  shift",
    "done",
    "if [ \"$key_type\" = \"bls\" ]; then printf 'secret output'; exit 1; fi",
    ": > \"$keystore\"",
    "printf 'Public key: secp\\nPrivate key: hidden'",
  ].join("\n"));
  await chmod(fake, 0o700);
  const result = spawnSync(process.execPath, [resolve("src/generate-validator-keys.js"), "--out-dir", out], {
    encoding: "utf8",
    env: { ...process.env, KEYSTORE_PASSWORD: "test-password", PATH: `${bin}:${process.env.PATH}` },
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout.includes("hidden"), false);
  assert.equal(result.stderr.includes("secret output"), false);
  assert.deepEqual(await readdir(out), []);
  await rm(temp, { recursive: true, force: true });
});
