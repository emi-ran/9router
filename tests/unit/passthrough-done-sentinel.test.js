// Regression for #5592 — an openai passthrough stream whose upstream ends with an
// unterminated "data: [DONE]" (no trailing newline) was forwarded raw and then
// followed by the sentinel flush() appends, producing "data: [DONE]data: [DONE]".
import { describe, it, expect, vi } from "vitest";
vi.mock("../../open-sse/translator/index.js", () => ({ translateResponse: vi.fn(), initState: vi.fn() }));

import { createSSEStream } from "../../open-sse/utils/stream.js";

const chunk = JSON.stringify({
  id: "chatcmpl-abc12345",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "m",
  choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
});

async function run(sse, provider = "openai") {
  const stream = createSSEStream({ mode: "passthrough", provider });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const decoder = new TextDecoder();
  const readPromise = (async () => {
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    return out;
  })();
  for (const part of Array.isArray(sse) ? sse : [sse]) {
    await writer.write(new TextEncoder().encode(part));
  }
  await writer.close();
  return readPromise;
}

const count = (s) => s.split("data: [DONE]").length - 1;

describe("passthrough [DONE] sentinel", () => {
  it("terminates a sentinel ending with only one newline as a complete SSE event", async () => {
    expect(await run(`data: ${chunk}\n\ndata: [DONE]\n`)).toMatch(/data: \[DONE\]\n\n$/);
  });
  it("emits one properly framed sentinel when upstream's has no trailing newline", async () => {
    const out = await run(`data: ${chunk}\n\ndata: [DONE]`);
    expect(count(out)).toBe(1);
    expect(out).not.toContain("[DONE]data:");
    expect(out.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("emits one sentinel when upstream's is fully terminated", async () => {
    const out = await run(`data: ${chunk}\n\ndata: [DONE]\n\n`);
    expect(count(out)).toBe(1);
    expect(out.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("separates an unterminated content event from the synthesized sentinel across chunks", async () => {
    const out = await run([`data: ${chunk.slice(0, 25)}`, chunk.slice(25)]);
    expect(out).toBe(`data: ${chunk}\n\ndata: [DONE]\n\n`);
  });

  it.each(["gemini", "vertex", "antigravity"])("preserves an unterminated upstream sentinel for %s", async (provider) => {
    const out = await run([`data: ${chunk}\n\ndata: [DO`, "NE]"], provider);
    expect(out).toBe(`data: ${chunk}\n\ndata: [DONE]\n\n`);
  });

  it("still appends a sentinel when upstream sent none", async () => {
    const out = await run(`data: ${chunk}\n\n`);
    expect(count(out)).toBe(1);
  });
});
