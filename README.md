# MEIRO v1 モノレポ概要

MEIRO v1 プロジェクトは `pnpm` を利用したモノレポ構成です。主要なパッケージは次のとおりです。

- `client/`：React + Phaser クライアント実装。Vite を用いたフロントエンド開発環境を提供します。
- `server/`：Cloudflare Workers + Durable Objects ベースのゲームサーバ実装です。
- `packages/common/`：クライアント/サーバ間で共有する型やユーティリティを格納します。

## セットアップ

```bash
pnpm install
```

## 環境変数

本番環境およびプレビューデプロイでは、以下の環境変数/シークレットを事前に設定してください。

- `VITE_WS_URL`：クライアントが接続する WebSocket エンドポイント。ローカルでは `ws://localhost:8787` を想定します。
- `CF_ACCOUNT_ID`：Cloudflare アカウント ID。Workers/Pages 双方で共通です。
- `CF_WORKERS_API_TOKEN`：Cloudflare Workers へのデプロイに利用する API トークン。GitHub Secrets で `CF_WORKERS_API_TOKEN` として登録します。
- `CF_PAGES_API_TOKEN`：Cloudflare Pages のビルド・デプロイを許可する API トークン。GitHub Secrets で `CF_PAGES_API_TOKEN` として登録します。
- `CF_PAGES_PROJECT`：Cloudflare Pages プロジェクト名。Preview デプロイで `projectName` として参照されます。
- `SENTRY_DSN`：任意。指定時のみクライアントで `@sentry/browser` が初期化されます。

ローカル開発では `.env.example` を複製して値を入力し、CI では上記トークンを GitHub Secrets として設定してください。

## Vercel + Cloudflare 併用デプロイ手順

Vercel と Cloudflare を組み合わせた併用構成を再現できる手順は以下の通りです。

### Cloudflare Workers の本番公開

1. `pnpm --filter @meiro/server deploy -- --env prod` で Cloudflare Workers を本番デプロイします。`wrangler.toml` の `env.prod` 設定を利用し、Durable Object のマイグレーションも自動で適用されます。
2. デプロイ完了後に表示される `wss://` で始まる Cloudflare Workers の本番 WebSocket エンドポイント URL を確認し、チームのログ（例: `docs/deployment-log.md` など）に記録します。クライアントはこの URL に常時接続するため、履歴を残しておくことで切り戻し時にも参照できます。

### Vercel プロジェクトの構成

1. Vercel の新規プロジェクトでこのリポジトリをインポートし、ルートディレクトリを `client` に設定します。
2. Build Command を `pnpm --filter @meiro/client build`、Output Directory を `dist` に設定します。必要に応じて Install Command は `pnpm install --frozen-lockfile` を指定します。
3. Vercel の環境変数に `VITE_WS_URL` を Production/Preview 両方で設定し、Cloudflare Workers の本番 WebSocket URL を常に参照できるようにします。Preview は `wss://preview...` など、環境ごとのエンドポイントに合わせて値を変えてください。

### 動作確認

1. Vercel のデプロイ完了後、Preview または Production の URL にアクセスします。
2. ブラウザからルーム作成 → コード共有 → 接続 → フェーズ遷移まで実施し、Cloudflare Workers への通信が成功することを確認します。
3. 取得したブラウザコンソール/ネットワークログをスクリーンショットまたはログとして残し、Cloudflare Workers 側のログとも突き合わせておきます。

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

### ロールバック手順

1. 直近のリリースで問題が発覚した場合は、対象コミットに対して `git revert <コミットID>` を実行し、修正コミットを main ブランチに取り込みます。単純な巻き戻しではなく revert を用いることで履歴を明瞭に残します。
2. Revert 後に `pnpm format && pnpm lint && pnpm typecheck && pnpm test` を再実行し、ロールバックによる副作用が無いことを確認します。
3. 変更内容を `CHANGELOG.md` の `Unreleased` セクションに追記し、必要に応じてパッチバージョンを発行します。
4. `git tag -a v<新バージョン>` でロールバック後のタグを作成し、`git push origin main --tags` で配布します。

過去リリースを保持するポリシーとして、既存タグの削除やリリースノートの破棄は行いません。問題があるリリースには README または CHANGELOG で注意喚起を追記し、履歴を参照できる状態を維持します。
