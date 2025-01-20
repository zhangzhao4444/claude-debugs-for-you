# Enable Claude (or any other LLM) to interactively debug your code

[![Badge](https://img.shields.io/badge/Visual%20Studio%20Marketplace-v0.0.2-blue.svg)](https://marketplace.visualstudio.com/items?itemName=JasonMcGhee.claude-debugs-for-you)

This is an [MCP](https://docs.anthropic.com/en/docs/build-with-claude/mcp) Server and VS Code extension which enables claude to interactively debug and evaluate expressions.

That means it should also work with other models / clients etc. but I only demonstrate it with Claude Desktop here.

It's language-agnostic, assuming debugger console support and valid launch.json for debugging in VSCode.

## Getting Started

- Download the extension from [releases](https://github.com/jasonjmcghee/claude-debugs-for-you/releases/) or [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=JasonMcGhee.claude-debugs-for-you)
- Install the extension
  - If using `.vsix` directly, go to the three dots in "Extensions" in VS Code and choose "Install from VSIX..."
- Open a project containing a `.vscode/launch.json` with the first configuration setup to debug a specific file with `${file}`.
- Execute "Start MCP Debug Server" (A popup will show that it started: copy the path to `mcp-debug.js`)

<img width="384" alt="image" src="https://github.com/user-attachments/assets/5de31d62-32e5-4eac-83f1-cd6bacc2ab7d" />

- Paste the following (BUT UPDATE THE PATH!) in your `claude_desktop_config.json` or edit accordingly if you use other MCP servers

```
{
  "mcpServers": {
    "debug": {
      "command": "node",
      "args": [
        "/path/to/mcp-debug.js"
      ]
    }
  }
}
```

- Start Claude desktop (or other MCP client)
- You're ready to debug
- See [Run  an Example](#run-an-example) below.

## Contributing

Find bugs or have an idea that will improve this? Please open a pull request or log an issue.

Does this readme suck? Help me improve it!

## Demo

In this example, I made it intentionally very cautious (make no assumptions etc - same prompt as below) but you can ask it to do whatever.

https://github.com/user-attachments/assets/ef6085f7-11a2-4eea-bb60-b5a54873b5d5

## Developing

- Cline / Open this repo with VS Code
- Run `npm run install` and `npm run compile`
- Hit "run" which will open a new VSCode
    - Run the command in VS Code: "Start MCP Debug Server"
- Otherwise same as "Getting Started applies"
- To rebuild, `npm run compile`

## Package

```bash
vsce package
```


## Run an Example

Enter the prompt:

```
i am building `longest_substring_with_k_distinct` and for some reason it's not working quite right. can you debug it step by step using breakpoints and evaluating expressions to figure out where it goes wrong? make sure to use the debug tool to get access and debug! don't make any guesses as to the problem up front. DEBUG!
```

## Configuration

There's a hidden env var you can use to set the port on the MCP side.

```
"debug": {
  "command": "node",
  "args": [
    "/path/to/mcp-debug.js"
  ],
  "env": {
    "MCP_DEBUGGER_PORT": 4711
  }
}
```

And similarly you may set the port on the vs code side using extensions settings or JSON:

<img width="243" alt="image" src="https://github.com/user-attachments/assets/51037811-b4f1-4c65-9344-f4d14d059be7" />

```
"mcpDebug.port": 4711
```

## Short list of ideas

- [ ] It should use ripgrep to find what you ask for, rather than list files + get file content.
- [x] Add support for conditional breakpoints
- [ ] Add "fix" tool by allowing MCP to insert a CodeLens or "auto fix" suggestion so the user can choose to apply a recommended change or not.
- Your idea here!
