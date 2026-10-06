import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { test } from "node:test";

const read = (name) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const dockerfile = read("Dockerfile").replace(/\r\n/g, "\n");
const rules = read(".dockerignore").split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));

// Only the glob subset used here: ordered exclusions/negations, including parents.
function ignored(path) {
  const parts = path.split("/");
  const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  let excluded = false;
  for (const rule of rules) {
    const negative = rule.startsWith("!");
    const pattern = negative ? rule.slice(1) : rule;
    if (ancestors.some(part => posix.matchesGlob(part, pattern))) excluded = !negative;
  }
  return excluded;
}

test("Docker installs locked dependencies with existing bounded cache-backed fetch", () => {
  assert.match(dockerfile, /COPY package\.json package-lock\.json \.\/\s+RUN --mount=type=cache,target=\/root\/\.npm\s+\\\s+npm ci\b/);
  assert.doesNotMatch(dockerfile, /npm install\b/);
  for (const option of ["registry", "fetch-retries", "fetch-retry-factor", "fetch-retry-mintimeout", "fetch-retry-maxtimeout", "fetch-timeout"]) {
    assert.ok(dockerfile.includes(`--${option}=`), option);
  }
  const manifest = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
    assert.deepEqual(lock.packages[""][key], manifest[key], key);
  }
});

test("Docker context excludes private env, nested dependencies and validation artifacts", () => {
  for (const path of ["node_modules/a.js", "tests/node_modules/a.js", "cli/node_modules/a.js", ".next/server.js", ".next-basic-validation/server.js", "cli/.next-cli-build/server.js", ".opencode-playwright/capture.png", "nested/.opencode-playwright/capture.png", ".env", ".env.local", ".env.production", ".env.backup", "nested/.env.secret", "nested/.env.example"]) {
    assert.equal(ignored(path), true, path);
  }
  for (const path of [".env.example", "package.json", "package-lock.json", "src/app/page.js", "public/logo.png", "open-sse/index.js", "custom-server.js", "scripts/copy-standalone-assets.mjs"]) {
    assert.equal(ignored(path), false, path);
  }
});

test("Docker directory setup fails fast while legacy symlink stays optional", () => {
  const setup = dockerfile.match(/RUN mkdir -p \/app\/data[\s\S]*?(?=\n\n)/)?.[0];
  assert.ok(setup);
  assert.match(setup, /chown -R node:node \/app &&/);
  assert.match(setup, /mkdir -p \/app\/data-home && chown node:node \/app\/data-home &&/);
  assert.match(setup, /\(ln -sf \/app\/data-home \/root\/\.9router 2>\/dev\/null \|\| true\)/);
  assert.doesNotMatch(setup, /&&\s*\\\s*ln[^\n]*\|\| true/);
  assert.ok(dockerfile.includes('exec su-exec node "$@"'));
  assert.ok(dockerfile.includes("ENV DATA_DIR=/app/data"));
});
