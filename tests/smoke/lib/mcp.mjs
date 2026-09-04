export async function callAgentToolViaRouter(page, { agent, tool, args = {}, expectedRawText }) {
  if (expectedRawText !== undefined && typeof expectedRawText !== 'string') {
    throw new TypeError('The expected MCP raw text must be a string.');
  }
  return page.evaluate(async ({ agent, tool, args, expectedRawText }) => {
    const endpoint = `/${encodeURIComponent(agent)}/mcp`;
    const proofResponse = await fetch(`/auth/token?agent=${encodeURIComponent(agent)}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    const proofPayload = await proofResponse.json().catch(() => ({}));
    const proof = proofPayload?.browserMutation;
    if (
      !proofResponse.ok
      || !proof?.csrfToken
      || proof.routeKey !== agent
      || proof.origin !== window.location.origin
    ) {
      throw new Error(`Browser mutation proof for ${endpoint} is unavailable.`);
    }
    const mutationHeaders = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'x-ploinky-browser-csrf-token': proof.csrfToken,
    };
    const initResponse = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: mutationHeaders,
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
    const initBody = await initResponse.json().catch(() => ({}));
    const sessionId = initResponse.headers.get('mcp-session-id');
    if (!initResponse.ok || !sessionId || initBody.error) {
      throw new Error(
        `MCP initialize on ${endpoint} failed with HTTP ${initResponse.status}: ${initBody.error?.message || initBody.error || 'no session id'}.`,
      );
    }
    const protocolVersion = initBody.result?.protocolVersion || '2025-06-18';
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...mutationHeaders,
        'mcp-session-id': sessionId,
        'mcp-protocol-version': protocolVersion,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'smoke-tool',
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      throw new Error(
        body.error?.message || body.error || `MCP tool call on ${endpoint} failed with HTTP ${response.status}.`,
      );
    }
    const result = body.result;
    const blocks = Array.isArray(result?.content) ? result.content : [];
    if (expectedRawText !== undefined) {
      // Validate the complete result before the ordinary decoder selects one block.
      if (
        !result || typeof result !== 'object' || Array.isArray(result)
        || (result.isError !== undefined && result.isError !== false)
        || blocks.length !== 1
        || blocks[0]?.type !== 'text'
        || blocks[0].text !== expectedRawText
      ) {
        throw new Error(`MCP tool call on ${endpoint} did not return the exact successful text result.`);
      }
      return { rawText: blocks[0].text };
    }
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
  }, { agent, tool, args, expectedRawText });
}
