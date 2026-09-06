# 再現セットの独立検証

2026-09-06に、公式main `6aa058ebbea9e6c5f6d715ab459bb0e0cd91a9ed`を基準とする本ブランチで確認しました。Windows x64、WSL2、rootless Podman 5.8.3、管理GUI `driver-0.20.0-v5`の環境です。

## 実行して確認したこと

- `container-computer.test.ts`、`control-omb.test.ts`、`group-goal-run.e2e.test.ts`、`local-vm-lease.test.ts`：4ファイル、75テスト成功。
- サーバーのTypeScript検査、ビルド、バンドル：成功。
- Noto Sans CJK JPをchecksum固定で含むv5管理GUIイメージのビルド：成功。
- `scripts/verify-group-vm.ts`：一時データとfake engineを使う隔離サーバーに、実Podman GUIを2台作成。Goalの発言者A/Bへ異なるコンテナを指すcomputer MCPが渡り、両ターンがsettledとなることを確認。`computer: off`の発言者には接続が渡らないことも確認。
- `scripts/verify-podman-firefox.ts`：同じv5イメージで能力を比較。`SYS_CHROOT`なしでは`chroot: EPERM`と画像生成失敗を再現。追加後はFirefox終了コード0とPNG実データを確認。ブラウザのサンドボックスは有効のまま。
- 上記fixtureのGUIコンテナ4台と一時サーバーの終了・撤去を確認。
- `node --test deploy/nekoneko/team.test.mjs`：4テスト成功。領域判定、専用マーカー、loopback、未完成チーム、停止済みGUI、HTML/PNG限定exportとハッシュを確認。
- `configure.mjs`と`team.mjs`のNode構文検査、`nekoneko.ps1`のPowerShell構文解析：成功。

## 検証の境界

Groupのfixtureは接続先とターン終了の検証です。Firefoxのfixtureはheadless画像生成の検証です。実GLMによる制作・クリック・スクロール・ファイル受け渡しの成功は、それぞれの実タスクで画面と成果物を確認してください。

独立レビュー担当は、この再現セットの3体GLM Goalの最終完了、Windowsへの実export、停止からの再開を通した操作を実施していません。GUIイメージへのフォント組込みは確認しましたが、本文・タブ・XFCEタイトルバー・パネルの全てについて日本語欠字が解消したとの視認判定も行っていません。

別の新規Podman machineではWSLユーザーbusの資源エラーが発生したため、記事の既定経路は既存`openmausbot` machineと専用データ・Composeプロジェクト・ポートを使います。新しいWindows端末、ARM64、native Linuxでの一式構築は、この検証範囲に含みません。

認証情報、会話履歴、fixtureの生JSONや一時パスはこの文書に含めていません。`docs/verification/evidence/`と`.omb-scratch/`は公開用成果物の対象外です。
