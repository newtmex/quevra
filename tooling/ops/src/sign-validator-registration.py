#!/usr/bin/env python3
"""Use Monad's staking-sdk-cli implementation to sign a Quevra request offline."""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REQUEST_SCHEMA = "quevra.validator-signing-request"
ARTIFACT_SCHEMA = "quevra.validator-registration"
REQUEST_FIELDS = {"schema", "version", "chainId", "operator", "saltSeed", "authAddress", "amount", "commission"}


def fail(message):
    raise ValueError(message)


def load_repository_env(env_file=None):
    repo_root = Path(__file__).resolve().parents[3]
    env_file = Path(env_file) if env_file else repo_root / ".env"
    try:
        lines = env_file.read_text(encoding="utf8").splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if not match:
            continue
        key, value = match.groups()
        if value[:1] in ("'", '"') and value.endswith(value[:1]):
            quote = value[0]
            value = value[1:-1]
            if quote == '"':
                value = re.sub(r"\\([nrt\\\"])", lambda escaped: {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", '"': '"'}[escaped.group(1)], value)
        else:
            value = re.sub(r"\s+#.*$", "", value).strip()
        os.environ.setdefault(key, value)


def fixed_hex(value, byte_length, label):
    if not isinstance(value, str) or not re.fullmatch(rf"(?:0x)?[0-9a-fA-F]{{{byte_length * 2}}}", value):
        fail(f"{label} must be exactly {byte_length} bytes of hex.")
    return "0x" + value.removeprefix("0x").removeprefix("0X").lower()


def validate_request(value):
    if not isinstance(value, dict) or set(value) != REQUEST_FIELDS:
        fail("Signing request has an unsupported shape.")
    if value["schema"] != REQUEST_SCHEMA or value["version"] != 1:
        fail("Unsupported Quevra signing request schema or version.")
    if not isinstance(value["chainId"], int) or value["chainId"] <= 0:
        fail("chainId must be a positive integer.")
    request = dict(value)
    request["operator"] = fixed_hex(value["operator"], 20, "operator")
    request["saltSeed"] = fixed_hex(value["saltSeed"], 32, "saltSeed")
    request["authAddress"] = fixed_hex(value["authAddress"], 20, "authAddress")
    for field in ("amount", "commission"):
        raw = value[field]
        if not isinstance(raw, str) or not re.fullmatch(r"0|[1-9][0-9]*", raw) or int(raw) >= 1 << 256:
            fail(f"{field} must be a decimal uint256 string.")
    return request


def recover_private_key(keystore_path, key_type, password):
    sys.stderr.write(f"Recovering the {key_type.upper()} keystore inside Docker...\n")
    try:
        result = subprocess.run(
            ["monad-keystore", "recover", "--password", password, "--keystore-path", keystore_path, "--key-type", key_type],
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        fail(f"Could not run monad-keystore recover for the {key_type} key.")
    if result.returncode != 0:
        # Recover output can contain private key material; do not relay it.
        fail(f"monad-keystore could not recover the {key_type} key. Check the keystore path and password.")
    source = result.stdout.strip()
    match = re.search(r"(?:private[_ ]?key|secret[_ ]?key)\s*[:=]\s*[\"']?(0x[0-9a-fA-F]{64}|[0-9a-fA-F]{64})", source, re.IGNORECASE)
    raw = match.group(1) if match else source
    if not re.fullmatch(r"(?:0x)?[0-9a-fA-F]{64}", raw):
        fail(f"Could not parse the recovered {key_type} key output.")
    return raw


def packed_uint256(value):
    return int(value).to_bytes(32, byteorder="big")


def sign_with_monad_sdk(request, secp_private_key, bls_private_key):
    try:
        from eth_abi import decode
        from staking_sdk_py import constants
        from staking_sdk_py.generateCalldata import add_validator
        from staking_sdk_py.keyGenerator import KeyGenerator
    except ImportError as error:
        fail("Install Monad's official staking-sdk-cli in the active Python environment before signing.")

    try:
        keys = KeyGenerator.from_keys(secp_private_key=secp_private_key, bls_private_key=bls_private_key)
        calldata = add_validator(
            keys,
            amount=int(request["amount"]),
            auth_address=request["authAddress"],
            commission=int(request["commission"]),
        )
    except Exception:
        fail("Monad's staking SDK could not derive the consensus keys or build registration calldata.")
    selector = str(constants.ADD_VALIDATOR_SELECTOR).removeprefix("0x").lower()
    if not isinstance(calldata, str) or not calldata.startswith("0x") or calldata[2:10].lower() != selector:
        fail("The official staking SDK returned unexpected addValidator calldata.")
    try:
        payload, secp_signature, bls_signature = decode(["bytes", "bytes", "bytes"], bytes.fromhex(calldata[10:]))
    except Exception:
        fail("Could not decode addValidator calldata from the official staking SDK.")

    secp_pubkey = "0x" + keys.pub_secp_key().hex()
    bls_pubkey = "0x" + keys.pub_bls_key().hex()
    expected_payload = b"".join([
        keys.pub_secp_key(),
        keys.pub_bls_key(),
        bytes.fromhex(request["authAddress"][2:]),
        packed_uint256(request["amount"]),
        packed_uint256(request["commission"]),
    ])
    if payload != expected_payload or len(payload) != 165:
        fail("Official SDK payload does not match the requested Monad registration fields.")
    if len(secp_signature) != 64 or len(bls_signature) != 96:
        fail("Official SDK returned an unexpected consensus signature length.")

    return {
        "schema": ARTIFACT_SCHEMA,
        "version": 1,
        "chainId": request["chainId"],
        "operator": request["operator"],
        "saltSeed": request["saltSeed"],
        "authAddress": request["authAddress"],
        "amount": request["amount"],
        "commission": request["commission"],
        "secpPubkey": secp_pubkey,
        "blsPubkey": bls_pubkey,
        "payload": "0x" + payload.hex(),
        "signedSecpMessage": "0x" + secp_signature.hex(),
        "signedBlsMessage": "0x" + bls_signature.hex(),
    }


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--":
        sys.argv.pop(1)
    parser = argparse.ArgumentParser(description="Sign a Quevra validator request with Monad's official staking SDK.")
    parser.add_argument("--request", required=True, help="JSON signing request copied from Quevra")
    parser.add_argument("--secp-keystore-path", required=True, help="Existing Monad SECP keystore path")
    parser.add_argument("--bls-keystore-path", required=True, help="Existing Monad BLS keystore path")
    parser.add_argument("--out", help="Artifact path; defaults to ignored validator-keys/ folder")
    parser.add_argument("--password-stdin", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.password_stdin:
        password = sys.stdin.read()
    else:
        load_repository_env()
        password = os.environ.get("KEYSTORE_PASSWORD")
    if not password:
        fail("Set KEYSTORE_PASSWORD in the environment or repository .env before signing.")

    request = validate_request(json.loads(Path(args.request).read_text(encoding="utf8")))
    secp_key = recover_private_key(args.secp_keystore_path, "secp", password)
    bls_key = recover_private_key(args.bls_keystore_path, "bls", password)
    sys.stderr.write("Signing the registration payload with Monad's official SDK...\n")
    artifact = sign_with_monad_sdk(request, secp_key, bls_key)
    output = json.dumps(artifact, indent=2) + "\n"

    if args.out:
        output_path = Path(args.out).resolve()
    else:
        repo_root = Path(__file__).resolve().parents[3]
        default_dir = repo_root / "validator-keys"
        default_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(default_dir, 0o700)
        output_path = default_dir / f"registration-{os.getpid()}.json"
    output_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        with output_path.open("x", encoding="utf8") as artifact_file:
            os.chmod(output_path, 0o600)
            artifact_file.write(output)
    except FileExistsError:
        fail(f"Refusing to overwrite existing artifact: {output_path}")
    # stdout is the portable signed message the operator pastes into Quevra.
    sys.stderr.write("Signed public artifact created.\n")
    sys.stdout.write(output)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        sys.exit(1)
