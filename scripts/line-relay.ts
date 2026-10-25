import { createLineRelay, lineRelayConfigFromEnv, type LineRelay } from "../server/line-relay.ts";

const HELP = `LINE relay for a self-hosted, headless OpenMakiBot server.

Listens on loopback only; expose POST /webhook through an HTTPS reverse proxy.
Run in the same network namespace as the app. Desktop-managed servers are not supported.

Required environment variables:
  OMB_LINE_APP_URL                 Loopback app origin, for example http://127.0.0.1:8799
  OMB_LINE_USER_ID                 One explicitly allowed LINE user ID (U...)
  OMB_LINE_BOT_ID                  Visible active Chief bot ID
  OMB_LINE_THREAD_ID               Pre-created dedicated Chief thread ID
  OMB_LINE_APPROVAL_MODE           Optional: ask (default) or full
  OMB_LINE_STATE_PATH              Absolute path for durable relay state
  OMB_LINE_CHANNEL_SECRET          LINE Messaging API channel secret
  OMB_LINE_CHANNEL_ACCESS_TOKEN    LINE Messaging API channel access token
  OMB_LINE_RELAY_PORT              Optional loopback port (default: 8765)

Choose the same approval mode for the dedicated task in OpenMakiBot. Full requires an explicit operator choice on that task; the relay never changes task permissions or answers approval cards.

Use --help to show this message. Keep /api private; only the LINE webhook route is public.`;

function printError(error: unknown): void {
  process.stderr.write(`${error instanceof Error ? error.message : "LINE relay startup failed"}\n`);
}

async function main(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  let relay: LineRelay | undefined;
  try {
    relay = createLineRelay({ config: lineRelayConfigFromEnv() });
    let closing = false;
    const stop = () => {
      if (closing || !relay) return;
      closing = true;
      void relay.close().catch((error: unknown) => {
        printError(error);
        process.exitCode = 1;
      });
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await relay.start();
    const address = relay.address();
    if (!address) throw new Error("LINE relay listener did not start");
    process.stdout.write(`LINE relay listening on http://${address.host}:${address.port}/webhook\n`);
  } catch (error) {
    printError(error);
    await relay?.close().catch(() => undefined);
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
