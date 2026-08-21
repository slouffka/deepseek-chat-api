import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { promises as fs } from "fs";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const DEEPSEEK_BASE_URL = 'https://chat.deepseek.com';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

if (!DEEPSEEK_API_KEY) {
  console.error('❌ DEEPSEEK_API_KEY not set in .env');
  process.exit(1);
}

app.use(cors());
app.use(express.json());

// PoW solver using WASM
let powSolver = null;
let wasmModule = null;

async function initPowSolver() {
    if (wasmModule) return wasmModule;
    
    try {
        const wasmPath = join(process.cwd(), 'public/sha3_wasm_bg.7b9ca65ddd.wasm');
        const wasmBytes = await fs.readFile(wasmPath);
        
        const importObject = {
            env: {
                memory: new WebAssembly.Memory({ initial: 256 }),
            }
        };
        
        const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
        wasmModule = instance.exports;
        console.log('[POW] WASM loaded, exports:', Object.keys(wasmModule));
        return wasmModule;
    } catch (error) {
        console.error('[POW] Failed to load WASM:', error);
        throw error;
    }
}

function writeToMemory(text) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    const length = encoded.length;
    
    const ptr = wasmModule.__wbindgen_export_0(length, 1);
    const memoryView = new Uint8Array(wasmModule.memory.buffer);
    memoryView.set(encoded, ptr);
    
    return [ptr, length];
}

function solvePow(challengeData) {
    if (!wasmModule) throw new Error('WASM not initialized');
    
    const prefix = `${challengeData.salt}_${challengeData.expire_at}_`;
    
    const retptr = wasmModule.__wbindgen_add_to_stack_pointer(-16);
    
    try {
        const [challengePtr, challengeLen] = writeToMemory(challengeData.challenge);
        const [prefixPtr, prefixLen] = writeToMemory(prefix);
        
        wasmModule.wasm_solve(
            retptr,
            challengePtr,
            challengeLen,
            prefixPtr,
            prefixLen,
            parseFloat(challengeData.difficulty)
        );
        
        const memoryView = new Uint8Array(wasmModule.memory.buffer);
        const statusBytes = memoryView.slice(retptr, retptr + 4);
        const status = new Int32Array(statusBytes.buffer)[0];
        
        if (status === 0) {
            throw new Error('PoW solve failed');
        }
        
        const answerBytes = memoryView.slice(retptr + 8, retptr + 16);
        const answerValue = new Float64Array(answerBytes.buffer)[0];
        const answer = Math.floor(answerValue);
        
        const result = {
            algorithm: challengeData.algorithm,
            challenge: challengeData.challenge,
            salt: challengeData.salt,
            answer: answer,
            signature: challengeData.signature,
            target_path: challengeData.target_path
        };
        
        const jsonStr = JSON.stringify(result);
        const encoded = Buffer.from(jsonStr).toString('base64');
        
        return encoded;
        
    } finally {
        wasmModule.__wbindgen_add_to_stack_pointer(16);
    }
}

async function getPowHeader() {
    await initPowSolver();
    
    const challengeRes = await fetch(`${DEEPSEEK_BASE_URL}/api/v0/chat/create_pow_challenge`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'x-client-version': '1.5.0',
            'x-app-version': '20241129.1',
            'x-client-platform': 'web',
            'x-client-locale': 'en_US',
            'Referer': 'https://chat.deepseek.com/',
            'Origin': 'https://chat.deepseek.com'
        },
        body: JSON.stringify({ target_path: '/api/v0/chat/completion' })
    });
    
    if (!challengeRes.ok) {
        throw new Error(`Challenge request failed: ${challengeRes.status}`);
    }
    
    const challengeData = await challengeRes.json();
    const challenge = challengeData.data?.biz_data?.challenge;
    
    if (!challenge) {
        throw new Error('Invalid challenge response');
    }
    
    return solvePow(challenge);
}

// Tool definitions for the LLM
const TOOLS = [
  {
    name: "read_file",
    description: "Read contents of a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write content to a file (creates or overwrites)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        content: { type: "string", description: "Content to write" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing a string",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        oldString: { type: "string", description: "Text to replace" },
        newString: { type: "string", description: "New text" }
      },
      required: ["path", "oldString", "newString"]
    }
  },
  {
    name: "list_files",
    description: "List files in a directory",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to project root", default: "." }
      },
      required: []
    }
  },
  {
    name: "run_shell",
    description: "Execute a shell command (zsh)",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute" },
        cwd: { type: "string", description: "Working directory", default: "." },
        timeout: { type: "number", description: "Timeout in ms", default: 30000 }
      },
      required: ["command"]
    }
  },
  {
    name: "grep",
    description: "Search for pattern in files",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern" },
        path: { type: "string", description: "Directory to search", default: "." },
        include: { type: "string", description: "File pattern (e.g. *.js)" }
      },
      required: ["pattern"]
    }
  }
];

