import { jest } from '@jest/globals';

export const window = {
  createStatusBarItem: jest.fn(),
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showQuickPick: jest.fn(),
  showInputBox: jest.fn(),
};

export const workspace = {
  getConfiguration: jest.fn(),
  onDidChangeConfiguration: jest.fn(),
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
};

export const env = {
  clipboard: {
    writeText: jest.fn(),
  },
};

export const StatusBarAlignment = {
  Right: 2,
  Left: 1,
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

export const Uri = {
  file: jest.fn(),
};

export default {
  window,
  workspace,
  commands,
  env,
  StatusBarAlignment,
  ConfigurationTarget,
  Uri,
}; 