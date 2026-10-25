# LINEからChief of Staffに相談する

このリレーを使うと、LINEの個人トークから指定したChief of Staffの専用タスクにテキストを送り、処理後の回答をLINEで受け取れます。成功した回答に、その依頼と同じturnで添付されたJPEGまたはPNG画像があれば、画像もLINEへ返信できます。リレーは別プロセスとして動き、アプリのHTTPポートには手を加えません。

共有サーバーでは、LINEのやり取りも共有ボットの会話履歴として保存されます。アプリ内の個人アカウントへの帰属は付けません。

対象はヘッドレスのセルフホスト環境です。デスクトップアプリ管理下のサーバーでは使えません。LINE利用者、Chief bot、スレッドはそれぞれ1つだけ指定します。受信側はテキストメッセージのみ処理し、グループ・画像メッセージ・登録していない利用者からのメッセージは処理しません。返信側で送れる画像はJPEGとPNGです。動画や他の添付形式は送信しません。

## 準備

1. LINE Official Accountを作成し、LINE Official Account ManagerでMessaging APIを有効にします。チャネルは自動で作成されるため、LINE Developers ConsoleでChannel secretとChannel access tokenを確認します。シークレット保管先に保存し、Webhookを有効にしてください。Official Accountを自分のLINEアカウントで友だち追加します。
2. OpenMakiBotで、表示中のChief botにLINE専用タスクを作ります。既定の承認モードは **Ask** です。**Full** を使う場合は、専用タスクをOpenMakiBotでFullに設定し、リレーの`OMB_LINE_APPROVAL_MODE`にも`full`を指定してください。設定とタスクのモードが一致しない場合、リレーは起動しません。リレーはタスクの権限を変更せず、承認カードにも回答しません。
3. 次のIDを確認します。
   - `OMB_LINE_USER_ID`: LINE Developers Consoleのチャネル「Basic settings」に表示される、利用者本人のUser ID。`U`と32桁の16進数で構成されます。LINE IDや表示名ではありません。User IDが表示されない場合は、Business IDとLINEアカウントを連携します。別の人を登録する場合は、その人からOfficial AccountへのWebhookイベントに含まれる`source.userId`を、信頼できる管理経路で確認してください。
   - `OMB_LINE_BOT_ID`と`OMB_LINE_THREAD_ID`: ローカルのアプリから`GET /api/bots?messages=0`を読み、Chief botとその専用タスクのIDを確認します。APIはローカルの管理用です。公開プロキシに追加しないでください。
4. アプリとリレーを同じネットワーク名前空間で動かします。Podmanでは同じPod、または同じVM内のhostネットワークを使います。ホストからコンテナへポート転送しただけの接続では、loopbackの権限確認を通過できません。
5. 画像返信を使う場合は、外部から到達できる固定HTTPSオリジンを`OMB_LINE_PUBLIC_ORIGIN`に設定し、そのオリジンの`/line/media/<capability>/(original|preview)`をリレーへ転送します。オリジンのパスやクエリは設定せず、アプリの`/api`は公開しません。画像返信を使わない場合は、この設定を省略できます。

## 起動

OpenMakiBotのチェックアウトから起動し、アプリと同じ実行ユーザー・ネットワーク名前空間で動かします。`OMB_LINE_CHANNEL_SECRET`と`OMB_LINE_CHANNEL_ACCESS_TOKEN`は、シェル履歴やチャットへ値を貼らず、既存のシークレット保管先から読み込んでください。

ソースを含まないNode 24以上のコンテナーで起動する場合は、チェックアウトから単体ファイルを作り、コンテナーへ読み取り専用でmountします。リレーはアプリと同じ実行ユーザー・ネットワーク名前空間で動かします。

```sh
pnpm build:line-relay
```

コンテナー内では、mountしたファイルをNodeで起動します。

