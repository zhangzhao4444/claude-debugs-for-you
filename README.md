# Enable Claude to interactively debug your code

This is an [MCP](https://docs.anthropic.com/en/docs/build-with-claude/mcp) Server and VS Code extension which enables claude to interactively debug and evaluate expressions.

That means it should also work with other models / clients etc. but I only demonstrate it with Claude here.

It's theoretically language-agnostic, assuming debugger console support and valid launch.json for debugging in VSCode.

_I made this during Nvidia + Vercel's 2 hour hackathon, so "it's not perfect" is the understatement of the century. Will happily accept pull requests!_

## Contributing

Find bugs or have an idea that will improve this? Please open a pull request or log an issue.

Does this readme suck? Help me improve it!

## Demo

In this example, I made it intentionally very cautious (make no assumptions etc - same prompt as below) but you can ask it to do whatever.

https://github.com/user-attachments/assets/ef6085f7-11a2-4eea-bb60-b5a54873b5d5

## Setup

- Open ./debug-with-llm with VS Code and hit "run" which will open a new VSCode
    - this should be improved via making a .visx extension!
- Navigate to your project root (containing .vscode/launch.json)
- Run the command "Start MCP Debug Server"
    - If you don't see it, the vs code extension isn't running
- [Skim the docs for MCP setup](https://modelcontextprotocol.io/quickstart/user) noting where `claude_desktop_config.json` lives on your system / follow the tutorial to create it.
- Paste the following (BUT UPDATE THE PATH!) in your `claude_desktop_config.json` or edit accordingly if you use other MCP servers

```
{
  "mcpServers": {
    "debug": {
      "command": "node",
      "args": [
        "/path/to/claude-debugs-for-you/mcp/build/index.js"
      ]
    }
  }
}
```

- Start Claude desktop
- You're ready to debug


## Run an Example

Enter the prompt:

```
i am building `longest_substring_with_k_distinct` and for some reason it's not working quite right. can you debug it step by step using breakpoints and evaluating expressions to figure out where it goes wrong? make sure to use the debug tool to get access and debug! don't make any guesses as to the problem up front. DEBUG!
```


## Short list of ideas

- [ ] It should use ripgrep to find what you ask for, rather than list files + get file content.
- [ ] Add support for conditional breakpoints
- [ ] Add "fix" tool by allowing MCP to insert a CodeLens or "auto fix" suggestion so the user can choose to apply a recommended change or not.
- Your idea here!
