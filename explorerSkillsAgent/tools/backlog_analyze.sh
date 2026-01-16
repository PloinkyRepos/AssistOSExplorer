#!/bin/sh
INPUT="$(cat)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

printf '%s' "${INPUT}" | node -e '
  const fs = require("fs");
  let envelope = {};
  try { envelope = JSON.parse(fs.readFileSync(0, "utf8")); } catch { envelope = {}; }
  const payload = envelope && typeof envelope === "object" ? (envelope.input || {}) : {};
  const next = { action: "analyze", ...payload };
  process.stdout.write(JSON.stringify({ input: { skillName: "backlog-skill", input: next } }));
' | sh "${SCRIPT_DIR}/execute_skill.sh"
