# OpenMakiBot patch ledger

上流へ返す変更と、独自に維持する変更を機能単位で追跡する。
本家 PR の状態は確認日とともに更新し、SHA だけで採用済みと判断しない。

| 機能 | 独自ブランチ / PR | 本家 PR | 方針 / 状態 |
| --- | --- | --- | --- |
| OpenMakiBot のブランド・Git Flow・公開ガード | `codex/feature/openmakibot-foundation` | 対象外 | 独自に維持 |

既存の Podman、アカウント共有、ルーム連携などの作業は、この初期整備で一括採用しない。
元の worktree と未コミット変更を維持し、develop への取り込み時に行を追加する。
初期基準は既存の fork/main (`5d69ece953a931cf66295263acdab69cdad9cc04`)。
本家最新との差分は同期 PR で検証して取り込む。
