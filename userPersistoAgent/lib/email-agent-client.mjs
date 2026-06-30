function extractToolText(result) {
  if (typeof result === 'string') return result;
  if (Array.isArray(result?.content)) {
    return result.content
      .filter((entry) => entry?.type === 'text')
      .map((entry) => entry.text || '')
      .join('\n');
  }
  return JSON.stringify(result || {});
}

function parseToolResult(result) {
  const text = extractToolText(result);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function createEmailAgentClient() {
  const module = await import('/Agent/client/AgentMcpClient.mjs');
  return module.createAgentClient('emailAgent');
}

export async function sendAuthCodeEmail({ email, code, expiresAt }) {
  const client = await createEmailAgentClient();
  const result = parseToolResult(await client.callTool('email_send_auth_code', { email, code, expiresAt }));
  if (result?.ok === false) {
    throw new Error(result.error || 'EmailAgent failed to send the authentication code.');
  }
  return { ok: true };
}
