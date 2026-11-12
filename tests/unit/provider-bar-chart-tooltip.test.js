import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chart = readFileSync(new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderBarChart.js", import.meta.url), "utf8");

describe("provider chart tooltip", () => {
  it("uses the theme text color for tooltip items in both view modes", () => {
    const tooltip = chart.match(/<Tooltip\b[\s\S]*?\/>/)?.[0];
    expect(tooltip).toBeDefined();
    expect(tooltip).toMatch(/itemStyle=\{\{\s*color:\s*["']var\(--color-text-main\)["']/);
    expect(tooltip).toContain("formatter={(value) => [fmt(value), label]}");
  });
});
