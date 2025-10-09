class AssistosSDK {
    constructor() {
    }

    async callTool(agentId, tool, args = {}) {
        const url = `/mcps/${agentId}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'},
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now().toString(),
                method: 'tools/call',
                params: {name: tool, arguments: args}
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`HTTP error! status: ${response.status}`, errorText);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.error) {
            console.error("Agent Error:", data.error);
            throw new Error(data.error.message);
        }

        const blocks = Array.isArray(data.result?.content) ? data.result.content : [];
        const firstText = blocks.find(block => block?.type === 'text')?.text;

        if (typeof firstText !== 'string') {
            console.warn('Agent response did not include text content.');
            return { text: JSON.stringify(data.result, null, 2), blocks, raw: data.result };
        }

        return {text: firstText, blocks, raw: data.result};
    }
}

const assistosSDK = new AssistosSDK();
export default assistosSDK;
