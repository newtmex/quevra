import importlib.util
import sys
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "src" / "sign-validator-registration.py"
spec = importlib.util.spec_from_file_location("quevra_monad_signer", SCRIPT)
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)

REQUEST = {
    "schema": "quevra.validator-signing-request",
    "version": 1,
    "chainId": 10143,
    "operator": "0x1111111111111111111111111111111111111111",
    "saltSeed": "0x" + "22" * 32,
    "authAddress": "0x" + "33" * 20,
    "amount": "100000000000000000000000",
    "commission": "0",
}


class ValidatorSigningOpsTest(unittest.TestCase):
    def test_loads_keystore_password_from_env_file_without_overriding_environment(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            env_file = Path(temp_dir) / ".env"
            env_file.write_text('KEYSTORE_PASSWORD="file secret # value"\n', encoding="utf8")
            with patch.dict(os.environ, {}, clear=True):
                signer.load_repository_env(env_file)
                self.assertEqual(os.environ["KEYSTORE_PASSWORD"], "file secret # value")
            with patch.dict(os.environ, {"KEYSTORE_PASSWORD": "shell-value"}, clear=True):
                signer.load_repository_env(env_file)
                self.assertEqual(os.environ["KEYSTORE_PASSWORD"], "shell-value")

    def test_validates_the_copyable_quevra_request(self):
        normalized = signer.validate_request(REQUEST)
        self.assertEqual(normalized["authAddress"], REQUEST["authAddress"])
        with self.assertRaisesRegex(ValueError, "unsupported shape"):
            signer.validate_request({**REQUEST, "secpPrivateKey": "must-not-be-here"})
        with self.assertRaisesRegex(ValueError, "saltSeed"):
            signer.validate_request({**REQUEST, "saltSeed": "0x1234"})

    def test_uses_the_official_sdk_add_validator_builder_and_emits_public_artifact(self):
        secp_pubkey = bytes.fromhex("02" + "11" * 32)
        bls_pubkey = bytes.fromhex("22" * 48)
        payload = b"".join([
            secp_pubkey,
            bls_pubkey,
            bytes.fromhex(REQUEST["authAddress"][2:]),
            int(REQUEST["amount"]).to_bytes(32, "big"),
            int(REQUEST["commission"]).to_bytes(32, "big"),
        ])
        secp_signature = bytes.fromhex("44" * 64)
        bls_signature = bytes.fromhex("55" * 96)
        calls = {}

        class FakeKeys:
            @staticmethod
            def from_keys(secp_private_key, bls_private_key):
                calls["keys"] = (secp_private_key, bls_private_key)
                return FakeKeys()

            @staticmethod
            def pub_secp_key():
                return secp_pubkey

            @staticmethod
            def pub_bls_key():
                return bls_pubkey

        def add_validator(keys, *, amount, auth_address, commission):
            calls["registration"] = (keys, amount, auth_address, commission)
            return "0xf145204c00"

        eth_abi = types.ModuleType("eth_abi")
        eth_abi.decode = lambda types_, data: (payload, secp_signature, bls_signature)
        constants = types.ModuleType("staking_sdk_py.constants")
        constants.ADD_VALIDATOR_SELECTOR = "f145204c"
        calldata = types.ModuleType("staking_sdk_py.generateCalldata")
        calldata.add_validator = add_validator
        keygen = types.ModuleType("staking_sdk_py.keyGenerator")
        keygen.KeyGenerator = FakeKeys
        sdk = types.ModuleType("staking_sdk_py")

        with patch.dict(sys.modules, {
            "eth_abi": eth_abi,
            "staking_sdk_py": sdk,
            "staking_sdk_py.constants": constants,
            "staking_sdk_py.generateCalldata": calldata,
            "staking_sdk_py.keyGenerator": keygen,
        }):
            artifact = signer.sign_with_monad_sdk(REQUEST, "secp-key", "bls-key")

        self.assertEqual(calls["keys"], ("secp-key", "bls-key"))
        self.assertEqual(calls["registration"][1:], (int(REQUEST["amount"]), REQUEST["authAddress"], 0))
        self.assertEqual(artifact["schema"], "quevra.validator-registration")
        self.assertEqual((len(bytes.fromhex(artifact["payload"][2:])), len(bytes.fromhex(artifact["signedSecpMessage"][2:])), len(bytes.fromhex(artifact["signedBlsMessage"][2:]))), (165, 64, 96))
        self.assertFalse(any("private" in key.lower() for key in artifact))
        self.assertFalse(any("secp-key" in str(value) or "bls-key" in str(value) for value in artifact.values()))

    def test_rejects_wrong_official_selector_or_payload(self):
        keys_module = types.ModuleType("staking_sdk_py.keyGenerator")

        class FakeKeys:
            @staticmethod
            def from_keys(**_):
                return FakeKeys()

            @staticmethod
            def pub_secp_key():
                return bytes.fromhex("02" + "11" * 32)

            @staticmethod
            def pub_bls_key():
                return bytes.fromhex("22" * 48)

        keys_module.KeyGenerator = FakeKeys
        sdk = types.ModuleType("staking_sdk_py")
        constants = types.ModuleType("staking_sdk_py.constants")
        constants.ADD_VALIDATOR_SELECTOR = "f145204c"
        calldata = types.ModuleType("staking_sdk_py.generateCalldata")
        calldata.add_validator = lambda *_args, **_kwargs: "0xdeadbeef00"
        eth_abi = types.ModuleType("eth_abi")
        eth_abi.decode = lambda *_args: (b"bad", b"x" * 64, b"y" * 96)
        with patch.dict(sys.modules, {
            "eth_abi": eth_abi,
            "staking_sdk_py": sdk,
            "staking_sdk_py.constants": constants,
            "staking_sdk_py.generateCalldata": calldata,
            "staking_sdk_py.keyGenerator": keys_module,
        }):
            with self.assertRaisesRegex(ValueError, "unexpected addValidator calldata"):
                signer.sign_with_monad_sdk(REQUEST, "secp-key", "bls-key")


if __name__ == "__main__":
    unittest.main()
