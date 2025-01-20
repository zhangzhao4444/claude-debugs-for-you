import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as net from 'net';

interface VSCodeResponse {
    success: boolean;
    data?: any;
    error?: string;
}

class VSCodeClient {
    private socket: net.Socket;
    private readonly port = Number(process.env.MCP_DEBUGGER_PORT || 4711);

    constructor() {
        this.socket = new net.Socket();
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.connect(this.port, 'localhost', () => resolve());
            this.socket.on('error', reject);
        });
    }

    async sendRequest(request: any): Promise<VSCodeResponse> {
        return new Promise((resolve, reject) => {
            this.socket.once('data', (data) => {
                try {
                    resolve(JSON.parse(data.toString()));
                } catch (error) {
                    reject(error);
                }
            });

            this.socket.write(JSON.stringify(request));
        });
    }

    disconnect(): Promise<void> {
        return new Promise((resolve) => {
            this.socket.end(() => resolve());
        });
    }
}

const server = new Server(
    {
        name: "mcp-debug-server",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

const vscodeClient = new VSCodeClient();

server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
        await vscodeClient.connect();
        const response = await vscodeClient.sendRequest({
            type: "listTools"
        });
        
        if (!response.success) {
            throw new Error(response.error || "Failed to list tools");
        }
        
        return response.data;
    } finally {
        await vscodeClient.disconnect();
    }
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        await vscodeClient.connect();
        const response = await vscodeClient.sendRequest({
            type: "callTool",
            tool: request.params.name,
            arguments: request.params.arguments
        });
        
        if (!response.success) {
            throw new Error(response.error || `Failed to execute tool: ${request.params.name}`);
        }

        return {
            content: [{
                type: "text",
                text: Array.isArray(response.data) ? response.data.join("\n") : response.data
            }]
        };
    } finally {
        await vscodeClient.disconnect();
    }
});

async function main() {
    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("MCP Debug Server running");
    } catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
}

main();