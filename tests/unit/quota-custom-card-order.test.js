import { describe, expect, it } from "vitest";
import {
  applyCustomCardOrder,
  sortVisibleConnections,
  updateCustomCardOrderList,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("Quota Tracker Custom Card Order", () => {
  const sampleConnections = [
    { id: "conn-1", provider: "antigravity", name: "Alpha" },
    { id: "conn-2", provider: "claude", name: "Beta" },
    { id: "conn-3", provider: "codex", name: "Gamma" },
    { id: "conn-4", provider: "antigravity", name: "Delta" },
  ];

  it("returns stable provider group order when customOrder is empty", () => {
    const result = applyCustomCardOrder(sampleConnections, []);
    expect(result.map((c) => c.id)).toEqual([
      "conn-1",
      "conn-4",
      "conn-2",
      "conn-3",
    ]);
  });

  it("applies stored custom order faithfully and appends unranked connections", () => {
    const customOrder = ["conn-3", "conn-2"];
    const result = applyCustomCardOrder(sampleConnections, customOrder);
    expect(result.map((c) => c.id)).toEqual([
      "conn-3",
      "conn-2",
      "conn-1",
      "conn-4",
    ]);
  });

  it("safely handles and ignores stale connection IDs in custom order", () => {
    const customOrder = ["conn-stale", "conn-2", "conn-missing", "conn-1"];
    const result = applyCustomCardOrder(sampleConnections, customOrder);
    expect(result.map((c) => c.id)).toEqual([
      "conn-2",
      "conn-1",
      "conn-3",
      "conn-4",
    ]);
  });

  it("merges reordered page slice into existing multi-page custom order without pruning other pages", () => {
    // Page 1 has conn-1, conn-2; Page 2 has conn-3, conn-4
    const existingOrder = ["conn-1", "conn-2", "conn-3", "conn-4"];
    // User reorders Page 2: conn-4 moved before conn-3
    const reorderedPage2 = ["conn-4", "conn-3"];
    const updated = updateCustomCardOrderList(existingOrder, reorderedPage2);
    expect(updated).toEqual(["conn-1", "conn-2", "conn-4", "conn-3"]);

    // User then reorders Page 1: conn-2 moved before conn-1
    const reorderedPage1 = ["conn-2", "conn-1"];
    const updatedAgain = updateCustomCardOrderList(updated, reorderedPage1);
    expect(updatedAgain).toEqual(["conn-2", "conn-1", "conn-4", "conn-3"]);
  });

  it("prunes deleted connections when allAvailableIds are provided", () => {
    const existingOrder = ["conn-1", "conn-2", "conn-deleted", "conn-3"];
    const reorderedCurrentPage = ["conn-3", "conn-1"];
    const allAvailable = ["conn-1", "conn-2", "conn-3"];
    const updated = updateCustomCardOrderList(
      existingOrder,
      reorderedCurrentPage,
      allAvailable,
    );
    expect(updated).toEqual(["conn-3", "conn-1", "conn-2"]);
  });

  it("uses customOrder only in neutral/default sort, preserving expiring-first semantic sort", () => {
    const quotaData = {
      "conn-1": { quotas: [{ resetAt: "2026-09-01T20:00:00Z" }] },
      "conn-2": { quotas: [{ resetAt: "2026-09-01T15:00:00Z" }] },
      "conn-3": { quotas: [{ resetAt: "2026-09-01T18:00:00Z" }] },
      "conn-4": { quotas: [{ resetAt: "2026-09-01T22:00:00Z" }] },
    };

    const customOrder = ["conn-4", "conn-3", "conn-2", "conn-1"];

    // Default neutral sort: customOrder applies
    const neutralSorted = sortVisibleConnections(
      sampleConnections,
      quotaData,
      false,
      "all",
      "default",
      customOrder,
    );
    expect(neutralSorted.map((c) => c.id)).toEqual([
      "conn-4",
      "conn-3",
      "conn-2",
      "conn-1",
    ]);

    // Expiring first: strict semantic reset time sort overrides custom order
    const expiringSorted = sortVisibleConnections(
      sampleConnections,
      quotaData,
      true,
      "all",
      "default",
      customOrder,
    );
    expect(expiringSorted.map((c) => c.id)).toEqual([
      "conn-2", // 15:00
      "conn-3", // 18:00
      "conn-1", // 20:00
      "conn-4", // 22:00
    ]);
  });

  it("uses semantic quota sorting when Codex quota sort is active", () => {
    const codexConns = [
      { id: "c1", provider: "codex", name: "C1" },
      { id: "c2", provider: "codex", name: "C2" },
    ];
    const quotaData = {
      c1: { quotas: [{ remaining: 80 }] },
      c2: { quotas: [{ remaining: 20 }] },
    };
    const customOrder = ["c1", "c2"];

    const ascSorted = sortVisibleConnections(
      codexConns,
      quotaData,
      false,
      "codex",
      "remaining-asc",
      customOrder,
    );
    expect(ascSorted.map((c) => c.id)).toEqual(["c2", "c1"]);
  });
});
