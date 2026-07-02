#!/bin/sh
set -eu
cd /code
if [ ! -d vendor/Persisto/src ]; then
    rm -rf vendor/Persisto
    mkdir -p vendor
    git clone --depth 1 https://github.com/OpenDSU/Persisto.git vendor/Persisto
fi
node -e "require('/code/vendor/Persisto/src/persistence/Persisto.cjs'); console.log('persisto ok')"
