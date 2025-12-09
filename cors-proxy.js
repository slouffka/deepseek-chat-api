import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const DEEPSEEK_BASE_URL = 'https://chat.deepseek.com';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

app.use(cors());
app.use(express.json());

// Debug middleware - captures all API requests
app.use((req, _res, next) => {
    if (req.path.includes('/api/v0/')) {
        console.log('\n=== INCOMING REQUEST ===');
        console.log('Path:', req.path);
        console.log('Method:', req.method);
        console.log('Body:', req.body);
        console.log('=== END REQUEST ===\n');
    }
    next();
});

// Universal proxy handler for all DeepSeek API endpoints
app.post('/api/v0/:service/:endpoint', async (req, res) => {
    try {
        const { service, endpoint } = req.params; // service = 'chat' or 'chat_session'
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
                const encoder = new TextEncoder();
                
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        // Write the chunk to response
                        res.write(encoder.encode(value));
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

app.get('/', (_req, res) => {
    res.send(`
        <html>
            <head><title>DeepSeek Universal Proxy</title></head>
            <body>
                <h1>DeepSeek Universal Proxy</h1>
                <p>Handles CORS for all DeepSeek API endpoints</p>
                <ul>
                    <li><code>POST /api/v0/chat/:endpoint</code> - Chat endpoints</li>
                    <li><code>POST /api/v0/chat_session/:endpoint</code> - Session endpoints</li>
                    <li><code>GET</code> <a href='/health'><code>/health</code></a> - Health check</li>
                </ul>
                <p>Base URL: ${DEEPSEEK_BASE_URL}</p>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
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
