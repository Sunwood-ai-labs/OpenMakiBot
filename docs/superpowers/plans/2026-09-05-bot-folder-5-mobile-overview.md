# Bot Folder, Step 5: Mobile Overview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS and Android show the same plain-language Overview the desktop dialog shows, read-only, reached from each phone's existing bot profile view, fed by `GET /api/bots/:id/overview`.

**Architecture:** No rules live on the phones. Each client adds a `BotOverview` wire type, one GET in its existing `CompanionClient`, one read-only screen that renders `who / does / reaches / wont / recent` as sentence rows in the house style, and a link to it from the profile view. A shared fixture `bot-overview.json` (captured from the server) pins the contract for both decoding test suites, which already read the same fixture directory.

**Tech Stack:** Swift 6 / SwiftUI (`swift test --package-path ios` for CompanionCore; `xcodegen` + `xcodebuild` to compile the app), Kotlin / Jetpack Compose (`./gradlew :core:test :app:testDebugUnitTest :app:assembleDebug`).

**Spec:** `docs/superpowers/specs/2026-09-05-bot-folder-and-self-setup-design.md` — Part 3 "Mobile", rollout step 5.

**Depends on:** step 3 Task 2 (`GET /api/bots/:id/overview`) on the branch.

## Global Constraints

- The phones render the server's sentences verbatim. No phone reimplements a Won't rule.
- Response shape (server-owned): `{ who: { name, title, blurb, soulLead }, does: string[], reaches: string[], wont: string[], recent: [{ at: number (ms), summary: string }] }`. Decoders stay lenient (unknown keys ignored); every array may be empty.
- Read-only: the screen never writes. Pull-to-refresh reloads.
- The new route needs no auth change (it is an ordinary `/api/bots/:id/…` GET; every paired session has `client` scope).
- iOS test suite: `swift test --package-path ios` must pass. Android: `cd android && ./gradlew --no-daemon :core:test :app:testDebugUnitTest :app:assembleDebug` must pass. Gradle wants a JDK 17 toolchain: this Mac has no system JDK; try `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` (JDK 25 — Gradle's toolchain resolution may still need 17). If Gradle cannot provision 17, install it with `brew install --cask temurin@17` and set `JAVA_HOME=$(/usr/libexec/java_home -v 17)`; record what you did in the report.
- Never push. Commit locally on `feat/bot-folder`; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

- Create `ios/Tests/CompanionCoreTests/Fixtures/bot-overview.json` — captured response (Task 1).
- Modify `scripts/capture-companion-fixtures.mjs` — capture the new fixture (Task 1).
- Modify `ios/Sources/CompanionCore/Models.swift` — `BotOverview`, `BotOverviewWho`, `BotOverviewRecent`.
- Modify `ios/Sources/CompanionCore/Client.swift` — `overview(botId:)`.
- Modify `ios/App/Session.swift` — `botOverview(for:)`.
- Create `ios/App/BotOverviewView.swift`.
- Modify `ios/App/AgentProfileView.swift` — a NavigationLink row in the Identity section.
- Modify `ios/Tests/CompanionCoreTests/DecodingTests.swift`, create `ios/Tests/CompanionCoreTests/OverviewClientTests.swift`.
- Modify `android/core/src/main/kotlin/com/openmausbot/companion/core/Models.kt` — `BotOverview`, `BotOverviewWho`, `BotOverviewRecent`.
- Modify `android/core/src/main/kotlin/com/openmausbot/companion/core/Client.kt` — `overview(botId)`.
- Modify `android/core/src/main/kotlin/com/openmausbot/companion/core/Session.kt` — `loadOverview(botId)`.
- Modify `android/app/src/main/kotlin/com/openmausbot/companion/ui/Navigation.kt`, `RootScreen.kt`, `ChatScreen.kt`, `AgentProfileSheet.kt` — `Destination.Overview(botId)` and the row that opens it.
- Create `android/app/src/main/kotlin/com/openmausbot/companion/ui/BotOverviewScreen.kt`, `ui/OverviewRules.kt` (copy strings).
- Modify `android/core/src/test/kotlin/com/openmausbot/companion/core/DecodingTest.kt`, create `OverviewClientTest.kt`; modify `android/app/src/test/kotlin/com/openmausbot/companion/ui/NavigationTest.kt`.

---

### Task 1: The fixture

**Files:**
- Modify: `scripts/capture-companion-fixtures.mjs`
- Create: `ios/Tests/CompanionCoreTests/Fixtures/bot-overview.json`

- [ ] Read `scripts/capture-companion-fixtures.mjs` to see how it starts a server and writes each fixture (it already captures `bots-full.json` etc.). Add a step that creates a bot named `Kiwi` with `title: "Tracker"`, `description: "Files bugs."`, PATCHes `soul: "File bugs.\n\nNever file noise."`, creates one enabled 5-minute interval routine for it named `Triage Discord` via `POST /api/routines` (read the routine input shape in `src/lib/routines.ts` `RoutineInput`), then captures `GET /api/bots/<id>/overview` to `bot-overview.json`. Run the script the way its header says; commit the new fixture. If the script needs a fake engine to create bots, follow whatever it already does for `bots-full.json`.
- [ ] Verify the fixture has non-empty `does` (one `Every 5 minutes…: Triage Discord.` line), `wont` with the standing last line, `who.soulLead === "File bugs."`, and `recent` with a `soul:` summary.
- [ ] Commit: `test(fixtures): capture a bot overview for the phone suites`.

---

### Task 2: iOS — model, client, session

**Files:**
- Modify: `ios/Sources/CompanionCore/Models.swift`, `ios/Sources/CompanionCore/Client.swift`, `ios/App/Session.swift`
- Test: `ios/Tests/CompanionCoreTests/DecodingTests.swift`, `ios/Tests/CompanionCoreTests/OverviewClientTests.swift`

**Interfaces:**

```swift
public struct BotOverviewWho: Codable, Hashable, Sendable {
    public var name: String
    public var title: String
    public var blurb: String
    public var soulLead: String
}
public struct BotOverviewRecent: Codable, Hashable, Sendable {
    /** epoch milliseconds, like every other timestamp on the wire */
    public var at: Double
    public var summary: String
}
public struct BotOverview: Codable, Hashable, Sendable {
    public var who: BotOverviewWho
    public var does: [String]
    public var reaches: [String]
    public var wont: [String]
    public var recent: [BotOverviewRecent]
}
// Client.swift
public func overview(botId: String) async throws -> BotOverview   // GET /api/bots/<validRouteID(botId)>/overview
// Session.swift
func botOverview(for bot: Bot) async -> BotOverview?             // nil + actionError on failure, like configStatus()
```

- [ ] **Step 1: Failing tests.** In `DecodingTests.swift` add `func testDecodesABotOverview() throws { let overview = try decode(BotOverview.self, "bot-overview"); XCTAssertEqual(overview.who.name, "Kiwi"); XCTAssertEqual(overview.who.soulLead, "File bugs."); XCTAssertFalse(overview.does.isEmpty); XCTAssertEqual(overview.wont.last, "Won't change its own instructions without your approval."); XCTAssertFalse(overview.recent.isEmpty) }`. Create `OverviewClientTests.swift` copying the URLProtocol stub pattern from `ConnectedAppsClientTests.swift`: stub a minimal JSON body, call `client.overview(botId: "bot-1")`, assert the request path is `/api/bots/bot-1/overview`, the `Authorization` header is `Bearer paired-token`, and the decoded `who.name`.
- [ ] **Step 2:** `swift test --package-path ios --filter "DecodingTests|OverviewClientTests"` → FAIL. Implement the three pieces (place the structs near `Bot` in `Models.swift`; the client method beside `routines()`; the session method beside `configStatus()`). → PASS.
- [ ] **Step 3:** `swift test --package-path ios` (whole package) green. Commit `feat(ios): decode and fetch a bot overview`.

---

### Task 3: iOS — the screen and its entry point

**Files:**
- Create: `ios/App/BotOverviewView.swift`
- Modify: `ios/App/AgentProfileView.swift`

**Interfaces:**
- `struct BotOverviewView: View { let bot: Bot }` — `@EnvironmentObject var session: Session`, `@State private var overview: BotOverview?`, `@State private var loading = false`, `@State private var failed = false`. Body: `List` with sections **Who** (name as headline, title, blurb, soulLead as `.footnote.secondary`), **Does** (one `Label(text, systemImage: "calendar.badge.clock")` per line; empty → `Text("Nothing scheduled or learned yet.")`), **Can reach** (`Label(_, systemImage: "network")`), **Won't** (`Label(_, systemImage: "hand.raised")`), **Recent changes** (`summary` + `Date(timeIntervalSince1970: at / 1_000).formatted(date: .abbreviated, time: .shortened)` as `.caption.secondary`; empty → `No changes recorded yet.`). `.navigationTitle("What \(bot.name) does")`, `.task { await load() }`, `.refreshable { await load() }`, `.overlay { if loading && overview == nil { ProgressView() } }`, and on failure a `ContentUnavailableView("Couldn't load", systemImage: "wifi.exclamationmark")`. Copy the shell from `ios/App/ConnectedAppsView.swift:38-91`.
- In `AgentProfileView`, add to the **Identity** section's top a `NavigationLink { BotOverviewView(bot: current) } label: { Label("What this bot does", systemImage: "list.bullet.rectangle") }` — the first `NavigationLink` in that view; the `NavigationStack` is already there.

- [ ] **Step 1:** Generate and build the app to prove it compiles (no simulator run needed):

```bash
cd ios && xcodegen generate && xcodebuild -project OpenMausCompanion.xcodeproj -scheme OpenMausCompanion -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build | tail -5
```

If `xcodegen` is missing, `brew install xcodegen`. Do not commit the generated `.xcodeproj` (check `.gitignore`).
- [ ] **Step 2:** If a simulator is available (`xcrun simctl list devices available | grep iPhone`), boot one, install the built app, pair it to a fixture server if the existing recipe in `docs/` or the `ios-device-install-recipe` notes makes that quick, open a bot → Bot settings → "What this bot does", and screenshot it (`xcrun simctl io booted screenshot`). If pairing is not quick, skip and say so.
- [ ] **Step 3:** Commit `feat(ios): read-only What this bot does screen`.

---

### Task 4: Android — model, client, session

**Files:**
- Modify: `android/core/src/main/kotlin/com/openmausbot/companion/core/Models.kt`, `Client.kt`, `Session.kt`
- Test: `android/core/src/test/kotlin/com/openmausbot/companion/core/DecodingTest.kt`, create `OverviewClientTest.kt`

**Interfaces:**

```kotlin
@Serializable data class BotOverviewWho(val name: String, val title: String, val blurb: String, val soulLead: String)
@Serializable data class BotOverviewRecent(val at: Double, val summary: String)
@Serializable data class BotOverview(
    val who: BotOverviewWho,
    val does: List<String> = emptyList(),
    val reaches: List<String> = emptyList(),
    val wont: List<String> = emptyList(),
    val recent: List<BotOverviewRecent> = emptyList(),
)
// Client.kt
suspend fun overview(botId: String): BotOverview = send(makeRequest("GET", "/api/bots/${segment(botId)}/overview"))
// Session.kt
suspend fun loadOverview(botId: String): BotOverview?   // null + _actionError on failure, like loadRoutines()
```

- [ ] **Step 1: Failing tests.** `DecodingTest.kt`: `decodeFixture<BotOverview>("bot-overview")` asserting `who.name == "Kiwi"`, `who.soulLead == "File bugs."`, `does.isNotEmpty()`, `wont.last() == "Won't change its own instructions without your approval."`. `OverviewClientTest.kt`: copy the MockWebServer harness from `ProfileClientTest.kt`, enqueue `json(fixtureText("bot-overview"))`, call `client.overview("bot-1")`, assert `GET` and path `/api/bots/bot-1/overview`, and the `Authorization` header `Bearer paired-token`.
- [ ] **Step 2:** `cd android && ./gradlew --no-daemon :core:test` (with the JDK arrangement from Global Constraints) → FAIL, implement, → PASS.
- [ ] **Step 3:** Commit `feat(android): decode and fetch a bot overview`.

---

### Task 5: Android — the screen and navigation

**Files:**
- Create: `android/app/src/main/kotlin/com/openmausbot/companion/ui/BotOverviewScreen.kt`, `android/app/src/main/kotlin/com/openmausbot/companion/ui/OverviewRules.kt`
- Modify: `ui/Navigation.kt` (`data class Overview(val botId: String) : Destination` + encode/decode), `ui/RootScreen.kt` (branch → `BotOverviewScreen(botId, onBack = navigator::pop)`), `ui/AgentProfileSheet.kt` (an `ActionRow` "What this bot does" at the top that calls `onOpenOverview(bot.id)`), `ui/ChatScreen.kt` (thread `onOpenOverview = { navigator.push(Destination.Overview(it)); showingProfile = false }`)
- Test: `android/app/src/test/kotlin/com/openmausbot/companion/ui/NavigationTest.kt` (round-trip the new destination)

**Interfaces:**
- `OverviewRules` object: `TITLE(name) = "What $name does"`, `EMPTY_DOES = "Nothing scheduled or learned yet."`, `EMPTY_RECENT = "No changes recorded yet."`, `FAILED = "Couldn't load the overview."`, section headers `WHO, DOES, REACHES, WONT, RECENT`.
- `BotOverviewScreen(botId: String, onBack: () -> Unit)`: loads via `session.loadOverview(botId)` in `LaunchedEffect(botId)`, `PullToRefreshBox` shell copied from `ConnectedAppsScreen.kt:59-90`, `FormSection` per block with `IconNote` rows (icons: `Icons.Outlined.Schedule` for does, `Icons.Outlined.Hub` for reaches, `Icons.Outlined.Block` for wont), recent rows with `RelativeStamp.dateAndTime(at.toLong(), …)`.

- [ ] **Step 1:** `NavigationTest.kt` round-trip test for `Destination.Overview("bot-1")` → FAIL → implement encode/decode → PASS.
- [ ] **Step 2:** Implement the screen and wiring. `cd android && ./gradlew --no-daemon :app:testDebugUnitTest :app:assembleDebug` green.
- [ ] **Step 3:** If the AVD `openmaus` exists (`emulator -list-avds`), boot it, `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, open a bot → profile → "What this bot does", screenshot with `adb exec-out screencap -p > overview.png`. If not, skip and say so.
- [ ] **Step 4:** Commit `feat(android): read-only What this bot does screen`.

---

## Done when

- `swift test --package-path ios` green; the iOS app compiles for the simulator.
- `./gradlew :core:test :app:testDebugUnitTest :app:assembleDebug` green.
- Both phones can open "What this bot does" from the bot profile and show the server's sentences.
- The shared fixture `bot-overview.json` exists and both decoding suites read it.
