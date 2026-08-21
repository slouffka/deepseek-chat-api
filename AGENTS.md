# Project Rules for Agents

## General

- Use `bun` instead of `node` for running scripts
- Use `bun dev` to start the proxy server
- Never read `.env` directly - use `.env.example` for reference
- All secrets must stay in `.env` (gitignored)

## Code Style

- Vanilla JS on frontend (no frameworks)
- ES modules (`type: "module"` in package.json)
- No TypeScript unless explicitly requested
- Minimal dependencies

## Frontend (public/index.html)

- Single file: HTML + CSS + JS
- Marked.js for markdown, Highlight.js for code
- localStorage for session/history persistence
- Custom scrollbar, dark/light theme

## Backend (cors-proxy.js)

- Express server with CORS
- PoW solved via WASM (sha3_wasm_bg.7b9ca65ddd.wasm)
- Tool calling: fs (read/write/edit/list), shell (zsh), grep (rg)
- ReAct loop for multi-turn tool execution
- SSE streaming with DeepSeek diff-format parsing
- Rate limiting handled on frontend with auto-retry

## Environment Variables

```
DEEPSEEK_API_KEY=sk-xxx  # Required
PORT=3000                # Optional, defaults to 3000
```

## Commands

```bash
bun dev          # Start proxy server
bun install      # Install dependencies
```

## Git

- `.env` is gitignored
- Never commit API keys
- Use conventional commits if committing
- **NEVER commit or push without green tests** (`bun test` must pass)
- **No push permission** - user handles all git pushes

## Safety

- Research/educational project only
- Respect DeepSeek ToS and rate limits
- No production use