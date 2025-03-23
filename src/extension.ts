import * as vscode from 'vscode';
import { DebugServer } from './debug-server';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    // Get the storage path for your extension
    const storagePath = context.globalStorageUri.fsPath;

    // Ensure the storage directory exists
    fs.mkdirSync(storagePath, { recursive: true });
    const mcpServerPath = path.join(storagePath, 'mcp-debug.js');
    const sourcePath = path.join(context.extensionUri.fsPath, 'mcp', 'build', 'index.js');

    try {
        fs.copyFileSync(sourcePath, mcpServerPath);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to setup debug server: ${err.message}`);
        return;
    }

    const config = vscode.workspace.getConfiguration('mcpDebug');
    const port = config.get<number>('port') ?? 4711;

    // Write port configuration to a file that can be read by the MCP server
    const portConfigPath = path.join(storagePath, 'port-config.json');
    try {
        fs.writeFileSync(portConfigPath, JSON.stringify({ port }));
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to write port configuration: ${err.message}`);
    }

    const server = new DebugServer(port, portConfigPath);

    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    statusBarItem.command = 'claude-debugs-for-you.showCommands';

    // Update status bar with server state
    function updateStatusBar() {
        if (server.isRunning) {
            statusBarItem.text = "$(check) Claude Debugs For You";
            statusBarItem.tooltip = "Claude Debugs For You (Running) - Click to show commands";
        } else {
            statusBarItem.text = "$(x) Claude Debugs For You";
            statusBarItem.tooltip = "Claude Debugs For You (Stopped) - Click to show commands";
        }
        statusBarItem.show();
    }

    // Listen for server state changes
    server.on('started', updateStatusBar);
    server.on('stopped', updateStatusBar);

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async e => {
            if (e.affectsConfiguration('mcpDebug.port')) {
                // Always reload the latest configuration
                const updatedConfig = vscode.workspace.getConfiguration('mcpDebug');
                const newPort = updatedConfig.get<number>('port') ?? 4711;

                // Update port configuration file
                try {
                    const portConfigPath = path.join(storagePath, 'port-config.json');
                    fs.writeFileSync(portConfigPath, JSON.stringify({ port: newPort }));
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to write port configuration: ${err.message}`);
                }

                // Update server's port setting
                server.setPort(newPort);

                if (server.isRunning) {
                    // Port changed, restart server with new port
                    vscode.window.showInformationMessage(`Port changed to ${newPort}. Restarting server...`);
                    await vscode.commands.executeCommand('vscode-mcp-debug.restart');
                }
            } else if (e.affectsConfiguration('mcpDebug')) {
                updateStatusBar();
            }
        })
    );

    // Initial state
    updateStatusBar();

    async function startServer() {
        // Always get the current port from config
        const updatedConfig = vscode.workspace.getConfiguration('mcpDebug');
        const currentPort = updatedConfig.get<number>('port') ?? 4711;
        server.setPort(currentPort);

        try {
            await server.start();
        } catch (err: any) {
            // Check if this is likely a port conflict (server already running)
            const nodeErr = err as NodeJS.ErrnoException;
            if ((nodeErr.code === 'EADDRINUSE') || (nodeErr.message && nodeErr.message.includes('already running'))) {
                const response = await vscode.window.showInformationMessage(
                    `Failed to start debug server. Another server is likely already running in a different VS Code window. Would you like to stop it and start the server in this window?`,
                    'Yes', 'No'
                );

                if (response === 'Yes') {
                    try {
                        // First try to stop any existing server
                        await server.forceStopExistingServer();
                        // Wait a moment for port to be released
                        await new Promise(resolve => setTimeout(resolve, 500));
                        // Then try to start our server
                        await server.start();
                        vscode.window.showInformationMessage('Debug server successfully started in this window');
                    } catch (startErr: any) {
                        vscode.window.showErrorMessage(`Still failed to start debug server: ${startErr.message}`);
                    }
                }
            } else {
                vscode.window.showErrorMessage(`Failed to start debug server: ${err.message}`);
            }
        }
    }

    const startupConfig = vscode.workspace.getConfiguration('mcpDebug');
    if (startupConfig.get<boolean>('autostart')) {
        void startServer();
    }

    context.subscriptions.push(
        statusBarItem,
        vscode.commands.registerCommand('claude-debugs-for-you.showCommands', async () => {
            const updatedConfig = vscode.workspace.getConfiguration('mcpDebug');
            const currentPort = updatedConfig.get<number>('port') ?? 4711;
            const commands = [
                // Show either Start or Stop based on server state
                server.isRunning
                    ? { label: "Stop Server", command: 'vscode-mcp-debug.stop' }
                    : { label: "Start Server", command: 'vscode-mcp-debug.restart' },
                { label: `Set Port (currently: ${currentPort})`, command: 'vscode-mcp-debug.setPort' },
                { label: `${updatedConfig.get<boolean>('autostart') ? 'Disable' : 'Enable'} Autostart`, command: 'vscode-mcp-debug.toggleAutostart' },
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
                await startServer();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to stop debug server: ${err.message}`);
                await startServer();
            }
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.stop', () => {
            server.stop()
                .then(() => {
                    vscode.window.showInformationMessage('MCP Debug Server stopped');
                })
                .catch(err => {
                    vscode.window.showErrorMessage(`Failed to stop debug server: ${err.message}`);
                });
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.copyStdioPath', async () => {
            await vscode.env.clipboard.writeText(mcpServerPath);
            vscode.window.showInformationMessage(`MCP stdio server path copied to clipboard.`);
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.copySseAddress', async () => {
            // Always get the latest port from config
            const updatedConfig = vscode.workspace.getConfiguration('mcpDebug');
            const currentPort = updatedConfig.get<number>('port') ?? 4711;
            await vscode.env.clipboard.writeText(`http://localhost:${currentPort}/sse`);
            vscode.window.showInformationMessage(`MCP sse server address copied to clipboard.`);
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.setPort', async () => {
            // Always get the latest configuration
            const updatedConfig = vscode.workspace.getConfiguration('mcpDebug');
            const currentPort = updatedConfig.get<number>('port') ?? 4711;
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
                await updatedConfig.update('port', portNum, vscode.ConfigurationTarget.Global);

                // Update port configuration file
                try {
                    const portConfigPath = path.join(storagePath, 'port-config.json');
                    fs.writeFileSync(portConfigPath, JSON.stringify({ port: portNum }));
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to write port configuration: ${err.message}`);
                }

                // Update server's port setting directly
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
            const updatedConfig = vscode.workspace.getConfiguration('mcpDebug');
            const currentAutostart = updatedConfig.get<boolean>('autostart') ?? true;
            await updatedConfig.update('autostart', !currentAutostart, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Autostart ${!currentAutostart ? 'enabled' : 'disabled'}`);
        }),
    );
}

export function deactivate() {
    // We should already have cleaned up during context disposal, but just in case
}
