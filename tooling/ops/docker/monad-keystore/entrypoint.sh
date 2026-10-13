#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat <<'USAGE'
Quevra Monad keystore (official monad-keystore binary)

Commands:
  create    Generate encrypted SECP and BLS keystores (one time)
  public    Print public keys only, after asking for keystore password
  sign      Sign a Quevra request using Monad's official staking SDK
  version   Display monad-keystore version
  help      Show this help

All keys are kept under /keystore (mounted outside the repo).
No raw private keys or IKM are intentionally printed by this wrapper.
USAGE
}

password_prompt() {
  if [[ ! -t 0 ]]; then
    echo 'Error: use an interactive terminal for password input.' >&2
    exit 1
  fi
  IFS= read -r -s -p 'Keystore password: ' password
  printf '\n'
  if [[ -z "$password" ]]; then
    echo 'Error: password cannot be empty.' >&2
    exit 1
  fi
}

# The upstream binary writes secret IKM/private keys to stdout.
# Filter stdout as it streams, forwarding only public-key lines.
public_only() {
  awk 'tolower($0) ~ /public key/ { print }'
}

case "${1:-help}" in
  create)
    if [[ -e /keystore/id-secp || -e /keystore/id-bls ]]; then
      echo 'Refusing to overwrite existing keys. Both id-secp and id-bls must be absent.' >&2
      exit 1
    fi
    password_prompt
    IFS= read -r -s -p 'Confirm password: ' confirmation
    printf '\n'
    if [[ "$password" != "$confirmation" ]]; then
      echo 'Error: passwords do not match.' >&2
      exit 1
    fi
    unset confirmation
    echo 'Generating SECP256K1 keystore...'
    monad-keystore create --key-type secp --keystore-path /keystore/id-secp --password "$password" | public_only
    echo 'Generating BLS keystore...'
    monad-keystore create --key-type bls --keystore-path /keystore/id-bls --password "$password" | public_only
    unset password
    echo 'Encrypted keystores created: id-secp and id-bls.'
    echo 'Back up BOTH files and the password securely, outside Git.'
    ;;
  public)
    if [[ ! -f /keystore/id-secp || ! -f /keystore/id-bls ]]; then
      echo 'Error: both keystores are required. Run create first.' >&2
      exit 1
    fi
    password_prompt
    echo 'SECP256K1:'
    monad-keystore recover --key-type secp --keystore-path /keystore/id-secp --password "$password" | public_only
    echo 'BLS:'
    monad-keystore recover --key-type bls --keystore-path /keystore/id-bls --password "$password" | public_only
    unset password
    ;;
  sign)
    shift
    exec /opt/staking-sdk-venv/bin/python /opt/quevra/sign-validator-registration.py "$@"
    ;;
  version)
    monad-keystore --version
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $1" >&2
    usage >&2
    exit 2
    ;;
esac
