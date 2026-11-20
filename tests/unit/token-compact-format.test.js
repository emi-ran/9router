// Usage chart token formatting (upstream issue #5670).
import { describe, it, expect } from "vitest";
import { fmtCompactTokens } from "@/app/(dashboard)/dashboard/usage/components/tokenDisplay.js";

describe("fmtCompactTokens - issue #5670", () => {
  it("formats zero, nullish, and small counts cleanly", () => {
    expect(fmtCompactTokens(0)).toBe("0");
    expect(fmtCompactTokens(null)).toBe("0");
    expect(fmtCompactTokens(undefined)).toBe("0");
    expect(fmtCompactTokens(842)).toBe("842");
  });

  it("formats thousands and millions with one decimal place", () => {
    expect(fmtCompactTokens(1000)).toBe("1.0K");
    expect(fmtCompactTokens(15_400)).toBe("15.4K");
    expect(fmtCompactTokens(550_000_000)).toBe("550.0M");
  });

  it("formats billions and trillions instead of 4+ digit M strings that clip on YAxis", () => {
    expect(fmtCompactTokens(1_000_000_000)).toBe("1.0B");
    expect(fmtCompactTokens(1_100_000_000)).toBe("1.1B");
    expect(fmtCompactTokens(1_650_000_000)).toBe("1.6B");
    expect(fmtCompactTokens(2_200_000_000)).toBe("2.2B");
    expect(fmtCompactTokens(1_250_000_000_000)).toBe("1.3T");
  });

  it("promotes boundary values that round to 1000.0 into the next unit", () => {
    expect(fmtCompactTokens(999_950)).toBe("1.0M");
    expect(fmtCompactTokens(999_950_000)).toBe("1.0B");
    expect(fmtCompactTokens(999_950_000_000)).toBe("1.0T");
  });
});
