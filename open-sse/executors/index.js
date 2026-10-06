import { AntigravityExecutor } from "./antigravity.js";
import { CodexExecutor } from "./codex.js";
import { OpenCodeExecutor } from "./opencode.js";

const executors = {
  antigravity: new AntigravityExecutor(),
  codex: new CodexExecutor(),
  opencode: new OpenCodeExecutor(),
};

export function getExecutor(provider) {
  const executor = executors[provider];
  if (!executor) throw new Error(`Unsupported chat provider: ${provider}`);
  return executor;
}

export function hasSpecializedExecutor(provider) {
  return Object.hasOwn(executors, provider);
}

export { BaseExecutor } from "./base.js";
export { AntigravityExecutor } from "./antigravity.js";
export { CodexExecutor } from "./codex.js";
export { OpenCodeExecutor } from "./opencode.js";
