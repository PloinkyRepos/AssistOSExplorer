#!/bin/sh
set -eu
cd /code
export PERSISTENCE_FOLDER="${PERSISTENCE_FOLDER:-/data/persisto}"
mkdir -p "$PERSISTENCE_FOLDER"
exec node main.mjs
