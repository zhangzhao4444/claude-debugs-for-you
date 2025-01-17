import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as net from 'net';

interface VSCodeResponse {
    success: boolean;
    data?: any;
    error?: string;
}

interface DebugStep {
    type: 'setBreakpoint' | 'removeBreakpoint' | 'continue' | 'evaluate' | 'launch';
    line?: number;
    expression?: string;
}

class VSCodeClient {
    private socket: net.Socket;
    private readonly port = 4711;

    constructor() {
        this.socket = new net.Socket();
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.connect(this.port, 'localhost', () => resolve());
            this.socket.on('error', reject);
        });
    }

    async sendCommand(command: string, payload: any): Promise<VSCodeResponse> {
        return new Promise((resolve, reject) => {
            this.socket.once('data', (data) => {
                try {
                    resolve(JSON.parse(data.toString()));
                } catch (error) {
                    reject(error);
                }
            });

            this.socket.write(JSON.stringify({
                command,
                payload
            }));
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
    return {
        tools: [

            {
                name: "listFiles",
                description: "List all files in the workspace. Use this to find any requested files.",
                inputSchema: {
                    type: "object",
                    properties: {
                        includePatterns: {
                            type: "array",
                            items: { type: "string" },
                            description: "Glob patterns to include (e.g. ['**/*.js'])"
                        },
                        excludePatterns: {
                            type: "array",
                            items: { type: "string" },
                            description: "Glob patterns to exclude (e.g. ['node_modules/**'])"
                        }
                    }
                }
            },
            {
                name: "getFileContent",
                description: "Get file content with line numbers - you likely need to list files to understand what files are available. Be careful to use absolute paths.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Path to the file. IT MUST BE AN ABSOLUTE PATH AND MATCH THE OUTPUT OF listFiles"
                        }
                    },
                    required: ["path"]
                }
            },
            {
                name: "debug",
                description: "Execute a debug plan with breakpoints, launch, continues, and expression evaluation. ONLY SET BREAKPOINTS BEFORE LAUNCHING OR WHILE PAUSED. Be careful to keep track of where you are, if paused on a breakpoint. Make sure to find and get the contents of any requested files. Only use continue when ready to move to the next breakpoint. Launch will bring you to the first breakpoint. DO NOT USE CONTINUE TO GET TO THE FIRST BREAKPOINT.",
                inputSchema: {
                    type: "object",
                    properties: {
                        steps: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    type: {
                                        type: "string",
                                        enum: ["setBreakpoint", "removeBreakpoint", "continue", "evaluate", "launch"],
                                        description: ""
                                    },
                                    file: { type: "string" },
                                    line: { type: "number" },
                                    expression: { type: "string" }
                                },
                                required: ["type", "file"]
                            }
                        }
                    },
                    required: ["steps"]
                }
            }
        ]
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        await vscodeClient.connect();

        if (request.params.name === "listFiles") {
            const response = await vscodeClient.sendCommand("listFiles", request.params.arguments || {
                includePatterns: ["**/*"],
                excludePatterns: ["**/node_modules/**", "**/.git/**"]
            });
            
            if (!response.success) {
                throw new Error(response.error || "Failed to list files");
            }

            return {
                content: [{
                    type: "text",
                    text: response.data.join("\n")
                }]
            };
        }

        if (request.params.name === "getFileContent") {
            const response = await vscodeClient.sendCommand("getFile", request.params.arguments);
            
            if (!response.success) {
                throw new Error(response.error || "Failed to get file content");
            }

            return {
                content: [{
                    type: "text",
                    text: response.data
                }]
            };
        }

        if (request.params.name === "debug") {
            const response = await vscodeClient.sendCommand("debug", request.params.arguments);
            
            if (!response.success) {
                throw new Error(response.error || "Failed to execute debug plan");
            }

            return {
                content: [{
                    type: "text",
                    text: Array.isArray(response.data) ? response.data.join("\n") : response.data
                }]
            };
        }

        throw new Error(`Unknown tool: ${request.params.name}`);
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