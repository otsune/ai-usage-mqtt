# AI Usage MQTT

AIサービスのusageを収集・保存し、HTTPとMQTTで提供する独立ソフトウェアです。Mosquittoの起動・ACL設定を同梱します。Fire Dashboard、天気、RSS、Reactは不要です。表示機器はHTTP／MQTT契約を通じて接続します。

対応収集元: Claude、Codex、Antigravity、OpenCode Go、Hermes / Nous、Grok。アカウント資格情報は収集元PCに置き、母艦には表示用の数値だけを送ります。

## 単独で起動する

Linux、Node.js 24推奨、Docker Composeを用意します。ブローカーとAPIはloopback限定です。既に1883／9001／8788を使っている場合は、初期化前に別ポートを指定してください。

```sh
npm ci
npm run build
USAGE_PUBLIC_ORIGIN=https://usage.example.net npm run init
docker compose up --build -d
```

`npm run init` は `.runtime/` と `.env` を新規作成し、既存設定があれば上書きせず終了します。publisherパスワード、collector token、reader tokenは別々に生成し、秘密をコンソールへ出しません。`.runtime/collectors/desk.token` は収集元PC用、`.runtime/reader.token` はHTTP reader用です。broker passwordはMosquittoのツールでハッシュ化します。

Podmanでは `npm run init -- --runtime podman` を使えます。Compose実行環境は別途必要です。起動時は `podman compose -f compose.yaml -f compose.podman.yaml up --build -d` とし、所有者のUID対応を維持します。HTTPS／VPNの入口は運用環境で用意し、匿名WS listenerをLANやインターネットへ直接公開しないでください。`USAGE_PUBLIC_ORIGIN` は利用画面の正確なHTTPS originです。

## Node.jsで起動する

HTTPだけの検証ではbrokerを省略できます。

```sh
npm run init -- --no-broker
node --env-file=.runtime/native.env dist/usage/start.mjs
```

既存brokerを使う場合は `.runtime/config/native.json` のMQTT設定を変更します。native Mosquittoのpasswordツールを使った初期化は `npm run init -- --runtime native`。その設定ファイルに書かれた `/mosquitto/config` と `/mosquitto/data` はcontainer内パスなので、native brokerとして使う場合は実配置に置き換えてください。systemd user unitの例は `deploy/ai-usage.service` です。

## 他の表示機器で使う

| 接続 | 契約 |
| --- | --- |
| collector | `POST /api/v1/usage`、source専用Bearer |
| HTTP reader | `GET /api/v1/usage`、reader専用Bearer |
| MQTT | `ai-usage/v1/main/usage/state`、`heartbeat`、`availability` |
| browser | 認証付きWSS `/api/v1/usage/stream`、MQTT v3.1.1 clean session |

`state` はQoS1・retain、`heartbeat` は60秒間隔。streamIdが変わったらHTTPで照合し、同じstreamIdのrevisionを整数として比較します。完全なJSON契約・権限・移行手順は [usage-service](docs/usage-service.md)。

Fire Dashboardもこの契約を使うクライアントです。既存Fireの移行ではトピックを `fire-dashboard/v1/main` のまま設定すると購読を維持できます。旧stateの移行は `dist/usage/migrate.mjs` を使い、受信を止めてから実施してください。同一トピックにpublisherを二重起動しません。

収集器の設定変数 `FIRE_ENDPOINT`／`FIRE_COLLECTOR_TOKEN_FILE` などは旧版との互換名として残っています。Fireを起動する必要はなく、endpointを本ソフトウェアのHTTPS入口に向けます。API本体には `FIRE_*` を渡さず、`USAGE_*` を使います。[収集器](docs/collectors.md)・[provider別の取得範囲](docs/provider-usage.md)。

## 開発・検証

```sh
npm ci
npm run typecheck
npm test
npm run check:separation
npm run build
```

成果物の `dist/usage`／`dist/collectors` はNodeで実行でき、実行先のnode_modulesは不要です。テストはFireの実装を参照しません。プロバイダーによって実取得の検証範囲が異なります。Grokのprotobuf parserは合成fixtureの検証で、実アカウント全体の互換性を保証するものではありません。

ライセンスは[Unlicense](LICENSE)。切り出し元は[PROVENANCE](PROVENANCE.md)に記録しています。
