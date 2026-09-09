# OpenMakiBot agent instructions

OpenMakiBot は OpenMausBot の独自開発フォーク。本家の更新を取り込みながら、
独自機能を自分たちの判断で採用・リリースし、汎用的な改善を適宜本家へ PR する。
本家 PR のマージを、独自版の開発・採用の前提にしない。

## タスク名

作業を把握したら最初の実作業前に `set_thread_title` で現在のタスク名を変更する。
先頭に内容に合う絵文字を1つと半角スペースを付け、対象と目的が分かる簡潔な日本語にする。
ユーザー指定名を優先し、対象が変わった場合は更新する。他のタスクは依頼なく改名しない。

## リモートとブランチ

標準リモート名は一般的な clone 直後と異なる。必ず URL を確認する。

| 名前 | URL / 役割 |
| --- | --- |
| `origin` | `https://github.com/milind-soni/OpenMausBot.git`：本家。通常は fetch のみ |
| `fork` | `https://github.com/Sunwood-ai-labs/OpenMakiBot.git`：開発・push 先 |
| `origin/main` | fetch 時点の本家の main。独自変更を置かない |
| ローカル `main` → `fork/main` | 独自版の安定系列。GitHub のデフォルトブランチ |
| ローカル `develop` → `fork/develop` | 独自版の開発・機能統合系列 |

