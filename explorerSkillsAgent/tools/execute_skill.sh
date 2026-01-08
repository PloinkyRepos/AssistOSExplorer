#!/bin/sh
INPUT="$(cat)"
export EXECUTE_SKILL_PAYLOAD="${INPUT}"

# Default SKILLS_DIR to the agent's local .AchillesSkills folder.
if [ -z "${SKILLS_DIR}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  SKILLS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)/.AchillesSkills"
  export SKILLS_DIR
fi

node --input-type=module <<'NODE' 2>&1
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  const raw = process.env.EXECUTE_SKILL_PAYLOAD || '';
  const envelope = raw && raw.trim() ? safeJsonParse(raw) : null;
  const inputData = envelope?.input && typeof envelope.input === 'object' ? envelope.input : {};
  const skillName = String(inputData.skillName || '').trim();
  const skillInput = inputData.input;

  if (!skillName) {
    process.stdout.write(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ ok: false, message: '', error: 'skillName is required' }) }]
    }));
    return;
  }

  const skillsDir = process.env.SKILLS_DIR || '';
  if (!skillsDir) {
    throw new Error('SKILLS_DIR is not set.');
  }

  const skillFile = path.join(skillsDir, skillName, `${skillName}.js`);
  try {
    await fs.access(skillFile);
  } catch {
    process.stdout.write(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ ok: false, message: '', error: `Skill not found: ${skillName}` }) }]
    }));
    return;
  }

  try {
    const mod = await import(pathToFileURL(skillFile).href);
    const fn = mod?.default;
    if (typeof fn !== 'function') {
      throw new Error(`Skill "${skillName}" does not export a default function.`);
    }

    const workspaceRoot = process.env.WORKSPACE_ROOT || process.env.ASSISTOS_FS_ROOT || '';
    const result = await fn(skillInput, { workspaceRoot });

    process.stdout.write(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ ok: true, message: typeof result === 'string' ? result : String(result ?? '') }) }]
    }));
  } catch (e) {
    const msg = e?.message ? String(e.message) : String(e);
    process.stdout.write(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ ok: false, message: '', error: msg }) }]
    }));
  }
}

main();
NODE

