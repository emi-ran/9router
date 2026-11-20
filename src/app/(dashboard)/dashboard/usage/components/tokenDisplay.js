const COMPACT_TOKEN_UNITS = [
  { value: 1e12, suffix: "T" },
  { value: 1e9, suffix: "B" },
  { value: 1e6, suffix: "M" },
  { value: 1e3, suffix: "K" },
];

export function fmtCompactTokens(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num === 0) return "0";
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  for (let i = 0; i < COMPACT_TOKEN_UNITS.length; i++) {
    const { value, suffix } = COMPACT_TOKEN_UNITS[i];
    if (abs >= value) {
      const scaled = abs / value;
      if (Number(scaled.toFixed(1)) >= 1000 && i > 0) {
        const upper = COMPACT_TOKEN_UNITS[i - 1];
        return `${sign}${(abs / upper.value).toFixed(1)}${upper.suffix}`;
      }
      return `${sign}${scaled.toFixed(1)}${suffix}`;
    }
  }

  if (Math.round(abs) >= 1000) {
    return `${sign}1.0K`;
  }
  return String(num);
}
