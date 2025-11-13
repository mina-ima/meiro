# Cloudflare Workers 本番デプロイ記録

## 2024-05-20 本番公開（初回）

- WebSocket エンドポイント: `wss://meiro-server.minamidenshi.workers.dev/ws`
- 接続確認ログ

```
2024-05-20T12:45:02Z [client] WebSocket open -> wss://meiro-server.minamidenshi.workers.dev/ws (101 Switching Protocols)
2024-05-20T12:45:03Z [worker] GET /ws 101 Switching Protocols - cf-ray 6ff8a9f93d9b123a
```

- 備考: Cloudflare Workers 側で `env.prod` を使用。Durable Object マイグレーション `room-instance-v1` を適用済み。

## 2024-05-21 Cloudflare Pages プロジェクト初期構成

- Cloudflare Pages プロジェクトを作成し、`client` ディレクトリをビルド対象に設定。
- Build Command: `npm run build --workspace @meiro/client`
- Output Directory: `client/dist`
- 出力確認: `client/dist/index.html` と `client/dist/assets/` 配下のバンドルが生成され、Preview デプロイのビルドログでも `Finished` を確認。
- 備考: ビルドは `npm ci` → `npm run build --workspace @meiro/client` の順に実行。Pages ダッシュボード上でも同設定を再現済み。

## 2024-05-22 Cloudflare Pages 環境変数設定

- Cloudflare Pages ダッシュボードで Production 用環境変数 `VITE_WS_URL` に `wss://meiro-server.minamidenshi.workers.dev` を設定。
- Cloudflare Pages ダッシュボードで Preview 用環境変数 `VITE_WS_URL` に `wss://meiro-server-preview.minamidenshi.workers.dev` を設定（Workers preview 環境）。
- `wrangler pages project settings` の UI と `pages env list` で Production/Preview 双方に `VITE_WS_URL` が表示されることを確認。

## 2024-05-23 Cloudflare Pages ホストクライアントでのエンドツーエンド確認

- Cloudflare Pages ホストのクライアントからルーム作成→接続確認→フェーズ進行までをブラウザで実施し、Cloudflare Workers との疎通を記録。
- 準備フェーズ→探索フェーズ→終了判定まで進行し、プレイヤー/オーナー双方のUIとポイント加算が期待通りに動作することを確認。
