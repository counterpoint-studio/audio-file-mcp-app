This project provides an MCP server that hosts an MCP app for interacting with
a local audio file (playing it, seeing its basic metadata and metrics such as loudness).

It runs as an stdio MCP server and is designed for local files only.

Instructions:
- pnpm for package management
- prefer unit testable modular code. write tests for all new and changed code, except when it's DOM manipulation / otherwise hard to test.
- Find Mediabunny context in https://mediabunny.dev/llms.txt
