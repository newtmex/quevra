import assert from "node:assert/strict";
import test from "node:test";
import { contracts, protocol } from "../src/index.js";

test("@quevra/contracts exposes protocol metadata", () => {
  assert.equal(protocol.name, "quevra");
  assert.equal(contracts.Quevra.name, "Quevra");
});
