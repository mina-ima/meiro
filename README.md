# MEIRO v1 モノレポ概要

MEIRO v1 プロジェクトは npm ワークスペースで構成されたモノレポです。主要なパッケージは次のとおりです。

- `client/`：React + Phaser クライアント実装。Vite を用いたフロントエンド開発環境を提供します。
- `server/`：Cloudflare Workers + Durable Objects ベースのゲームサーバ実装です。
- `packages/common/`：クライアント/サーバ間で共有する型やユーティリティを格納します。

## セットアップ

```bash
npm install
```

## 環境変数

本番環境およびプレビューデプロイでは、以下の環境変数/シークレットを事前に設定してください。

- `VITE_WS_URL`：クライアントが接続する WebSocket エンドポイント。ローカルでは `.env` に `ws://localhost:8787` を、Cloudflare Pages では `wss://meiro-server.minamidenshi.workers.dev` を必ず設定します。未設定の場合はビルド済みクライアントの初期化時に即エラーになります。Pages の環境変数にもこの `wss://` URL を設定し、誤って Pages 側の `https://` を指さないようにしてください。
- `CF_ACCOUNT_ID`：Cloudflare アカウント ID。Workers/Pages 双方で共通です。
- `CF_WORKERS_API_TOKEN`：Cloudflare Workers へのデプロイに利用する API トークン。GitHub Secrets で `CF_WORKERS_API_TOKEN` として登録します。
- `CF_PAGES_API_TOKEN`：Cloudflare Pages のビルド・デプロイを許可する API トークン。GitHub Secrets で `CF_PAGES_API_TOKEN` として登録します。
- `CF_PAGES_PROJECT`：Cloudflare Pages プロジェクト名。Preview デプロイで `projectName` として参照されます。
- `SENTRY_DSN`：任意。指定時のみクライアントで `@sentry/browser` が初期化されます。

ローカル開発では `.env.example` を複製して値を入力し、CI では上記トークンを GitHub Secrets として設定してください。

## Cloudflare Pages + Cloudflare Workers 併用デプロイ手順

Cloudflare Pages と Cloudflare Workers の併用構成を再現する手順です。

### Cloudflare Workers の本番公開

1. `npm run deploy --workspace @meiro/server -- --env prod` で Cloudflare Workers を本番デプロイします。`wrangler.toml` の `env.prod` 設定を利用し、Durable Object のマイグレーションも自動で適用されます。
2. デプロイ完了後に表示される Cloudflare Workers の本番 WebSocket エンドポイント（`wss://meiro-server.minamidenshi.workers.dev/ws`）を確認し、チームのログ（例: `docs/deployment-log.md`）に記録します。クライアントは常にこの Workers へ接続するため、履歴を残しておくことで切り戻し時にも参照できます。初回本番公開時のログは `docs/deployment-log.md` に記載済みです。

### Cloudflare Pages プロジェクトの構成

GitHub 連携で Cloudflare Pages のプロジェクトを作成しておくと、main ブランチへの push や Pull Request ごとに自動でビルド/デプロイされます。

1. Cloudflare Pages の新規プロジェクトでこのリポジトリをインポートし、ビルド対象ディレクトリを `client` に設定します。
2. Build Command を `npm run build --workspace @meiro/client`、Output Directory を `client/dist` に設定します。必要に応じて Install Command は `npm install --frozen-lockfile` を指定します。初回ビルドで生成された `client/dist/index.html` などのアセットは `docs/deployment-log.md` に記録し、構成の再現性を保ってください。
3. Cloudflare Pages の環境変数として `VITE_WS_URL=wss://meiro-server.minamidenshi.workers.dev` を Production/Preview の両方に設定します。Pages の URL（`https://meiro-d85.pages.dev` など）を指定すると WebSocket が接続できないため、必ず Workers の `wss://` を参照させます。Preview 用に別の Workers エンドポイントを用意している場合は、同様に `wss://` で始まる URL を入力してください。
4. Cloudflare Pages と GitHub を連携させることで main/PR ごとに自動デプロイされるため、手動の `wrangler pages deploy` は不要です。

