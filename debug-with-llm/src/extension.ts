import * as vscode from 'vscode';
import * as net from 'net';
import { DebugServer } from './debug-server';

export function activate(context: vscode.ExtensionContext) {
    const server = new DebugServer();
    
    let disposable = vscode.commands.registerCommand('vscode-mcp-debug.start', () => {
        server.start().catch(err => {
            vscode.window.showErrorMessage(`Failed to start debug server: ${err.message}`);
        });
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
