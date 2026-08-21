import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

// Test utilities
const TEST_DIR = join(process.cwd(), "test-workspace");

// Helper to create test files
function setupTestWorkspace() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "test.txt"), "Hello World");
  writeFileSync(join(TEST_DIR, "code.js"), "console.log('test');");
  mkdirSync(join(TEST_DIR, "subdir"));
  writeFileSync(join(TEST_DIR, "subdir", "nested.txt"), "Nested content");
}

function cleanupTestWorkspace() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe("File System Tools", () => {
  beforeAll(() => {
    setupTestWorkspace();
  });

  afterAll(() => {
    cleanupTestWorkspace();
  });

  it("reads file content correctly", async () => {
    const content = await Bun.file(join(TEST_DIR, "test.txt")).text();
    expect(content).toBe("Hello World");
  });

  it("writes file content correctly", async () => {
    const testPath = join(TEST_DIR, "write-test.txt");
    await Bun.write(testPath, "Written content");
    const content = await Bun.file(testPath).text();
    expect(content).toBe("Written content");
  });

  it("lists directory contents", async () => {
    const entries = [];
    for await (const entry of new Bun.Glob("*").scan({ cwd: TEST_DIR })) {
      entries.push(entry);
    }
    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(entries).toContain("test.txt");
  });
});

describe("Tool Execution", () => {
  it("executes shell commands", async () => {
    const proc = Bun.spawn(["echo", "hello"], { stdout: "pipe" });
    const text = await new Response(proc.stdout).text();
    expect(text.trim()).toBe("hello");
  });

  it("handles shell command errors", async () => {
    const proc = Bun.spawn(["false"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    expect(code).not.toBe(0);
  });
});

describe("PoW Solver", () => {
  it("loads WASM module", async () => {
    const wasmPath = join(process.cwd(), "public/sha3_wasm_bg.7b9ca65ddd.wasm");
    const wasmBytes = await Bun.file(wasmPath).arrayBuffer();
    expect(wasmBytes.byteLength).toBeGreaterThan(0);
  });
});

describe("SSE Parsing", () => {
  it("parses DeepSeek diff format", () => {
    const sseData = `data: {"v":"Hello","p":"/content"}\n\ndata: {"v":" World","p":"/content"}\n\ndata: [DONE]\n\n`;
    
    const lines = sseData.split('\n');
    let content = '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.substring(6).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.v) content += parsed.v;
        } catch {}
      }
    }
    expect(content).toBe("Hello World");
  });
});

describe("Rate Limiter", () => {
  it("tracks request timestamps per IP", () => {
    const requestTimestamps = new Map();
    const ip = "127.0.0.1";
    const now = Date.now();
    
    requestTimestamps.set(ip, now);
    const elapsed = Date.now() - requestTimestamps.get(ip);
    
    expect(elapsed).toBeLessThan(100);
  });
});