```sh
node /opt/openmakibot-line/line-relay.mjs
```

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
# 画像返信を使う場合だけ、Caddyで/line/mediaをリレーへ転送する公開HTTPSオリジンを指定します。
export OMB_LINE_PUBLIC_ORIGIN=https://your-host.example:10000
# シークレットファイルのパスは環境に合わせてください。
export OMB_LINE_CHANNEL_SECRET="$(cat /run/secrets/line-channel-secret)"
export OMB_LINE_CHANNEL_ACCESS_TOKEN="$(cat /run/secrets/line-channel-access-token)"
# 任意。既定値は8765
export OMB_LINE_RELAY_PORT=8765
# 任意。既定値はaskです。Fullに設定した専用タスクを使う場合だけfullを指定します。
# export OMB_LINE_APPROVAL_MODE=full
pnpm line-relay
```

`OMB_LINE_APP_URL`はループバックのHTTPオリジンだけを受け付けます。リレーは`127.0.0.1`にだけbindし、`GET /health`で稼働状態を確認できます。アプリのURLまたは設定のIDを変える場合は、新しいstateファイルを用意してください。既存ファイルは元のアプリ、LINE利用者、bot、threadに固定されます。画像返信を有効にすると、リレーはstateファイルと同じ場所に`<state-path>.media`の非公開画像キャッシュを作ります。両方を再起動後も使えるよう、同じ永続ボリュームに保存してください。

Flex形式または画像URLを記録した未完了の送信データがある間は、古いリレーバイナリへ戻さないでください。古い版はその形式を読み込めません。戻す前に`GET /health`の`queued`が`0`であることを確認してください。画像URLはリトライ時にも同じ内容で保たれます。`OMB_LINE_PUBLIC_ORIGIN`を変更する場合も、画像付きoutboxを空にしてから切り替えてください。リレーは保留中のURLを書き換えず、設定と一致しない送信を止めます。

LINE Developers ConsoleのWebhook URLは、公開HTTPS URLにします。Caddyがアプリ・リレーと同じネットワーク名前空間にある構成なら、たとえば次のように**このパスだけ**をリレーへ転送します。既存のアプリ用ハンドラーより前に置きます。

```caddyfile
@lineWebhook path /line/webhook
handle @lineWebhook {
	rewrite * /webhook
	reverse_proxy 127.0.0.1:8765
}

@lineMedia path_regexp lineMedia ^/line/media/[A-Za-z0-9_-]{43}/(original|preview)$
handle @lineMedia {
	reverse_proxy 127.0.0.1:8765
}
```

Webhook URLは`https://your-host.example:10000/line/webhook`です。画像返信を使う場合は、`OMB_LINE_PUBLIC_ORIGIN`を同じホストとポートにします。`/line/media`はGET専用で、能力トークンと画像の種類が一致するURLだけを応答します。`/api`、`/health`、他のアプリ内部ルートは公開リレーへ転送しないでください。既存のアプリ画面を公開する場合も、今の認証・プロキシ制御を維持します。汎用の`/hooks/*`処理には接続しません。

## 動作と承認

- Webhook署名を検証してから本文を解析し、イベントIDで重複を抑止します。受信イベントは永続化後にWebhookへ成功応答します。
- 受信文は指定済みのChiefタスクに、既存のguarded API経由で送ります。スレッドの状態が変わった場合やタスクが実行中の場合は、別の会話へ送らず再確認または安全な失敗にします。
- リレーは`OMB_LINE_APPROVAL_MODE`の値をguarded APIへ渡します。既定値は`ask`です。設定したモードと専用タスクのモードが一致しない場合、リレーは起動を拒否します。
- 表形式の回答は縦型Flexカードに変換します。列見出しと値、表の前後にある文章を残します。変換できない表は元のテキストで送ります。
- 成功を確認した依頼と同じrequest/turnに紐づく画像だけを返信します。原画像はJPEG/PNGの10 MB以下で、各辺16,384画素・全体4,000万画素以下に限ります。プレビューはPNGの1 MB以下です。画像はランダムな能力URLで公開され、URLの保存内容と再送キーは再起動後も変えません。画像を確認できない場合や公開オリジンがない場合は、テキスト回答と添付を送れなかった旨を返し、手動確認が必要な状態にします。
- 画像キャッシュは512 MiBまでです。送信待ちの画像URLは24時間以上、送信に使ったURLは30日以上保持します。期限切れ・未参照ファイルはリレーが整理します。キャッシュ容量が足りない場合は、送信済みの画像を早期削除せず、新しい画像返信を手動確認にします。
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
