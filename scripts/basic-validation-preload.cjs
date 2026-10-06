// Isolated validation: never read credentials from .env or contact external hosts.
const fs = require("node:fs");
const path = require("node:path");
const isEnv = (file) => typeof file === "string" && /^\.env(?:\.|$)/.test(path.basename(file));
for (const name of ["readFileSync", "statSync"]) {
  const original = fs[name];
  fs[name] = function (file, ...args) {
    if (isEnv(file)) throw Object.assign(new Error("Environment files disabled during basic validation"), { code: "ENOENT" });
    return original.call(this, file, ...args);
  };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("External network disabled during basic validation");
  return originalFetch(input, init);
};
