// @ts-nocheck
import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';

// Mock vscode module
jest.mock('vscode', () => ({
  window: {
    createStatusBarItem: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
    showTextDocument: jest.fn().mockResolvedValue({
      document: { uri: { toString: () => '/test/file.ts' } }
    })
  },
  workspace: {
    getConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    findFiles: jest.fn().mockResolvedValue([
      { fsPath: '/test/file1.ts' },
      { fsPath: '/test/file2.js' }
    ]),
    openTextDocument: jest.fn().mockResolvedValue({
      getText: jest.fn().mockReturnValue('line1\nline2\nline3')
    }),
    workspaceFolders: [{ uri: { fsPath: '/test' } }]
  },
  commands: {
    registerCommand: jest.fn(),
    executeCommand: jest.fn()
  },
  env: {
    clipboard: {
      writeText: jest.fn()
    }
  },
  StatusBarAlignment: {
    Right: 'right'
  },
  ConfigurationTarget: {
    Global: 'global'
  },
  debug: {
    activeDebugSession: null,
    activeStackItem: null,
    breakpoints: [],
    addBreakpoints: jest.fn(),
    removeBreakpoints: jest.fn(),
    startDebugging: jest.fn()
  },
  SourceBreakpoint: jest.fn(),
  Location: jest.fn(),
  Position: jest.fn(),
  RelativePattern: jest.fn()
}));

// Mock fs module
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  copyFileSync: jest.fn(),
  writeFileSync: jest.fn()
}));

// Mock path module
jest.mock('path', () => ({
  join: jest.fn()
}));

// Mock debug-server module
// jest.mock('../debug-server', () => ({
//   DebugServer: jest.fn()
// }));

// Mock vscode.DebugStackFrame 构造函数
(global as any).vscode = require('vscode');
(global as any).vscode.DebugStackFrame = function DebugStackFrame() {}; 