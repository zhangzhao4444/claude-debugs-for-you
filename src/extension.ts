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
    const port = config.get<number>('port');
    const server = new DebugServer(port ?? 4711);

    function startServer() {
        server.start().catch(err => {
            vscode.window.showErrorMessage(`Failed to start debug server: ${err.message}`);
        });
    }

    if (config.get<boolean>('autostart')) {
      startServer();
    }

    context.subscriptions.push(...[
        vscode.commands.registerCommand('vscode-mcp-debug.restart', () => {
            server.stop().catch(err => {
                vscode.window.showErrorMessage(`Failed to stop debug server: ${err.message}`);
            }).then(() => {
                startServer();
            });
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.stop', () => {
            server.stop().catch(err => {
                vscode.window.showErrorMessage(`Failed to stop debug server: ${err.message}`);
            });
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.copyStdioPath', () => {
            await vscode.env.clipboard.writetext(mcpServerPath);
            vscode.window.showInformationMessage(`MCP stdio server path copied to clipboard.`);
        }),
        vscode.commands.registerCommand('vscode-mcp-debug.copySseAddress', () => {
            await vscode.env.clipboard.writetext(`http://localhost:${port}/sse`);
            vscode.window.showInformationMessage(`MCP sse server address copied to clipboard.`);
        }),
    ]);
}

export function deactivate() {}
