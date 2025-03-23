import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Try to read port from config file, fallback to default
function getPortFromConfig(): number {
    try {
        // Determine the global storage path based on platform
        let storagePath: string;
        const homeDir = os.homedir();
        
        if (process.platform === 'darwin') {
            storagePath = path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'jasonmcghee.claude-debugs-for-you');
        } else if (process.platform === 'win32') {
            storagePath = path.join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'jasonmcghee.claude-debugs-for-you');
        } else {
            // Linux and others
            storagePath = path.join(homeDir, '.config', 'Code', 'User', 'globalStorage', 'jasonmcghee.claude-debugs-for-you');
        }
        
        const configPath = path.join(storagePath, 'port-config.json');
        
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config && typeof config.port === 'number') {
                return config.port;
            }
        }
    } catch (error) {
        console.error('Error reading port config:', error);
    }
    
    return 4711; // Default port
}

async function makeRequest(payload: any): Promise<any> {
    const port = getPortFromConfig();
    
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        
        const req = http.request({
            hostname: 'localhost',
            port,
            path: '/tcp',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (!response.success) {
                        reject(new Error(response.error || 'Unknown error'));
                    } else {
                        resolve(response.data);
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
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

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return await makeRequest({ type: 'listTools' });
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const response = await makeRequest({
        type: 'callTool',
        tool: request.params.name,
        arguments: request.params.arguments
    });

    return {
        content: [{
            type: "text",
            text: Array.isArray(response) ? response.join("\n") : response
        }]
    };
});

function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function main() {
    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("MCP Debug Server running");
        return true;
    } catch (error) {
        console.error("Error starting server:", error);
        return false;
    }
}

// Only try up to 10 times
const MAX_RETRIES = 10;

// Wait 500ms before each subsequent check
const TIMEOUT = 500;

// Wait 500ms before first check
const INITIAL_DELAY = 500;

(async function() {
    await sleep(INITIAL_DELAY);

    for (let i = 0; i < MAX_RETRIES; i++) {
        const success = await main();
        if (success) {
            break;
        }
        await sleep(TIMEOUT);
    }
})();

