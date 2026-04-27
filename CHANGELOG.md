# Changelog

すべての重要な変更はこのファイルで管理します。書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) と [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### Added
- Cloudflare Workers/Pages 向けプレビューデプロイワークフローを追加。
- リリースタグ運用と CHANGELOG 更新手順を README に記載。
- オーナービューのポイント配置 UI に残数 (n/上限) と合計点 (合計/下限) を表示。合計点が下限以上で「条件達成」、未満で不足ポイントを赤字表示。
- `.github/workflows/deploy-production.yml` を追加し、`main` への push で Cloudflare Workers を自動デプロイ。

### Changed
- ポイント配置の効率化: 1点/3点/5点を一度選んだら、別の点数を選ぶまで連続配置可能に（毎回再選択不要）。
- 俯瞰マップ上のポイントマーカー（数字）を拡大し視認性を改善。

### Added (v1.4.0)
- プレイヤー操作の実装: キーボード(W/A/S/D + 矢印キー)とオンスクリーンの方向ボタン(タッチ対応)で、20Hzで `P_INPUT` を送信。
- 探索フェーズの画面下部に操作説明パネル（前進/後退/左回転/右回転）を表示。

### Changed (v1.5.0)
- 探索フェーズの描画を、プレビューと同じSVG生成方式に統一（canvasレイキャスティングを廃止）。プレイヤー位置と向きから forward/left/right/back の壁開閉を判定し、`createSimplePreviewSvg` で生成。
- 操作パネルを HUD の上（描画canvas/SVGの直下）へ移動し、見落としにくくした。
- 描画キャンバス右上に操作キーガイドのオーバーレイを追加。

### Removed (v1.5.0)
- レイキャスティング描画関連のテスト (PlayerViewRaycaster.test.tsx)。SVG生成方式に置換のため不要。

### Changed (v1.6.0)
- プレイヤー操作を1マス単位の離散ステップ移動に変更:
  - ↑前進1マス（500ms forward=1パルス）
  - ↓後退1マス（500ms forward=-1パルス）
  - ←左に曲がって1マス（250ms yaw=-1 → 500ms forward=1）
  - →右に曲がって1マス（250ms yaw=+1 → 500ms forward=1）
- 現在セルの壁状態から各方向ボタンを有効/無効化（壁がある方向は disabled かつ薄く表示）
- キーボードのキー押下も「1キー押下=1ステップ」に変更（押しっぱなしでも次ステップは進まない）

### Changed (v1.6.1)
- SVG生成と移動可否判定で同じ `openings` オブジェクトを共有し整合性を担保（computeOpeningsに集約）。
- 描画領域右上のオーバーレイに「現在の向き／前後左右の通路状態」をデバッグ表示（操作キー説明の代わり）。これでボタンの有効/無効と画面の見え方を即時照合できる。

## [1.0.0] - 2025-10-03

### Added
- MEIRO v1 初期リリース。
