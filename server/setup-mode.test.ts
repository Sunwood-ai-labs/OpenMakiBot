// Setup mode: a blank bot, or a /setup message, turns on a coaching block
// that makes the bot interview the user and configure itself through cards.
import { describe, expect, it } from "vitest";

import {
  SETUP_PROMPT,
  expandSetupTurnText,
  parseSetupCommand,
  setupModeActive,
  setupSystemPrompt,
} from "./setup-mode.ts";

describe("parseSetupCommand", () => {
  it("recognises /setup with and without a request", () => {
    expect(parseSetupCommand("/setup")).toEqual({ request: "" });
    expect(parseSetupCommand("  /SETUP watch Discord and file bugs into Linear  ")).toEqual({
      request: "watch Discord and file bugs into Linear",
    });
    expect(parseSetupCommand("/setup\nevery 5 minutes")).toEqual({ request: "every 5 minutes" });
  });

  it("ignores ordinary chat that only mentions the word", () => {
    expect(parseSetupCommand("please setup a routine")).toBeNull();
    expect(parseSetupCommand("use /setup later")).toBeNull();
    expect(parseSetupCommand("/setupx")).toBeNull();
    expect(parseSetupCommand("")).toBeNull();
  });
});

describe("expandSetupTurnText", () => {
  it("turns a bare /setup into a request to set up, and keeps a described job", () => {
    expect(expandSetupTurnText("/setup")).toBe(
      "Set yourself up. Ask me what you need to know, then propose your configuration.",
    );
    expect(expandSetupTurnText("/setup watch Discord")).toBe("Set yourself up for this job: watch Discord");
    expect(expandSetupTurnText("hello")).toBe("hello");
  });
});

describe("setupModeActive", () => {
  it("is on for a blank bot regardless of the message", () => {
    expect(setupModeActive({ soul: "", description: "", text: "hello" })).toBe(true);
    expect(setupModeActive({ soul: "  \n", description: undefined, text: "hello" })).toBe(true);
    expect(setupModeActive({ text: "hello" })).toBe(true);
  });

  it("is off once either field is set, unless the message is /setup", () => {
    expect(setupModeActive({ soul: "Be brief.", description: "", text: "hello" })).toBe(false);
    expect(setupModeActive({ soul: "", description: "Files bugs.", text: "hello" })).toBe(false);
    expect(setupModeActive({ soul: "Be brief.", description: "Files bugs.", text: "/setup" })).toBe(true);
    expect(setupModeActive({ soul: "Be brief.", description: "", text: "/setup change my job" })).toBe(true);
  });
});

describe("setupSystemPrompt", () => {
  it("is empty when not active, regardless of the skills option", () => {
    expect(setupSystemPrompt(false)).toBe("");
    expect(setupSystemPrompt(false, { skills: true })).toBe("");
  });

  it("is the skill_manage-naming block when active with skills on", () => {
    expect(setupSystemPrompt(true, { skills: true })).toBe(SETUP_PROMPT);
    expect(SETUP_PROMPT.startsWith("\n\n")).toBe(true);
    for (const tool of ["propose_profile", "propose_routine", "skill_manage", "request_credential"]) {
      expect(SETUP_PROMPT).toContain(tool);
    }
    expect(SETUP_PROMPT).toContain("at most three questions");
    expect(SETUP_PROMPT).toContain("Wait for a yes");
  });

  it("never mentions skill_manage when active with skills off (or unspecified)", () => {
    for (const prompt of [setupSystemPrompt(true), setupSystemPrompt(true, { skills: false })]) {
      expect(prompt).not.toContain("skill_manage");
      expect(prompt).toContain("propose_profile");
      expect(prompt).toContain("propose_routine");
      expect(prompt).toContain("request_credential");
      expect(prompt).toContain("describe procedures plainly in your standing instructions");
    }
  });
});
