import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile, parseEnv } from "../src/env.js";

test("parses common .env values and ignores comments", () => {
  assert.deepEqual(parseEnv(`KEYSTORE_PASSWORD=plain-value
QUOTED=" spaces # stay "
export SINGLE='literal\\nvalue'
INLINE=value # comment
# ignored`), {
    KEYSTORE_PASSWORD: "plain-value",
    QUOTED: " spaces # stay ",
    SINGLE: "literal\\nvalue",
    INLINE: "value",
  });
});

test("loads .env values without replacing shell environment values", async () => {
  const temp = await mkdtemp(join(tmpdir(), "quevra-env-"));
  try {
    const envFile = join(temp, ".env");
    await writeFile(envFile, "KEYSTORE_PASSWORD=from-file\n", "utf8");
    const target = { KEYSTORE_PASSWORD: "from-shell" };
    await loadEnvFile(envFile, target);
    assert.equal(target.KEYSTORE_PASSWORD, "from-shell");
    const emptyTarget = {};
    await loadEnvFile(envFile, emptyTarget);
    assert.equal(emptyTarget.KEYSTORE_PASSWORD, "from-file");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
