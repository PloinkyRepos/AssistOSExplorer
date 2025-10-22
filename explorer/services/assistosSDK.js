import { createAgentClient } from '/MCPBrowserClient.js';

class AssistosSDK {
    constructor() {
        this.clients = new Map();
    }

    getClient(agentId) {
        if (!agentId || typeof agentId !== 'string') {
            throw new Error('Agent id must be a non-empty string.');
        }
        if (!this.clients.has(agentId)) {
            const baseUrl = `/mcps/${agentId}/mcp`;
            this.clients.set(agentId, createAgentClient(baseUrl));
        }
        return this.clients.get(agentId);
    }

    async callTool(agentId, tool, args = {}) {
        const client = this.getClient(agentId);
        try {
            const result = await client.callTool(tool, args);
            const blocks = Array.isArray(result?.content) ? result.content : [];
            const firstText = blocks.find(block => block?.type === 'text' && typeof block.text === 'string');
            const text = firstText ? firstText.text : JSON.stringify(result, null, 2);
            return { text, blocks, raw: result };
        } catch (error) {
            console.error(`Agent call failed (${agentId}:${tool})`, error);
            throw error;
        }
    }
}

const assistosSDK = new AssistosSDK();
export default assistosSDK;