// Tool executor
async function executeTool(name, args) {
  const projectRoot = process.cwd();
  
  try {
    switch (name) {
      case "read_file": {
        const fullPath = join(projectRoot, args.path);
        const content = await fs.readFile(fullPath, "utf-8");
        return { success: true, content };
      }
      
      case "write_file": {
        const fullPath = join(projectRoot, args.path);
        await fs.mkdir(join(fullPath, ".."), { recursive: true });
        await fs.writeFile(fullPath, args.content, "utf-8");
        return { success: true, message: `Written to ${args.path}` };
      }
      
      case "edit_file": {
        const fullPath = join(projectRoot, args.path);
        let content = await fs.readFile(fullPath, "utf-8");
        if (!content.includes(args.oldString)) {
          return { success: false, error: "oldString not found in file" };
        }
        content = content.replace(args.oldString, args.newString);
        await fs.writeFile(fullPath, content, "utf-8");
        return { success: true, message: `Edited ${args.path}` };
      }
      
      case "list_files": {
        const fullPath = join(projectRoot, args.path || ".");
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const files = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file"
        }));
        return { success: true, files };
      }
      
      case "run_shell": {
        return new Promise((resolve) => {
          const cmd = spawn("zsh", ["-c", args.command], {
            cwd: join(projectRoot, args.cwd || "."),
            timeout: args.timeout || 30000
          });
          
          let stdout = "";
          let stderr = "";
          
          cmd.stdout.on("data", (data) => stdout += data.toString());
          cmd.stderr.on("data", (data) => stderr += data.toString());
          
          cmd.on("close", (code) => {
            resolve({
              success: code === 0,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              code
            });
          });
          
          cmd.on("error", (err) => {
            resolve({ success: false, error: err.message });
          });
        });
      }
      
      case "grep": {
        const fullPath = join(projectRoot, args.path || ".");
        const cmd = spawn("rg", ["--json", args.pattern], {
          cwd: fullPath
        });
        
        let stdout = "";
        cmd.stdout.on("data", (data) => stdout += data.toString());
        
        return new Promise((resolve) => {
          cmd.on("close", () => {
            const matches = stdout.trim().split("\n")
              .filter(l => l)
              .map(l => {
                try { return JSON.parse(l); } catch { return null; }
              })
              .filter(Boolean)
              .map(m => m?.data?.lines?.text || m?.data?.path?.text || "")
              .filter(Boolean);
            resolve({ success: true, matches: matches.slice(0, 50) });
          });
        });
      }
      
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Build system prompt with tools
function buildSystemPrompt() {
  const toolDescriptions = TOOLS.map(t => 
    `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters)}`
  ).join("\n\n");
  
  return `You are a coding assistant with access to tools. Use them to accomplish tasks.

Available tools:
${toolDescriptions}

To call a tool, respond with a JSON block:
\`\`\`json
{
  "tool": "tool_name",
  "arguments": { "param": "value" }
}
\`\`\`

Only call ONE tool per response. Wait for the result before continuing.
When done, respond normally without a tool call.`;
}

// Convert messages array to prompt string with system prompt embedded
function buildPrompt(messages) {
  const systemPrompt = buildSystemPrompt();
  const conversation = messages.map(m => `${m.role}: ${m.content}`).join("\n\n");
  return `${systemPrompt}\n\n${conversation}\n\nassistant:`;
}

// Serve index.html with PORT injected (before static middleware)
app.get('/', (_req, res) => {
    const html = readFileSync(join(process.cwd(), 'public/index.html'), 'utf-8');
    const searchStr = 'placeholder="http://localhost:3000" value=""';
    const replaceStr = `placeholder="http://localhost:3000" value="http://localhost:${PORT}"`;
    const injectedHtml = html.replace(searchStr, replaceStr);
    res.setHeader('Content-Type', 'text/html');
    res.send(injectedHtml);
});

