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
    if (result && typeof result === 'object' && !Array.isArray(result) && !Array.isArray(result.content)) {
        return result;
    }
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

export async function sendAuthCode({ to, code, correlationId = '' }) {
    const client = await createEmailAgentClient();
    try {
        const result = parseToolResult(await client.callTool('email_send_auth_code', {
            to,
            code,
            correlationId,
        }));
        if (result?.ok === false || result?.error) {
            return {
                delivered: false,
                result: result.error || 'email-agent-error',
            };
        }
        return {
            delivered: true,
            providerMessageId: result.providerMessageId || '',
            result,
        };
    } finally {
        await client.close?.().catch(() => {});
    }
}

export async function sendAuthCodeEmail({ email, code, correlationId = '' }) {
    return sendAuthCode({ to: email, code, correlationId });
}
