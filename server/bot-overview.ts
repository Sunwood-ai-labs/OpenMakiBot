// One builder for "what does this bot do" plain-language sentences, so the
// phones (step 5) and the web settings dialog agree on the same wording. The
// route in index.ts (botOverview()) is the only place that reads server-only
// state (engine capabilities, connected-apps inventory, history); everything
// here is pure and takes that state already gathered as OverviewFacts.
import type { BotRecord } from "./store.ts";
import type { Routine } from "./routines.ts";
import type { RoutineRequestSchedule } from "../shared/routine-request.ts";
import { scheduleText } from "./routine-requests.ts";

export interface BotOverview {
  who: { name: string; title: string; blurb: string; soulLead: string };
  does: string[];
  reaches: string[];
  wont: string[];
  recent: Array<{ at: number; summary: string }>;
}

export interface OverviewFacts {
  bot: Pick<
    BotRecord,
    | "name"
    | "title"
    | "description"
    | "soul"
    | "computer"
    | "cloudBackend"
    | "cwd"
    | "autoApprove"
    | "approvePeerComms"
    | "peers"
    | "composio"
    | "browser"
    | "chiefOfStaff"
  >;
  routines: Array<{
    id: string;
    name: string;
    enabled: boolean;
    schedule: RoutineRequestSchedule | Routine["schedule"];
    nextRunAt: number | null;
  }>;
  runs: Array<{ routineId: string; status: string; finishedAt?: number; startedAt?: number; scheduledFor: number }>;
  webhooks: Array<{ name: string; enabled: boolean }>;
  skills: Array<{ name: string; description: string; enabled: boolean }>;
  engine: { agentsMcp?: boolean; composioMcp?: boolean; browserMcp?: boolean; computerMcp?: boolean } | null;
  connectedApps: { configured: boolean; authoritative: boolean; services: string[] };
  sectionPeers: number;
  timeZone: string;
  recent: Array<{ at: number; summary: string }>;
}

/** The first paragraph of a SOUL.md-style persona, capped at 240 characters
 * so a settings-dialog card never renders a full standing-instructions
 * document inline. */
export function soulLead(soul: string | undefined): string {
  const trimmed = (soul ?? "").trim();
  if (!trimmed) return "";
  const paragraph = (trimmed.split(/\r?\n\s*\r?\n/)[0] ?? trimmed).trim();
  return paragraph.length > 240 ? paragraph.slice(0, 240) : paragraph;
}

function capitalize(value: string): string {
  return value.length ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function lowerFirst(value: string): string {
  return value.length ? value[0]!.toLowerCase() + value.slice(1) : value;
}

function time(at: number, timeZone: string): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

/** The most recent run for a routine, by (finishedAt ?? startedAt ??
 * scheduledFor) — not merely the first match in `runs`, since callers may
 * hand this an unsorted or multi-routine list. */
function latestRunFor(runs: OverviewFacts["runs"], routineId: string): OverviewFacts["runs"][number] | undefined {
  let best: OverviewFacts["runs"][number] | undefined;
  let bestAt = -Infinity;
  for (const run of runs) {
    if (run.routineId !== routineId) continue;
    const at = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
    if (at > bestAt) {
      bestAt = at;
      best = run;
    }
  }
  return best;
}

function doesLines(facts: OverviewFacts): string[] {
  const lines: string[] = [];
  for (const routine of facts.routines) {
    if (!routine.enabled) {
      lines.push(`Paused: ${routine.name}.`);
      continue;
    }
    const nextRun = routine.nextRunAt != null ? ` Next run ${time(routine.nextRunAt, facts.timeZone)}.` : "";
    const latest = latestRunFor(facts.runs, routine.id);
    const at = latest ? latest.finishedAt ?? latest.startedAt ?? latest.scheduledFor : undefined;
    const lastRun = latest ? ` Last run ${latest.status} at ${time(at!, facts.timeZone)}.` : "";
    lines.push(`${capitalize(scheduleText(routine.schedule, facts.timeZone))}: ${routine.name}.${nextRun}${lastRun}`);
  }
  for (const skill of facts.skills) {
    if (!skill.enabled) continue;
    lines.push(`Knows how to ${lowerFirst(skill.description || skill.name)}.`);
  }
  for (const webhook of facts.webhooks) {
    if (!webhook.enabled) continue;
    lines.push(`Listens for “${webhook.name}” webhooks.`);
  }
  return lines;
}

function computerReach(computer: BotRecord["computer"]): string | null {
  switch (computer) {
    case "cloud":
      return "Works on a cloud computer.";
    case "vm":
      return "Works in the Local VM.";
    case "local":
      return "Can act on this computer.";
    case "browser":
      return "Uses only the built-in browser.";
    case "off":
      return null;
    default:
      return "Picks a computer automatically.";
  }
}

function reachesLines(facts: OverviewFacts): string[] {
  const lines: string[] = [];
  const computer = computerReach(facts.bot.computer);
  if (computer) lines.push(computer);
  lines.push(facts.bot.cwd ? `Works in ${facts.bot.cwd}.` : "Works in its private workspace.");
  const apps = facts.connectedApps;
  if (
    facts.bot.composio !== false &&
    apps.configured &&
    facts.engine?.composioMcp &&
    apps.authoritative &&
    apps.services.length > 0
  ) {
    lines.push(`Can use ${apps.services.length} connected apps: ${apps.services.join(", ")}.`);
  } else if (!apps.authoritative) {
    lines.push("Connected apps could not be checked.");
  }
  if (facts.bot.browser !== false && facts.bot.computer !== "off") lines.push("Has the built-in browser.");
  if (facts.engine?.agentsMcp && facts.sectionPeers > 0 && facts.bot.peers?.length !== 0) {
    lines.push(`Can talk to ${facts.sectionPeers} other bots in its section.`);
  }
  if (facts.bot.chiefOfStaff) lines.push("Coordinates its section as Chief of Staff.");
  return lines;
}

function wontLines(facts: OverviewFacts): string[] {
  const lines: string[] = [];
  if (!facts.bot.autoApprove) lines.push("Won't run commands without asking you first.");
  if (facts.bot.approvePeerComms || facts.bot.peers?.length === 0) {
    lines.push("Won't contact other bots without asking.");
  }
  const apps = facts.connectedApps;
  if (
    facts.bot.composio === false ||
    !apps.configured ||
    !facts.engine?.composioMcp ||
    (apps.authoritative && apps.services.length === 0)
  ) {
    lines.push("Has no connected apps.");
  }
  if (facts.bot.computer === "off") lines.push("Can't use a computer.");
  if (!facts.routines.some((routine) => routine.enabled)) lines.push("Won't act on a schedule.");
  lines.push("Won't change its own instructions without your approval.");
  return lines;
}

export function buildBotOverview(facts: OverviewFacts): BotOverview {
  return {
    who: {
      name: facts.bot.name,
      title: facts.bot.title,
      blurb: facts.bot.description,
      soulLead: soulLead(facts.bot.soul),
    },
    does: doesLines(facts),
    reaches: reachesLines(facts),
    wont: wontLines(facts),
    recent: facts.recent,
  };
}
