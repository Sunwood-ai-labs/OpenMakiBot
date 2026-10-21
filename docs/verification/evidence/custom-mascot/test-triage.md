# マスコットテスト失敗の切り分け

## 概要

現行ソースで最初の失敗ケースを再実行したところ、1回目は `fetch` が `ECONNRESET` で失敗し、2回目は通りました。基準コミット `6b4d749834f8581e1f6e42d7346a058c1c487e73` の同じケースも通りました。このケースの失敗は再現性がなく、機能回帰とは判断できません。接続を切ったプロセスは特定できていません。

全体テストでは `server/index.test.ts` に206件の失敗表示があります。詳細ログが出ておらず、実行開始後にソースも更新されているため、全体失敗の原因は未確定です。全体テスト成功とは扱いません。

## 実行結果

全体実行ログ `C:\Users\makim\.codex\visualizations\2026\10\21\01a15c95-e6da-73c1-9c09-1f23f15c8408\custom-mascot\full-tests.log` は20:20:57 JST以降更新されていません。記録された `server/index.test.ts` の結果は278件中206件失敗、8件スキップ、152,987 msです。先頭の失敗は「keeps the bot while an owned Boat deletion is pending and finishes on retry」で、6,652 msでした。

現行ソースの同ケースは20:32:18開始の実行で `TypeError: fetch failed`、原因 `read ECONNRESET` となり、1件失敗、278件スキップでした。詳細な発生行は出力されていません。ログは `test-triage-current-2031.log` です。

同ケースを現行ソースで再実行したところ、20:33:25開始で1件成功、278件スキップでした。結果は `test-triage-current-json-2032.json` にあります。

基準コミットの隔離 worktree で同ケースを選択実行したところ、1件成功、277件スキップでした。ログは `test-triage-baseline-2034.log` です。基準 worktree は `C:\Prj\OpenMakiBot-baseline-6b4d749-20261021` に作り、依存関係を現行 checkout の `node_modules` junction から共有しました。`package.json` と `pnpm-lock.yaml` は現行 HEAD と一致しています。

## 全体実行の状態

20:37:58 JSTの読み取り専用スナップショットでは、全体実行のプロセス列は `pnpm` PID 31280、`cmd.exe` PID 27568、Vitest PID 4160、worker PID 30476でした。Vitest本体はCPU 9.17秒、189.6 MB、workerはCPU 9.14秒、121.5 MBでした。15秒の計測区間ではworkerのCPUが0.906秒増え、fixture server PID 2092のCPUも3秒増えました。後のプロセス照会ではPID 2092が見つからず、worker PID 30476は残っていました。詳細は `test-triage-process-snapshot.txt` に保存しました。

別プロセスのPID 38100は `scripts/verify-bot-settings.ts`、PID 36108はUI fixture launcher、その子のPID 33900はfixture serverです。いずれも全体テストのプロセス列には含まれません。調査では停止していません。

## 最終source・CI確認（2026-10-21）

HEAD `0e24c4cf5d301a402c5637c0e0c940fa0c627cf7` のCIでは、UbuntuとmacOSのshard 4で同じ組織ライブラリ追加テストが各1件失敗しました。テストが `packageBase.look.r === packageBase.look.w` を要求していましたが、この2値は別の値を記録します。fixtureのreleaseは `mascotBody` を省略するため `r` は `null` のhash `9fb5a4a35d967a2dd3487a57cccf5e5c4180a417fa01cbfebd447145007c36c2`、新規Botのcanonical profileはbuiltin Cursorを選ぶため `w` は `cursor` のhash `e346e1a4c2bc3255359bb8cc22c362f2125be9dc9c7e5b423c157ddc34cf4d00` でした。テストを修正し、それぞれを独立して期待値と照合し、選択済みprofileがCursorであることも確認します。その他7件のCI failure statusはaggregate表示のため、個別caseへ帰属させていません。CIログは外部evidenceの `triage/ci-ubuntu-0e.log` と `triage/ci-macos-0e.log` です。

次の5ファイルのfocused runは108件成功、失敗0件でした。コマンド実行ごとに一時 `CODEX_HOME` を明示しています。

```text
pnpm exec vitest run server/package-parts.test.ts server/org-library.test.ts server/package-import.test.ts server/package-export.test.ts server/team-manifest.test.ts
```

同じsource stateで `pnpm typecheck`、`pnpm lint`、`git diff --check` も成功しました。独立した現行カスタムマスコットvalidator runは4件成功、失敗0件です。

初回の全体 `pnpm test` はsource変更をまたいだ混在実行となり、所有するexec session PID 13295からCtrl-Cで停止しました。最終Vitest summaryはなく、成功gateではありません。初期ログの206件failure表示や、後から出たcache由来のvalidator failureを現行ソースの結果として扱いません。PID、停止方法、previewとの境界は外部receipt `full-run-final-status.json` に記録されています。

また、host Codex appserverのrouteとhomeがfixture専用だと証明できなかったため、そのrouteは停止し、追加host CLI probeは行っていません。画面・動画の受け入れ証拠は、これとは別のsealed fake-engine fixtureで記録したままです。後続のpackage look-stamp修正は非UI変更で、Creator、native renderer、API-save実装は変更していません。したがって既存mediaは保存されたsource snapshotに結び付いたUI証拠であり、後続のpackage hash logicを実行した証拠ではありません。ファイル別blob ID・SHA256とこの境界は [proof.json](proof.json) に記録しています。
