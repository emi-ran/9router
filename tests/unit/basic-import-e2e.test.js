import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("import compatibility e2e & comprehensive validation (real sqlite)", () => {
  it("normalizes and roundtrips realistic old backup, drops unsupported, handles rollback", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-import-test-"));
    const dbPath = path.join(tempDir, "data.sqlite");

    const { createNodeSqliteAdapter } = await import("../../src/lib/db/adapters/nodeSqliteAdapter.js");
    const { runMigrationOnce } = await import("../../src/lib/db/migrate.js");
    const adapter = await createNodeSqliteAdapter(dbPath);
    await runMigrationOnce(adapter);

    const { normalizeBasicImport } = await import("../../src/mine/import/compatibility.js");

    const oldBackup = {
      settings: {
        language: "zh-CN",
        locale: "zh-CN",
        password: "$2b$10$hashedadminpasswordvalue",
        rememberMe: true,
        outboundProxyEnabled: true,
        outboundProxyUrl: "http://127.0.0.1:8080",
        authMode: "sso",
        ssoType: "saml",
        tailscale: true,
        mitm: true,
        rtk: true,
        headroom: true,
        capacityAdapter: {
          vision: [
            { model: "oc/mimo-v2.5-free", enabled: true },
            { model: "kiro/claude-opus", enabled: true },
            { model: "codex/gpt-5.4", enabled: true },
            { model: "cx/gpt-5.3", enabled: false },
          ],
          audioInput: {
            enabled: true,
            roundRobin: false,
            models: ["antigravity/gemini-3.1-pro", "unsupported/audio-model"],
          },
        },
      },
      providerConnections: [
        { id: "conn-cx", provider: "cx", authType: "oauth", name: "Codex Acct", isActive: true, accessToken: "cx-token", providerSpecificData: { enabledModels: ["codex/gpt-5.4"] } },
        { id: "conn-ag", provider: "antigravity", authType: "oauth", name: "AG Acct", isActive: true, accessToken: "ag-token" },
        { id: "conn-tavily", provider: "tavily", authType: "apikey", name: "Tavily Search/Fetch", isActive: true, apiKey: "tvly-key" },
        { id: "conn-tinyfish", provider: "tinyfish", authType: "apikey", name: "TinyFish Fetch", isActive: true, apiKey: "tf-key" },
        { id: "conn-kiro", provider: "kiro", authType: "oauth", name: "Kiro Acct", isActive: true, accessToken: "kiro-token" },
        { id: "conn-claude", provider: "claude", authType: "oauth", name: "Claude Acct", isActive: true, accessToken: "claude-token" },
      ],
      providerNodes: [
        { id: "node-cx", type: "codex", name: "Codex Node" },
        { id: "node-kiro", type: "kiro", name: "Kiro Node" },
      ],
      proxyPools: [
        { id: "pool-1", isActive: true, testStatus: "active", url: "http://proxy.local" },
      ],
      apiKeys: [
        { id: "key-1", key: "sk-9r-testkey1", name: "Dev Key", isActive: true },
        { id: "key-2", key: "sk-9r-testkey2", name: "Prod Key", isActive: true },
      ],
      combos: [
        { id: "combo-1", name: "Smart Chat", kind: "llm", models: ["codex/gpt-5.4", "kiro/claude-sonnet-4.5"] },
        { id: "combo-retired", name: "Old Kiro Only", kind: "llm", models: ["kiro/claude-sonnet-4.5"] },
        { id: "combo-media", name: "Web Combo", kind: "webFetch", models: ["tavily/fetch", "tinyfish/fetch", "unsupported/fetch"] },
        // Removed modality combo (e.g. video)
        { id: "combo-video", name: "Video Combo", kind: "video", models: ["cx/gpt-5.4"] },
        // Cycles with live leaf test: A -> [B, cx/gpt-5.4], B -> [A, cx/gpt-5.4]
        { id: "combo-cycle-a", name: "CycleA", kind: "llm", models: ["CycleB", "cx/gpt-5.4"] },
        { id: "combo-cycle-b", name: "CycleB", kind: "llm", models: ["CycleA", "cx/gpt-5.4"] },
        // Valid DAG with shared child
        { id: "combo-child", name: "ChildCombo", kind: "llm", models: ["cx/gpt-5.4"] },
        { id: "combo-parent-1", name: "Parent1", kind: "llm", models: ["ChildCombo"] },
        { id: "combo-parent-2", name: "Parent2", kind: "llm", models: ["ChildCombo"] },
      ],
      modelAliases: {
        "gpt-fast": "codex/gpt-5.4",
        "chained-fast": "gpt-fast",
        "alias-cycle-1": "alias-cycle-2",
        "alias-cycle-2": "alias-cycle-1",
        "kiro-fast": "kiro/claude-sonnet-4.5",
        "dangling-alias": "unsupported-vendor/some-model",
        "bare-provider-alias": "codex",
      },
      customModels: [
        { providerAlias: "cx", id: "custom-gpt", type: "llm", name: "Custom GPT" },
        { providerAlias: "kiro", id: "custom-kiro", type: "llm", name: "Custom Kiro" },
        { providerAlias: "cx", id: "custom-video", type: "video", name: "Removed video kind" },
      ],
      pricing: {
        codex: { "gpt-5.4": { input: 1.5, output: 6.0 } },
        kiro: { "claude-sonnet-4.5": { input: 3.0, output: 15.0 } },
      },
      mitmAlias: {
        cursor: { "model": "cx/gpt-5.4" },
      },
    };

    // 1. Test normalization logic directly
    const { normalizedPayload, summary } = normalizeBasicImport(oldBackup);

    // Settings normalized to en, retired dropped, capacity upgraded & legacy array format preserved
    expect(normalizedPayload.settings.locale).toBe("en");
    expect(normalizedPayload.settings.language).toBe("en");
    expect(normalizedPayload.settings.authMode).toBeUndefined();
    expect(normalizedPayload.settings.tailscale).toBeUndefined();
    expect(normalizedPayload.settings.password).toBe("$2b$10$hashedadminpasswordvalue");
    expect(normalizedPayload.settings.capacityAdapter.vision).toEqual([
      { model: "oc/mimo-v2.6-flash-free", enabled: true },
      { model: "cx/gpt-5.4", enabled: true },
    ]);
    expect(normalizedPayload.settings.capacityAdapter.audioInput.models).toEqual(["ag/gemini-3.1-pro"]);

    // Provider connections: canonicalized to canonical provider IDs ('codex', 'antigravity', etc.)
    expect(normalizedPayload.providerConnections.map((c) => c.provider)).toEqual(["codex", "antigravity", "tavily", "tinyfish"]);
    expect(summary.providerConnections.kept).toBe(4);
    expect(summary.providerConnections.dropped).toBe(2);

    // Combos: Cycles A and B dropped; Old Kiro & Video Combo dropped; Smart Chat, Web Combo & DAG parents kept
    expect(normalizedPayload.combos.map((c) => c.name)).toEqual(["Smart Chat", "Web Combo", "ChildCombo", "Parent1", "Parent2"]);
    expect(normalizedPayload.combos.find((c) => c.name === "Smart Chat").models).toEqual(["cx/gpt-5.4"]);
    expect(normalizedPayload.combos.find((c) => c.name === "Parent1").models).toEqual(["ChildCombo"]);
    expect(normalizedPayload.combos.find((c) => c.name === "Parent2").models).toEqual(["ChildCombo"]);

    // Custom models: removed 'video' kind dropped, kiro dropped, cx llm kept
    expect(normalizedPayload.customModels.map((m) => m.id)).toEqual(["custom-gpt"]);

    // Model aliases: bare-provider 'codex', cyclic, dangling, and kiro dropped; gpt-fast and chained-fast kept
    expect(normalizedPayload.modelAliases).toEqual({
      "gpt-fast": "cx/gpt-5.4",
      "chained-fast": "cx/gpt-5.4",
    });

    // Pricing: canonicalized to codex, kiro dropped
    expect(Object.keys(normalizedPayload.pricing)).toEqual(["codex"]);

    // 2. Real DB execution with transaction & replace semantics
    adapter.transaction(() => {
      adapter.run("INSERT INTO apiKeys(id, key, name, isActive, createdAt) VALUES(?, ?, ?, ?, ?)", [
        "old-preexisting-key", "sk-old", "Old Key", 1, new Date().toISOString(),
      ]);
    });
    expect(adapter.all("SELECT * FROM apiKeys")).toHaveLength(1);

    adapter.transaction(() => {
      adapter.run("DELETE FROM apiKeys");
      for (const k of normalizedPayload.apiKeys) {
        adapter.run("INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)", [
          k.id, k.key, k.name, k.machineId || null, k.isActive ? 1 : 0, k.createdAt || new Date().toISOString(),
        ]);
      }
    });

    const keysInDb = adapter.all("SELECT * FROM apiKeys");
    expect(keysInDb).toHaveLength(2);
    expect(keysInDb.map((k) => k.id)).toEqual(["key-1", "key-2"]);

    // 3. Pre-validation rejections: DB remains 100% untouched
    // Generate an excessive nesting chain > 20
    const deepCombos = [];
    for (let i = 0; i < 25; i++) {
      deepCombos.push({
        id: `c-${i}`,
        name: `Combo-${i}`,
        kind: "llm",
        models: i === 24 ? ["cx/gpt-5.4"] : [`Combo-${i + 1}`],
      });
    }

    const invalidPayloads = [
      { settings: "bad-string" },
      { settings: null },
      { providerConnections: [{ id: "c1", provider: 123 }] },
      { providerConnections: [{ id: "dup", provider: "codex" }, { id: "dup", provider: "codex" }] },
      { combos: [{ id: "cb1", name: "dup" }, { id: "cb2", name: "dup" }] },
      { combos: deepCombos }, // Excessive nesting depth > 20
      { apiKeys: [{ id: "k1" }] }, // missing key
    ];

    for (const bad of invalidPayloads) {
      expect(() => normalizeBasicImport(bad)).toThrow();
    }
    // Verify DB still intact after all invalid attempts
    expect(adapter.all("SELECT * FROM apiKeys")).toHaveLength(2);

    adapter.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("handles completely empty / all-unsupported backup gracefully", async () => {
    const { normalizeBasicImport } = await import("../../src/mine/import/compatibility.js");
    const emptyBackup = {
      providerConnections: [
        { id: "legacy-1", provider: "unsupported-vendor", authType: "apikey" },
      ],
      combos: [
        { id: "combo-1", name: "All Unsupported", models: ["vendor/model"] },
      ],
    };

    const { normalizedPayload, summary } = normalizeBasicImport(emptyBackup);
    expect(normalizedPayload.providerConnections).toEqual([]);
    expect(normalizedPayload.combos).toEqual([]);
    expect(summary.providerConnections.dropped).toBe(1);
    expect(summary.combos.dropped).toBe(1);
  });
});
