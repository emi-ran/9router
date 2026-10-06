import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";

const root = new URL("../../", import.meta.url);

function filesUnder(relative) {
  const directory = new URL(`${relative}/`, root);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${relative}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe("basic router removes Token Saver and CLI configuration tools", () => {
  for (const directory of [
    "src/app/(dashboard)/dashboard/token-saver",
    "src/app/(dashboard)/dashboard/cli-tools",
    "src/app/api/cli-tools",
    "src/app/api/headroom",
    "src/app/api/pxpipe",
    "src/lib/headroom",
    "src/lib/pxpipe",
    "open-sse/rtk",
    "src/app/(dashboard)/dashboard/translator",
    "gitbook",
  ]) {
    it(`contains no routes, UI, or private implementation in ${directory}`, () => {
      assert.deepEqual(filesUnder(directory), []);
    });
  }

  for (const file of [
    "src/shared/constants/cliTools.js",
    "src/shared/constants/coworkPlugins.js",
    "src/app/(dashboard)/dashboard/usage/components/ProviderTopology.js",
    "src/app/api/translator/translate/route.js",
    "src/app/api/translator/load/route.js",
    "src/app/api/translator/save/route.js",
    "src/app/api/translator/send/route.js",
    "src/shared/components/DonateModal.js",
  ]) {
    it(`does not expose removed configuration registry or component ${file}`, () => {
      assert.equal(existsSync(new URL(file, root)), false);
    });
  }

  for (const file of [
    "src/app/api/v1/chat/completions/route.js",
    "src/app/api/v1/responses/route.js",
    "src/app/api/v1/models/route.js",
  ]) {
    it(`retains OpenAI-compatible client route ${file}`, () => {
      assert.equal(existsSync(new URL(file, root)), true);
    });
  }
});
