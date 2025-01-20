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
        // Check if symlink already exists
        const stats = fs.lstatSync(mcpServerPath);
        if (!stats.isSymbolicLink()) {
            // If it exists but isn't a symlink, remove and recreate
            fs.unlinkSync(mcpServerPath);
            fs.symlinkSync(sourcePath, mcpServerPath);
        }
        // If it is a symlink, do nothing
    } catch (err) {
        // File doesn't exist, create the symlink
        fs.symlinkSync(sourcePath, mcpServerPath);
    }

    const config = vscode.workspace.getConfiguration('mcpDebug');
    const server = new DebugServer(config.get<number>('port') ?? 4711);
    server.start(mcpServerPath).catch(err => {
        vscode.window.showErrorMessage(`Failed to start debug server: ${err.message}`);
    });

    let disposable = vscode.commands.registerCommand('vscode-mcp-debug.restart', () => {
        server.stop().catch(err => {
            vscode.window.showErrorMessage(`Failed to stop debug server: ${err.message}`);
        }).then(() => {
            server.start().catch(err => {
                vscode.window.showErrorMessage(`Failed to restart debug server: ${err.message}`);
            });
        });
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
