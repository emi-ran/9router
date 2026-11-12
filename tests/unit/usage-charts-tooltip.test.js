import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const components = ["TopModelsChart", "ProviderBarChart", "UsageChart"];

describe("usage chart tooltips", () => {
  it.each(components)("%s uses the theme text color for tooltip items", (component) => {
    const chart = readFileSync(new URL(`../../src/app/(dashboard)/dashboard/usage/components/${component}.js`, import.meta.url), "utf8");
    const tooltip = chart.match(/<Tooltip\b[\s\S]*?\/>/)?.[0];
    expect(tooltip).toBeDefined();
    expect(tooltip).toMatch(/itemStyle=\{\{\s*color:\s*["']var\(--color-text-main\)["']/);
  });
});
