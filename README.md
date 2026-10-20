# Native session profile display

Synthetic UI evidence captured on 2026-10-21 for upstream OpenMausBot.

- Before: `c192de3c2d4183f721a1c544f7fcd16ae719b899` (v0.1.120).
- After: `192a9e0dd9fe9603cd9f9aa9c09095544b3e6d31`.
- The configured profile is `Workspace Owner`, `owner@example.test`, with a generated generic avatar.
- The browser signs in through the native email OTP flow as `member.one@example.test`, with `client` scope and the device label `Chrome on Windows`.
- Before and after use the same browser session and fixture data. Only the served production UI changes. The browser's `/api/auth/session` response retains the same session ID and member email across the reload.
- `before.png` shows the owner's name and avatar for that member. `after.png` shows the member's email and initial instead. The full email is also the profile button's accessible name.
- `after-owner.png` confirms a separate native sign-in as `owner@example.test` retains the configured owner's name and avatar.

The fixture uses a disposable home, the repository's fake engine, and `server/testing/control-plane-stub.ts`. It sends no real email and uses no user data or credentials. Its fixed OTP is test data.

## Reproduce

Install the upstream dependencies with Node 24 and pnpm 10.33.0. Build the baseline and fixed production UIs with `pnpm exec vite build`, saving each `dist` directory separately. From a directory containing this fixture script, run:

```sh
OMB_PROFILE_FIXTURE_REPO=/absolute/path/to/OpenMausBot \
STATIC_DIR=/absolute/path/to/baseline-dist \
node --experimental-strip-types ./native-profile-fixture.ts
```

Open the printed URL and complete the synthetic native OTP login using the printed code. Inspect `/api/auth/session` in the same browser. Serve the fixed build from the same static directory and reload to compare while keeping the session unchanged. Stop the fixture with SIGTERM or Ctrl-C; it removes only its temporary home and owned server.

## Checks

The fixed source passed `pnpm typecheck`, `pnpm lint`, `pnpm i18n:check`, `pnpm exec vite build`, and 68 focused tests across `src/lib/session.test.ts`, `src/components/SidebarProfileMenu.test.ts`, `server/people-invite.test.ts`, and `server/email-signin.test.ts` in a disposable Linux container. A separate read-only review covered the four-file diff. The complete `pnpm test` run is recorded separately in the PR status; these focused checks are not a full-suite result.
