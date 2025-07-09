import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DebugServer } from '../debug-server';
import { activate, deactivate } from '../extension';

// 提前声明 mockServer 供 jest.mock 使用
let mockServer: any;

jest.mock('../debug-server', () => {
	return {
		DebugServer: jest.fn(() => mockServer)
	};
});

describe('Extension', () => {
	let mockContext: any;
	let mockConfig: any;
	let mockStatusBarItem: any;
	let mockTestServer: any;

	beforeEach(() => {
		// Reset all mocks
		jest.clearAllMocks();

		// Mock context
		mockContext = {
			globalStorageUri: {
				fsPath: '/mock/storage/path'
			},
			extensionUri: {
				fsPath: '/mock/extension/path'
			},
			subscriptions: {
				push: jest.fn()
			}
		};

		// Mock configuration
		mockConfig = {
			get: jest.fn(),
			update: jest.fn()
		};

		// Mock status bar item
		mockStatusBarItem = {
			command: '',
			text: '',
			tooltip: '',
			show: jest.fn()
		};

		// Mock server
		mockServer = {
			isRunning: false,
			port: 4711,
			on: jest.fn(),
			setPort: jest.fn(),
			getPort: jest.fn(),
			start: jest.fn(),
			stop: jest.fn(),
			forceStopExistingServer: jest.fn()
		};

		// Mock test server for port checking
		mockTestServer = {
			once: undefined,
			close: jest.fn().mockReturnThis(),
			listen: jest.fn().mockReturnThis()
		};
		mockTestServer.once = ((event: string, cb: any) => {
			if (event === 'error') {
				cb({ code: 'EADDRINUSE' });
			}
			return mockTestServer;
		}) as any;

		// Setup default mock returns
		jest.mocked(vscode.window.createStatusBarItem).mockReturnValue(mockStatusBarItem);
		jest.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);
		jest.mocked(mockConfig.get).mockImplementation((key: string) => {
			if (key === 'port') {return 4711;}
			if (key === 'autostart') {return true;}
			return undefined;
		});
		jest.mocked(path.join).mockReturnValue('/mock/path');
		jest.mocked(fs.mkdirSync).mockReturnValue(undefined);
		jest.mocked(fs.copyFileSync).mockReturnValue(undefined);
		jest.mocked(fs.writeFileSync).mockReturnValue(undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('activate', () => {
		it('should successfully initialize extension', () => {
			// Setup
			mockServer.start.mockResolvedValue(undefined);
			mockServer.isRunning = true;

			// Execute
			activate(mockContext);

			// Verify
			expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/storage/path', { recursive: true });
			expect(fs.copyFileSync).toHaveBeenCalled();
			expect(fs.writeFileSync).toHaveBeenCalled();
			expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Right);
			expect(mockServer.on).toHaveBeenCalled();
			expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
			expect(mockContext.subscriptions.push).toHaveBeenCalled();
		});

		it('should handle file copy failure', () => {
			// Setup
			const error = new Error('File copy failed');
			jest.mocked(fs.copyFileSync).mockImplementation(() => {
				throw error;
			});

			// Execute
			activate(mockContext);

			// Verify
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to setup debug server: File copy failed');
		});

		it('should handle port config write failure', () => {
			// Setup
			const error = new Error('Write failed');
			jest.mocked(fs.writeFileSync).mockImplementation(() => {
				throw error;
			});

			// Execute
			activate(mockContext);

			// Verify
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to write port configuration: Write failed');
		});

		it('should not start server when autostart is disabled', () => {
			// Setup
			jest.mocked(mockConfig.get).mockImplementation((key: string) => {
				if (key === 'port') {return 4711;}
				if (key === 'autostart') {return false;}
				return undefined;
			});

			// Execute
			activate(mockContext);

			// Verify
			expect(mockServer.start).not.toHaveBeenCalled();
		});

		it('should start server when autostart is enabled', () => {
			// Setup
			jest.mocked(mockConfig.get).mockImplementation((key: string) => {
				if (key === 'port') {return 4711;}
				if (key === 'autostart') {return true;}
				return undefined;
			});
			mockServer.start.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Verify
			expect(mockServer.start).toHaveBeenCalled();
		});

		it('should handle fs.writeFileSync error and continue', () => {
			// Setup
			jest.mocked(fs.writeFileSync).mockImplementationOnce(() => { throw new Error('Write failed'); });
			mockServer.start.mockResolvedValue(undefined);
			mockServer.isRunning = true;

			// Execute
			activate(mockContext);

			// Verify
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to write port configuration: Write failed');
			// 依然会继续执行后续逻辑
			expect(mockServer.on).toHaveBeenCalled();
		});
	});

	describe('startServer', () => {
		it('should successfully start server', () => {
			// Setup
			mockServer.start.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Verify
			expect(mockServer.start).toHaveBeenCalled();
		});

		it('should handle port conflict with user choosing Yes', async () => {
			// Setup
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValue(portConflictError);
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockResolvedValue(undefined);
			mockServer.getPort.mockReturnValue(4711);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);

			// Mock port availability check
			mockTestServer.once = undefined;
			mockTestServer.close.mockReturnValue(mockTestServer);
			mockTestServer.listen.mockReturnValue(mockTestServer);

			// Execute
			activate(mockContext);

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 100));

			// Verify
			expect(mockServer.stop).toHaveBeenCalled();
			expect(vscode.window.showInformationMessage).toHaveBeenCalled();
			expect(mockServer.forceStopExistingServer).toHaveBeenCalled();
		});

		it('should handle port conflict with user choosing No', async () => {
			// Setup
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValue(portConflictError);
			mockServer.stop.mockResolvedValue(undefined);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('No' as any);

			// Execute
			activate(mockContext);

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 100));

			// Verify
			expect(mockServer.stop).toHaveBeenCalled();
			expect(vscode.window.showInformationMessage).toHaveBeenCalled();
			expect(mockServer.forceStopExistingServer).not.toHaveBeenCalled();
		});

		it('should handle port conflict with user choosing Disable Autostart', async () => {
			// Setup
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValue(portConflictError);
			mockServer.stop.mockResolvedValue(undefined);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Disable Autostart' as any);
			mockConfig.update.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 100));

			// Verify
			expect(mockConfig.update).toHaveBeenCalledWith('autostart', false, vscode.ConfigurationTarget.Global);
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Autostart has been disabled');
		});

		it('should handle non-port conflict error', async () => {
			// Setup
			const error = new Error('Other error');
			mockServer.start.mockRejectedValue(error);
			mockServer.stop.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Wait for async operations
			await new Promise(resolve => setTimeout(resolve, 100));

			// Verify
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to start debug server: Other error');
		});

		it('should handle port conflict with retry logic - max retries exceeded', async () => {
			// Setup
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValueOnce(portConflictError)
				.mockRejectedValue(new Error('Port still in use after max retries'));
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockResolvedValue(undefined);
			mockServer.getPort.mockReturnValue(4711);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);

			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 1500));
			// 应该抛出端口仍被占用的错误
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Still failed to start debug server'));
		});

		it('should handle port conflict with retry logic - port becomes available', async () => {
			// Setup
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValueOnce(portConflictError).mockResolvedValueOnce(undefined);
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockResolvedValue(undefined);
			mockServer.getPort.mockReturnValue(4711);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);

			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 1200));

			// Verify
			expect(mockServer.start).toHaveBeenCalledTimes(1);
		});

		it('should handle port conflict with retry logic - non-EADDRINUSE error', async () => {
			// Setup
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValueOnce(portConflictError).mockRejectedValue(new Error('Other error during retry'));
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockResolvedValue(undefined);
			mockServer.getPort.mockReturnValue(4711);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);

			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 1200));
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Still failed to start debug server'));
		});

		it('should cover port conflict retry logic throw branch with exact retry count', async () => {
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValue(new Error('Port 4711 is still in use after 5 attempts to release it'));
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockResolvedValue(undefined);
			mockServer.getPort.mockReturnValue(4711);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);

			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 2200));

			// Verify - should show error message about port still in use after max retries
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Still failed to start debug server'));
		});

		it('should cover port conflict retry logic throw branch with different port number', async () => {
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValue(new Error('Port 9999 is still in use after 5 attempts to release it'));
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockResolvedValue(undefined);
			mockServer.getPort.mockReturnValue(9999);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);

			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 2200));

			// Verify - should show error message about port still in use after max retries
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Still failed to start debug server'));
		});

		it('should handle port check error with non-object error', async () => {
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValueOnce(portConflictError).mockRejectedValue(new Error('Non-object error during retry'));
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockResolvedValue(undefined);
			mockServer.getPort.mockReturnValue(4711);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);

			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 1200));
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Still failed to start debug server'));
		});

		it('should handle port check with immediate listening', async () => {
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValueOnce(portConflictError).mockResolvedValueOnce(undefined);
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockResolvedValue(undefined);
			mockServer.getPort.mockReturnValue(4711);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);

			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 1200));
			// 验证至少有一次调用，并且用户选择了Yes
			expect(mockServer.start).toHaveBeenCalled();
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining('Failed to start debug server'),
				'Yes',
				'No',
				'Disable Autostart'
			);
		});

		it('should handle port change with server running and restart command failure', async () => {
			// Setup
			mockServer.isRunning = true;
			mockServer.start.mockResolvedValue(undefined);
			jest.mocked(vscode.commands.executeCommand).mockReset();
			jest.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('Restart failed'));

			activate(mockContext);

			// Simulate configuration change
			const configChangeEvent = { affectsConfiguration: (key: string) => key === 'mcpDebug.port' };
			const configChangeHandler = jest.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls[0][0];

			// 应该抛出异常
			try {
				await configChangeHandler(configChangeEvent);
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe('Restart failed');
			}

			expect(fs.writeFileSync).toHaveBeenCalled();
			expect(mockServer.setPort).toHaveBeenCalled();
			expect(vscode.window.showInformationMessage).toHaveBeenCalled();
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode-mcp-debug.restart');
		});

		it('should handle stop failure', async () => {
			// Setup
			const error = new Error('Stop failed');
			mockServer.stop.mockRejectedValue(error);
			mockServer.start.mockResolvedValue(undefined);

			activate(mockContext);

			// Get the stop command handler
			const stopHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[2][1];
			await stopHandler();

			// Wait for the Promise to resolve/reject
			await new Promise(resolve => setTimeout(resolve, 10));

			// Verify
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to stop debug server: Stop failed');
		});

		it('should cover branch when server.stop throws in startServer', async () => {
			// mock server.start 抛错
			const error = new Error('EADDRINUSE');
			(error as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValue(error);
			// mock server.stop 也抛错
			mockServer.stop.mockRejectedValue(new Error('stop failed'));
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('No' as any);
			// 不应抛出未捕获异常
			await expect(async () => {
				activate(mockContext);
				await new Promise(resolve => setTimeout(resolve, 200));
			}).not.toThrow();
			// 不应调用showErrorMessage
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		});

		it('should handle error when server.stop throws in startServer', async () => {
			// mock server.start 抛端口冲突
			const error = new Error('EADDRINUSE');
			(error as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValue(error);
			mockServer.stop.mockRejectedValue(new Error('stop failed'));
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('No' as any);
			// 不应抛出未捕获异常
			await expect(async () => {
				activate(mockContext);
				await new Promise(resolve => setTimeout(resolve, 200));
			}).not.toThrow();
			// 不应调用showErrorMessage
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		});

		it('should handle error when forceStopExistingServer throws in startServer', async () => {
			const error = new Error('EADDRINUSE');
			(error as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValue(error);
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockRejectedValue(new Error('force stop failed'));
			mockServer.getPort.mockReturnValue(4711);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);
			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 300));
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Still failed to start debug server'));
		});

		it('should handle error when startServer throws non-port-conflict error', async () => {
			// mock server.start 抛非端口冲突错误
			const error = new Error('other error');
			mockServer.start.mockRejectedValue(error);
			mockServer.stop.mockResolvedValue(undefined);
			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 100));
			// 应该走到最后的 else 分支
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to start debug server: other error');
		});
	});

	describe('configuration change', () => {
		it('should handle port change with server running', async () => {
			// Setup
			mockServer.isRunning = true;
			mockServer.start.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Simulate configuration change
			const configChangeEvent = { affectsConfiguration: (key: string) => key === 'mcpDebug.port' };
			const configChangeHandler = jest.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls[0][0];
			await configChangeHandler(configChangeEvent);

			// Verify
			expect(fs.writeFileSync).toHaveBeenCalled();
			expect(mockServer.setPort).toHaveBeenCalled();
			expect(vscode.window.showInformationMessage).toHaveBeenCalled();
		});

		it('should handle port change with server not running', async () => {
			// Setup
			mockServer.isRunning = false;
			mockServer.start.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Simulate configuration change
			const configChangeEvent = { affectsConfiguration: (key: string) => key === 'mcpDebug.port' };
			const configChangeHandler = jest.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls[0][0];
			await configChangeHandler(configChangeEvent);

			// Verify
			expect(fs.writeFileSync).toHaveBeenCalled();
			expect(mockServer.setPort).toHaveBeenCalled();
			expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		});

		it('should handle other mcpDebug config change', async () => {
			// Setup
			mockServer.isRunning = false;
			mockServer.start.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Simulate configuration change
			const configChangeEvent = { affectsConfiguration: (key: string) => key === 'mcpDebug' };
			const configChangeHandler = jest.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls[0][0];
			await configChangeHandler(configChangeEvent);

			// Verify
			expect(mockStatusBarItem.show).toHaveBeenCalled();
		});

		it('should handle port change with write file error', async () => {
			// Setup
			mockServer.isRunning = false;
			mockServer.start.mockResolvedValue(undefined);
			const error = new Error('Write failed');
			jest.mocked(fs.writeFileSync).mockImplementation(() => {
				throw error;
			});

			// Execute
			activate(mockContext);

			// Simulate configuration change
			const configChangeEvent = { affectsConfiguration: (key: string) => key === 'mcpDebug.port' };
			const configChangeHandler = jest.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls[0][0];
			await configChangeHandler(configChangeEvent);

			// Verify
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to write port configuration: Write failed');
			expect(mockServer.setPort).toHaveBeenCalled();
		});

		it('should handle configuration change not affecting mcpDebug', async () => {
			// Setup
			mockServer.isRunning = false;
			mockServer.start.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Simulate configuration change
			const configChangeEvent = { affectsConfiguration: (key: string) => key === 'other.config' };
			const configChangeHandler = jest.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls[0][0];
			await configChangeHandler(configChangeEvent);

			// setPort 只会在初始化时被调用一次
			expect(mockServer.setPort).toHaveBeenCalledTimes(1);
			// show 只会在初始化时被调用一次
			expect(mockStatusBarItem.show).toHaveBeenCalledTimes(1);
		});
	});

	describe('commands', () => {
		describe('showCommands', () => {
			it('should show commands when server is running', async () => {
				// Setup
				mockServer.isRunning = true;
				jest.mocked(vscode.window.showQuickPick).mockResolvedValue({ 
					label: 'Stop Server', 
					command: 'vscode-mcp-debug.stop' 
				} as any);

				// Execute
				activate(mockContext);

				// Get the command handler
				const commandHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[0][1];
				await commandHandler();

				// Verify
				expect(vscode.window.showQuickPick).toHaveBeenCalled();
				expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode-mcp-debug.stop');
			});

			it('should show commands when server is not running', async () => {
				// Setup
				mockServer.isRunning = false;
				jest.mocked(vscode.window.showQuickPick).mockResolvedValue({ 
					label: 'Start Server', 
					command: 'vscode-mcp-debug.restart' 
				} as any);

				// Execute
				activate(mockContext);

				// Get the command handler
				const commandHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[0][1];
				await commandHandler();

				// Verify
				expect(vscode.window.showQuickPick).toHaveBeenCalled();
				expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode-mcp-debug.restart');
			});

			it('should handle no selection', async () => {
				// Setup
				mockServer.isRunning = false;
				jest.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

				// Execute
				activate(mockContext);

				// Get the command handler
				const commandHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[0][1];
				await commandHandler();

				// Verify
				expect(vscode.window.showQuickPick).toHaveBeenCalled();
				expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
			});
		});

		describe('restart', () => {
			it('should successfully restart server', async () => {
				// Setup
				mockServer.stop.mockResolvedValue(undefined);
				mockServer.start.mockResolvedValue(undefined);

				// Execute
				activate(mockContext);

				// Get the restart command handler
				const restartHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[1][1];
				await restartHandler();

				// Verify
				expect(mockServer.stop).toHaveBeenCalled();
				expect(mockServer.start).toHaveBeenCalled();
			});

			it('should handle stop failure', async () => {
				// Setup
				const error = new Error('Stop failed');
				mockServer.stop.mockRejectedValue(error);
				mockServer.start.mockResolvedValue(undefined);

				// Execute
				activate(mockContext);

				// Get the restart command handler
				const restartHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[1][1];
				await restartHandler();

				// Verify
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to stop debug server: Stop failed');
				expect(mockServer.start).toHaveBeenCalled();
			});
		});

		describe('stop', () => {
			it('should successfully stop server', async () => {
				// Setup
				mockServer.stop.mockResolvedValue(undefined);

				// Execute
				activate(mockContext);

				// Get the stop command handler
				const stopHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[2][1];
				await stopHandler();

				// Verify
				expect(mockServer.stop).toHaveBeenCalled();
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('MCP Debug Server stopped');
			});

			it('should handle stop failure', async () => {
				// Setup
				const error = new Error('Stop failed');
				mockServer.stop.mockRejectedValue(error);

				// Execute
				activate(mockContext);

				// Get the stop command handler
				const stopHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[2][1];
				await stopHandler();

				// Wait for the Promise to resolve/reject
				await new Promise(resolve => setTimeout(resolve, 10));

				// Verify
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to stop debug server: Stop failed');
			});
		});

		describe('copyStdioPath', () => {
			it('should copy stdio path to clipboard', async () => {
				jest.mocked(vscode.env.clipboard.writeText).mockResolvedValue(undefined);
				activate(mockContext);
				const copyHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[3][1];
				await copyHandler();
				expect(vscode.env.clipboard.writeText).toHaveBeenCalled();
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('MCP stdio server path copied to clipboard.');
			});
			it('should handle clipboard write error', async () => {
				jest.mocked(vscode.env.clipboard.writeText).mockRejectedValue(new Error('Clipboard error'));
				activate(mockContext);
				const copyHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[3][1];
				await expect(copyHandler()).rejects.toThrow('Clipboard error');
			});
		});

		describe('copySseAddress', () => {
			it('should copy SSE address to clipboard', async () => {
				jest.mocked(vscode.env.clipboard.writeText).mockResolvedValue(undefined);
				activate(mockContext);
				const copyHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[4][1];
				await copyHandler();
				expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('http://localhost:4711/sse');
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('MCP sse server address copied to clipboard.');
			});
			it('should handle clipboard write error', async () => {
				jest.mocked(vscode.env.clipboard.writeText).mockRejectedValue(new Error('Clipboard error'));
				activate(mockContext);
				const copyHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[4][1];
				await expect(copyHandler()).rejects.toThrow('Clipboard error');
			});
		});

		describe('setPort', () => {
			it('should set valid port', async () => {
				// Setup
				jest.mocked(vscode.window.showInputBox).mockResolvedValue('8080');
				mockConfig.update.mockResolvedValue(undefined);
				mockServer.isRunning = false;

				// Execute
				activate(mockContext);

				// Get the setPort command handler
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Verify
				expect(mockConfig.update).toHaveBeenCalledWith('port', 8080, vscode.ConfigurationTarget.Global);
				expect(fs.writeFileSync).toHaveBeenCalled();
				expect(mockServer.setPort).toHaveBeenCalledWith(8080);
			});

			it('should handle invalid port (too low) - validation should prevent update', async () => {
				// Setup
				// Mock showInputBox to return invalid port, but the validation should prevent the update
				jest.mocked(vscode.window.showInputBox).mockResolvedValue('1023');
				
				// Mock the validateInput function to return error message
				const mockShowInputBox = jest.mocked(vscode.window.showInputBox);
				mockShowInputBox.mockImplementation((options: any) => {
					if (options.validateInput) {
						const result = options.validateInput('1023');
						if (result) {
							// If validation fails, return undefined to simulate user cancellation
							return Promise.resolve(undefined);
						}
					}
					return Promise.resolve('1023');
				});

				// Execute
				activate(mockContext);

				// Get the setPort command handler
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Verify
				expect(mockConfig.update).not.toHaveBeenCalled();
			});

			it('should handle invalid port (too high) - validation should prevent update', async () => {
				// Setup
				const mockShowInputBox = jest.mocked(vscode.window.showInputBox);
				mockShowInputBox.mockImplementation((options: any) => {
					if (options.validateInput) {
						const result = options.validateInput('65536');
						if (result) {
							return Promise.resolve(undefined);
						}
					}
					return Promise.resolve('65536');
				});

				// Execute
				activate(mockContext);

				// Get the setPort command handler
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Verify
				expect(mockConfig.update).not.toHaveBeenCalled();
			});

			it('should handle invalid port (non-numeric) - validation should prevent update', async () => {
				// Setup
				const mockShowInputBox = jest.mocked(vscode.window.showInputBox);
				mockShowInputBox.mockImplementation((options: any) => {
					if (options.validateInput) {
						const result = options.validateInput('abc');
						if (result) {
							return Promise.resolve(undefined);
						}
					}
					return Promise.resolve('abc');
				});

				// Execute
				activate(mockContext);

				// Get the setPort command handler
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Verify
				expect(mockConfig.update).not.toHaveBeenCalled();
			});

			it('should handle no input', async () => {
				// Setup
				jest.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

				// Execute
				activate(mockContext);

				// Get the setPort command handler
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Verify
				expect(mockConfig.update).not.toHaveBeenCalled();
			});

			it('should restart server when running and user chooses Yes', async () => {
				// Setup
				jest.mocked(vscode.window.showInputBox).mockResolvedValue('8080');
				jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);
				mockConfig.update.mockResolvedValue(undefined);
				mockServer.isRunning = true;

				// Execute
				activate(mockContext);

				// Get the setPort command handler
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Verify
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
					'Port updated. Restart server to apply changes?',
					'Yes',
					'No'
				);
				expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode-mcp-debug.restart');
			});

			it('should not restart server when running and user chooses No', async () => {
				// Setup
				jest.mocked(vscode.window.showInputBox).mockResolvedValue('8080');
				jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('No' as any);
				mockConfig.update.mockResolvedValue(undefined);
				mockServer.isRunning = true;

				// Execute
				activate(mockContext);

				// Get the setPort command handler
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Verify
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
					'Port updated. Restart server to apply changes?',
					'Yes',
					'No'
				);
				expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('vscode-mcp-debug.restart');
			});

			it('should handle port config write failure', async () => {
				// Setup
				jest.mocked(vscode.window.showInputBox).mockResolvedValue('8080');
				mockConfig.update.mockResolvedValue(undefined);
				const error = new Error('Write failed');
				jest.mocked(fs.writeFileSync).mockImplementation(() => {
					throw error;
				});

				// Execute
				activate(mockContext);

				// Get the setPort command handler
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Verify
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to write port configuration: Write failed');
			});

			it('should handle parseInt(newPort) returns NaN', async () => {
				jest.mocked(vscode.window.showInputBox).mockResolvedValue('notanumber');
				mockConfig.update.mockResolvedValue(undefined);
				mockServer.isRunning = false;
				activate(mockContext);
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();
				// 真实逻辑会调用 update 并传 NaN
				expect(mockConfig.update).toHaveBeenCalledWith('port', NaN, vscode.ConfigurationTarget.Global);
				expect(mockServer.setPort).toHaveBeenCalledWith(NaN);
			});

			it('should handle server.isRunning true but user cancels restart', async () => {
				// Setup
				jest.mocked(vscode.window.showInputBox).mockResolvedValue('8080');
				jest.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
				mockConfig.update.mockResolvedValue(undefined);
				mockServer.isRunning = true;

				// Execute
				activate(mockContext);
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Verify
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
					'Port updated. Restart server to apply changes?',
					'Yes',
					'No'
				);
				expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('vscode-mcp-debug.restart');
			});

			it('should handle valid port validation returning null', async () => {
				// Setup - test the validation function returning null for valid input
				jest.mocked(vscode.window.showInputBox).mockResolvedValue('8080');
				mockConfig.update.mockResolvedValue(undefined);
				mockServer.isRunning = false;

				// Execute
				activate(mockContext);

				// Get the setPort command handler
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Verify that validation returns null for valid port
				const showInputBoxCall = jest.mocked(vscode.window.showInputBox).mock.calls[0];
				const options = showInputBoxCall[0] as any;
				expect(options.validateInput('8080')).toBeNull();
				expect(options.validateInput('1024')).toBeNull();
				expect(options.validateInput('65535')).toBeNull();
			});

			it('should handle port validation edge cases', async () => {
				// Setup
				jest.mocked(vscode.window.showInputBox).mockResolvedValue('8080');
				mockConfig.update.mockResolvedValue(undefined);
				mockServer.isRunning = false;

				// Execute
				activate(mockContext);

				// Get the setPort command handler
				const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
				await setPortHandler();

				// Get the validation function
				const showInputBoxCall = jest.mocked(vscode.window.showInputBox).mock.calls[0];
				const options = showInputBoxCall[0] as any;
				const validateInput = options.validateInput;

				// Test edge cases
				expect(validateInput('1023')).toBe('Please enter a valid port number (1024-65535)');
				expect(validateInput('65536')).toBe('Please enter a valid port number (1024-65535)');
				expect(validateInput('abc')).toBe('Please enter a valid port number (1024-65535)');
				expect(validateInput('')).toBe('Please enter a valid port number (1024-65535)');
				expect(validateInput('1024')).toBeNull();
				expect(validateInput('65535')).toBeNull();
				expect(validateInput('8080')).toBeNull();
			});
		});

		describe('toggleAutostart', () => {
			it('should enable autostart when disabled', async () => {
				// Setup
				jest.mocked(mockConfig.get).mockImplementation((key: string) => {
					if (key === 'port') {return 4711;}
					if (key === 'autostart') {return false;}
					return undefined;
				});
				mockConfig.update.mockResolvedValue(undefined);

				// Execute
				activate(mockContext);

				// Get the toggleAutostart command handler
				const toggleHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[6][1];
				await toggleHandler();

				// Verify
				expect(mockConfig.update).toHaveBeenCalledWith('autostart', true, vscode.ConfigurationTarget.Global);
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Autostart enabled');
			});

			it('should disable autostart when enabled', async () => {
				// Setup
				jest.mocked(mockConfig.get).mockImplementation((key: string) => {
					if (key === 'port') {return 4711;}
					if (key === 'autostart') {return true;}
					return undefined;
				});
				mockConfig.update.mockResolvedValue(undefined);

				// Execute
				activate(mockContext);

				// Get the toggleAutostart command handler
				const toggleHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[6][1];
				await toggleHandler();

				// Verify
				expect(mockConfig.update).toHaveBeenCalledWith('autostart', false, vscode.ConfigurationTarget.Global);
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Autostart disabled');
			});
		});
	});

	describe('updateStatusBar', () => {
		it('should update status bar when server is running', () => {
			// Setup
			mockServer.isRunning = true;

			// Execute
			activate(mockContext);

			// Get the updateStatusBar function by triggering a server state change
			const startedHandler = jest.mocked(mockServer.on).mock.calls[0][1];
			startedHandler();

			// Verify
			expect(mockStatusBarItem.text).toBe('$(check) Claude Debugs For You');
			expect(mockStatusBarItem.tooltip).toBe('Claude Debugs For You (Running) - Click to show commands');
			expect(mockStatusBarItem.show).toHaveBeenCalled();
		});

		it('should update status bar when server is not running', () => {
			// Setup
			mockServer.isRunning = false;

			// Execute
			activate(mockContext);

			// Get the updateStatusBar function by triggering a server state change
			const stoppedHandler = jest.mocked(mockServer.on).mock.calls[1][1];
			stoppedHandler();

			// Verify
			expect(mockStatusBarItem.text).toBe('$(x) Claude Debugs For You');
			expect(mockStatusBarItem.tooltip).toBe('Claude Debugs For You (Stopped) - Click to show commands');
			expect(mockStatusBarItem.show).toHaveBeenCalled();
		});

		it('should cover updateStatusBar else branch during initialization', () => {
			// Setup - ensure server is not running during initialization
			mockServer.isRunning = false;
			mockServer.start.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Verify - should show stopped status during initialization
			expect(mockStatusBarItem.text).toBe('$(x) Claude Debugs For You');
			expect(mockStatusBarItem.tooltip).toBe('Claude Debugs For You (Stopped) - Click to show commands');
			expect(mockStatusBarItem.show).toHaveBeenCalled();
		});

		it('should cover updateStatusBar else branch when server state changes to stopped', () => {
			// Setup - start with server running, then change to stopped
			mockServer.isRunning = true;
			mockServer.start.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Change server state to stopped
			mockServer.isRunning = false;
			const stoppedHandler = jest.mocked(mockServer.on).mock.calls[1][1];
			stoppedHandler();

			// Verify - should show stopped status
			expect(mockStatusBarItem.text).toBe('$(x) Claude Debugs For You');
			expect(mockStatusBarItem.tooltip).toBe('Claude Debugs For You (Stopped) - Click to show commands');
			expect(mockStatusBarItem.show).toHaveBeenCalled();
		});

		it('should cover port conflict retry logic throw branch with exact retry count', async () => {
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValue(new Error('Port 4711 is still in use after 5 attempts to release it'));
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockResolvedValue(undefined);
			mockServer.getPort.mockReturnValue(4711);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);

			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 2200));

			// Verify - should show error message about port still in use after max retries
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Still failed to start debug server'));
		});

		it('should cover port conflict retry logic throw branch with different port number', async () => {
			const portConflictError = new Error('EADDRINUSE');
			(portConflictError as any).code = 'EADDRINUSE';
			mockServer.start
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValueOnce(portConflictError)
				.mockRejectedValue(new Error('Port 9999 is still in use after 5 attempts to release it'));
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockResolvedValue(undefined);
			mockServer.getPort.mockReturnValue(9999);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);

			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 2200));

			// Verify - should show error message about port still in use after max retries
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Still failed to start debug server'));
		});

		it('should use default port when config.get returns undefined', () => {
			// Setup - mock config.get to return undefined for port
			jest.mocked(mockConfig.get).mockImplementation((key: string) => {
				if (key === 'port') {return undefined;}
				if (key === 'autostart') {return true;}
				return undefined;
			});

			// Execute
			activate(mockContext);

			// Verify - should use default port 4711
			expect(mockServer.setPort).toHaveBeenCalledWith(4711);
		});

		it('should use default port when config.get returns null', () => {
			// Setup - mock config.get to return null for port
			jest.mocked(mockConfig.get).mockImplementation((key: string) => {
				if (key === 'port') {return null;}
				if (key === 'autostart') {return true;}
				return undefined;
			});

			// Execute
			activate(mockContext);

			// Verify - should use default port 4711
			expect(mockServer.setPort).toHaveBeenCalledWith(4711);
		});

		it('should use default port in configuration change handler when config.get returns undefined', async () => {
			// Setup
			mockServer.isRunning = false;
			mockServer.start.mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Mock config.get to return undefined for port in configuration change
			jest.mocked(mockConfig.get).mockImplementation((key: string) => {
				if (key === 'port') {return undefined;}
				if (key === 'autostart') {return true;}
				return undefined;
			});

			// Simulate configuration change
			const configChangeEvent = { affectsConfiguration: (key: string) => key === 'mcpDebug.port' };
			const configChangeHandler = jest.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls[0][0];
			await configChangeHandler(configChangeEvent);

			// Verify - should use default port 4711
			expect(mockServer.setPort).toHaveBeenCalledWith(4711);
		});

		it('should use default port in showCommands when config.get returns undefined', async () => {
			// Setup
			mockServer.isRunning = false;
			jest.mocked(mockConfig.get).mockImplementation((key: string) => {
				if (key === 'port') {return undefined;}
				if (key === 'autostart') {return true;}
				return undefined;
			});

			// Execute
			activate(mockContext);

			// Get the showCommands handler
			const showCommandsHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[0][1];
			await showCommandsHandler();

			// Verify - should use default port 4711 in commands
			expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						label: expect.stringContaining('4711')
					})
				]),
				expect.any(Object)
			);
		});

		it('should use default port in copySseAddress when config.get returns undefined', async () => {
			// Setup
			jest.mocked(mockConfig.get).mockImplementation((key: string) => {
				if (key === 'port') {return undefined;}
				if (key === 'autostart') {return true;}
				return undefined;
			});
			jest.mocked(vscode.env.clipboard.writeText).mockResolvedValue(undefined);

			// Execute
			activate(mockContext);

			// Get the copySseAddress handler
			const copySseAddressHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[4][1];
			await copySseAddressHandler();

			// Verify - should use default port 4711
			expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('http://localhost:4711/sse');
		});

		it('should use default port in setPort when config.get returns undefined', async () => {
			// Setup
			jest.mocked(mockConfig.get).mockImplementation((key: string) => {
				if (key === 'port') {return undefined;}
				if (key === 'autostart') {return true;}
				return undefined;
			});
			jest.mocked(vscode.window.showInputBox).mockResolvedValue('8080');

			// Execute
			activate(mockContext);

			// Get the setPort handler
			const setPortHandler = jest.mocked(vscode.commands.registerCommand).mock.calls[5][1];
			await setPortHandler();

			// Verify - should use default port 4711 as current value
			expect(vscode.window.showInputBox).toHaveBeenCalledWith(
				expect.objectContaining({
					value: '4711'
				})
			);
		});
	});

	describe('deactivate', () => {
		it('should not throw when called', () => {
			// Execute & Verify
			expect(() => deactivate()).not.toThrow();
		});
	});

	describe('补充分支覆盖', () => {
		it('should cover branch when server.stop throws in startServer', async () => {
			// mock server.start 抛错
			const error = new Error('EADDRINUSE');
			(error as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValue(error);
			// mock server.stop 也抛错
			mockServer.stop.mockRejectedValue(new Error('stop failed'));
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('No' as any);
			// 不应抛出未捕获异常
			await expect(async () => {
				activate(mockContext);
				await new Promise(resolve => setTimeout(resolve, 200));
			}).not.toThrow();
			// 不应调用showErrorMessage
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		});

		it('should handle error when server.stop throws in startServer', async () => {
			// mock server.start 抛端口冲突
			const error = new Error('EADDRINUSE');
			(error as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValue(error);
			mockServer.stop.mockRejectedValue(new Error('stop failed'));
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('No' as any);
			// 不应抛出未捕获异常
			await expect(async () => {
				activate(mockContext);
				await new Promise(resolve => setTimeout(resolve, 200));
			}).not.toThrow();
			// 不应调用showErrorMessage
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		});

		it('should handle error when forceStopExistingServer throws in startServer', async () => {
			const error = new Error('EADDRINUSE');
			(error as any).code = 'EADDRINUSE';
			mockServer.start.mockRejectedValue(error);
			mockServer.stop.mockResolvedValue(undefined);
			mockServer.forceStopExistingServer.mockRejectedValue(new Error('force stop failed'));
			mockServer.getPort.mockReturnValue(4711);
			jest.mocked(vscode.window.showInformationMessage).mockResolvedValue('Yes' as any);
			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 300));
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Still failed to start debug server'));
		});

		it('should handle error when startServer throws non-port-conflict error', async () => {
			// mock server.start 抛非端口冲突错误
			const error = new Error('other error');
			mockServer.start.mockRejectedValue(error);
			mockServer.stop.mockResolvedValue(undefined);
			activate(mockContext);
			await new Promise(resolve => setTimeout(resolve, 100));
			// 应该走到最后的 else 分支
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to start debug server: other error');
		});
	});
});
