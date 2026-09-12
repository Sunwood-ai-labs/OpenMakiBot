import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { handleToolCall, request } from "../scripts/mcp-server.ts";

async function withRooms(test: (f: any) => Promise<void>) {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const env = { OPENMAUSBOT_URL: session.info.url };
  const cli = (...args: string[]) => runControlOmb(args, { env }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") => request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  const tool = (name: string, args: Record<string, unknown>) => handleToolCall(name, args, (path, options) => request(path, options, session.info.url)) as Promise<any>;
  try {
    const sender = (await cli("new-bot", "--name", "Director", "--section", "A")).bot;
    const target = (await cli("new-bot", "--name", "Engineer", "--section", "B")).bot;
    const source = (await tool("create_channel", { name: "Planning", member_ids: [sender.id], bulletin: "SOURCE_ONLY" })).channel;
    const destination = (await tool("create_channel", { name: "Engineering", member_ids: [target.id], bulletin: "DESTINATION_ONLY" })).channel;
    await cli("room-routes", "--channel", destination.id, "--from", source.id);
    const planPath = join(session.info.dataDir, "room-plan.json");
    const plan: Record<string, any> = {
      [sender.id]: { steps: [{ arguments: { group_id: destination.id, bot_id: target.id, request_key: "work", message: "Please build CSV" } }], reply: "Assigned", resumeReply: "Reviewed downstream outcome" },
      [target.id]: { reply: "Built CSV" },
    };
    const savePlan = () => writeFileSync(planPath, JSON.stringify(plan));
    const nodes = () => {
      const file = join(session.info.dataDir, "room-handoffs.json");
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
    };
    const messages = async (threadId: string) => (await api(`/api/threads/${threadId}/messages`)).messages;
    const start = async () => { savePlan(); return cli("send-channel", "--channel", source.id, "--text", "@Director Start the assignment"); };
    const wait = async () => cli("wait", "--channel", source.id, "--timeout", "30");
    await test({ session, api, cli, tool, sender, target, source, destination, plan, savePlan, nodes, messages, start, wait });
  } finally { await session.close(); }
}

it("refuses a disabled incoming route without starting the recipient", () => withRooms(async f => {
  await f.cli("room-routes", "--channel", f.destination.id, "--from", "");
  f.plan[f.sender.id].steps[0].expectError = true;
  await f.start(); expect((await f.wait()).status).toBe("settled");
  expect(f.nodes()).toEqual([]);
  expect(await f.messages(f.destination.activeTaskId)).toEqual([]);
}), 45_000);

it("returns a provider failure to the sender and resumes it to handle the failure", () => withRooms(async f => {
  f.plan[f.target.id].fail = true;
  await f.start(); expect((await f.wait()).status).toBe("settled");
  const child = f.nodes().find((n: any) => n.parentId);
  expect(child.status).toBe("failed");
  const source = await f.messages(f.source.activeTaskId);
  expect(source.some((m: any) => m.roomRequest?.phase === "result" && m.text.includes("failed"))).toBe(true);
  expect(source.some((m: any) => m.text === "Reviewed downstream outcome")).toBe(true);
}), 45_000);

it("keeps a busy recipient queued and rejects a revoked route before dispatch", () => withRooms(async f => {
  f.plan[f.target.id].delayMs = 2000;
  f.savePlan();
  await f.cli("send", "--bot", f.target.id, "--text", "Independent direct task");
  await f.start();
  await expect.poll(() => f.nodes().find((n: any) => n.parentId)?.status, { timeout: 10_000 }).toBe("queued");
  await f.cli("room-routes", "--channel", f.destination.id, "--from", "");
  expect((await f.wait()).status).toBe("settled");
  expect(f.nodes().find((n: any) => n.parentId).status).toBe("failed");
  expect(await f.messages(f.destination.activeTaskId)).toEqual([]);
  await f.cli("wait", "--bot", f.target.id, "--timeout", "15");
}), 45_000);

it("stops an active downstream turn when the source group is interrupted", () => withRooms(async f => {
  f.plan[f.target.id].delayMs = 10_000;
  await f.start();
  await expect.poll(() => f.nodes().find((n: any) => n.parentId)?.status, { timeout: 10_000 }).toBe("running");
  await f.cli("interrupt", "--channel", f.source.id);
  await expect.poll(async () => {
    const { bots } = await f.api("/api/bots"); return bots.find((b: any) => b.id === f.target.id)?.busy;
  }, { timeout: 15_000 }).toBeFalsy();
  expect(f.nodes().every((n: any) => n.status === "cancelled")).toBe(true);
  expect((await f.messages(f.source.activeTaskId)).some((m: any) => m.text === "Reviewed downstream outcome")).toBe(false);
}), 45_000);

it.each(["allow", "deny"])("honors %s on the sender's peer-approval card", behavior => withRooms(async f => {
  await f.api(`/api/bots/${f.sender.id}`, { approvePeerComms: true }, "PATCH");
  f.plan[f.sender.id].steps[0].expectError = behavior === "deny";
  await f.start();
  let card: any;
  await expect.poll(async () => {
    card = (await f.messages(f.source.activeTaskId)).find((m: any) => m.card?.tool === "send_room_message");
    return Boolean(card);
  }, { timeout: 10_000 }).toBe(true);
  expect(await f.messages(f.destination.activeTaskId)).toEqual([]);
  expect((await f.cli("wait", "--channel", f.source.id, "--timeout", "3")).status).toBe("needs-user");
  await f.api(`/api/threads/${f.source.activeTaskId}/respond`, { requestId: card.card.requestId, behavior });
  expect((await f.wait()).status).toBe("settled");
  if (behavior === "deny") expect(f.nodes()).toEqual([]);
  else expect(f.nodes().find((n: any) => n.parentId)).toMatchObject({ status: "completed", approvalGranted: true });
}), 45_000);

it("pins a busy destination's task even when its active task changes", () => withRooms(async f => {
  f.plan[f.target.id].delayMs = 1500;
  f.savePlan(); await f.cli("send", "--bot", f.target.id, "--text", "Independent work");
  await f.start();
  await expect.poll(() => f.nodes().find((n: any) => n.parentId)?.status, { timeout: 10_000 }).toBe("queued");
  const created = await f.tool("create_task", { target_type: "channel", target_id: f.destination.id, title: "Unrelated conversation" });
  expect((await f.wait()).status).toBe("settled");
  const nodes = f.nodes(); expect(nodes.find((n: any) => n.parentId).threadId).toBe(f.destination.activeTaskId);
  expect((await f.messages(f.destination.activeTaskId)).some((m: any) => m.text === "Built CSV")).toBe(true);
  const current = (await f.api("/api/bots")).groups.find((g: any) => g.id === f.destination.id);
  expect(current.threadId).not.toBe(f.destination.activeTaskId);
  expect(await f.messages(current.threadId)).toEqual([]);
  expect(created.success).toBe(true);
}), 45_000);
