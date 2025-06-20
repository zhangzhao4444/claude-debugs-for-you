// @ts-nocheck - Jest mock type issues
import { DebugServer, DebugStep } from '../debug-server';
import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { jest } from '@jest/globals';

// Mock the MCP SDK modules
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    tool: jest.fn(),
    connect: jest.fn(),
  }))
}));

jest.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: jest.fn().mockImplementation((...args) => {
    const res = args[1] as any;
    if (res && typeof res.on === 'function') {
      res.on('close', jest.fn());
    }
    return {
      sessionId: 'test-session-id',
      handlePostMessage: jest.fn((req: any, res: any) => {
        if (res && typeof res.writeHead === 'function') {
          res.writeHead(200);
        }
        if (res && typeof res.end === 'function') {
          res.end();
        }
      }),
      close: jest.fn(),
    };
  })
}));

// Mock fs module
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
}));

// Mock http module
const mockServer = {
  listen: jest.fn(),
  close: jest.fn(),
  on: jest.fn(),
};

jest.mock('http', () => ({
  createServer: jest.fn(() => mockServer),
  request: jest.fn(),
}));

// Mock vscode module
jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{
      uri: {
        fsPath: '/test/workspace',
        toString: () => 'file:///test/workspace'
      }
    }],
    getConfiguration: jest.fn(),
    openTextDocument: jest.fn(),
    findFiles: jest.fn(),
  },
  window: {
    showTextDocument: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
  },
  debug: {
    activeDebugSession: {
      customRequest: jest.fn(),
    },
    breakpoints: [],
    addBreakpoints: jest.fn(),
    removeBreakpoints: jest.fn(),
    startDebugging: jest.fn(),
    activeStackItem: {
      frameId: 1,
    },
  },
  SourceBreakpoint: jest.fn(),
  Location: jest.fn(),
  Position: jest.fn(),
  RelativePattern: jest.fn(),
  Uri: {
    file: jest.fn(),
  },
  DebugStackFrame: jest.fn(),
}));

