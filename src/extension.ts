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
    const server = new DebugServer(config.get<number>('port') ?? 4711);

    function startServer() {
        server.start().then(() => {
            if (config.get<boolean>("showServerPathOnStartup")) {
                vscode.window.showInformationMessage(`MCP Debug server started: ${mcpServerPath}`);
            }
        }).catch(err => {
            vscode.window.showErrorMessage(`Failed to start debug server: ${err.message}`);
        });
    }

    startServer();

    let disposable = vscode.commands.registerCommand('vscode-mcp-debug.restart', () => {
        server.stop().catch(err => {
            vscode.window.showErrorMessage(`Failed to stop debug server: ${err.message}`);
        }).then(() => {
            startServer();
        });
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
