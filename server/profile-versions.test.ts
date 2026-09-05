// Per-bot profile history: one NDJSON row per changed field, full text only
// for the soul, secrets scrubbed, and a revision token that moves when any
// of the four profile fields move.
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { profileRevision, profileSnapshot } from "./profile-revision.ts";
import {
  flushProfileHistory,
  historyFile,
  historyRowAt,
  readHistory,
  recordProfileChange,
} from "./profile-versions.ts";

const base = { name: "Scout", title: "", description: "", soul: "" };

describe("profileRevision", () => {
  it("is stable for equal profiles and moves when any field moves", () => {
    expect(profileRevision(base)).toBe(profileRevision({ ...base }));
    expect(profileRevision(base)).toMatch(/^[0-9a-f]{64}$/);
    for (const field of ["name", "title", "description", "soul"] as const) {
      expect(profileRevision({ ...base, [field]: "x" })).not.toBe(profileRevision(base));
    }
    expect(profileSnapshot({ name: "A", title: "B", description: "C", soul: undefined })).toEqual({
      name: "A", title: "B", description: "C", soul: "",
    });
  });
});

describe("profile history", () => {
  it("writes one redacted row per changed field with private mode, newest first on read", async () => {
    const id = "hist-1";
    recordProfileChange(id, "user", "ui", base, { ...base, name: "Kiwi", title: "Tracker" });
    recordProfileChange(id, "bot", "card:abc", { ...base, name: "Kiwi", title: "Tracker" }, {
      ...base, name: "Kiwi", title: "Tracker", soul: "token sk-ant-api03-SECRETSECRETSECRETSECRET\nBe brief.",
    });
    await flushProfileHistory(id);
    expect(statSync(historyFile(id)).mode & 0o777).toBe(0o600);
    const rows = readHistory(id);
    expect(rows.map((r) => r.field)).toEqual(["soul", "title", "name"]);
    expect(rows[2]).toMatchObject({ actor: "user", via: "ui", field: "name", before: "Scout", after: "Kiwi" });
    expect(rows[2]!.summary).toBe('name: "Scout" → "Kiwi"');
    expect(rows[0]).toMatchObject({ actor: "bot", via: "card:abc", field: "soul", before: "" });
    expect(rows[0]!.after).toContain("Be brief.");
    expect(rows[0]!.after).not.toContain("SECRETSECRET");
    expect(rows[0]!.summary).toMatch(/^soul: 0 → \d+ bytes$/);
    expect(historyRowAt(id, rows[0]!.at)).toEqual(rows[0]);
    expect(historyRowAt(id, 1)).toBeUndefined();
  });

  it("writes nothing when nothing changed, and trims long non-soul values", async () => {
    const id = "hist-2";
    recordProfileChange(id, "user", "api", base, { ...base });
    await flushProfileHistory(id);
    expect(existsSync(historyFile(id))).toBe(false);
    recordProfileChange(id, "user", "api", base, { ...base, description: "d".repeat(500) });
    await flushProfileHistory(id);
    const [row] = readHistory(id);
    expect(row!.after!.length).toBe(200);
    expect(readFileSync(historyFile(id), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("caps reads and survives a torn line", async () => {
    const id = "hist-3";
    for (let i = 0; i < 5; i++) recordProfileChange(id, "user", "ui", { ...base, name: `n${i}` }, { ...base, name: `n${i + 1}` });
    await flushProfileHistory(id);
    expect(readHistory(id, 2).map((r) => r.after)).toEqual(["n5", "n4"]);
    const { appendFileSync } = await import("node:fs");
    appendFileSync(historyFile(id), '{"at":1,"acto');
    expect(readHistory(id)).toHaveLength(5);
  });
});
