import assert from "node:assert/strict";
import test from "node:test";
import { workspaceGlobs } from "../src/index.js";

test("@quevra/ops lists workspace globs", () => {
  assert.deepEqual(workspaceGlobs, [
    "apps/*",
    "services/*",
    "packages/*",
    "tooling/*",
  ]);
});
