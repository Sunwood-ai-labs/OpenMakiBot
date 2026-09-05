// Setup mode: the coaching block a bot gets when it has not been set up yet,
// or when the user asks for it with /setup. The bot interviews the user, says
// what it intends, and then configures itself only through proposal cards
// (propose_profile, propose_routine, skill_manage, request_credential) — so
// nothing changes without the user's approval. Mirrors skill-learn.ts:
// /setup is a turn-text rewrite plus a prompt block, never a hidden mode.

const SETUP_COMMAND = /^\/setup(?:\s+|$)([\s\S]*)$/i;

/** `/setup` at the start of a message, optionally followed by a job description. */
export function parseSetupCommand(text: string): { request: string } | null {
  const match = text.trim().match(SETUP_COMMAND);
  if (!match) return null;
  return { request: match[1]!.trim() };
}

/** What the model reads in place of a literal `/setup` message. */
export function expandSetupTurnText(userText: string): string {
  const setup = parseSetupCommand(userText);
  if (!setup) return userText;
  return setup.request
    ? `Set yourself up for this job: ${setup.request}`
    : "Set yourself up. Ask me what you need to know, then propose your configuration.";
}

/** A bot with neither standing instructions nor a description has not been
 * set up. /setup re-enters the mode for a configured bot. */
export function setupModeActive(input: { soul?: string; description?: string; text: string }): boolean {
  const blank = !(input.soul ?? "").trim() && !(input.description ?? "").trim();
  return blank || parseSetupCommand(input.text) !== null;
}

export const SETUP_PROMPT =
  "\n\nThis bot has not been set up yet, or the user asked you to set yourself up. Your job this conversation is to set yourself up from what the user tells you." +
  " First ask at most three questions that change what you would build: what the job is, when it should happen (on demand, on a schedule, or when something arrives), and which apps or accounts it touches." +
  " Then, before any tool call, tell the user in plain language what you intend: who you will be, what you will do and when, what you will need from them, and what you will not do. Wait for a yes." +
  " Then emit proposals, each of which the user must confirm: propose_profile for your identity and standing rules (keep SOUL.md short; put step-by-step procedure into a skill with skill_manage), propose_routine for anything scheduled (propose it paused), request_credential for any token." +
  " Never claim something is set up until its card is confirmed. Finish by saying what remains for the user to do by hand, such as authorizing an app or enabling a routine.";

export function setupSystemPrompt(active: boolean): string {
  return active ? SETUP_PROMPT : "";
}
