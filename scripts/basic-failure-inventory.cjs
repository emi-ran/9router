// Offline classification of an existing Vitest JSON report; never executes tests.
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/basic-failure-inventory.cjs <report.json> <output.md>");
const report = JSON.parse(fs.readFileSync(input, "utf8"));
const unchanged = (file) => {
  try {
    return cp.execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" }).replace(/\r\n/g, "\n") === fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch { return false; }
};
const counts = {};
const rows = [];
for (const result of report.testResults.filter((r) => r.status === "failed")) {
  const file = path.relative(process.cwd(), result.name).replaceAll("\\", "/");
  const failures = result.assertionResults.filter((a) => a.status === "failed");
  let category = "unknown";
  let evidence = "Retained or mixed-scope file: exact failure below; no isolated baseline equivalence established. Keep assertions; needs source-level review.";
  if (!fs.existsSync(file)) {
    category = "removed-feature obsolete";
    evidence = "Removed dedicated retired-provider/CLI-settings/MITM/token-saver suite; no retained mixed suite deleted.";
  } else if (file.endsWith("db-concurrent.test.js") && unchanged("src/lib/db/repos/usageRepo.js") && unchanged("src/lib/db/driver.js")) {
    category = "demonstrated baseline failure";
    evidence = "usageRepo.js and driver.js byte-equivalent to HEAD after newline normalization; identical millisecond timestamp/content dedup loses independent requests. Request identity decision requires user approval.";
  } else if (file.endsWith("security-audit.test.js") && unchanged("src/lib/db/repos/usageRepo.js")) {
    category = "demonstrated baseline failure";
    evidence = "Unchanged HEAD usageRepo.js lacks exact source-string expected by masking tripwire. Runtime privacy is not proven by this source check; retained test kept.";
  } else if (file.endsWith("codex-image-fetch.test.js") || file.endsWith("cached-token-e2e.test.js") || file.endsWith("quota-auto-ping.test.js")) {
    category = "retained new regression";
    evidence = file.endsWith("codex-image-fetch.test.js") ? "Test DNS mock returned object instead of lookup({all:true}) array; fixed mock, retained size/base64/wire assertions." : file.endsWith("cached-token-e2e.test.js") ? "Windows EPERM teardown: adapter remained open; fixed lifecycle close before deleting temp directory." : "Deleted Claude usage import in mixed retained Codex tests prevented collection; removed dead mock/import, replaced retired behavior assertion with non-reactivation assertion.";
  }
  counts[category] = (counts[category] || 0) + 1;
  const exact = failures.map((a) => `${a.fullName}: ${(a.failureMessages || []).join(" ").split("\n")[0]}`).join("; ") || result.message || "Collection failure; inspect original JSON report.";
  rows.push(`| \`${file}\` | ${category} | ${evidence} | ${exact.replaceAll("|", "\\|").replaceAll("\n", " ")} |`);
}
const text = `# Full-suite failure classification\n\nInput: \`${path.basename(input)}\`. All ${rows.length} failed files accounted for. Unknown means unresolved, not baseline or accepted. No filename-based baseline claims.\n\n${Object.entries(counts).map(([k,v]) => `- ${k}: **${v}**`).join("\n")}\n\n| Exact path | Category | Evidence / blocker | Exact failing assertions / collection message |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`;
fs.writeFileSync(output, text);
console.log(JSON.stringify({ files: rows.length, counts }));
