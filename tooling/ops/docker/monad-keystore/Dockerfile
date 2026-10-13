# Official Ubuntu 24.04 binary distribution for Monad, packaged for local key operations.
# Build on amd64: no Rust toolchain, node service, or blockchain sync needed.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -d -m 0755 /etc/apt/keyrings; \
    curl -fsSL https://pkg.category.xyz/keys/public-key.asc -o /tmp/category-labs.asc; \
    gpg --batch --dearmor -o /etc/apt/keyrings/category-labs.gpg /tmp/category-labs.asc; \
    printf '%s\n' \
      'Types: deb' \
      'URIs: https://pkg.category.xyz/' \
      'Suites: noble' \
      'Components: main' \
      'Signed-By: /etc/apt/keyrings/category-labs.gpg' \
      > /etc/apt/sources.list.d/category-labs.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends monad; \
    command -v monad-keystore; \
    rm -rf /var/lib/apt/lists/* /tmp/category-labs.asc

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends python3 python3-venv git; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    git clone --depth 1 https://github.com/monad-developers/staking-sdk-cli.git /opt/staking-sdk-cli; \
    python3 -m venv /opt/staking-sdk-venv; \
    /opt/staking-sdk-venv/bin/pip install --no-cache-dir /opt/staking-sdk-cli; \
    rm -rf /opt/staking-sdk-cli/.git

COPY docker/monad-keystore/entrypoint.sh /usr/local/bin/quevra-keystore
COPY src/sign-validator-registration.py /opt/quevra/sign-validator-registration.py
RUN chmod 0755 /usr/local/bin/quevra-keystore

WORKDIR /keystore
ENTRYPOINT ["/usr/local/bin/quevra-keystore"]
