import assert from "node:assert/strict";
import test from "node:test";
import { createDapp } from "../src/index.js";

test("@quevra/dapp uses workspace contracts", () => {
  const dapp = createDapp();
  assert.equal(dapp.name, "@quevra/dapp");
  assert.equal(dapp.protocol.name, "quevra");
});