### 動作確認

1. Cloudflare Pages のデプロイ完了後、Preview または Production の URL にアクセスします。
2. ブラウザからルーム作成 → コード共有 → 接続 → フェーズ遷移まで実施し、Cloudflare Workers への通信が成功することを確認します。
3. 取得したブラウザコンソール/ネットワークログをスクリーンショットまたはログとして残し、Cloudflare Workers 側のログとも突き合わせておきます。

## よく使うコマンド

- `npm run dev --workspace @meiro/client`：クライアントの開発サーバを起動
- `npm run dev --workspace @meiro/server`：Workers ランタイムでサーバを起動
- `npm test`：ワークスペース全体のテストを実行

## ディレクトリ構成

```
.
├── client/           # クライアントアプリケーション（React + Phaser）
├── server/           # サーバアプリケーション（Cloudflare Workers + DO）
├── packages/common/  # 共有型定義・ユーティリティ
├── prompt_spec.md    # 開発仕様書
└── todo.md           # 実装チェックリスト
```

各パッケージは `package.json` の `workspaces` 設定で管理され、共通のリンター/フォーマッター/テスト設定を共有しています。

## ライセンス

本リポジトリは MIT License で提供されます。詳細は `LICENSE` と `NOTICE` を参照してください。

## ブランチ戦略

- `main`：デプロイ可能な安定ブランチ。常に最新の検証済みビルドを保持します。
- 開発作業は `feature/<概要>` ブランチで行い、完了後に Pull Request を通じて `main` へマージします。
- バグ修正は `fix/<概要>` ブランチで行い、緊急対応が必要な場合でも PR を経由して `main` に取り込みます。
- PR 作成時は `npm run format && npm run lint && npm run typecheck && npm test` の実行結果を添付し、レビュー後に squash merge します。

## CI

- `.github/workflows/ci.yml` で `main` への push・pull request をトリガーに自動実行。
- フォーマットチェック（`npm run format`）、Lint、Typecheck、テストを順番に実行します。
- ワークフローは Node.js 20 + npm 10 を使用し、`npm ci` で依存関係を固定します。

## リリースフロー

1. `CHANGELOG.md` の `Unreleased` セクションに変更内容を追記し、必要に応じてバージョン節を確定します。
2. `npm run format && npm run lint && npm run typecheck && npm test` を実行して品質チェックを通します。
3. リリースバージョンを決定し、例として `1.1.0` を出す場合は `git tag -a v1.1.0 -m "v1.1.0"` を作成します。
4. `git push origin main --tags` でタグとブランチをリモートへ送信します。
5. GitHub のリリースノートに `CHANGELOG.md` の該当節を転載し、必要なアセットを添付します。

> 補足: プレビューデプロイは PR 作成時に自動実行されるため、本番リリース前に `Deploy Preview` ワークフローの結果を確認してください。

### ロールバック手順

1. 直近のリリースで問題が発覚した場合は、対象コミットに対して `git revert <コミットID>` を実行し、修正コミットを main ブランチに取り込みます。単純な巻き戻しではなく revert を用いることで履歴を明瞭に残します。
2. Revert 後に `npm run format && npm run lint && npm run typecheck && npm test` を再実行し、ロールバックによる副作用が無いことを確認します。
3. 変更内容を `CHANGELOG.md` の `Unreleased` セクションに追記し、必要に応じてパッチバージョンを発行します。
4. `git tag -a v<新バージョン>` でロールバック後のタグを作成し、`git push origin main --tags` で配布します。

過去リリースを保持するポリシーとして、既存タグの削除やリリースノートの破棄は行いません。問題があるリリースには README または CHANGELOG で注意喚起を追記し、履歴を参照できる状態を維持します。
