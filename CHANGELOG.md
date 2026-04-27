# Changelog

すべての重要な変更はこのファイルで管理します。書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) と [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### Added
- Cloudflare Workers/Pages 向けプレビューデプロイワークフローを追加。
- リリースタグ運用と CHANGELOG 更新手順を README に記載。
- オーナービューのポイント配置 UI に残数 (n/上限) と合計点 (合計/下限) を表示。合計点が下限以上で「条件達成」、未満で不足ポイントを赤字表示。
- `.github/workflows/deploy-production.yml` を追加し、`main` への push で Cloudflare Workers を自動デプロイ。

## [1.0.0] - 2025-10-03

### Added
- MEIRO v1 初期リリース。
