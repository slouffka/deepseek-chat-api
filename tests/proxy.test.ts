import { describe, it, expect, beforeAll, afterAll } from "bun:test";

describe("Proxy Server", () => {
  const PROXY_URL = "http://localhost:3000";
  let serverProcess: Bun.Subprocess | null = null;

  beforeAll(async () => {
    // Start proxy server for integration tests
    serverProcess = Bun.spawn(["bun", "cors-proxy.js"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  });

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

describe("Chat Completion Endpoint", () => {
  const PROXY_URL = "http://localhost:3000";

  it("requires authentication", async () => {
    const response = await fetch(`${PROXY_URL}/api/v0/chat/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });
    // Should fail without proper setup (no DEEPSEEK_API_KEY in test env)
    expect(response.status).not.toBe(200);
  });
});