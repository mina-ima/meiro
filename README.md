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

## CI

- `.github/workflows/ci.yml` で `main` への push・pull request をトリガーに自動実行。
- フォーマットチェック（`pnpm -r exec prettier --check "**/*.{ts,tsx,js,jsx,md,json}"`）、Lint、Typecheck、テストを順番に実行します。
- ワークフローは Node.js 20 + pnpm 9 を使用し、`pnpm install --frozen-lockfile` で依存関係を固定します。

## リリースフロー

1. `CHANGELOG.md` の `Unreleased` セクションに変更内容を追記し、必要に応じてバージョン節を確定します。
2. `pnpm format && pnpm lint && pnpm typecheck && pnpm test` を実行して品質チェックを通します。
3. リリースバージョンを決定し、例として `1.1.0` を出す場合は `git tag -a v1.1.0 -m "v1.1.0"` を作成します。
4. `git push origin main --tags` でタグとブランチをリモートへ送信します。
5. GitHub のリリースノートに `CHANGELOG.md` の該当節を転載し、必要なアセットを添付します。

> 補足: プレビューデプロイは PR 作成時に自動実行されるため、本番リリース前に `Deploy Preview` ワークフローの結果を確認してください。
