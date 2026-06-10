export async function callAgentToolViaRouter(page, { agent, tool, args = {} }) {
  return page.evaluate(async ({ agent, tool, args }) => {
    const endpoint = `/${encodeURIComponent(agent)}/mcp`;
    const initResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'smoke-init',
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'assistos-smoke', version: '1.0.0' },
        },
      }),
    });
    const sessionId = initResponse.headers.get('mcp-session-id');
    if (!sessionId) throw new Error(`MCP initialize on ${endpoint} did not return a session id.`);
    await initResponse.json();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'smoke-tool',
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
    });
    const body = await response.json();
    if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
    const result = body.result;
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const jsonBlock = blocks.find((block) => block?.type === 'json' && block.json && typeof block.json === 'object');
    if (jsonBlock) return jsonBlock.json;
    const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
    if (textBlock) {
      try {
        return JSON.parse(textBlock.text);
      } catch {
        return { rawText: textBlock.text };
      }
    }
    return result;
  }, { agent, tool, args });
}
