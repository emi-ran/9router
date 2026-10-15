import { describe, expect, it, vi } from "vitest";
import { handleComboChat, isZeroContentResponse } from "../../open-sse/services/combo.js";

const emptyChat = { choices: [{ message: { role: "assistant", content: "" }, finish_reason: "incomplete" }] };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});
const log = () => ({ info: vi.fn(), warn: vi.fn() });
const run = (handleSingleModel, models = ["oc/first", "oc/second"]) => handleComboChat({
  body: { stream: false, messages: [{ role: "user", content: "hi" }] },
  models, handleSingleModel, log: log(), autoSwitch: false,
});

describe("combo HTTP 200 zero-content fallback", () => {
  it.each([
    { choices: [] },
    emptyChat,
    { choices: [{ delta: { content: "  " } }] },
    { content: [], stop_reason: "in_progress" },
    { content: [{ type: "text", text: " " }], stop_reason: "incomplete" },
  ])("detects empty incomplete JSON: %j", (data) => {
    expect(isZeroContentResponse(data)).toBe(true);
  });

  it.each([
    null, {},
    { choices: [{ message: { content: "answer" } }] },
    { choices: [{ message: { content: [{ type: "text", text: "answer" }] } }] },
    { choices: [{ message: { tool_calls: [{ id: "call_1" }] } }] },
    { choices: [{ message: { function_call: { name: "lookup" } } }] },
    { choices: [{ message: { reasoning_content: "thinking" } }] },
    { content: [{ type: "text", text: "answer" }] },
    { content: [{ type: "tool_use", name: "lookup" }] },
    // Deliberate upstream compatibility: normal empty finishes aren't failures.
    { choices: [{ message: { content: "" }, finish_reason: "stop" }] },
    { choices: [{ message: { content: "" }, finish_reason: "length" }] },
    { content: [], stop_reason: "end_turn" },
  ])("preserves meaningful output and normal finishes: %j", (data) => {
    expect(isZeroContentResponse(data)).toBe(false);
  });

  it("tries the next seat and leaves its body readable", async () => {
    const success = json({ choices: [{ message: { content: "fallback answer" }, finish_reason: "stop" }] });
    const handle = vi.fn().mockResolvedValueOnce(json(emptyChat)).mockResolvedValueOnce(success);
    const result = await run(handle);
    expect(handle.mock.calls.map((args) => args[1])).toEqual(["oc/first", "oc/second"]);
    expect(result).toBe(success);
    expect((await result.json()).choices[0].message.content).toBe("fallback answer");
  });

  it("returns the final seat unchanged even when every response is empty", async () => {
    const final = json(emptyChat);
    const handle = vi.fn().mockResolvedValueOnce(json(emptyChat)).mockResolvedValueOnce(final);
    expect(await run(handle)).toBe(final);
    expect(await final.json()).toEqual(emptyChat);
  });

  it("does not peek at a single-seat response", async () => {
    const final = json(emptyChat);
    const clone = vi.spyOn(final, "clone");
    expect(await run(vi.fn().mockResolvedValue(final), ["oc/only"])).toBe(final);
    expect(clone).not.toHaveBeenCalled();
  });

  it.each([
    ["application/json", "not valid json"],
    ["text/event-stream", "data: {\"choices\":[]}\n\ndata: [DONE]\n\n"],
    ["text/plain", ""],
  ])("passes through %s without consuming the response", async (type, payload) => {
    const response = new Response(payload, { headers: { "content-type": type } });
    const handle = vi.fn().mockResolvedValue(response);
    expect(await run(handle)).toBe(response);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe(payload);
  });

  it("does not return a successful HTTP status if the next seat throws", async () => {
    const handle = vi.fn().mockResolvedValueOnce(json(emptyChat)).mockRejectedValueOnce(new Error("upstream disconnected"));
    const result = await run(handle);
    expect(result.ok).toBe(false);
    expect((await result.json()).error.message).toBe("upstream disconnected");
  });
});
