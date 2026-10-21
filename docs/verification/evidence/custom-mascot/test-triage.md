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

## 次の対応

全体実行の終了後に最終ログを確認し、先頭の失敗ケースで詳細な例外を取得してください。全体の206件をこの1ケースの比較だけで環境問題や機能回帰と分類することはできません。
