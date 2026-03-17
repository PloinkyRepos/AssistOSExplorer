#!/usr/bin/env bash
set -euo pipefail

/bin/bash "$(dirname "$0")/setup-sso.sh" bootstrap
