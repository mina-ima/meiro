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

## ブランチ戦略

- `main`：デプロイ可能な安定ブランチ。常に最新の検証済みビルドを保持します。
- 開発作業は `feature/<概要>` ブランチで行い、完了後に Pull Request を通じて `main` へマージします。
- バグ修正は `fix/<概要>` ブランチで行い、緊急対応が必要な場合でも PR を経由して `main` に取り込みます。
- PR 作成時は `pnpm format && pnpm lint && pnpm typecheck && pnpm test` の実行結果を添付し、レビュー後に squash merge します。
