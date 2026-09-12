# OpenMakiBot patch ledger

上流へ返す変更と、独自に維持する変更を機能単位で追跡する。
本家 PR の状態は確認日とともに更新し、SHA だけで採用済みと判断しない。

| 機能 | 独自ブランチ / PR | 本家 PR | 方針 / 状態 |
| --- | --- | --- | --- |
| OpenMakiBot のブランド・Git Flow・公開ガード | `codex/feature/openmakibot-foundation` | 対象外 | 独自に維持 |
| ローカル資料プレビューとチャット内サムネイル | [#4](https://github.com/Sunwood-ai-labs/OpenMakiBot/pull/4) · `codex/feature/chat-previews` | [#959](https://github.com/milind-soni/OpenMausBot/pull/959) | `19b0dcde` の資料プレビュー基盤を `cbbf46ad` で独自版へ採用。`b600c594` の画像分類・取得処理を再利用し、動画のチャット内再生、PDF/PPTX/表のサムネイルを追加。本家 #959 は 2026-09-12 確認時 Draft / 未マージ。本家の採用を待たず develop 向けに検証。 |

既存の Podman、アカウント共有、ルーム連携などの作業は、この初期整備で一括採用しない。
元の worktree と未コミット変更を維持し、develop への取り込み時に行を追加する。
初期基準は既存の fork/main (`5d69ece953a931cf66295263acdab69cdad9cc04`)。
本家最新との差分は同期 PR で検証して取り込む。
