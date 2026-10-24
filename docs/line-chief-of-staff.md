# LINEからChief of Staffに相談する

このリレーを使うと、LINEの個人トークから、指定したChief of Staffの専用タスクにテキストを送り、処理後の回答をLINEで受け取れます。別プロセスとして動き、アプリのHTTPポートには手を加えません。

対象はヘッドレスのセルフホスト環境です。デスクトップアプリ管理下のサーバーでは使えません。LINE利用者、Chief bot、スレッドはそれぞれ1つだけ指定します。グループ、画像などの非テキスト、登録していない利用者からのメッセージは処理しません。

## 準備

1. LINE Official Accountを作成し、LINE Official Account ManagerでMessaging APIを有効にします。チャネルは自動で作成されるため、LINE Developers ConsoleでChannel secretとChannel access tokenを確認します。シークレット保管先に保存し、Webhookを有効にしてください。Official Accountを自分のLINEアカウントで友だち追加します。
2. OpenMakiBotで、表示中のChief botに専用タスクを作ります。承認モードは **Ask** にします。既存のタスクを人と共有せず、このタスクをLINE専用にしてください。リレーはタスクの作成や権限変更をしません。
3. 次のIDを確認します。
   - `OMB_LINE_USER_ID`: LINE Developers Consoleのチャネル「Basic settings」に表示される、利用者本人のUser ID。`U`と32桁の16進数で構成されます。LINE IDや表示名ではありません。User IDが表示されない場合は、Business IDとLINEアカウントを連携します。別の人を登録する場合は、その人からOfficial AccountへのWebhookイベントに含まれる`source.userId`を、信頼できる管理経路で確認してください。
   - `OMB_LINE_BOT_ID`と`OMB_LINE_THREAD_ID`: ローカルのアプリから`GET /api/bots?messages=0`を読み、Chief botとその専用タスクのIDを確認します。APIはローカルの管理用です。公開プロキシに追加しないでください。
4. アプリとリレーを同じネットワーク名前空間で動かします。Podmanでは同じPod内に配置してください。ホストからコンテナへポート転送しただけの接続では、loopbackの権限確認を通過できません。

## 起動

OpenMakiBotのチェックアウトから起動し、アプリと同じ実行ユーザー・ネットワーク名前空間で動かします。`OMB_LINE_CHANNEL_SECRET`と`OMB_LINE_CHANNEL_ACCESS_TOKEN`は、シェル履歴やチャットへ値を貼らず、既存のシークレット保管先から読み込んでください。

```sh
umask 077
install -d -m 700 /var/lib/openmausbot-line
export OMB_LINE_APP_URL=http://127.0.0.1:8799
read -r -p 'LINE user ID: ' OMB_LINE_USER_ID
export OMB_LINE_USER_ID
read -r -p 'Chief bot ID: ' OMB_LINE_BOT_ID
export OMB_LINE_BOT_ID
read -r -p 'Dedicated thread ID: ' OMB_LINE_THREAD_ID
export OMB_LINE_THREAD_ID
export OMB_LINE_STATE_PATH=/var/lib/openmausbot-line/state.json
# シークレットファイルのパスは環境に合わせてください。
export OMB_LINE_CHANNEL_SECRET="$(cat /run/secrets/line-channel-secret)"
export OMB_LINE_CHANNEL_ACCESS_TOKEN="$(cat /run/secrets/line-channel-access-token)"
# 任意。既定値は8765
export OMB_LINE_RELAY_PORT=8765
pnpm line-relay
```

`OMB_LINE_APP_URL`はループバックのHTTPオリジンだけを受け付けます。リレーは`127.0.0.1`にだけbindし、`GET /health`で稼働状態を確認できます。設定のIDやURLを変える場合は、新しいstateファイルを用意してください。既存ファイルは元のアプリ、LINE利用者、bot、threadに固定されます。リレーはstateファイルを再起動後も使うため、永続ボリュームへ保存してください。

LINE Developers ConsoleのWebhook URLは、公開HTTPS URLにします。Caddyがアプリ・リレーと同じネットワーク名前空間にある構成なら、たとえば次のように**このパスだけ**をリレーへ転送します。既存のアプリ用ハンドラーより前に置きます。

```caddyfile
@line path /line/webhook
handle @line {
	rewrite * /webhook
	reverse_proxy 127.0.0.1:8765
}
```

Webhook URLは`https://your-host.example/line/webhook`です。`/api`、`/health`、他のアプリ内部ルートは公開リレーへ転送しないでください。既存のアプリ画面を公開する場合も、今の認証・プロキシ制御を維持します。汎用の`/hooks/*`処理には接続しません。

## 動作と承認

- Webhook署名を検証してから本文を解析し、イベントIDで重複を抑止します。受信イベントは永続化後にWebhookへ成功応答します。
- 受信文は指定済みのChiefタスクに、既存のguarded API経由で送ります。スレッドの状態が変わった場合やタスクが実行中の場合は、別の会話へ送らず再確認または安全な失敗にします。
- ChiefがLINE外の承認・質問・接続待ちで止まった場合、カードや秘密情報はLINEへ送りません。OpenMakiBotで内容を確認し、そこで操作してください。リレーが承認を行うことはありません。
- 長い回答はLINEのテキスト上限に合わせて分割し、Push APIで送ります。Push送信はLINE Official Accountの月間送信枠・料金対象です。送信先のプランと残量は[LINE公式の料金案内](https://developers.line.biz/en/docs/messaging-api/pricing/)で確認してください。再送には[LINEのretry key](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)を使います。
- Channel secretとChannel access tokenはチャットへ貼らず、シェル履歴にも残さないでください。stateには未完了イベントの本文が保存されるので、所有者のみ読めるディレクトリへ置き、バックアップも同じ扱いにしてください。

このリレーは同じOSユーザーやネットワーク名前空間で動く他プロセスやbot shellに対する新しい隔離境界ではありません。LINEの許可ユーザー、アプリ、リレーを信頼できる同じ管理領域で運用してください。

## LINE公式資料

- [Messaging APIを始める](https://developers.line.biz/en/docs/messaging-api/getting-started/)
- [Webhookでメッセージを受け取る](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [LINE User IDを確認する](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)
- [Pushメッセージを送る](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
- [テキストの文字数](https://developers.line.biz/en/docs/messaging-api/text-character-count/)
