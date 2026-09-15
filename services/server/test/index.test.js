import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/index.js";

test("@quevra/server uses workspace contracts", () => {
  const server = createServer();
  assert.equal(server.name, "@quevra/server");
  assert.equal(server.protocol.name, "quevra");
});
