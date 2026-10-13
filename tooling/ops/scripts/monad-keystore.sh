#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd -- "$OPS_DIR/../.." && pwd)"
IMAGE="${QUEVRA_KEYSTORE_IMAGE:-quevra-monad-keystore:local}"
KEYDIR="${QUEVRA_KEYSTORE_DIR:-$HOME/.quevra/validator}"

usage() {
  cat <<'USAGE'
Usage: bash tooling/ops/scripts/monad-keystore.sh <command>

  build    Build the official Monad keystore and staking SDK image
  create   Create SECP and BLS encrypted keystores on your computer
  public   Print only the public keys of existing keystores
  sign     Sign ./quevra-validator-request.json (or pass --request PATH)
  version  Display keystore binary version
  help     Display this help

Optional: QUEVRA_KEYSTORE_DIR (default: ~/.quevra/validator)
USAGE
}

case "${1:-help}" in
  help|-h|--help) usage; exit 0 ;;
  build|create|public|sign|version) command="$1" ;;
  *) echo "Unknown command: $1" >&2; usage >&2; exit 2 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker Desktop / Docker CLI is required.' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo 'Docker daemon is unavailable. Start Docker Desktop first.' >&2
  exit 1
fi

if [[ "$command" == build ]]; then
  docker build --platform linux/amd64 \
    -t "$IMAGE" \
    -f "$OPS_DIR/docker/monad-keystore/Dockerfile" \
    "$OPS_DIR"
  exit 0
fi

mkdir -p "$KEYDIR"
chmod 700 "$KEYDIR"
KEYDIR="$(cd -- "$KEYDIR" && pwd -P)"
if [[ "$KEYDIR/" == "$REPO_DIR/"* ]]; then
  echo 'Refusing to keep validator keys anywhere inside the Git repository.' >&2
  exit 1
fi

docker_base=(
  docker run --rm
  --platform linux/amd64
  --network none
  --read-only
  --tmpfs /tmp:rw,nosuid,nodev,size=64m
  --cap-drop ALL
  --security-opt no-new-privileges
  --user "$(id -u):$(id -g)"
)

case "$command" in
  create|public)
    if [[ ! -t 0 || ! -t 1 ]]; then
      echo 'This keystore command needs an interactive terminal for password entry.' >&2
      exit 1
    fi
    docker "${docker_base[@]:1}" -it \
      -v "$KEYDIR:/keystore" \
      "$IMAGE" "$command"
    ;;
  sign)
    shift
    [[ "${1:-}" == "--" ]] && shift
    request_path="$REPO_DIR/quevra-validator-request.json"
    secp_path="$KEYDIR/id-secp"
    bls_path="$KEYDIR/id-bls"
    output_path=''
    while (($#)); do
      case "$1" in
        --request|--secp-keystore-path|--bls-keystore-path|--out)
          option="$1"
          if (($# < 2)); then echo "Missing value for $option" >&2; exit 2; fi
          case "$option" in
            --request) request_path="$2" ;;
            --secp-keystore-path) secp_path="$2" ;;
            --bls-keystore-path) bls_path="$2" ;;
            --out) output_path="$2" ;;
          esac
          shift 2
          ;;
        *) echo "Unknown signing option: $1" >&2; exit 2 ;;
      esac
    done
    [[ "$request_path" = /* ]] || request_path="$REPO_DIR/$request_path"
    [[ "$secp_path" = /* ]] || secp_path="$REPO_DIR/$secp_path"
    [[ "$bls_path" = /* ]] || bls_path="$REPO_DIR/$bls_path"
    request_path="$(cd -- "$(dirname -- "$request_path")" && pwd -P)/$(basename -- "$request_path")"
    secp_path="$(cd -- "$(dirname -- "$secp_path")" && pwd -P)/$(basename -- "$secp_path")"
    bls_path="$(cd -- "$(dirname -- "$bls_path")" && pwd -P)/$(basename -- "$bls_path")"
    if [[ ! -f "$request_path" ]]; then
      echo "Signing request not found: $request_path. Save the copied dapp request there or pass --request PATH." >&2
      exit 1
    fi
    if [[ ! -f "$secp_path" || ! -f "$bls_path" ]]; then
      echo "Both keystores must exist (expected $secp_path and $bls_path). Create them with pnpm --filter @quevra/ops keystore:create or pass explicit keystore paths." >&2
      exit 1
    fi
    if [[ -z "$output_path" ]]; then
      mkdir -p "$REPO_DIR/validator-keys"
      chmod 700 "$REPO_DIR/validator-keys"
      output_path="$REPO_DIR/validator-keys/registration-$$.json"
    elif [[ "$output_path" != /* ]]; then
      output_path="$REPO_DIR/$output_path"
    fi
    mkdir -p "$(dirname -- "$output_path")"
    output_path="$(dirname -- "$output_path")/$(basename -- "$output_path")"
    output_dir="$(cd -- "$(dirname -- "$output_path")" && pwd -P)"
    output_path="$output_dir/$(basename -- "$output_path")"
    case "$output_path" in
      "$KEYDIR"/*) echo 'Signed artifacts cannot be written into the keystore directory.' >&2; exit 1 ;;
    esac
    if [[ ! -t 0 || ! -t 1 ]]; then
      echo 'Signing needs an interactive terminal for password entry.' >&2
      exit 1
    fi

    password="${KEYSTORE_PASSWORD:-}"
    if [[ -z "$password" && -f "$REPO_DIR/.env" ]]; then
      password="$(PYTHONDONTWRITEBYTECODE=1 python3 - "$OPS_DIR/src/sign-validator-registration.py" "$REPO_DIR/.env" <<'PY'
import importlib.util
import os
import sys
spec = importlib.util.spec_from_file_location("quevra_signer", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.load_repository_env(sys.argv[2])
print(os.environ.get("KEYSTORE_PASSWORD", ""), end="")
PY
)"
    fi
    if [[ -z "$password" ]]; then
      IFS= read -r -s -p 'Keystore password: ' password </dev/tty
      printf '\n' >/dev/tty
    fi
    if [[ -z "$password" ]]; then echo 'Keystore password cannot be empty.' >&2; exit 1; fi

    output_mount="$(dirname -- "$output_path")"
    printf '%s' "$password" | docker "${docker_base[@]:1}" -i \
      -e PYTHONDONTWRITEBYTECODE=1 \
      -v "$secp_path:/secp-keystore:ro" \
      -v "$bls_path:/bls-keystore:ro" \
      -v "$request_path:/request.json:ro" \
      -v "$output_mount:/output" \
      "$IMAGE" sign \
      --request /request.json \
      --secp-keystore-path /secp-keystore \
      --bls-keystore-path /bls-keystore \
      --out "/output/$(basename -- "$output_path")" \
      --password-stdin
    unset password
    ;;
  version)
    docker "${docker_base[@]:1}" \
      "$IMAGE" version
    ;;
esac
