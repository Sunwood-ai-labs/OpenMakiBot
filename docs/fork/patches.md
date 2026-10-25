# OpenMakiBot patch ledger

上流へ返す変更と、独自に維持する変更を機能単位で追跡する。
本家 PR の状態は確認日とともに更新し、SHA だけで採用済みと判断しない。

| 機能 | 独自ブランチ / PR | 本家 PR | 方針 / 状態 |
| --- | --- | --- | --- |
| OpenMakiBot のブランド・Git Flow・公開ガード | `codex/feature/openmakibot-foundation` | 対象外 | 独自に維持 |
| ローカル資料プレビューとチャット内サムネイル | [#4](https://github.com/Sunwood-ai-labs/OpenMakiBot/pull/4) · `codex/feature/chat-previews` | [#959](https://github.com/milind-soni/OpenMausBot/pull/959) | `19b0dcde` の資料プレビュー基盤を `cbbf46ad` で独自版へ採用。`b600c594` の画像分類・取得処理を再利用し、動画のチャット内再生、PDF/PPTX/表のサムネイルを追加。本家 #959 は 2026-10-03 確認時 Open / 未マージ。0.1.93 同期でも資料プレビューを独自に維持し、本家の数式・スレッド参照・画像制御と統合。 |
| 本家 0.1.93 の同期 | `codex/sync/upstream-20261003` | 対象外 | 2026-10-03 取得の本家 main `607bb5b9` を develop へ merge。独自ブランド、資料プレビュー、本家限定の公開ガードを維持。検証結果は同期 PR に記録。 |
| 本家 03a6e88 の同期 | `codex/sync/upstream-20261025` | 対象外 | fork/develop `717ab09f` を基点に、2026-10-25 取得の本家 main `03a6e88bc` を統合。上流の HTML/CSV/TSV preview、フォルダー一覧・外部 workspace 案内、最新 Markdown / thread / browser opener を維持し、独自の image/PDF/video/XLSX/XLS/ODS/PPTX preview を接続。Android/iOS の上流ソース削除を採用し、保護コンテキストはソースがない間だけ条件付き skip、戻った場合は検証復旧を要求する。配布先ガードと3 OSの実 Vitest shard matrixを維持。検証記録は [upstream sync evidence](../verification/evidence/upstream-sync-20261025/README.md)。 |
| 本家 f9191b5 の同期と更新案内ガード | [#11](https://github.com/Sunwood-ai-labs/OpenMakiBot/pull/11) · `codex/sync/upstream-20261025` | 対象外 | 本家 main `f9191b5384b9900b2371696336439ae5ad6e0117` までを fork/develop `717ab09f` に統合した `ae15688d` が PR #11 の基点。フォークの `/api/updates/check` は `current`、`install`、`available: false` のみ返し、本家 release feed を呼ばない。上流の汎用 `server/update-check.ts` は維持する。独立 UI 確認は e0455bb / tree `59cd8048` に結び付き、281個のdistファイルが同一だった。UI確認はプレビュー操作の証拠で、更新案内の確認ではない。e0455bb の手動 CI は成功したが、この更新案内修正より前の結果であり、修正後のPR headを検証しない。 |

既存の Podman、アカウント共有、ルーム連携などの作業は、この初期整備で一括採用しない。
元の worktree と未コミット変更を維持し、develop への取り込み時に行を追加する。
初期基準は既存の fork/main (`5d69ece953a931cf66295263acdab69cdad9cc04`)。
本家最新との差分は同期 PR で検証して取り込む。
