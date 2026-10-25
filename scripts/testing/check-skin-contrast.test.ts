import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);

describe("skin contrast check", () => {
  it("checks phone palettes after unrelated media queries and retains desktop palettes", () => {
    const output = execFileSync(process.execPath, ["scripts/check-skin-contrast.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(output).toContain("midnight (phone)");
    expect(output).toContain("meadow (phone)");
    expect(output).toContain("~ midnight (known upstream gaps)");
    expect(output).toContain("✓ meadow — 52 pairs, none below target");
    for (const skin of ["atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight", "pop", "halloween"]) {
      expect(output).toContain("✓ " + skin + " — 52 pairs, none below target");
    }
  });
});
