# GUI付きBotの制作・別GUI検証を再現する

このブランチは記事の再現用セットです。公式PR #849のPodman基盤に、Group/GoalのBot別GUI接続、Firefoxの`SYS_CHROOT`と検証ポリシー、日本語フォントを含む管理GUIイメージを加えています。既存アプリのデータとは別の`~/nekoneko-guide`、Composeプロジェクト`nekoneko-guide`、ポート29799・29800・29880を使います。

## 1. 準備

Windows x64、WSL2、Git、Podman、Z.ai Coding Planの利用可能なAPIキーが必要です。既存の`openmausbot` Podman machineを使い、未作成ならセットアップ時に作成します。machineの初期割当は4 CPU / 10 GiB / 60 GiB。2台のGUIに加えビルドと本体のメモリ・空きディスクを確保してください。WSL全体の制限も適用されます。

```powershell
# GitやPodmanが未導入の場合
winget install --exact --id Git.Git
winget install --exact --id RedHat.Podman
# WSL2が未設定の場合は wsl --install を実行し、必要に応じ再起動
```

PowerShellを開き直し、WSLからアクセスできるCドライブなどへcloneして、そのリポジトリ直下で以降のコマンドを実行します。

```powershell
git clone --branch codex/nekoneko-repro-guide --single-branch https://github.com/Sunwood-ai-labs/OpenMausBot.git OpenMausBot-nekoneko
cd OpenMausBot-nekoneko
```

## 2. ビルドして起動

```powershell
.\deploy\nekoneko\nekoneko.ps1 setup
.\deploy\nekoneko\nekoneko.ps1 up
```

初回はイメージ取得とソースビルドが走ります。`setup`は既存データを移行せず、記事専用の保存領域とマーカーを作ります。生成される`deploy/podman/.env.nekoneko`はGit管理対象外です。別machineを選ぶ場合は全コマンドへ同じ`-Machine NAME`を付けてください。

## 3. GLMを登録

```powershell
.\deploy\nekoneko\nekoneko.ps1 configure
.\deploy\nekoneko\nekoneko.ps1 check
```

`configure`の非表示入力欄へ自分のZ.ai Coding Plan APIキーを入力します。キーは引数やリポジトリへ保存せず、専用Linuxデータ領域へ保存します。本体再起動まで行います。`check`は実モデルへの短い有料リクエストを送り、成功時に`NEKONEKO_GLM_OK`と表示します。既存のBotが作業中なら設定変更を拒否します。

接続先とモデルの公式説明：

https://docs.z.ai/devpack/tool/claude

## 4. 3体のBotと2台のGUIを作成

```powershell
.\deploy\nekoneko\nekoneko.ps1 team
.\deploy\nekoneko\nekoneko.ps1 pair
```

`team`はGUIイメージを準備し、次を作成します。初回のGUI準備には大きなダウンロードが発生します。

- むぎ部長：GLM-5.3、PM、Computer off。
- そら工房長：GLM-5.3、制作担当、専用GUIとworkspace。
- きなこ探偵：GLM-5.3、検証担当、別のGUIとworkspace。

3体を「ネコネコインダストリー｜制作・検証室」へ登録し、PMを既定の応答者、ターン上限を20分に設定します。APIが返す実際のコンテナ名・保存先を`~/nekoneko-guide/nekoneko-team.json`へ保存するため、Bot IDやworkspaceパスを手で推測する必要はありません。

ブラウザで`http://localhost:29880`を開き、`pair`で発行したコードを入力します。元のアプリの8080番と区別してください。サイドバーのグループを開くと3体のBotが見えます。

`Review routine approvals`はOnです。Always allowの一括登録は行いません。アプリに承認カードが出た場合は、内容を読んで許可してください。必要に応じてそのツールを常時許可できますが、ツール・プログラム単位の範囲になります。

## 5. Goalで制作と検証を始める

```powershell
.\deploy\nekoneko\nekoneko.ps1 start
.\deploy\nekoneko\nekoneko.ps1 status
```

`start`は実際の保存先を含むGoalをグループへ送ります。そらが日本語の単一HTMLを制作し、自分のGUIで表示と操作を確認。次にきなこがHTMLを自分のworkspaceへコピーし、自分のGUIで検証。最後にむぎが結果をまとめます。架空の製品9点、社員猫3匹、カテゴリ切替、FAQを含む会社ページを指示します。外部への公開は指示していません。

`status`の`needs-user`相当や未回答カードがある場合はアプリの承認・質問を確認してください。Goalの完了と、個々の確認項目の成功を別々に見ます。制作と検証それぞれについて、ページ表示・カテゴリ切替・スクロールの実画像を確認し、コピーしたHTMLが一致するか確かめます。FAQ開閉まで成功した場合のみ、その項目を成功と扱います。モデルの回答や実行時間は毎回変わります。

## 6. 成果物を取り出す

```powershell
.\deploy\nekoneko\nekoneko.ps1 export
```

完了後に実行すると、リポジトリの`nekoneko-output/`へA/BのHTML・PNGとハッシュ一覧をコピーします。`sora/index.html`と`kinako/index.html`をブラウザで開けます。PNGはBotが実際に保存したものです。スクショが足りなければ、グループから担当者へ追加撮影を依頼して、完了後に再度exportしてください。認証ファイルや会話全体はexport対象に含めません。

元の実験の猫壁紙はこの記事の装飾です。この再現セットでは管理GUIの標準壁紙を使い、Bot名・別コンテナ・保存先・実操作で分離を確認します。

## 7. 停止・再開

Goalと各担当が止まったことを確認してから停止します。

```powershell
.\deploy\nekoneko\nekoneko.ps1 stop
```

この記事で作ったGUIだけを停止し、その後アプリを止めます。元のアプリのBotやデータは対象にしません。

```powershell
.\deploy\nekoneko\nekoneko.ps1 up
.\deploy\nekoneko\nekoneko.ps1 team
```

再開時の`team`は保存したBotとGroupを再利用し、停止した管理GUIをworkspaceを保持して再作成します。日本語フォントは管理イメージへ組み込んでいるため再作成でも残ります。稼働中のGoalがあると再設定を拒否します。

## 不具合と確認範囲

元の実験で見つかった不具合の報告：

https://github.com/milind-soni/OpenMausBot/issues/430#issuecomment-5559666871

https://github.com/milind-soni/OpenMausBot/issues/853

https://github.com/milind-soni/OpenMausBot/issues/854

このブランチの修正・導入補助を使用してください。公式mainやPR #849の提出時コミットだけへ手順を置き換えると、追加修正が欠けます。サーバーとGUIの検証方針は`docs/verification/README.md`に従い、稼働中のユーザーデータではなく隔離した環境で確認します。

独立レビューで実行したテストと確認範囲は[VALIDATION.md](VALIDATION.md)に記録しています。
