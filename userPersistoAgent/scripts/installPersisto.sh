#!/bin/sh
set -eu
cd /code
persisto_commit="a711a67f6bdfdec15af91f9f79aa8a0d69397149"
if [ ! -d vendor/Persisto/.git ]; then
    rm -rf vendor/Persisto
    mkdir -p vendor
    git clone --no-checkout https://github.com/OpenDSU/Persisto.git vendor/Persisto
fi
git -C vendor/Persisto fetch --depth 1 origin "$persisto_commit"
git -C vendor/Persisto checkout --detach "$persisto_commit"
test "$(git -C vendor/Persisto rev-parse HEAD)" = "$persisto_commit"
node -e "require('/code/vendor/Persisto/src/persistence/Persisto.cjs'); console.log('persisto ok')"
