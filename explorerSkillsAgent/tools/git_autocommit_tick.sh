#!/bin/sh
INPUT="$(cat)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

printf '%s' "${INPUT}" | node -e '
  const fs = require("fs");
  let envelope = {};
  try { envelope = JSON.parse(fs.readFileSync(0, "utf8")); } catch { envelope = {}; }
  const payload = envelope && typeof envelope === "object" ? (envelope.input || {}) : {};
  process.stdout.write(JSON.stringify({ input: { skillName: "git-autocommit", input: payload } }));
' | sh "${SCRIPT_DIR}/execute_skill.sh"
