import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] }));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    transaction: (fn) => fn(),
    get: () => null,
    all: () => [],
    run: (sql, args) => {
      if (sql.includes("INSERT OR REPLACE INTO providerConnections")) {
        state.rows.push({
          id: args[0],
          provider: args[1],
          isActive: args[6] === 1,
          ...JSON.parse(args[7]),
        });
      }
    },
  }),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => state.rows,
  getCombos: async () => [],
  getCustomModels: async () => [],
  getModelAliases: async () => ({}),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: async () => ({}),
}));

import { importDb } from "../../src/lib/db/index.js";
import { buildModelsList } from "../../src/app/api/v1/models/route.js";
import { parseModel } from "../../open-sse/services/model.js";
import { getExecutor } from "../../open-sse/executors/index.js";

it("import drops unsupported legacy provider rows while keeping retained ones normalized", async () => {
  state.rows = [];
  await importDb({
    providerConnections: [
      { id: "legacy-kiro", provider: "kiro", isActive: true, accessToken: "mock-only" },
      { id: "retained-cx", provider: "codex", isActive: true, providerSpecificData: { enabledModels: ["custom-import"] } },
    ],
  });

  // Legacy row dropped, retained row kept
  expect(state.rows).toHaveLength(1);
  expect(state.rows[0]).toMatchObject({ id: "retained-cx", provider: "codex", isActive: true });

  expect((await buildModelsList(["llm"])).map((m) => m.id)).toEqual(["cx/custom-import"]);
  expect(parseModel("kiro/old").provider).toBeNull();
  expect(() => getExecutor("kiro")).toThrow(/Unsupported/);
});
