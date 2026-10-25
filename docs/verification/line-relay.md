# LINE Chief relay fixture

Run the focused unit checks and isolated end-to-end fixture:

```sh
pnpm exec vitest run server/line-message-format.test.ts server/line-relay.test.ts
pnpm test:line-relay
```

This relay supports a self-hosted, headless server. A system service or
container must share the server's network namespace; desktop-managed servers
are unsupported. The relay binds to loopback, so expose only `POST /webhook`
through an HTTPS reverse proxy and keep `/api` private.

The end-to-end case launches the repository verification server from
`scripts/control-omb.ts` in a disposable home with the fake CLI. A local fake
LINE HTTP sink receives pushes through an injected test fetch. No LINE
credentials, public API, real LINE account, or user data are used.

The fixture verifies a signed webhook reaches the real guarded-message route
and only the exact successful Chief final is pushed. It also sends a second
message to the same pinned task, replays a duplicate event after restart,
changes redelivery metadata, and checks invalid signatures, unknown users and
group events do not dispatch. The end-to-end fixture gates a teammate wait,
checks that the initial delegation acknowledgment is not sent as a final, and
then confirms the eventual Chief result arrives. The relay has no approval
route; actual approval-card interaction is not covered by this fixture. Push
retry behavior preserves the original request after a lost response. Unit
checks cover transient app failure, failed durable writes,
state binding, busy-task retry IDs, retry-key stability, and UTF-16 text
chunking including supplementary characters.

The fixture also checks the Ask default, explicit Full mode on a dedicated
task, and refusal to start when the relay mode does not match the task. Full
mode is configured only in the disposable fixture; the relay does not change
the task's approval mode.

Formatter tests check vertical Flex cards, preserved columns and surrounding
text, and unchanged-text fallback when parsing or size limits are uncertain.
The relay's fake LINE sink verifies that a table final is pushed as one Flex
message. Retry tests keep the same Flex payload and retry key across a relay
restart, while a legacy pending batch without a format marker remains the same
plain-text request.

This fixture proves the relay against local fakes only. It does not prove a
configured LINE Official Account, billing plan, internet-facing HTTPS proxy,
Podman network namespace, or production delivery. Do not use real account
credentials or LINE's production endpoint for tests.
