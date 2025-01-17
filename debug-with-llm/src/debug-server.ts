import * as net from 'net';
import * as vscode from 'vscode';

export interface DebugCommand {
    command: 'listFiles' | 'getFile' | 'debug';
    payload: any;
}

export interface DebugStep {
    type: 'setBreakpoint' | 'removeBreakpoint' | 'continue' | 'evaluate' | 'launch';
    file: string;
    line?: number;
    expression?: string;
}

export class DebugServer {
    private server: net.Server | null = null;
    private readonly port = 4711;

    async start(): Promise<void> {
        if (this.server) {
            throw new Error('Server is already running');
        }

        this.server = net.createServer((socket) => {
            socket.on('data', (data) => this.handleCommand(socket, data));
        });

        return new Promise((resolve, reject) => {
            this.server!.listen(this.port, () => {
                vscode.window.showInformationMessage('MCP Debug server started');
                resolve();
            });

            this.server!.on('error', (err) => {
                reject(err);
            });
        });
    }

    private async handleCommand(socket: net.Socket, data: Buffer) {
        try {
            const command: DebugCommand = JSON.parse(data.toString());
            let response: any;

            if (command.command === 'listFiles') {
                response = await this.handleListFiles(command.payload);
            } else if (command.command === 'getFile') {
                response = await this.handleGetFile(command.payload);
            } else if (command.command === 'debug') {
                response = await this.handleDebug(command.payload);
            } else {
                throw new Error(`Unknown command: ${command.command}`);
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
        // Ensure Python extension is available
        const pythonExtension = vscode.extensions.getExtension('ms-python.python');
        if (!pythonExtension) {
            throw new Error('Python extension not installed');
        }
    
        // Create debug configuration
        const config = {
            type: 'python',
            name: 'MCP Python Debug',
            request: 'launch',
            program: payload.program,
            args: payload.args || [],
            console: 'integratedTerminal',
            justMyCode: true
        };
    
        // Start debugging
        await vscode.debug.startDebugging(undefined, config);
        
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
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) throw new Error('No active editor');

                    const bp = new vscode.SourceBreakpoint(
                        new vscode.Location(
                            editor.document.uri,
                            new vscode.Position(step.line - 1, 0)
                        )
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