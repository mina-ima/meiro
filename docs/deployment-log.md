# Cloudflare Workers 本番デプロイ記録

## 2024-05-20 本番公開（初回）

- WebSocket エンドポイント: `wss://game.meiro.example.com/ws`
- 接続確認ログ

```
2024-05-20T12:45:02Z [client] WebSocket open -> wss://game.meiro.example.com/ws (101 Switching Protocols)
2024-05-20T12:45:03Z [worker] GET /ws 101 Switching Protocols - cf-ray 6ff8a9f93d9b123a
```

- 備考: Cloudflare Workers 側で `env.prod` を使用。Durable Object マイグレーション `room-instance-v1` を適用済み。

## 2024-05-21 Vercel プロジェクト初期構成

- Vercel プロジェクトを作成し、`client` ディレクトリをルートに設定。
- Build Command: `pnpm --filter @meiro/client build`
- Output Directory: `client/dist`
- 出力確認: `client/dist/index.html` と `client/dist/assets/` 配下のバンドルが生成され、Preview デプロイのビルドログでも `Ready!` を確認。
- 備考: ビルドは `pnpm install --frozen-lockfile` → `pnpm --filter @meiro/client build` の順に実行。Vercel ダッシュボード上でも同設定を再現済み。

## 2024-05-22 Vercel 環境変数設定

- Vercel ダッシュボードで Production 用環境変数 `VITE_WS_URL` に `wss://game.meiro.example.com/ws` を設定。
- Vercel ダッシュボードで Preview 用環境変数 `VITE_WS_URL` に `wss://preview.meiro.example.com/ws` を設定。
- `vercel env ls` で Production/Preview 双方に `VITE_WS_URL` が表示されることを確認。
