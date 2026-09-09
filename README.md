# OpenMakiBot

**本家の進化を取り込みながら、自分たちの AI エージェント環境を育てる。**

OpenMakiBot is an independently maintained fork of [OpenMausBot](https://github.com/milind-soni/OpenMausBot), originally created by Milind Soni and its contributors.

本家の更新を継続的に取り込み、独自機能を自分たちのタイミングで採用します。
汎用的な改善は本家へ PR し、そのマージを待たずに独自版の開発を進めます。

## 🌿 開発とリリース

| 系列 | 役割 |
| --- | --- |
| [main](https://github.com/Sunwood-ai-labs/OpenMakiBot/tree/main) | 独自版の安定系列・デフォルトブランチ |
| [develop](https://github.com/Sunwood-ai-labs/OpenMakiBot/tree/develop) | 次の独自版へ向けた開発・統合 |
| 本家 main | 同期 PR を通して develop へ取り込む |

機能開発 → develop → release → main。緊急修正は main から作り、develop にも戻します。
本家への PR は本家 main を基準に作り、独自版の変更全体を送らない運用です。

- [エージェントの運用規約](AGENTS.md)
- [開発環境と貢献手順](CONTRIBUTING.md)
- [独自変更と本家 PR の管理](docs/fork/patches.md)
- [分離環境での検証](docs/verification/README.md)

## 🛠️ 開発を始める

Node.js 24 以上と、package.json 指定の pnpm を使います。

```sh
git clone -o fork https://github.com/Sunwood-ai-labs/OpenMakiBot.git
cd OpenMakiBot
git remote add origin https://github.com/milind-soni/OpenMausBot.git
git config remote.pushDefault fork
git fetch origin
git switch --track fork/develop
pnpm install --frozen-lockfile
```

実装は develop から専用ブランチ・worktree を作って進めます。
アプリ起動やテストの手順は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## 📦 現在の配布範囲

この初期整備はリポジトリ名・開発運用の独立化です。
アプリ内の表示名、CLI、環境変数、データ保存先には OpenMausBot の識別子が残っています。
既存のデータを移動・変換する変更は含みません。

OpenMakiBot 独自のインストーラーと自動更新フィードはまだ提供していません。
本家向けのリリース・npm 公開・更新ミラー・Docker 公開は、このフォークでは実行しません。
バイナリ配布は独自の識別子・署名・更新先を検証してから整備します。

既存のローカル機能開発は、機能ごとの検証後に develop へ採用します。
本家の機能・歴史的な説明は [保存した本家 README](README.upstream.md) を参照してください。
そこにあるダウンロードは OpenMausBot の配布物です。

## 🤝 派生元とライセンス

[OpenMausBot](https://github.com/milind-soni/OpenMausBot) と、その作者・貢献者に感謝します。
OpenMakiBot は独立した派生プロジェクトです。元の著作権表示と [Apache-2.0 LICENSE](LICENSE) を維持します。
