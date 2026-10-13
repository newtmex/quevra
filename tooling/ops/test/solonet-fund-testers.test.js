import assert from "node:assert/strict";
import test from "node:test";
import {
  parseFundAmountMon,
  parseTesterAddresses,
} from "../src/solonet-fund-testers.js";

test("parseTesterAddresses accepts comma or whitespace lists", () => {
  assert.deepEqual(
    parseTesterAddresses("0x41Cbf317fcF3d5128ECF46e1B9f96dDf2994850A,0xa5189F3058CC50443eB9b3A39A2CcDA56f1b6bF1"),
    [
      "0x41Cbf317fcF3d5128ECF46e1B9f96dDf2994850A",
      "0xa5189F3058CC50443eB9b3A39A2CcDA56f1b6bF1",
    ],
  );
  assert.deepEqual(
    parseTesterAddresses("0x41Cbf317fcF3d5128ECF46e1B9f96dDf2994850A 0xa5189F3058CC50443eB9b3A39A2CcDA56f1b6bF1"),
    [
      "0x41Cbf317fcF3d5128ECF46e1B9f96dDf2994850A",
      "0xa5189F3058CC50443eB9b3A39A2CcDA56f1b6bF1",
    ],
  );
});

test("parseTesterAddresses falls back to the default Solonet tester set", () => {
  assert.deepEqual(parseTesterAddresses(""), [
    "0x41Cbf317fcF3d5128ECF46e1B9f96dDf2994850A",
    "0xa5189F3058CC50443eB9b3A39A2CcDA56f1b6bF1",
    "0x8fFd5b0d5C76FC19CBd7198571Be8b8b814F1676",
  ]);
  assert.deepEqual(parseTesterAddresses(undefined), [
    "0x41Cbf317fcF3d5128ECF46e1B9f96dDf2994850A",
    "0xa5189F3058CC50443eB9b3A39A2CcDA56f1b6bF1",
    "0x8fFd5b0d5C76FC19CBd7198571Be8b8b814F1676",
  ]);
});

test("parseTesterAddresses rejects invalid addresses", () => {
  assert.throws(() => parseTesterAddresses("not-an-address"), /Invalid Solonet tester address/);
  assert.throws(() => parseTesterAddresses("0x1234"), /Invalid Solonet tester address/);
});

test("parseFundAmountMon defaults to 200 million MON", () => {
  assert.equal(parseFundAmountMon(undefined), 200_000_000n);
  assert.equal(parseFundAmountMon(""), 200_000_000n);
  assert.equal(parseFundAmountMon("150000000"), 150_000_000n);
  assert.throws(() => parseFundAmountMon("0"), /positive integer/);
  assert.throws(() => parseFundAmountMon("-1"), /positive integer/);
});
