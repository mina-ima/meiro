# Changelog

すべての重要な変更はこのファイルで管理します。書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) と [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### Fixed (v1.7.6)
- 仕様「前方3マス先まで見える」を探索SVGに反映。`computeForwardWallDistance` を追加し、現在セルから前方N マス目に壁がある場合は対応する奥行きt (0.25/0.5/0.75)で正面壁を描画。N≥3 のときのみ fade（暗闇）にする。
- これにより `forward=通路` でも1〜2マス先で壁の場合、正面奥に壁が描画される。

### Fixed (v1.7.5)
- 探索SVGの正面壁の奥行きを 0.7 (約2.8マス先) → 0.25 (1マス先) に変更。`forward=壁` のとき正面壁が現在セルの東境界に立つようになり、「前方に通路があるように見える」誤認を解消。

### Fixed (v1.7.4)
- 探索SVGがスタート地点で左右の開口部を描画しないバグを修正。`renderStartView` は `openings.left/right` を無視するため、ゴール以外は `junction` variant で統一して描画するように変更。
- `renderSideBranch` の開口部奥行きを 0.25..0.60 → 0.0..0.25 に変更。従来は「もう一歩進んだ先で分岐」のように見えていたが、現在セルの真横に開口部が描画されるよう修正。

### Changed (v1.7.3)
- 探索フェーズの描画を、prepフェーズと同じプレビューSVG (`createSimplePreviewSvg`) に統一。canvas+Raycasterから移行。
- オーナー俯瞰マップのプレイヤー三角矢印をセル内に収まるサイズへ縮小（高さ0.6→0.4、幅0.7→0.45）。隣セルの壁にかかって見える問題を解消。

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

### Fixed (v1.6.2)
- オーナー俯瞰マップのプレイヤー三角矢印が常に北向きで描画されていた不具合を修正。
  - `playerAngle` を OwnerView/OwnerMap に伝搬し、`transform="rotate(angle*180/π+90, x, y)"` で実際の向きに回転表示。
  - `playerAngle=0`(東)で右向き、`π/2`(南)で下向き、`π`(西)で左向き、`-π/2`(北)で上向き。

### Fixed (v1.7.2)
- オーナーが prep フェーズで1つもポイントを置かないと、explore 開始と同時に `targetScore=0 ≤ player.score=0` で即時 result 遷移してしまう不具合を修正。
  - `evaluateScoreCompletion` で `targetScore <= 0` の場合は完了判定をスキップ（タイムアップまで explore を継続）
  - これがクライアント側で「壁が描画されない」「操作カーソルが見えない」現象の正体だった（result フェーズでは Raycaster ループがスキップされ PlayerControls も非表示）。

### Refactor (v1.7.1)
- 方向ヘルパー（Direction型, DIRECTION_INFO, angleToDirection, computeOpenings, isDirectionOpen, rotateDirection, getOpenDirections, DIRECTION_LABEL_JA）を `mazeDirection.ts` に切り出し。
  - PlayerView ⇄ simpleMazePreview/FancyMazePreview の循環参照を解消し、OwnerView も同モジュールから取得するように統一。
  - Temporal Dead Zone 由来の不安定挙動を回避。

### Fixed (v1.7.0)
- 探索フェーズの描画を canvas + Raycaster に戻す（v1.5.0でSVG化した時点での機能後退を是正）。
  - SVGは現在セルの状態しか反映していなかったが、仕様は「前方3マス先まで見える」。
  - Raycaster は PLAYER_VIEW_RANGE=4 で動的視界を表現する（v1.5.0以前から残っていたコードを再活用）。
  - テクスチャ・カラーはプレビューと統一（タン色の壁、グレー床、青空グラデーション）。
- オーナー画面の InitialSetupPanel に「プレイヤー位置／向き／前後左右の通路状態」を表示（デバッグ用）。プレイヤー画面のオーバーレイと同じ情報を直接照合可能に。

## [1.0.0] - 2025-10-03

### Added
- MEIRO v1 初期リリース。