// Serve static files from public directory (except index.html)
app.use(express.static(join(process.cwd(), 'public'), { index: false }));

// Tool execution endpoint
app.post('/api/v0/tools/execute', async (req, res) => {
    try {
        const { tool, arguments: args } = req.body;
        console.log(`[TOOL] Executing ${tool}`, args);
        
        const result = await executeTool(tool, args);
        console.log(`[TOOL] Result:`, result);
        
        res.json(result);
    } catch (error) {
        console.error("[TOOL] Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Chat completion with tool loop
async function handleChatCompletionWithTools(req, res) {
    try {
        let messages = req.body.messages || [];
        const maxTurns = 10;
        let turn = 0;
        
        while (turn < maxTurns) {
            turn++;
            console.log(`[CHAT] Turn ${turn}/${maxTurns}`);
            
            // Get fresh PoW for each turn
            let powHeader;
            try {
                powHeader = await getPowHeader();
                console.log(`[CHAT] PoW obtained for turn ${turn}`);
            } catch (e) {
                console.error(`[CHAT] PoW failed:`, e.message);
                res.status(500).json({ error: 'PoW failed', message: e.message });
                return;
            }
            
            // Build prompt with system + history
            const prompt = buildPrompt(messages);
            
            // Forward to DeepSeek
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'x-client-version': '1.5.0',
                'x-app-version': '20241129.1',
                'x-client-platform': 'web',
                'x-client-locale': 'en_US',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                'x-ds-pow-response': powHeader
            };
            
            const response = await fetch(`${DEEPSEEK_BASE_URL}/api/v0/chat/completion`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ...req.body,
                    prompt,  // Use prompt string instead of messages array
                    thinking_enabled: true,
                    search_enabled: true,
                    client_stream_id: req.body.client_stream_id
                })
            });
            
            console.log(`[CHAT] Response status: ${response.status}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[CHAT] API error:`, errorText);
                throw new Error(`API error ${response.status}: ${errorText}`);
            }
            
            const contentType = response.headers.get('content-type');
            const isStreaming = contentType && contentType.includes('text/event-stream');
            
            // Always buffer first to check for tool calls
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = "";
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                fullResponse += decoder.decode(value, { stream: true });
            }
            
            console.log(`[CHAT] Raw response length: ${fullResponse.length}`);
            
            // Parse SSE to extract actual text content
            const parsedContent = parseSSEContent(fullResponse);
            console.log(`[CHAT] Parsed content (first 500): ${parsedContent.substring(0, 500)}`);
            
            // Check for tool calls in parsed content
            const toolCall = extractToolCall(parsedContent);
            if (toolCall) {
                console.log(`[CHAT] Tool call detected:`, toolCall);
                // Execute tool
                const toolResult = await executeTool(toolCall.tool, toolCall.arguments);
                console.log(`[CHAT] Tool result:`, toolResult);
                
                // Add tool result to messages and continue loop
                messages.push({ role: "assistant", content: parsedContent });
                messages.push({ role: "tool", content: JSON.stringify(toolResult), tool_call_id: toolCall.tool });
                continue;
            }
            
            console.log(`[CHAT] No tool call, streaming to client`);
            // No tool call - THIS is the final turn, stream to client
            if (isStreaming) {
                res.status(response.status);
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.write(fullResponse);
                res.end();
                return;
            } else {
                // Non-streaming - parse and return JSON
                try {
                    const data = JSON.parse(fullResponse);
                    res.json(data);
                } catch {
                    res.status(response.status).send(fullResponse);
                }
                return;
            }
        }
        
        res.status(400).json({ error: "Max tool turns exceeded" });
        
    } catch (error) {
        console.error("[CHAT] Error:", error);
        res.status(500).json({ error: 'Chat error', message: error.message });
    }
}

function extractToolCall(text) {
    // Match ```json { "tool": "...", "arguments": {...} } ``` OR ``` { "tool": "...", "arguments": {...} } ```
    const match = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (match) {
        try {
            const parsed = JSON.parse(match[1]);
            if (parsed.tool && parsed.arguments) {
                return parsed;
            }
        } catch {}
    }
    
    // Also match bare JSON object (no code fences)
    const bareMatch = text.match(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/);
    if (bareMatch) {
        try {
            const parsed = JSON.parse(bareMatch[0]);
            if (parsed.tool && parsed.arguments) {
                return parsed;
            }
        } catch {}
    }
    
    return null;
}