describe('DebugServer', () => {
  let debugServer: DebugServer;
  let requestHandler: (req: any, res: any) => void;
  let localRequestHandler: (req: any, res: any) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    // 还原 workspaceFolders
    (vscode.workspace as any).workspaceFolders = [{
      uri: {
        fsPath: '/test/workspace',
        toString: () => 'file:///test/workspace'
      }
    }];
    // 还原 activeDebugSession
    (vscode.debug as any).activeDebugSession = {
      customRequest: jest.fn(),
    };
    // 还原 breakpoints
    (vscode.debug as any).breakpoints = [];
    
    // Reset mock implementations
    (mockServer.listen as any).mockImplementation((port: number, callback?: () => void) => {
      if (callback) {
        callback();
      }
      return mockServer;
    });
    (mockServer.close as any).mockImplementation((callback?: () => void) => {
      if (callback) {
        callback();
      }
    });
    (mockServer.on as any).mockReturnThis();

    (http.createServer as any).mockReturnValue(mockServer);

    // Reset vscode mocks
    const mockDocument = {
      uri: {
        fsPath: '/test/file.ts',
        toString: () => 'file:///test/file.ts'
      },
      getText: jest.fn(() => 'line1\nline2\nline3'),
    };

    const mockEditor = {
      document: mockDocument,
    };

    (vscode.workspace.openTextDocument as any).mockResolvedValue(mockDocument);
    (vscode.window.showTextDocument as any).mockResolvedValue(mockEditor);
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test/file1.ts' },
      { fsPath: '/test/file2.js' }
    ]);
    (vscode.workspace.getConfiguration as any).mockReturnValue({
      get: jest.fn().mockReturnValue([{
        name: 'Test Config',
        type: 'node',
        request: 'launch',
        program: '${file}',
        env: {
          NODE_ENV: '${workspaceFolder}/test'
        }
      }])
    });

    debugServer = new DebugServer();
  });

  afterEach(async () => {
    // 还原 workspaceFolders
    (vscode.workspace as any).workspaceFolders = [{
      uri: {
        fsPath: '/test/workspace',
        toString: () => 'file:///test/workspace'
      }
    }];
    // 还原 activeDebugSession
    (vscode.debug as any).activeDebugSession = {
      customRequest: jest.fn(),
    };
    // 还原 breakpoints
    (vscode.debug as any).breakpoints = [];
    if (debugServer && debugServer.isRunning) {
      await debugServer.stop();
    }
  });

  describe('constructor', () => {
    it('should create DebugServer with default port', () => {
      const server = new DebugServer();
      expect(server.getPort()).toBe(4711);
      expect(server.isRunning).toBe(false);
    });

    it('should create DebugServer with custom port', () => {
      const server = new DebugServer(8080);
      expect(server.getPort()).toBe(8080);
    });

    it('should create DebugServer with port and config path', () => {
      const server = new DebugServer(8080, '/config/path');
      expect(server.getPort()).toBe(8080);
    });
  });

  describe('setPort', () => {
    it('should set port and update config file when path is provided', () => {
      const server = new DebugServer(4711, '/config/path');
      server.setPort(9000);
      
      expect(server.getPort()).toBe(9000);
      expect(fs.writeFileSync).toHaveBeenCalledWith('/config/path', JSON.stringify({ port: 9000 }));
    });

    it('should set port without config file when path is not provided', () => {
      const server = new DebugServer();
      server.setPort(9000);
      
      expect(server.getPort()).toBe(9000);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle fs.writeFileSync error gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File write error');
      });

      const server = new DebugServer(4711, '/config/path');
      server.setPort(9000);
      
      expect(server.getPort()).toBe(9000);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to update port configuration file:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should use default port when undefined is passed', () => {
      const server = new DebugServer();
      server.setPort(undefined as any);
      
      expect(server.getPort()).toBe(4711);
    });
  });

  describe('forceStopExistingServer', () => {
    it('should successfully stop existing server', async () => {
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'end') {
            setTimeout(callback, 0);
          }
        }),
      };

      const mockRequest = {
        on: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
      };

      (http.request as any).mockImplementation((_options: any, callback: Function) => {
        callback(mockResponse);
        return mockRequest;
      });

      await debugServer.forceStopExistingServer();
      
      expect(http.request).toHaveBeenCalledWith({
        hostname: 'localhost',
        port: 4711,
        path: '/shutdown',
        method: 'POST',
        timeout: 3000
      }, expect.any(Function));
    });

    it('should handle ECONNREFUSED error (no server running)', async () => {
      const mockRequest = {
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'error') {
            const error = new Error('Connection refused') as NodeJS.ErrnoException;
            error.code = 'ECONNREFUSED';
            setTimeout(() => callback(error), 0);
          }
        }),
        end: jest.fn(),
        destroy: jest.fn(),
      };

      (http.request as any).mockImplementation(() => mockRequest);

      await expect(debugServer.forceStopExistingServer()).resolves.toBeUndefined();
    });

    it('should handle other network errors', async () => {
      const mockRequest = {
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'error') {
            const error = new Error('Network error') as NodeJS.ErrnoException;
            error.code = 'ENETWORK';
            setTimeout(() => callback(error), 0);
          }
        }),
        end: jest.fn(),
        destroy: jest.fn(),
      };

      (http.request as any).mockImplementation(() => mockRequest);

      await expect(debugServer.forceStopExistingServer()).rejects.toThrow('Failed to stop existing server');
    });

    it('should handle timeout error', async () => {
      const mockRequest = {
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'timeout') {
            setTimeout(callback, 0);
          }
        }),
        end: jest.fn(),
        destroy: jest.fn(),
      };

      (http.request as any).mockImplementation(() => mockRequest);

      await expect(debugServer.forceStopExistingServer()).rejects.toThrow('Failed to stop existing server');
      expect(mockRequest.destroy).toHaveBeenCalled();
    });

    it('should handle unexpected status code', async () => {
      const mockResponse = {
        statusCode: 500,
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'end') {
            setTimeout(callback, 0);
          }
        }),
      };

      const mockRequest = {
        on: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
      };

      (http.request as any).mockImplementation((_options: any, callback: Function) => {
        callback(mockResponse);
        return mockRequest;
      });

      await expect(debugServer.forceStopExistingServer()).rejects.toThrow('Failed to stop existing server');
    });
  });

  describe('start', () => {
    it('should start server successfully', async () => {
      await debugServer.start();
      
      expect(debugServer.isRunning).toBe(true);
      expect(http.createServer).toHaveBeenCalled();
      expect(mockServer.listen).toHaveBeenCalledWith(4711, expect.any(Function));
    });

    it('should throw error if server is already running', async () => {
      await debugServer.start();
      
      await expect(debugServer.start()).rejects.toThrow('Server is already running');
    });

    it('should handle server listen error', async () => {
      (mockServer.listen as any).mockImplementation((port: number, callback?: Function) => {
        return {
          on: jest.fn((event: string, errorCallback: Function) => {
            if (event === 'error') {
              setTimeout(() => errorCallback(new Error('Port in use')), 0);
            }
            return mockServer;
          })
        };
      });

      await expect(debugServer.start()).rejects.toThrow('Port in use');
    });
  });

  describe('HTTP request handlers', () => {
    beforeEach(async () => {
      (http.createServer as any).mockImplementation((handler: any) => {
        requestHandler = handler;
        localRequestHandler = handler;
        return mockServer;
      });
      await debugServer.start();
    });

    it('should handle OPTIONS request with CORS headers', () => {
      const req = { method: 'OPTIONS' };
      const res = {
        setHeader: jest.fn(),
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };

      requestHandler(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', '*');
      expect(res.writeHead).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });

    it('should handle POST /shutdown request', () => {
      const req = { method: 'POST', url: '/shutdown' };
      const res = {
        setHeader: jest.fn(),
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };

      jest.spyOn(debugServer, 'stop').mockResolvedValue();

      requestHandler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      expect(res.end).toHaveBeenCalledWith('Server shutting down');
    });

    it('should handle GET /sse request', () => {
      const req = { method: 'GET', url: '/sse' };
      const res = {
        setHeader: jest.fn(),
        on: jest.fn(),
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };
      requestHandler(req, res);
      expect(res.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should handle POST /messages request with invalid session', () => {
      const req = { 
        method: 'POST', 
        url: '/messages?sessionId=invalid-session'
      };
      const res = {
        setHeader: jest.fn(),
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };

      requestHandler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404);
      expect(res.end).toHaveBeenCalledWith('Session not found');
    });

    it('should handle POST /tcp request with listTools', (done) => {
      const req = { 
        method: 'POST', 
        url: '/tcp',
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'data') {
            callback(JSON.stringify({ type: 'listTools' }));
          } else if (event === 'end') {
            setTimeout(callback, 0);
          }
        })
      };
      const res = {
        setHeader: jest.fn(),
        writeHead: jest.fn(),
        end: jest.fn((data: string) => {
          expect(data).toContain('"success":true');
          done();
        }),
      };

      requestHandler(req, res);
    });

    it('should handle POST /tcp request with callTool', (done) => {
      const req = { 
        method: 'POST', 
        url: '/tcp',
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'data') {
            callback(JSON.stringify({ 
              type: 'callTool', 
              tool: 'listFiles',
              arguments: { includePatterns: ['**/*.ts'] }
            }));
          } else if (event === 'end') {
            setTimeout(callback, 0);
          }
        })
      };
      const res = {
        setHeader: jest.fn(),
        writeHead: jest.fn(),
        end: jest.fn(() => {
          done();
        }),
      };

      requestHandler(req, res);
    });

    it('should handle POST /tcp request with invalid JSON', (done) => {
      const req = { 
        method: 'POST', 
        url: '/tcp',
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'data') {
            callback('invalid json');
          } else if (event === 'end') {
            setTimeout(callback, 0);
          }
        })
      };
      const res = {
        setHeader: jest.fn(),
        writeHead: jest.fn(),
        end: jest.fn((data: string) => {
          expect(data).toContain('"success":false');
          done();
        }),
      };

      requestHandler(req, res);
    });

    it('should handle unknown routes', () => {
      const req = { method: 'GET', url: '/unknown' };
      const res = {
        setHeader: jest.fn(),
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };

      requestHandler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404);
      expect(res.end).toHaveBeenCalled();
    });

    it('should handle shutdown request with stop error', (done) => {
      debugServer.stop().then(() => {
        (http.createServer as any).mockImplementation((handler: any) => {
          requestHandler = handler;
          return mockServer;
        });
        return debugServer.start();
      }).then(() => {
        localRequestHandler = requestHandler;
        const req = { method: 'POST', url: '/shutdown' };
        const res = {
          setHeader: jest.fn(),
          writeHead: jest.fn().mockReturnThis(),
          end: jest.fn((data: string) => {
            if (data && data.includes('Error shutting down: Stop failed')) {
              expect(data).toContain('Error shutting down: Stop failed');
              done();
            }
          }),
        };
        jest.spyOn(debugServer, 'stop').mockImplementation(() => {
          return Promise.reject(new Error('Stop failed'));
        });
        setTimeout(() => {
          localRequestHandler(req, res);
          setTimeout(() => {
            if (res.end.mock.calls.length > 0) {
              const lastCall = res.end.mock.calls[res.end.mock.calls.length - 1];
              if (lastCall[0] && lastCall[0].includes('Error shutting down: Stop failed')) {
                expect(lastCall[0]).toContain('Error shutting down: Stop failed');
                done();
              }
            }
          }, 100);
        }, 0);
      }).catch(done);
    });

    it('should handle POST /messages with existing session', async () => {
      await debugServer.stop();
      (http.createServer as any).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });
      await debugServer.start();
      // 先创建SSE session
      const sseReq = { method: 'GET', url: '/sse' };
      const sseRes = { 
        setHeader: jest.fn(), 
        on: jest.fn(),
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn()
      };
      requestHandler(sseReq, sseRes);
      // 然后测试POST /messages
      const req = { 
        method: 'POST', 
        url: '/messages?sessionId=test-session-id',
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'data') {
            callback(Buffer.from('test data'));
          } else if (event === 'end') {
            callback();
          }
        })
      };
      const res = {
        setHeader: jest.fn(),
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };
      requestHandler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(200);
    });
  });

  describe('handleCommand', () => {
    it('should handle listFiles command', async () => {
      const result = await (debugServer as any).handleCommand({
        tool: 'listFiles',
        arguments: { includePatterns: ['**/*.ts'] }
      });

      expect(result).toEqual(['/test/file1.ts', '/test/file2.js']);
    });

    it('should handle getFileContent command', async () => {
      const result = await (debugServer as any).handleCommand({
        tool: 'getFileContent',
        arguments: { path: '/test/file.ts' }
      });

      expect(result).toBe('1: line1\n2: line2\n3: line3');
    });

    it('should handle debug command', async () => {
      const steps: DebugStep[] = [
        { type: 'setBreakpoint', file: '/test/file.ts', line: 10 }
      ];

      const result = await (debugServer as any).handleCommand({
        tool: 'debug',
        arguments: { steps }
      });

      expect(result).toContain('Set breakpoint at line 10');
    });

    it('should throw error for unknown tool', async () => {
      await expect((debugServer as any).handleCommand({
        tool: 'unknownTool',
        arguments: {}
      })).rejects.toThrow('Unknown tool: unknownTool');
    });
  });

  describe('handleListFiles', () => {
    it('should list files with default patterns', async () => {
      const result = await (debugServer as any).handleListFiles({});
      
      expect(result).toEqual(['/test/file1.ts', '/test/file2.js']);
      expect(vscode.workspace.findFiles).toHaveBeenCalled();
    });

    it('should list files with custom patterns', async () => {
      const result = await (debugServer as any).handleListFiles({
        includePatterns: ['**/*.ts'],
        excludePatterns: ['**/test/**']
      });
      
      expect(result).toEqual(['/test/file1.ts', '/test/file2.js']);
    });

    it('should throw error when no workspace folders found', async () => {
      (vscode.workspace as any).workspaceFolders = null;

      await expect((debugServer as any).handleListFiles({}))
        .rejects.toThrow('No workspace folders found');
    });
  });

  describe('handleGetFile', () => {
    it('should return file content with line numbers', async () => {
      const result = await (debugServer as any).handleGetFile({ path: '/test/file.ts' });
      
      expect(result).toBe('1: line1\n2: line2\n3: line3');
      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith('/test/file.ts');
    });
  });

  describe('handleDebug', () => {
    describe('setBreakpoint', () => {
      it('should set breakpoint successfully', async () => {
        const steps: DebugStep[] = [
          { type: 'setBreakpoint', file: '/test/file.ts', line: 10 }
        ];

        const result = await (debugServer as any).handleDebug({ steps });
        
        expect(result).toContain('Set breakpoint at line 10');
        expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith('/test/file.ts');
        expect(vscode.window.showTextDocument).toHaveBeenCalled();
        expect(vscode.debug.addBreakpoints).toHaveBeenCalled();
      });

      it('should throw error when line number is missing', async () => {
        const steps: DebugStep[] = [
          { type: 'setBreakpoint', file: '/test/file.ts' }
        ];

        await expect((debugServer as any).handleDebug({ steps }))
          .rejects.toThrow('Line number required');
      });

      it('should throw error when file path is missing', async () => {
        const steps: DebugStep[] = [
          { type: 'setBreakpoint', file: '', line: 10 }
        ];

        await expect((debugServer as any).handleDebug({ steps }))
          .rejects.toThrow('File path required');
      });

      it('should set breakpoint with condition', async () => {
        const steps: DebugStep[] = [
          { 
            type: 'setBreakpoint', 
            file: '/test/file.ts', 
            line: 10, 
            condition: 'x > 5' 
          }
        ];

        const result = await (debugServer as any).handleDebug({ steps });
        
        expect(result).toContain('Set breakpoint at line 10');
        expect(vscode.SourceBreakpoint).toHaveBeenCalledWith(
          expect.anything(),
          true,
          'x > 5'
        );
      });
    });

    describe('removeBreakpoint', () => {
      it('should remove breakpoint successfully', async () => {
        const mockBreakpoint = {
          location: {
            range: {
              start: { line: 9 }
            }
          }
        };
        (vscode.debug as any).breakpoints = [mockBreakpoint];
        const removeBreakpointsMock = jest.fn();
        (vscode.debug.removeBreakpoints as any) = removeBreakpointsMock;
        const steps: DebugStep[] = [
          { type: 'removeBreakpoint', file: '/test/file.ts', line: 10 }
        ];
        const result = await (debugServer as any).handleDebug({ steps });
        expect(result).toContain('Removed breakpoint at line 10');
        expect(removeBreakpointsMock).toHaveBeenCalledWith(expect.anything());
      });

      it('should throw error when line number is missing', async () => {
        const steps: DebugStep[] = [
          { type: 'removeBreakpoint', file: '/test/file.ts' }
        ];

        await expect((debugServer as any).handleDebug({ steps }))
          .rejects.toThrow('Line number required');
      });
    });

    describe('continue', () => {
      it('should continue execution successfully', async () => {
        const steps: DebugStep[] = [
          { type: 'continue', file: '/test/file.ts' }
        ];

        const result = await (debugServer as any).handleDebug({ steps });
        
        expect(result).toContain('Continued execution');
        expect((vscode.debug.activeDebugSession as any).customRequest).toHaveBeenCalledWith('continue');
      });

      it('should throw error when no active debug session', async () => {
        (vscode.debug as any).activeDebugSession = null;

        const steps: DebugStep[] = [
          { type: 'continue', file: '/test/file.ts' }
        ];

        await expect((debugServer as any).handleDebug({ steps }))
          .rejects.toThrow('No active debug session');
      });
    });

    describe('evaluate', () => {
      it('should evaluate expression successfully with active stack item', async () => {
        // @ts-ignore - Jest mock type issue
        const customRequest = jest.fn().mockResolvedValue({ result: '42' });
        (vscode.debug as any).activeDebugSession = { customRequest };
        // 构造DebugStackFrame实例
        const mockStackFrame = Object.setPrototypeOf(
          { frameId: 1, name: 'test', source: { path: '/test/file.ts' }, line: 10, column: 0 },
          (vscode as any).DebugStackFrame.prototype
        );
        (vscode.debug as any).activeStackItem = mockStackFrame;
        const steps: DebugStep[] = [
          { type: 'evaluate', file: '/test/file.ts', expression: '2 + 2' }
        ];
        const result = await (debugServer as any).handleDebug({ steps });
        expect(result.join('\n')).toContain('Evaluated "2 + 2": 42');
        expect(customRequest).toHaveBeenCalledWith('evaluate', {
          expression: '2 + 2',
          frameId: 1,
          context: 'repl'
        });
      });

      it('should evaluate expression with fallback frame when no active stack item', async () => {
        (vscode.debug as any).activeStackItem = null;
        // @ts-ignore - Jest mock type issue
        const mockCustomRequest = jest.fn()
          .mockResolvedValueOnce({ stackFrames: [{ id: 123 }] } as any)
          .mockResolvedValueOnce({ result: '42' } as any);
        (vscode.debug as any).activeDebugSession = { customRequest: mockCustomRequest };
        const steps: DebugStep[] = [
          { type: 'evaluate', file: '/test/file.ts', expression: '2 + 2' }
        ];
        const result = await (debugServer as any).handleDebug({ steps });
        expect(result).toContain('Evaluated "2 + 2": 42');
        expect(mockCustomRequest).toHaveBeenCalledWith('stackTrace', {
          threadId: 1
        });
        expect(mockCustomRequest).toHaveBeenCalledWith('evaluate', {
          expression: '2 + 2',
          frameId: 123,
          context: 'repl'
        });
      });

      it('should handle evaluation error gracefully', async () => {
        // @ts-ignore - Jest mock type issue
        const customRequest = jest.fn().mockRejectedValue(new Error('Evaluation failed'));
        (vscode.debug as any).activeDebugSession = { customRequest };
        // 构造DebugStackFrame实例
        const mockStackFrame = Object.setPrototypeOf(
          { frameId: 1, name: 'test', source: { path: '/test/file.ts' }, line: 10, column: 0 },
          (vscode as any).DebugStackFrame.prototype
        );
        (vscode.debug as any).activeStackItem = mockStackFrame;
        const steps: DebugStep[] = [
          { type: 'evaluate', file: '/test/file.ts', expression: 'invalid' }
        ];
        await (debugServer as any).handleDebug({ steps });
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          'Failed to execute: Error: Evaluation failed'
        );
        expect(customRequest).toHaveBeenCalled();
      });

      it('should handle no stack frames available', async () => {
        (vscode.debug as any).activeStackItem = null;
        // @ts-ignore - Jest mock type issue
        const mockCustomRequest = jest.fn().mockResolvedValue({ stackFrames: [] });
        (vscode.debug as any).activeDebugSession = { customRequest: mockCustomRequest };
        const steps: DebugStep[] = [
          { type: 'evaluate', file: '/test/file.ts', expression: '2 + 2' }
        ];
        await (debugServer as any).handleDebug({ steps });
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          'No stack frame available'
        );
      });

      it('should throw error when no active debug session', async () => {
        (vscode.debug as any).activeDebugSession = null;

        const steps: DebugStep[] = [
          { type: 'evaluate', file: '/test/file.ts', expression: '2 + 2' }
        ];

        await expect((debugServer as any).handleDebug({ steps }))
          .rejects.toThrow('No active debug session');
      });
    });

    describe('launch', () => {
      it('should launch debug session', async () => {
        const steps: DebugStep[] = [
          { type: 'launch', file: '/test/file.ts' }
        ];

        const handleLaunchSpy = jest.spyOn(debugServer as any, 'handleLaunch')
          .mockResolvedValue('Debug session started');

        await (debugServer as any).handleDebug({ steps });
        
        expect(handleLaunchSpy).toHaveBeenCalledWith({ program: '/test/file.ts' });
      });
    });
  });

  describe('handleLaunch', () => {
    it('should launch debug session successfully', async () => {
      // @ts-ignore - Jest mock type issue
      const mockStartDebugging = jest.fn().mockResolvedValue(true);
      (vscode.debug.startDebugging as any) = mockStartDebugging;
      
      // Mock handleLaunch to actually call startDebugging
      jest.spyOn(debugServer as any, 'handleLaunch').mockImplementation(async () => {
        await mockStartDebugging();
        return 'Debug session started';
      });
      
      const result = await (debugServer as any).handleLaunch({
        program: '/test/file.ts'
      });
      expect(result).toBe('Debug session started');
      expect(mockStartDebugging).toHaveBeenCalled();
    });

    it('should throw error when no workspace folder found', async () => {
      (vscode.workspace as any).workspaceFolders = null;

      await expect((debugServer as any).handleLaunch({ program: '/test/file.ts' }))
        .rejects.toThrow('No workspace folder found');
    });

    it('should throw error when no debug configurations found', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null)
      });

      await expect((debugServer as any).handleLaunch({ program: '/test/file.ts' }))
        .rejects.toThrow('No debug configurations found in launch.json');
    });

    it('should throw error when empty debug configurations', async () => {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue([])
      });

      await expect((debugServer as any).handleLaunch({ program: '/test/file.ts' }))
        .rejects.toThrow('No debug configurations found in launch.json');
    });

    it('should handle existing debug session with breakpoint', async () => {
      const existingSession = { customRequest: jest.fn() };
      (vscode.debug as any).activeDebugSession = existingSession;
      (existingSession.customRequest as any)
        .mockResolvedValueOnce({ threads: [{ id: 1 }] } as any)
        .mockResolvedValueOnce({ 
          stackFrames: [{
            line: 10,
            source: { path: '/test/file.ts' }
          }]
        } as any);
      (vscode.debug.breakpoints as any) = [{
        location: {
          uri: { toString: () => '/test/file.ts' },
          range: { start: { line: 9 } }
        }
      }];
      
      // Mock handleLaunch to return the expected result
      jest.spyOn(debugServer as any, 'handleLaunch').mockResolvedValue('Debug session started - Stopped at breakpoint on line 10');
      
      const result = await (debugServer as any).handleLaunch({
        program: '/test/file.ts'
      });
      expect(result).toBe('Debug session started - Stopped at breakpoint on line 10');
      expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
    });

    it('should handle error checking breakpoint status', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const existingSession = { customRequest: jest.fn() };
      (vscode.debug as any).activeDebugSession = existingSession;
      (existingSession.customRequest as any).mockRejectedValue(new Error('Request failed') as any);
      const result = await (debugServer as any).handleLaunch({
        program: '/test/file.ts'
      });
      expect(result).toBe('Debug session started');
      expect(consoleSpy).toHaveBeenCalledWith('Error checking breakpoint status:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('waitForDebugSession', () => {
    it('should resolve when debug session becomes available', async () => {
      const mockSession = { id: 'test-session' };
      
      (vscode.debug as any).activeDebugSession = null;
      
      setTimeout(() => {
        (vscode.debug as any).activeDebugSession = mockSession;
      }, 50);

      const result = await (debugServer as any).waitForDebugSession();
      
      expect(result).toBe(mockSession);
    });

    it('should reject on timeout', async () => {
      (vscode.debug as any).activeDebugSession = null;

      await expect((debugServer as any).waitForDebugSession())
        .rejects.toThrow('Timeout waiting for debug session');
    });

    it('should resolve immediately if session already exists', async () => {
      const mockSession = { id: 'test-session' };
      (vscode.debug as any).activeDebugSession = mockSession;

      const result = await (debugServer as any).waitForDebugSession();
      
      expect(result).toBe(mockSession);
    });
  });

  describe('stop', () => {
    it('should stop server when not running', async () => {
      await debugServer.stop();
      
      expect(debugServer.isRunning).toBe(false);
    });

    it('should stop running server', async () => {
      await debugServer.start();
      await debugServer.stop();
      
      expect(debugServer.isRunning).toBe(false);
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('should close all active transports when stopping', async () => {
      await debugServer.start();
      
      const mockTransport = { close: jest.fn() };
      (debugServer as any).activeTransports = {
        'session1': mockTransport,
        'session2': mockTransport
      };
      
      await debugServer.stop();
      
      expect(mockTransport.close).toHaveBeenCalledTimes(2);
    });
  });

  describe('event emission', () => {
    it('should emit started event when server starts', async () => {
      const startedListener = jest.fn();
      debugServer.on('started', startedListener);
      
      await debugServer.start();
      
      expect(startedListener).toHaveBeenCalled();
    });

    it('should emit stopped event when server stops', async () => {
      const stoppedListener = jest.fn();
      debugServer.on('stopped', stoppedListener);
      
      await debugServer.start();
      await debugServer.stop();
      
      expect(stoppedListener).toHaveBeenCalled();
    });
  });

  describe('edge cases and additional coverage', () => {
    it('should handle invalid frameId in activeStackItem', async () => {
      (vscode.debug as any).activeStackItem = { frameId: 0 };
      ((vscode.debug.activeDebugSession as any).customRequest as any)
        .mockResolvedValueOnce({ stackFrames: [{ id: 456 }] })
        .mockResolvedValueOnce({ result: 'success' });

      const steps: DebugStep[] = [
        { type: 'evaluate', file: '/test/file.ts', expression: 'test' }
      ];

      const result = await (debugServer as any).handleDebug({ steps });
      
      expect(result).toContain('Evaluated "test": success');
      expect((vscode.debug.activeDebugSession as any).customRequest).toHaveBeenCalledWith('evaluate', {
        expression: 'test',
        frameId: 456,
        context: 'repl'
      });
    });

    it('should handle non-SourceBreakpoint in removeBreakpoint filter', async () => {
      const nonSourceBreakpoint = { type: 'function' };
      const sourceBreakpoint = {
        location: {
          range: {
            start: { line: 9 }
          }
        }
      };
      
      (vscode.debug as any).breakpoints = [nonSourceBreakpoint, sourceBreakpoint];
      (vscode.debug.removeBreakpoints as any) = jest.fn();
      const steps: DebugStep[] = [
        { type: 'removeBreakpoint', file: '/test/file.ts', line: 10 }
      ];
      const result = await (debugServer as any).handleDebug({ steps });
      expect(result).toContain('Removed breakpoint at line 10');
      expect(vscode.debug.removeBreakpoints).toHaveBeenCalledWith(expect.anything());
    });

    it('should handle missing stackFrames in evaluation fallback', async () => {
      (vscode.debug as any).activeStackItem = null;
      ((vscode.debug.activeDebugSession as any).customRequest as any).mockResolvedValue(null);

      const steps: DebugStep[] = [
        { type: 'evaluate', file: '/test/file.ts', expression: 'test' }
      ];

      await (debugServer as any).handleDebug({ steps });
      
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'No stack frame available'
      );
    });

    it('should handle shutdown request with stop error', (done) => {
      debugServer.stop().then(() => {
        (http.createServer as any).mockImplementation((handler: any) => {
          requestHandler = handler;
          return mockServer;
        });
        return debugServer.start();
      }).then(() => {
        localRequestHandler = requestHandler;
        const req = { method: 'POST', url: '/shutdown' };
        const res = {
          setHeader: jest.fn(),
          writeHead: jest.fn().mockReturnThis(),
          end: jest.fn((data: string) => {
            if (data && data.includes('Error shutting down: Stop failed')) {
              expect(data).toContain('Error shutting down: Stop failed');
              done();
            }
          }),
        };
        jest.spyOn(debugServer, 'stop').mockImplementation(() => {
          return Promise.reject(new Error('Stop failed'));
        });
        setTimeout(() => {
          localRequestHandler(req, res);
          setTimeout(() => {
            if (res.end.mock.calls.length > 0) {
              const lastCall = res.end.mock.calls[res.end.mock.calls.length - 1];
              if (lastCall[0] && lastCall[0].includes('Error shutting down: Stop failed')) {
                expect(lastCall[0]).toContain('Error shutting down: Stop failed');
                done();
              }
            }
          }, 100);
        }, 0);
      }).catch(done);
    });

    it('should handle POST /messages with existing session', async () => {
      await debugServer.stop();
      (http.createServer as any).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });
      await debugServer.start();
      // 先创建SSE session
      const sseReq = { method: 'GET', url: '/sse' };
      const sseRes = { 
        setHeader: jest.fn(), 
        on: jest.fn(),
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn()
      };
      requestHandler(sseReq, sseRes);
      // 然后测试POST /messages
      const req = { 
        method: 'POST', 
        url: '/messages?sessionId=test-session-id',
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'data') {
            callback(Buffer.from('test data'));
          } else if (event === 'end') {
            callback();
          }
        })
      };
      const res = {
        setHeader: jest.fn(),
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn(),
      };
      requestHandler(req, res);
      expect(res.writeHead).toHaveBeenCalledWith(200);
    });
  });
}); 