# MEIRO v1 モノレポ概要

MEIRO v1 プロジェクトは `pnpm` を利用したモノレポ構成です。主要なパッケージは次のとおりです。

- `client/`：React + Phaser クライアント実装。Vite を用いたフロントエンド開発環境を提供します。
- `server/`：Cloudflare Workers + Durable Objects ベースのゲームサーバ実装です。
- `packages/common/`：クライアント/サーバ間で共有する型やユーティリティを格納します。

## セットアップ

```bash
pnpm install
```

## よく使うコマンド

- `pnpm --filter @meiro/client dev`：クライアントの開発サーバを起動
- `pnpm --filter @meiro/server dev`：Workers ランタイムでサーバを起動
- `pnpm test`：ワークスペース全体のテストを実行

## ディレクトリ構成

```
.
├── client/           # クライアントアプリケーション（React + Phaser）
├── server/           # サーバアプリケーション（Cloudflare Workers + DO）
├── packages/common/  # 共有型定義・ユーティリティ
├── prompt_spec.md    # 開発仕様書
└── todo.md           # 実装チェックリスト
```

各パッケージは `pnpm-workspace.yaml` で管理され、共通のリンター/フォーマッター/テスト設定を共有しています。

## ライセンス

本リポジトリは MIT License で提供されます。詳細は `LICENSE` と `NOTICE` を参照してください。
