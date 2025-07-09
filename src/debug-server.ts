import * as net from 'net';
import * as http from 'http';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { z } from 'zod';
import * as fs from 'fs';

interface DebugServerEvents {
    on(event: 'started', listener: () => void): this;
    on(event: 'stopped', listener: () => void): this;
    emit(event: 'started'): boolean;
    emit(event: 'stopped'): boolean;
}
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export interface DebugCommand {
    command: 'listFiles' | 'getFileContent' | 'debug';
    payload: any;
}

export interface DebugStep {
    type: 'setBreakpoint' | 'removeBreakpoint' | 'continue' | 'evaluate' | 'launch';
    file: string;
    line?: number;
    expression?: string;
    condition?: string;
}

interface ToolRequest {
    type: 'listTools' | 'callTool';
    tool?: string;
    arguments?: any;
}

const debugDescription = `Execute a debug plan with breakpoints, launch, continues, and expression 
evaluation. ONLY SET BREAKPOINTS BEFORE LAUNCHING OR WHILE PAUSED. Be careful to keep track of where 
you are, if paused on a breakpoint. Make sure to find and get the contents of any requested files. 
Only use continue when ready to move to the next breakpoint. Launch will bring you to the first 
breakpoint. DO NOT USE CONTINUE TO GET TO THE FIRST BREAKPOINT.`;

const listFilesDescription = "List all files in the workspace. Use this to find any requested files.";

const getFileContentDescription = `Get file content with line numbers - you likely need to list files 
to understand what files are available. Be careful to use absolute paths.`;

// Zod schemas for the tools
const listFilesInputSchema = {
    includePatterns: z.array(z.string()).describe("Glob patterns to include (e.g. ['**/*.js'])").optional(),
    excludePatterns: z.array(z.string()).describe("Glob patterns to exclude (e.g. ['node_modules/**'])").optional(),
};

const getFileContentInputSchema = {
    path: z.string().describe("Path to the file. IT MUST BE AN ABSOLUTE PATH AND MATCH THE OUTPUT OF listFiles"),
};

const debugStepSchema = z.object({
    type: z.enum(["setBreakpoint", "removeBreakpoint", "continue", "evaluate", "launch"]).describe(""),
    file: z.string(),
    line: z.number().optional(),
    expression: z.string().describe("An expression to be evaluated in the stack frame of the current breakpoint").optional(),
    condition: z.string().describe("If needed, a breakpoint condition may be specified to only stop on a breakpoint for some given condition.").optional(),
});

const debugInputSchema = {
    steps: z.array(debugStepSchema),
};

// 工具定义集中管理
const TOOL_DEFINITIONS = {
    listFiles: {
        name: "listFiles",
        description: listFilesDescription,
        inputSchema: listFilesInputSchema,
    },
    getFileContent: {
        name: "getFileContent",
        description: getFileContentDescription,
        inputSchema: getFileContentInputSchema,
    },
    debug: {
        name: "debug",
        description: debugDescription,
        inputSchema: debugInputSchema,
    },
};

// 通用CORS处理
function setCorsHeaders(res: http.ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
}

// 工具注册辅助函数
function registerMcpTools(server: DebugServer) {
    server.mcpServer.tool(
        TOOL_DEFINITIONS.listFiles.name,
        TOOL_DEFINITIONS.listFiles.description,
        TOOL_DEFINITIONS.listFiles.inputSchema,
        async (args: any) => {
            const files = await server.handleListFiles(args);
            return { content: [{ type: "text", text: JSON.stringify(files) }] };
        }
    );
    server.mcpServer.tool(
        TOOL_DEFINITIONS.getFileContent.name,
        TOOL_DEFINITIONS.getFileContent.description,
        TOOL_DEFINITIONS.getFileContent.inputSchema,
        async (args: any) => {
            const content = await server.handleGetFile(args);
            return { content: [{ type: "text", text: content }] };
        }
    );
    server.mcpServer.tool(
        TOOL_DEFINITIONS.debug.name,
        TOOL_DEFINITIONS.debug.description,
        TOOL_DEFINITIONS.debug.inputSchema,
        async (args: any) => {
            const results = await server.handleDebug(args);
            return { content: [{ type: "text", text: results.join('\n') }] };
        }
    );
}

export class DebugServer extends EventEmitter implements DebugServerEvents {
    private server: http.Server | null = null;
    private port: number = 4711;
    private portConfigPath: string | null = null;
    private activeTransports: Record<string, SSEServerTransport> = {};
    public mcpServer: McpServer;
    private _isRunning: boolean = false;

    constructor(port?: number, portConfigPath?: string) {
        super();
        this.port = port || 4711;
        this.portConfigPath = portConfigPath || null;
        this.mcpServer = new McpServer({
            name: "Debug Server",
            version: "1.0.0",
        });
        registerMcpTools(this);
    }

    get isRunning(): boolean {
        return this._isRunning;
    }

