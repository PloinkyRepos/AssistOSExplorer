#!/usr/bin/env node
import { sendTextEmail, sendTemplateEmail, sendAuthCodeEmail, testConfiguration } from '../lib/mailjet.mjs';
import { getEmailSettings, saveEmailSettings } from '../lib/settings.mjs';

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

async function readInput() {
  let raw = '';
  if (!process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
  }
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  let current = parsed;
  for (let i = 0; i < 4; i += 1) {
    if (current?.input && typeof current.input === 'object') current = current.input;
    else if (current?.arguments && typeof current.arguments === 'object') current = current.arguments;
    else if (current?.params?.arguments && typeof current.params.arguments === 'object') current = current.params.arguments;
    else break;
  }
  return current && typeof current === 'object' ? current : {};
}

async function dispatch(toolName, input) {
  switch (toolName) {
    case 'email_send_text':
      return sendTextEmail(input);
    case 'email_send_template':
      return sendTemplateEmail(input);
    case 'email_send_auth_code':
      return sendAuthCodeEmail(input);
    case 'email_test_configuration':
      return testConfiguration();
    case 'email_get_agent_settings':
      return getEmailSettings();
    case 'email_save_agent_settings':
      return saveEmailSettings(input);
    default:
      throw new Error(`Unknown EmailAgent tool: ${toolName}`);
  }
}

try {
  const input = await readInput();
  writeJson(await dispatch(process.env.TOOL_NAME || input.toolName, input));
} catch (error) {
  writeJson({ ok: false, error: error?.message || String(error) });
}
