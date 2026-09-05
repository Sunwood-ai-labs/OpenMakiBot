import { describe, expect, it } from "vitest";

import { intervalLabel, runsPerDay, scheduleSentence } from "./schedule-label";

describe("schedule labels", () => {
  it("names intervals", () => {
    expect(intervalLabel(5)).toBe("Every 5 min");
    expect(intervalLabel(60)).toBe("Every hour");
    expect(intervalLabel(120)).toBe("Every 2 hr");
    expect(intervalLabel(90)).toBe("Every 1 hr 30 min");
  });

  it("writes schedules as prose", () => {
    expect(scheduleSentence({ type: "interval", everyMinutes: 5, anchorAt: 0 })).toBe("every 5 minutes");
    expect(scheduleSentence({ type: "interval", everyMinutes: 60, anchorAt: 0 })).toBe("every hour");
    expect(scheduleSentence({ type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] })).toMatch(/^every weekday at /);
    expect(scheduleSentence({ type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] })).toMatch(/^every day at /);
    expect(scheduleSentence({ type: "daily", time: "09:00", weekdays: [3] })).toMatch(/^weekly on Wed at /);
    expect(scheduleSentence({ type: "once", at: Date.UTC(2026, 8, 5, 12) })).toMatch(/^once on /);
  });

  it("estimates runs per day", () => {
    expect(runsPerDay({ type: "interval", everyMinutes: 5, anchorAt: 0 })).toBe(288);
    expect(runsPerDay({ type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] })).toBe(0.71);
    expect(runsPerDay({ type: "once", at: 0 })).toBeNull();
  });
});