// Parse SSE stream to extract text content
function parseSSEContent(sseText) {
    const lines = sseText.split('\n');
    let content = '';
    
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            if (dataStr === '[DONE]') continue;
            
            try {
                const parsed = JSON.parse(dataStr);
                
                // Handle DeepSeek diff format: {"v": "text", "p": "path"}
                if (parsed.v && typeof parsed.v === 'string') {
                    content += parsed.v;
                }
                // Handle standard OpenAI format
                else if (parsed.choices?.[0]?.delta?.content) {
                    content += parsed.choices[0].delta.content;
                }
                // Handle full message
                else if (parsed.choices?.[0]?.message?.content) {
                    content += parsed.choices[0].message.content;
                }
            } catch {}
        }
    }
    
    return content;
}

// Universal proxy handler for all DeepSeek API endpoints
app.post('/api/v0/:service/:endpoint', async (req, res) => {
    try {
        const { service, endpoint } = req.params;
        
        if (service === 'chat' && endpoint === 'completion') {
            return handleChatCompletionWithTools(req, res);
        }
        
        const targetUrl = `${DEEPSEEK_BASE_URL}/api/v0/${service}/${endpoint}`;
        
        console.log(`[PROXY] Forwarding ${service}/${endpoint} to: ${targetUrl}`);
        
        // Prepare headers - always use env token
        const headersToForward = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'x-client-version': req.headers['x-client-version'] || '1.5.0',
            'x-app-version': req.headers['x-app-version'] || '20241129.1',
            'x-client-platform': req.headers['x-client-platform'] || 'web',
            'x-client-locale': req.headers['x-client-locale'] || 'en_US',
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        };
        
        // Only forward x-ds-pow-response for chat/completion endpoint
        if (service === 'chat' && endpoint === 'completion' && req.headers['x-ds-pow-response']) {
            headersToForward['x-ds-pow-response'] = req.headers['x-ds-pow-response'];
        }
        
        // Log what we're forwarding (redacted)
        const logHeaders = { ...headersToForward };
        if (logHeaders.Authorization) {
            logHeaders.Authorization = logHeaders.Authorization.substring(0, 25) + '...';
        }
        console.log('[PROXY] Forwarding headers:', logHeaders);
        console.log('[PROXY] Forwarding body:', req.body);
        
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: headersToForward,
            body: JSON.stringify(req.body)
        });
        
        console.log(`[PROXY] Response status: ${response.status} for ${service}/${endpoint}`);
        
        // Handle different response types
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            res.status(response.status).json(data);
        } else if (contentType && contentType.includes('text/event-stream')) {
            // For streaming responses, pipe through
            res.status(response.status);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            if (response.body) {
                const reader = response.body.getReader();
                
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        // Write the chunk to response
                        res.write(value);
                    }
                } finally {
                    reader.releaseLock();
                }
            }
            res.end();
        } else {
            const text = await response.text();
            res.status(response.status).send(text);
        }
        
    } catch (error) {
        console.error("[PROXY] Error:", error);
        res.status(500).json({ 
            error: 'Proxy error', 
            message: error.message 
        });
    }
});

// Health check
app.get('/health', (_req, res) => {
    res.json({ 
        status: 'ok',
        service: 'DeepSeek Universal Proxy',
        timestamp: new Date().toISOString(),
        endpoints: {
            chat: '/api/v0/chat/:endpoint (completion, create_pow_challenge)',
            chat_session: '/api/v0/chat_session/:endpoint (create)',
            health: '/health'
        }
    });
});

const server = app.listen(PORT, () => {
    console.log(`=====================================`);
    console.log(`DeepSeek Universal Proxy Running`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`Base: ${DEEPSEEK_BASE_URL}`);
    console.log(``);
    console.log(`📡 Supported Endpoints:`);
    console.log(`  POST /api/v0/chat/create_pow_challenge`);
    console.log(`  POST /api/v0/chat/completion`);
    console.log(`  POST /api/v0/chat_session/create`);
    console.log(``);
    console.log(`✅ Authentication: Auto-injected from .env`);
    console.log(`🔧 Streaming: SSE responses supported`);
    console.log(`=====================================`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ PORT ${PORT} ALREADY IN USE!`);
        console.error(`Kill existing process: lsof -ti:${PORT} | xargs kill -9`);
        console.error(`Or change PORT in .env\n`);
        process.exit(1);
    }
    throw err;
});