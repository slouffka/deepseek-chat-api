import { describe, it, expect, beforeAll, afterAll, mock, test } from "bun:test";

const TEST_PORT = 3001;
const PROXY_URL = `http://localhost:${TEST_PORT}`;
let serverProcess: Bun.Subprocess | null = null;

// Global setup - runs once before all tests
beforeAll(async () => {
  // Start proxy server for integration tests
  serverProcess = Bun.spawn(["bun", "cors-proxy.js"], {
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, NODE_ENV: "test", PORT: String(TEST_PORT) },
  });

  // Wait for server to be ready - poll health endpoint
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${PROXY_URL}/health`);
      if (response.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
});

// Global teardown - runs once after all tests
afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
});

describe("Proxy Server", () => {
  it("serves index.html on root", async () => {
    const response = await fetch(`${PROXY_URL}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("DeepSeek Chat API");
  });

  it("handles health check", async () => {
    const response = await fetch(`${PROXY_URL}/health`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(data.service).toBe("DeepSeek Universal Proxy");
  });

  it("returns 404 for unknown endpoints", async () => {
    const response = await fetch(`${PROXY_URL}/unknown`);
    expect(response.status).toBe(404);
  });

  it("handles OPTIONS for CORS", async () => {
    const response = await fetch(`${PROXY_URL}/api/v0/chat/completion`, {
      method: "OPTIONS",
    });
    expect(response.status).toBe(204);
  });
});

describe("Chat Completion Endpoint (mocked)", () => {
  it("returns mock response without real API", async () => {
    const response = await fetch(`${PROXY_URL}/api/v0/chat/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        prompt: "test",
        messages: [{ role: "user", content: "hello" }]
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.choices).toBeDefined();
    expect(data.choices[0].message.content).toBe("Test response from mock");
  });

  it("handles tool calls in mock mode", async () => {
    const response = await fetch(`${PROXY_URL}/api/v0/chat/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        prompt: "list files",
        messages: [{ role: "user", content: "list files" }]
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.choices).toBeDefined();
  });
});