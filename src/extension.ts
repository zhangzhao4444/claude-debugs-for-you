import * as vscode from 'vscode';
import { DebugServer } from './debug-server';
import * as fs from 'fs';
import * as path from 'path';

function getStoragePaths(context: vscode.ExtensionContext) {
    const storagePath = context.globalStorageUri.fsPath;
    const mcpServerPath = path.join(storagePath, 'mcp-debug.js');
    const sourcePath = path.join(context.extensionUri.fsPath, 'mcp', 'build', 'index.js');
    const portConfigPath = path.join(storagePath, 'port-config.json');
    return { storagePath, mcpServerPath, sourcePath, portConfigPath };
}

function ensureStorageAndCopyServer(sourcePath: string, mcpServerPath: string, storagePath: string) {
    fs.mkdirSync(storagePath, { recursive: true });
    try {
        fs.copyFileSync(sourcePath, mcpServerPath);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to setup debug server: ${err.message}`);
        return false;
    }
    return true;
}

function writePortConfig(portConfigPath: string, port: number) {
    try {
        fs.writeFileSync(portConfigPath, JSON.stringify({ port }));
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to write port configuration: ${err.message}`);
    }
}

function createStatusBar(server: DebugServer): vscode.StatusBarItem {
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    statusBarItem.command = 'claude-debugs-for-you.showCommands';
    const updateStatusBar = () => {
        if (server.isRunning) {
            statusBarItem.text = "$(check) Claude Debugs For You";
            statusBarItem.tooltip = "Claude Debugs For You (Running) - Click to show commands";
        } else {
            statusBarItem.text = "$(x) Claude Debugs For You";
            statusBarItem.tooltip = "Claude Debugs For You (Stopped) - Click to show commands";
        }
        statusBarItem.show();
    };
    server.on('started', updateStatusBar);
    server.on('stopped', updateStatusBar);
    updateStatusBar();
    return statusBarItem;
}

