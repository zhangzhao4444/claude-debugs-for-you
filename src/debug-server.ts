import * as net from 'net';
import * as vscode from 'vscode';

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

export class DebugServer {
    private server: net.Server | null = null;
    private port: number = 4711;

    constructor(port?: number) {
        this.port = port || 4711;
    }

    private readonly tools = [
        {
            name: "listFiles",
            description: listFilesDescription,
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
            description: getFileContentDescription,
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
            description: debugDescription,
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
                                expression: { 
                                    description: "An expression to be evaluated in the stack frame of the current breakpoint",
                                    type: "string"
                                 },
                                condition: {
                                    description: "If needed, a breakpoint condition may be specified to only stop on a breakpoint for some given condition.",
                                    type: "string"
                                },
                            },
                            required: ["type", "file"]
                        }
                    }
                },
                required: ["steps"]
            }
        }
    ];

    async start(serverPath?: string): Promise<void> {
        if (this.server) {
            throw new Error('Server is already running');
        }

        this.server = net.createServer((socket) => {
            socket.on('data', (data) => this.handleCommand(socket, data));
        });

        return new Promise((resolve, reject) => {
            this.server!.listen(this.port, () => {
                vscode.window.showInformationMessage(`MCP Debug server started${serverPath ? `: ${serverPath}` : ""}`);
                resolve();
            });

            this.server!.on('error', (err) => {
                reject(err);
            });
        });
    }

    // Modify just the request handling part
    private async handleCommand(socket: net.Socket, data: Buffer) {
        try {
            const request: ToolRequest = JSON.parse(data.toString());
            let response: any;

            if (request.type === 'listTools') {
                response = { tools: this.tools };
            } else if (request.type === 'callTool') {
                if (request.tool === 'listFiles') {
                    response = await this.handleListFiles(request.arguments);
                } else if (request.tool === 'getFileContent') {
                    response = await this.handleGetFile(request.arguments);
                } else if (request.tool === 'debug') {
                    response = await this.handleDebug(request.arguments);
                } else {
                    throw new Error(`Unknown tool: ${request.tool}`);
                }
            } else {
                throw new Error(`Unknown request type: ${request.type}`);
            }

            socket.write(JSON.stringify({ success: true, data: response }));
        } catch (error) {
            socket.write(JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            }));
        }
    }

    private async handleLaunch(payload: { 
        program: string,
        args?: string[]
    }): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        // Try to get launch configurations
        const launchConfig = vscode.workspace.getConfiguration('launch', workspaceFolder.uri);
        const configurations = launchConfig.get<any[]>('configurations');
        
        if (!configurations || configurations.length === 0) {
            throw new Error('No debug configurations found in launch.json');
        }

        // Get the first configuration and update it with the current file
        const config = {...configurations[0]};
        
        // Replace ${file} with actual file path if it exists in the configuration
        Object.keys(config).forEach(key => {
            if (typeof config[key] === 'string') {
                config[key] = config[key].replace('${file}', payload.program);
            }
        });

        // Replace ${workspaceFolder} in environment variables if they exist
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

        // Start debugging using the configured launch configuration
        await vscode.debug.startDebugging(workspaceFolder, config);
        
        // Wait for session to be available
        const session = await this.waitForDebugSession();
    
        // Check if we're at a breakpoint
        try {
            const threads = await session.customRequest('threads');
            const threadId = threads.threads[0].id;
            
            const stack = await session.customRequest('stackTrace', { threadId });
            if (stack.stackFrames && stack.stackFrames.length > 0) {
                const topFrame = stack.stackFrames[0];
                const currentBreakpoints = vscode.debug.breakpoints.filter(bp => {
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

    private async handleListFiles(payload: { 
        includePatterns?: string[], 
        excludePatterns?: string[] 
    }): Promise<string[]> {
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
            files.push(...foundFiles.map(file => file.fsPath));
        }

        return files;
    }

    private async handleGetFile(payload: { path: string }): Promise<string> {
        const doc = await vscode.workspace.openTextDocument(payload.path);
        const lines = doc.getText().split('\n');
        return lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
    }

    private async handleDebug(payload: { steps: DebugStep[] }): Promise<string[]> {
        const results: string[] = [];

        for (const step of payload.steps) {
            switch (step.type) {
                case 'setBreakpoint': {
                    if (!step.line) throw new Error('Line number required');
                    if (!step.file) throw new Error('File path required');

                    // Open the file and make it active
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
                    const bps = vscode.debug.breakpoints.filter(bp => {
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
                    if (!session) {
                        throw new Error('No active debug session');
                    }
                    await session.customRequest('continue');
                    results.push('Continued execution');
                    break;
                }

                case 'evaluate': {
                    const session = vscode.debug.activeDebugSession;
                    if (!session) {
                        throw new Error('No active debug session');
                    }
                    // Get the current stack frame
                    const frames = await session.customRequest('stackTrace', {
                        threadId: 1  // You might need to get the actual threadId
                    });
                    
                    if (!frames || !frames.stackFrames || frames.stackFrames.length === 0) {
                        vscode.window.showErrorMessage('No stack frame available');
                        break;
                    }

                    const frameId = frames.stackFrames[0].id;  // Usually use the top frame

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
                }
            }
        }

        return results;
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.server) {
                resolve();
                return;
            }

            this.server.close(() => {
                this.server = null;
                resolve();
            });
        });
    }
}