`remote.pushDefault=fork` を使う。push と `gh pr` は対象を明示する。
フォークの main を本家に reset / force push して同期してはいけない。
`gh repo sync` で独自版 main を直接更新せず、下記の同期 PR を使う。
初回 clone 手順は [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

## 作業開始と分離

1. `git status --short --branch`、`git remote -v`、`git worktree list` を確認する。
2. `git fetch origin` と `git fetch fork` で参照を更新する。
3. 対象系列の最新リモート参照から、機能専用ブランチと専用 worktree を作る。
4. 既存の未コミット変更を勝手に stash・commit・reset しない。汚れた作業場所はそのまま残し、別 worktree で進める。
5. 無関係な変更・実データ・秘密情報・生成物をコミットに混ぜない。

## Git Flow

| 用途 | ブランチ | 分岐元 | 戻し先 |
| --- | --- | --- | --- |
| 新機能・通常修正 | `codex/feature/<slug>` | `fork/develop` | フォーク `develop` |
| リリース準備 | `codex/release/<version>` | `fork/develop` | フォーク `main` と `develop` |
| 安定版の緊急修正 | `codex/hotfix/<slug>` | `fork/main` | フォーク `main` と `develop` |
| 本家更新の統合 | `codex/sync/<slug>` | `fork/develop` | フォーク `develop` |
| 本家への提案 | `codex/pr/<slug>` | `origin/main` | 本家 `main` |

- 独自機能は develop に PR を出す。`gh pr create --repo Sunwood-ai-labs/OpenMakiBot --base develop` を使う。
- main / develop は PR と必要な CI 成功を経由する。承認レビュー人数は0人でよい。保護の管理者バイパスや強制 push で失敗を隠さない。
- 統合には merge commit を使う。長期系列・複数系列へ統合済みの履歴を rebase しない。linear history は必須にしない。
- release → main を検証・マージ後、修正を develop にも戻す。hotfix も両方へ戻す。
- 独自タグは `openmaki-vX.Y.Z`。本家の `v*` タグを移動・上書きしない。タグは依頼されたリリース作業で main 上の対象コミットに付ける。
- 不具合時は revert PR で取り消す。依存する機能がある場合は影響を確認する。
- 実装、検証、対象ファイルの commit、fork への push、PR、CI 確認、許可されたマージまで進める。外部要因で止まった場合は原因と PR を明記する。
- ブランチ削除は必要な統合先とタグを確認してから。本家 PR が開いているブランチ、未統合の修正、使用中の worktree は残す。

## 本家の更新を取り込む

- 作業開始時に本家の更新を確認する。同期は短い間隔で小さく行う。
- `codex/sync/<slug>` を `fork/develop` から作り、`origin/main` を merge する。
- 競合は両方の意図を確認して解消する。特に AGENTS.md、README、CI、公開先、依存関係、保存形式は独自版の方針を再確認する。
- 分離環境で必要なテスト・UI 確認を行い、フォーク develop に同期 PR を出す。main に直接取り込まない。
- Actions の **Sync upstream** は手動実行でドラフト PR を作る。競合時は停止してブランチを公開しない。ログを確認して専用 worktree で解消する。
- 同期 Actions 内では、未レビューのマージ結果に含まれるスクリプト・ワークフローを実行しない。検査スクリプトも実行対象に含む。
- Actions の標準トークンで作った PR は通常の PR イベント CI が起動しない。まずエージェントがワークフロー・スクリプト・公開先・secret 参照を含む差分を確認する。その後、対象ブランチに `gh workflow run <workflow> --repo Sunwood-ai-labs/OpenMakiBot --ref <sync-branch>` を使い、`ci.yml` / `fork-policy.yml` / `docker.yml` / `docs.yml` を起動する。必要な検証を済ませて PR を ready にする。
- 本家に入った独自パッチは差分を照合する。squash・rebase・レビュー修正で SHA が異なる場合がある。SHA だけで削除・再適用を判断しない。

## 本家へ PR を出す

- 独自版 main / develop をそのまま本家 PR の head にしない。
- `origin/main` から `codex/pr/<slug>` を作り、対象コミットだけを `cherry-pick -x` するか、汎用部分を実装する。
- 本家にない独自依存を取り除き、本家ベースの専用 worktree で検証する。
- `git diff origin/main...HEAD` で独自ブランド・運用設定・無関係な機能が混ざっていないことを確認する。
- head は fork に push する。本家への公開はユーザーの依頼範囲内で行い、対象を明示する：
  `gh pr create --repo milind-soni/OpenMausBot --base main --head Sunwood-ai-labs:codex/pr/<slug>`。
- レビュー修正は独自版にも反映する。PR、元コミット、採用状況は [docs/fork/patches.md](docs/fork/patches.md) に記録する。

## 検証・コミット

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

- UI 変更には実際の before / after スクリーンショットを残す。
- 実装変更は CONTRIBUTING.md のテスト要件に従う。設定・文書だけの場合は関連する構造検証を行い、実施していない動作確認を成功と書かない。
- CI 失敗は自分の変更と既存・外部要因を区別する。必要なら同じ環境の変更前と比較し、必須チェックを黙って外さない。
- コミットは機能単位で、共通改善と独自仕様を分ける。タイトルは絵文字付きの英語、本文に変更理由・内容・検証を記す。
- 実行コマンド、検証結果、未解決事項を PR に残す。PR 本文にメモリ引用を入れない。

## ブランド・公開先

- リポジトリのブランドは OpenMakiBot。本家の著作者表示・LICENSE・NOTICE は維持する。
- 初期整備ではアプリ内部名、`OMB_*`、`.openmausbot`、CLI・パッケージ識別子は引き継ぐ。保存先や自動更新先の移行は専用機能として検証する。
- 本家向け Release / Prepare next release / npm package / Sync published release は、本家リポジトリのみ実行可能な条件を維持する。
- OpenMakiBot のバイナリ配布は、独自のアプリ識別子・署名・配布先・更新フィードの検証を済ませてから構築する。本家のダウンロードを独自版として案内しない。
- Docker の公開も独自配布の確認が済むまでフォークでは無効。ビルド検証は維持する。
- 本家同期時に新規公開ワークフローや旧 URL が入ったら、再度公開先を点検する。
- Actions のリポジトリ既定トークン権限は `read` を維持する。公開権限の検査はこの設定を前提とするため、設定変更時は検査方針も見直す。

More specific `AGENTS.md` files override this note within their directories.