    setPort(port: number): void {
        this.port = port || 4711;
        if (this.portConfigPath && typeof port === 'number') {
            try {
                fs.writeFileSync(this.portConfigPath, JSON.stringify({ port }));
            } catch (err) {
                console.error('Failed to update port configuration file:', err);
            }
        }
    }

    getPort(): number {
        return this.port;
    }

    async forceStopExistingServer(): Promise<void> {
        try {
            await new Promise<void>((resolve, reject) => {
                const req = http.request({
                    hostname: 'localhost',
                    port: this.port,
                    path: '/shutdown',
                    method: 'POST',
                    timeout: 3000
                }, (res: http.IncomingMessage) => {
                    let data = '';
                    res.on('data', (chunk: Buffer) => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            setTimeout(resolve, 500);
                        } else {
                            reject(new Error(`Unexpected status: ${res.statusCode}`));
                        }
                    });
                });
                req.on('error', (err: NodeJS.ErrnoException) => {
                    if (err.code === 'ECONNREFUSED') {
                        resolve();
                    } else {
                        reject(err);
                    }
                });
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Request timed out'));
                });
                req.end();
            });
        } catch (err) {
            console.error('Error requesting server shutdown:', err);
            throw new Error('Failed to stop existing server');
        }
    }

    async start(): Promise<void> {
        if (this.server) {
            throw new Error('Server is already running');
        }
        this.server = http.createServer(this.handleHttpRequest.bind(this));
        return new Promise((resolve, reject) => {
            this.server!.listen(this.port, () => {
                this._isRunning = true;
                this.emit('started');
                resolve();
            }).on('error', reject);
        });
    }

    private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204).end();
            return;
        }
        if (req.method === 'POST' && req.url === '/shutdown') {
            res.writeHead(200).end('Server shutting down');
            this.stop().catch(err => {
                res.writeHead(500).end(`Error shutting down: ${err.message}`);
            });
            return;
        }
        if (req.method === 'POST' && req.url === '/tcp') {
            let body = '';
            req.on('data', (chunk: Buffer) => body += chunk);
            req.on('end', async () => {
                try {
                    const request = JSON.parse(body);
                    let response: any;
                    if (request.type === 'listTools') {
                        response = Object.values(TOOL_DEFINITIONS);
                    } else if (request.type === 'callTool') {
                        response = await this.handleCommand(request);
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, data: response }));
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    }));
                }
            });
            return;
        }
        if (req.method === 'GET' && req.url === '/sse') {
            const transport = new SSEServerTransport('/messages', res);
            this.activeTransports[transport.sessionId] = transport;
            await this.mcpServer.connect(transport);
            res.on('close', () => {
                delete this.activeTransports[transport.sessionId];
            });
            return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/messages')) {
            const url = new URL(req.url, 'http://localhost');
            const sessionId = url.searchParams.get('sessionId');
            if (!sessionId || !this.activeTransports[sessionId]) {
                res.writeHead(404).end('Session not found');
                return;
            }
            await this.activeTransports[sessionId].handlePostMessage(req, res);
            return;
        }
        res.writeHead(404).end();
    }

    private async handleCommand(request: ToolRequest): Promise<any> {
        switch (request.tool) {
            case 'listFiles':
                return await this.handleListFiles(request.arguments);
            case 'getFileContent':
                return await this.handleGetFile(request.arguments);
            case 'debug':
                return await this.handleDebug(request.arguments);
            default:
                throw new Error(`Unknown tool: ${request.tool}`);
        }
    }

    async handleListFiles(payload: { includePatterns?: string[], excludePatterns?: string[] }): Promise<string[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('No workspace folders found');
        }
        const includePatterns = payload.includePatterns || ['**/*'];
        const excludePatterns = payload.excludePatterns || ['**/node_modules/**', '**/.git/**'];
        const files: string[] = [];
        for (const folder of workspaceFolders) {
            const relativePattern = new vscode.RelativePattern(folder, `{${includePatterns.join(',')}}`);
            const foundFiles = await vscode.workspace.findFiles(relativePattern, `{${excludePatterns.join(',')}}`);
            files.push(...foundFiles.map((file: vscode.Uri) => file.fsPath));
        }
        return files;
    }

    async handleGetFile(payload: { path: string }): Promise<string> {
        const doc = await vscode.workspace.openTextDocument(payload.path);
        const lines = doc.getText().split('\n');
        return lines.map((line: string, i: number) => `${i + 1}: ${line}`).join('\n');
    }

    async handleDebug(payload: { steps: DebugStep[] }): Promise<string[]> {
        const results: string[] = [];
        for (const step of payload.steps) {
            switch (step.type) {
                case 'setBreakpoint': {
                    if (!step.line) throw new Error('Line number required');
                    if (!step.file) throw new Error('File path required');
                    const document = await vscode.workspace.openTextDocument(step.file);
                    const editor = await vscode.window.showTextDocument(document);
                    const bp = new vscode.SourceBreakpoint(
                        new vscode.Location(
                            editor.document.uri,
                            new vscode.Position(step.line - 1, 0)
                        ),
                        true,
                        step.condition,
                    );
                    await vscode.debug.addBreakpoints([bp]);
                    results.push(`Set breakpoint at line ${step.line}`);
                    break;
                }
                case 'removeBreakpoint': {
                    if (!step.line) throw new Error('Line number required');
                    const bps = vscode.debug.breakpoints.filter((bp: vscode.Breakpoint) => {
                        if (bp instanceof vscode.SourceBreakpoint) {
                            return bp.location.range.start.line === step.line! - 1;
                        }
                        return false;
                    });
                    await vscode.debug.removeBreakpoints(bps);
                    results.push(`Removed breakpoint at line ${step.line}`);
                    break;
                }
                case 'continue': {
                    const session = vscode.debug.activeDebugSession;
                    if (!session) throw new Error('No active debug session');
                    await session.customRequest('continue');
                    results.push('Continued execution');
                    break;
                }
                case 'evaluate': {
                    const session = vscode.debug.activeDebugSession;
                    if (!session) throw new Error('No active debug session');
                    const activeStackItem = vscode.debug.activeStackItem;
                    let frameId = undefined;
                    if (activeStackItem instanceof vscode.DebugStackFrame) {
                        frameId = activeStackItem.frameId;
                    }
                    if (!frameId) {
                        const frames = await session.customRequest('stackTrace', { threadId: 1 });
                        if (!frames || !frames.stackFrames || frames.stackFrames.length === 0) {
                            vscode.window.showErrorMessage('No stack frame available');
                            break;
                        }
                        frameId = frames.stackFrames[0].id;
                    }
                    try {
                        const response = await session.customRequest('evaluate', {
                            expression: step.expression,
                            frameId: frameId,
                            context: 'repl'
                        });
                        results.push(`Evaluated "${step.expression}": ${response.result}`);
                    } catch (err) {
                        vscode.window.showErrorMessage(`Failed to execute: ${err}`);
                    }
                    break;
                }
                case 'launch': {
                    await this.handleLaunch({ program: step.file });
                    break;
                }
            }
        }
        return results;
    }

    private async handleLaunch(payload: { program: string, args?: string[] }): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }
        const launchConfig = vscode.workspace.getConfiguration('launch', workspaceFolder.uri);
        const configurations = launchConfig.get<any[]>('configurations');
        if (!configurations || configurations.length === 0) {
            throw new Error('No debug configurations found in launch.json');
        }
        const config = { ...configurations[0] };
        Object.keys(config).forEach(key => {
            if (typeof config[key] === 'string') {
                config[key] = config[key].replace('${file}', payload.program);
            }
        });
        if (config.env) {
            Object.keys(config.env).forEach(key => {
                if (typeof config.env[key] === 'string') {
                    config.env[key] = config.env[key].replace(
                        '${workspaceFolder}',
                        workspaceFolder.uri.fsPath
                    );
                }
            });
        }
        let session = vscode.debug.activeDebugSession;
        if (!session) {
            await vscode.debug.startDebugging(workspaceFolder, config);
            session = await this.waitForDebugSession();
        }
        try {
            const threads = await session.customRequest('threads');
            const threadId = threads.threads[0].id;
            const stack = await session.customRequest('stackTrace', { threadId });
            if (stack.stackFrames && stack.stackFrames.length > 0) {
                const topFrame = stack.stackFrames[0];
                const currentBreakpoints = vscode.debug.breakpoints.filter((bp: vscode.Breakpoint) => {
                    if (bp instanceof vscode.SourceBreakpoint) {
                        return bp.location.uri.toString() === topFrame.source.path &&
                            bp.location.range.start.line === (topFrame.line - 1);
                    }
                    return false;
                });
                if (currentBreakpoints.length > 0) {
                    return `Debug session started - Stopped at breakpoint on line ${topFrame.line}`;
                }
            }
            return 'Debug session started';
        } catch (err) {
            console.error('Error checking breakpoint status:', err);
            return 'Debug session started';
        }
    }

    private waitForDebugSession(): Promise<vscode.DebugSession> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for debug session'));
            }, 5000);
            const checkSession = () => {
                const session = vscode.debug.activeDebugSession;
                if (session) {
                    clearTimeout(timeout);
                    resolve(session);
                } else {
                    setTimeout(checkSession, 100);
                }
            };
            checkSession();
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.server) {
                this._isRunning = false;
                this.emit('stopped');
                resolve();
                return;
            }
            Object.values(this.activeTransports).forEach(transport => {
                transport.close();
            });
            this.activeTransports = {};
            this.server.close(() => {
                this.server = null;
                this._isRunning = false;
                this.emit('stopped');
                resolve();
            });
        });
    }
}
