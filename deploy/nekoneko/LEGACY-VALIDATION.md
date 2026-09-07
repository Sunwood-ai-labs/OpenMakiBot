# 再現セットの検証記録

対象は公式main `6aa058ebbea9e6c5f6d715ab459bb0e0cd91a9ed`を土台にした実験用ブランチです。PR #855/#856/#857の必要差分を移植し、記事用セットアップを追加しています。公式v0.1.61を動かす本体環境とは別です。

検証環境：Windows x64、既存WSL2 Podman machine、rootless Podman 5.8.3、Claude Code 2.1.263、GLM-5.3。新規Windows端末とARM64は対象外です。

## コードと独立レビュー

- 2026-09-07：関連5ファイル96テスト成功（container-computer、group-local-vm.e2e、local-vm-lease、group-goal-run、group-goal-run.e2e）。
- Node helper 11テスト成功。非既定モデル・APIポート・endpoint・timeout、HOME外データ拒否、symlink拒否、Bot再作成時のGroup ID同期、HTML/PNG限定exportとSHA-256を検証。
- PowerShell構文解析、サーバー型検査・ビルド・バンドル成功。
- 2名のサブエージェントが実装と読者手順を独立レビュー。exportのhealthy待ち、既存Group同期、設定保存先境界の指摘を修正。
- Windowsでテスト用CLIの改行がCRLFになるのを防ぐため、`.gitattributes`に対象ファイルのLFを指定。

## Podman GUI実機検証

- 記事専用image namespace `localhost/openmausbot-nekoneko/cua-local-vm:driver-0.20.0-v5`を使用。
- Group fixtureで実GUIを2台作り、発言Bot別の接続先、Computer off、終了時の権限失効を検証。
- Firefoxの実画像生成と実効content sandbox level 6を確認。disabledの対照では0を検出。
- Noto Sans CJK JPとライセンスをchecksum固定でイメージへ組込み。再作成した2台で本文・タブ・XFCEタイトルバー・パネルを目視確認。
- fixture GUI6台を終了・撤去。既存本体のGUI image tagは変更していません。

## 実GLM制作の初回確認

空の専用データに3体を作成して、PM→そら制作→きなこの別GUI検証を実行しました。

- A/Bとも17,789byteのHTML。SHA-256は `4980f54f265bd1db125ed4b9e12076ad595ec5f923e29f44c0012d44197e4112` で一致。
- そら7 PNG、きなこ10 PNGを保存。WindowsへHTML2点を含む19ファイルを実export。
- 両者のGUIでカテゴリ切替とFAQ開→閉を画像確認。FAQはEnterで操作。マウスクリック成功とは扱っていません。
- PMの最終JSONの閉じ引用符と波括弧が欠落し、初回Goalはblocked。成果物の成功とGoal状態を区別しています。
- 完全なJSON例と短いdetailをPM指示へ追加。不正JSONを成功へ読み替えるparser変更はありません。

## 公開コードからの別clone確認

公開候補 `ed22f6df` をGitHubから別フォルダへ取得。project・data root・3ポートを非既定値に変更してsetup/build/upを実行しました。healthy、GLM実接続、3 Bot作成、2 GUI ready、壁紙自動適用まで確認しています。

公開cloneの新規Goalも正式completed。6ターン、約48分14秒。途中の20分timeout後、同じGoalで継続しました。A/BのHTMLは18,005byte、SHA-256 `b38ebadf840a9e02f28943d744489100eb3312c5857ce31368c25bb27c76f310` で一致。各Botが自身のGUIでカテゴリ切替・FAQ開閉を確認し、3枚ずつPNGを保存しました。他カテゴリ3ボタンと残りFAQ4問の個別操作は検証範囲外です。

## Goal再確認と停止・再開

既存制作環境でreviewを実行し、PMがA/BのHTMLと17PNGを読取確認。Goalカードは正式にcompleted、全Bot idle、未回答カードなしとなりました。

続けてexport→stop→stop→up（ソースビルド）→team→exportを実行。2HTMLと17PNG、全19ファイルのSHA-256が停止前後で一致しました。保存済みBot/Groupとworkspaceを保ってGUIが再作成され、壁紙も再適用されました。

## 画面とデータ

アプリをpairコマンドのコードで接続し、各Botの「Bot’s computer」からLocal VMと壁紙画面を確認しました。グループ共有Computerパネルの完成を意味しません。

会話生データ、認証ファイル、署名付き画像URL、VNC接続資格情報は公開しません。exportはHTMLとPNG、ハッシュ一覧に限定しています。`.omb-scratch/`と`docs/verification/evidence/`の生JSONは公開対象外です。

強制終了後の古いdata leaseが起動を妨げる場合は、所有確認を要します。未知のleaseを自動削除する機能は追加していません。