async function handlePortConflict(server: DebugServer, startupConfig: vscode.WorkspaceConfiguration) {
    try {
        const response = await vscode.window.showInformationMessage(
            `Failed to start debug server. Another server is likely already running in a different VS Code window. Would you like to stop it and start the server in this window?`,
            'Yes', 'No', 'Disable Autostart'
        );
        if (response === 'Yes') {
            try {
                await server.forceStopExistingServer();
                // Wait for the port to be released with retry logic
                let portAvailable = false;
                let retryCount = 0;
                const maxRetries = 5;
                const currentPort = server.getPort();
                while (!portAvailable && retryCount < maxRetries) {
                    try {
                        const net = require('net');
                        const testServer = net.createServer();
                        await new Promise<void>((resolve, reject) => {
                            testServer.once('error', (err: any) => {
                                testServer.close();
                                if (err.code === 'EADDRINUSE') {
                                    reject(new Error('Port still in use'));
                                } else {
                                    reject(err);
                                }
                            });
                            testServer.once('listening', () => {
                                testServer.close();
                                portAvailable = true;
                                resolve();
                            });
                            testServer.listen(currentPort);
                        });
                    } catch {
                        await new Promise(resolve => setTimeout(resolve, 500));
                        retryCount++;
                    }
                }
                if (!portAvailable) {
                    vscode.window.showErrorMessage(`Still failed to start debug server: Port ${currentPort} is still in use after ${maxRetries} attempts to release it`);
                    return;
                }
                try {
                    await server.start();
                } catch (startErr: any) {
                    vscode.window.showErrorMessage(`Still failed to start debug server: ${startErr && startErr.message ? startErr.message : startErr}`);
                }
            } catch (startErr: any) {
                vscode.window.showErrorMessage(`Still failed to start debug server: ${startErr && startErr.message ? startErr.message : startErr}`);
            }
        } else if (response === 'Disable Autostart') {
            await startupConfig.update('autostart', false, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Autostart has been disabled');
        }
        // 用户选择 No 时不报错
    } catch (err: any) {
        vscode.window.showErrorMessage(`Still failed to start debug server: ${err && err.message ? err.message : err}`);
    }
}

async function startServer(server: DebugServer, startupConfig: vscode.WorkspaceConfiguration) {
    const updatedConfig = vscode.workspace.getConfiguration('mcpDebug');
    const currentPort = updatedConfig.get<number>('port') ?? 4711;
    server.setPort(currentPort);
    try {
        await server.start();
    } catch (err: any) {
        await server.stop().catch(() => {});
        const nodeErr = err as NodeJS.ErrnoException;
        if ((nodeErr.code === 'EADDRINUSE') || (nodeErr.message && nodeErr.message.includes('already running'))) {
            await handlePortConflict(server, startupConfig);
        } else {
            vscode.window.showErrorMessage(`Failed to start debug server: ${err && err.message ? err.message : err}`);
        }
    }
}

function registerCommands(context: vscode.ExtensionContext, server: DebugServer, paths: ReturnType<typeof getStoragePaths>) {
    const getCurrentPort = () => {
        const config = vscode.workspace.getConfiguration('mcpDebug');
        return config.get<number>('port') ?? 4711;
    };
    const getAutostart = () => {
        const config = vscode.workspace.getConfiguration('mcpDebug');
        return config.get<boolean>('autostart');
    };
    context.subscriptions.push(
        vscode.commands.registerCommand('claude-debugs-for-you.showCommands', async () => {
            const currentPort = getCurrentPort();
            const commands = [
                server.isRunning
                    ? { label: "Stop Server", command: 'vscode-mcp-debug.stop' }
                    : { label: "Start Server", command: 'vscode-mcp-debug.restart' },
                { label: `Set Port (currently: ${currentPort})`, command: 'vscode-mcp-debug.setPort' },
                { label: `${getAutostart() ? 'Disable' : 'Enable'} Autostart`, command: 'vscode-mcp-debug.toggleAutostart' },
                { label: "Copy stdio path", command: 'vscode-mcp-debug.copyStdioPath' },
                { label: "Copy SSE address", command: 'vscode-mcp-debug.copySseAddress' }
            ];
            const selected = await vscode.window.showQuickPick(commands, {
                placeHolder: 'Select a Claude Debugs For You command'
            });
            if (selected) {
                vscode.commands.executeCommand(selected.command);
            }
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.restart', async () => {
            try {
                await server.stop();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to stop debug server: ${err && err.message ? err.message : err}`);
                throw err;
            }
            try {
                await startServer(server, vscode.workspace.getConfiguration('mcpDebug'));
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to start debug server: ${err && err.message ? err.message : err}`);
            }
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.stop', () => {
            server.stop()
                .then(() => {
                    vscode.window.showInformationMessage('MCP Debug Server stopped');
                })
                .catch(err => {
                    vscode.window.showErrorMessage(`Failed to stop debug server: ${err && err.message ? err.message : err}`);
                });
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.copyStdioPath', async () => {
            await vscode.env.clipboard.writeText(paths.mcpServerPath);
            vscode.window.showInformationMessage(`MCP stdio server path copied to clipboard.`);
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.copySseAddress', async () => {
            const currentPort = getCurrentPort();
            await vscode.env.clipboard.writeText(`http://localhost:${currentPort}/sse`);
            vscode.window.showInformationMessage(`MCP sse server address copied to clipboard.`);
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.setPort', async () => {
            const currentPort = getCurrentPort();
            const newPort = await vscode.window.showInputBox({
                prompt: 'Enter port number for MCP Debug Server',
                placeHolder: 'Port number',
                value: currentPort.toString(),
                validateInput: (input) => {
                    const port = parseInt(input);
                    if (isNaN(port) || port < 1024 || port > 65535) {
                        return 'Please enter a valid port number (1024-65535)';
                    }
                    return null;
                }
            });
            if (newPort) {
                const portNum = parseInt(newPort);
                const config = vscode.workspace.getConfiguration('mcpDebug');
                await config.update('port', portNum, vscode.ConfigurationTarget.Global);
                try {
                    fs.writeFileSync(paths.portConfigPath, JSON.stringify({ port: portNum }));
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to write port configuration: ${err.message}`);
                }
                server.setPort(portNum);
                if (server.isRunning) {
                    const restart = await vscode.window.showInformationMessage(
                        'Port updated. Restart server to apply changes?',
                        'Yes', 'No'
                    );
                    if (restart === 'Yes') {
                        vscode.commands.executeCommand('vscode-mcp-debug.restart');
                    }
                }
            }
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.toggleAutostart', async () => {
            const config = vscode.workspace.getConfiguration('mcpDebug');
            const currentAutostart = config.get<boolean>('autostart') ?? true;
            await config.update('autostart', !currentAutostart, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Autostart ${!currentAutostart ? 'enabled' : 'disabled'}`);
        })
    );
}

export function activate(context: vscode.ExtensionContext) {
    const paths = getStoragePaths(context);
    if (!ensureStorageAndCopyServer(paths.sourcePath, paths.mcpServerPath, paths.storagePath)) {
        return;
    }
    const config = vscode.workspace.getConfiguration('mcpDebug');
    const port = config.get<number>('port') ?? 4711;
    writePortConfig(paths.portConfigPath, port);
    const server = new DebugServer(port, paths.portConfigPath);
    const statusBarItem = createStatusBar(server);
    context.subscriptions.push(statusBarItem);
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async e => {
            if (e.affectsConfiguration('mcpDebug.port')) {
                const updatedConfig = vscode.workspace.getConfiguration('mcpDebug');
                const newPort = updatedConfig.get<number>('port') ?? 4711;
                writePortConfig(paths.portConfigPath, newPort);
                server.setPort(newPort);
                if (server.isRunning) {
                    vscode.window.showInformationMessage(`Port changed to ${newPort}. Restarting server...`);
                    try {
                        await vscode.commands.executeCommand('vscode-mcp-debug.restart');
                    } catch (err) {
                        throw err;
                    }
                }
            } else if (e.affectsConfiguration('mcpDebug')) {
                statusBarItem.show();
            }
        })
    );
    registerCommands(context, server, paths);
    const startupConfig = vscode.workspace.getConfiguration('mcpDebug');
    if (startupConfig.get<boolean>('autostart')) {
        void startServer(server, startupConfig);
    }
}

export function deactivate() {
    // We should already have cleaned up during context disposal, but just in case
}
