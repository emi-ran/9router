import { test, mock } from "node:test";
import assert from "node:assert/strict";
let handler;
mock.module("../../open-sse/utils/proxyFetch.js", { exports: { proxyAwareFetch: (...args) => handler(...args) } });
const { getClaudeUsage } = await import("../../open-sse/services/usage/claude.js");
test("transient quota errors do not stick in cache", async () => {
 let count = 0; handler = async () => { if (++count === 1) throw new Error("offline"); return Response.json({ five_hour: { utilization: 10 } }); };
 await getClaudeUsage("retry-node-token");
 const result = await getClaudeUsage("retry-node-token");
 assert.equal(result.quotas?.["session (5h)"].remainingPercentage, 90);
});
test("401 signals expired credentials without legacy fallback", async () => {
 let count = 0; handler = async () => { count++; return new Response("", { status: 401 }); };
 const result = await getClaudeUsage("expired-node-token");
 assert.match(result.message, /401|expired|unauthorized/i); assert.equal(count, 1);
});

test("usage route preserves strict proxy policy for Claude", async () => {
 const { readFile } = await import("node:fs/promises");
 const source = await readFile(new URL("../../src/app/api/usage/[connectionId]/route.js", import.meta.url), "utf8");
 assert.match(source, /strictProxy:\s*connection\.provider\s*===\s*["']claude["']\s*&&\s*proxyConfig\.strictProxy\s*===\s*true/);
});
