# MEIRO v1 開発 TODO チェックリスト
作成: 2025-10-03 05:46:04

> 目的: このチェックリストは、仕様に基づいてMVP→v1までを漏れなく実装するための実行順Checklistです。役割ごとに分割し、**完了条件(DoD)** を併記しています。

---

## 0. プロジェクトメタ
- [x] プロジェクト名・バージョンを確定（MEIRO v1）  
  - DoD: `package.json` の name/version 設定
- [x] リポジトリ初期化（client/server モノレポ or 2リポ）  
  - DoD: `client/` と `server/` の雛形コミット
- [x] ライセンス/著作権表記  
  - DoD: `LICENSE`/`NOTICE` 追加
- [x] 作業ブランチ戦略（main/develop、PR運用）  
  - DoD: READMEに明記

---

## 1. 環境・依存関係
- [x] Node.js LTS / pnpm を統一（バージョンピン）  
  - DoD: `.tool-versions` or `.nvmrc` / `.npmrc`
- [x] パッケージ導入  
  - client: React, Phaser, Zustand, Zod, Vite
  - server: Cloudflare Workers, Durable Objects, wrangler, Zod
  - 共通: eslint, prettier, vitest, tsconfig
  - DoD: `pnpm i` で両プロジェクトがビルド・起動
- [x] .env / Secrets 設定  
  - DoD: `VITE_WS_URL`, `CF_*`, `SENTRY_DSN(任意)` の雛形 `.env.example`

---

## 2. ディレクトリと初期コード
- [x] client/ 初期構成
  - [x] `src/net/NetClient.ts`
  - [x] `src/views/OwnerView.tsx`, `PlayerView.tsx`, `HUD.tsx`
  - [x] `src/game/Raycaster.ts`, `Physics.ts`, `Sound.ts`
  - [x] `src/state/*`（Zustand）
  - DoD: Vite開発サーバ起動・空画面表示
- [x] server/ 初期構成
  - [x] `router.ts`（WSアップグレード）
  - [x] `room-do.ts`（DO本体・20Hz Tick）
  - [x] `logic/maze.ts`, `rules.ts`, `validate.ts`, `bfs.ts`
  - [x] `schema/ws.ts`, `state.ts`
  - DoD: wrangler dev でWSエコーが動作

---

## 3. ルーム/マッチメイク（DO）
- [x] ルームID発行（6桁 Base32風、O/I/1/0除外）
  - DoD: 衝突率試験（10万回で衝突0）
- [x] 1ルーム=1 Durable Object マッピング
  - DoD: 同一 roomId で同一DOにルーティング
- [x] ロビー管理（2名まで/5分で自動解散）
  - DoD: 満室時 `ROOM_FULL`、5分で `ROOM_EXPIRED`

---

## 4. ステートマシン（サーバ権威）
- [x] Phase 遷移: `CREATED → LOBBY → COUNTDOWN(3s) → PREP(60s:40/5/15) → EXPLORE(5..10m) → RESULT`
  - DoD: ログで全遷移が追跡できる
- [x] 再戦: 同部屋・役割50/50
  - DoD: RESULT後にクリーン再初期化

---

## 5. 通信（WebSocket, JSON Lines）
- [x] 接続: `/ws?room=ID&role=owner|player&nick=foo`
  - DoD: 役割検証・重複入室禁止
- [x] メッセージ定義（Zod）
  - [x] 共通: `STATE`, `EV`, `ERR`, `PING`/`PONG`
  - [x] プレイヤー: `P_INPUT(yaw, fwd, ts)`
  - [x] オーナー: `O_EDIT(ADD_WALL|DEL_WALL|PLACE_TRAP)`, `O_MRK`, `O_CONFIRM`, `O_CANCEL`
  - DoD: 型安全なシリアライズ/バリデーション
- [x] 送受信頻度
  - DoD: サーバ送信20Hz上限、1メッセージ≤2KB（p95）
- [x] スナップショット/差分配信
  - DoD: Phase遷移/重要イベントは全量、通常は差分

---

## 6. 迷路生成と最短路制約
- [x] アルゴリズム実装（棒倒し/穴掘り）
- [x] `start/goal` ランダム配置（十分距離）
- [x] 最短路長 ≥ 4×L を満たすまで再生成
  - DoD: 性質テスト 1,000回で常に充足
- [x] サイズ: 20×20 / 40×40 をサポート

---

## 7. 経路維持バリデーション（BFS）
- [x] 編集適用前に player→goal の到達路を1本以上確認
- [x] 失敗時 `NO_PATH` を返す（クライアントは楽観描画しない）
  - DoD: 経路封鎖が常に拒否される自動テスト

---

## 8. 物理/移動/視界（プレイヤー）
- [x] 回転 360°/s、移動 2.0 マス/s、半径 0.35 マス
- [x] 壁衝突のスライド補正
- [x] レイキャスト視界 FOV 90°、到達4マス（4マス目減光）
- [x] 20Hz サーバ積分 + クライアント補間
  - DoD: 壁抜け・角抜けしないことの単体/結合テスト

## 9. オーナー編集と資源
- [x] 壁資源：20×20=48本 / 40×40=140本
- [x] 壁削除：1回のみ（返却あり）
- [x] 編集クールダウン：1.0s（サーバ強制）
- [x] 禁止エリア：プレイヤーからマンハッタン距離2以内は不可
- [x] 予測地点ボーナス：通過時 70%で壁+1 / 30%で罠+1
  - DoD: UIに残数/クールダウン/禁止領域が正しく表示

---

## 10. 罠（トラップ）
- [x] 通路中心のみ設置  
  - DoD: RoomDOが壁セル/範囲外を拒否（server/tests/owner-wall-remove.test.ts）
- [x] 踏むと速度 40%（slow）
- [x] 持続: 残り制限時間の 1/5（重複踏みで延長）
- [x] 同時設置数: 最大2
  - DoD: server/tests/trap-effects.test.ts
- [x] 初期権利=1（準備フェーズから設置可）
  - DoD: server/tests/owner-resources.test.ts

---

## 11. ポイント/勝敗
- [x] 準備40sで配置（合計下限・個数上限）
- [x] 下限未達は不足分をプレイヤー初期ポイントに補填（上限=規定−1）
- [x] 規定ポイント = `ceil(0.65 × 合計配置ポイント)`
- [x] ゴールボーナス = 規定の 1/5
- [x] **規定到達で即終了**（ゴール未達でも終了しうる）
  - DoD: server/tests/points-scoring.test.ts で境界値および補填/終了を検証済み

---

## 12. 切断/再接続
- [x] 片方切断→即ポーズ
- [x] 60秒以内復帰で続行、超過で不在側敗北（双方不在はノーゲーム）
  - DoD: server/tests/disconnect-timeout.test.ts でポーズ/復帰/タイムアウトを検証

---

## 13. クライアントUI/UX
### 13.1 共通
- [x] HUD：残時間、現在ポイント、規定/達成率
- [x] トースト/エラー表示（`ERR.code` 別文言）
- [x] フレームレート制御（30fps上限）
- [x] サウンド（SEのみ、初期音量70%）

### 13.2 プレイヤーUI
- [x] 準備中プレビュー（5秒クリップ連続再生）
- [x] **必ずゴールが1回映る** ロジック
  - DoD: client/tests/PlayerViewPreview.test.tsx でプレビューを検証

### 13.3 オーナーUI
- [x] 俯瞰マップ：ズーム/パン（最大 9マスが画面内）
- [x] 編集操作：確認ポップ→再クリックで確定、右クリック/Escでキャンセル
- [x] 表示：プレイヤー位置、壁残数、削除権(0/1)、罠権、CD、禁止エリア、規定/現ポイント
  - DoD: client/tests/OwnerView.test.tsx でズーム/センタリング操作を検証

---

## 14. プロトコル互換性/堅牢化
- [x] 未知フィールドは無視（前方互換）
- DoD: Client/Server 双方で追加フィールドを受けても処理継続（server/tests/message-handler.test.ts）
- [x] 入力レート上限・過去時刻 ts 拒否・未来時刻補正・位置スナップ
  - DoD: フラッディング/改竄を検知しサーバで拒否（server/tests/player-input-validation.test.ts, server/tests/player-tick.test.ts）

---

## 15. ロギング/計測/運用
- [x] クライアント: 起動/接続/Phase遷移/ERR/RTT/FPS
  - DoD: `client/src/logging/telemetry.ts` と `NetClient`, `App` でコンソール出力を計測
- [x] サーバ: 部屋寿命/参加離脱/Phase時間/編集拒否率/BFS時間/メッセージサイズ
  - DoD: `server/src/logic/metrics.ts` 経由でルームメトリクスをログ
- [x] アラート: WS失敗率/再接続率/STATE遅延>200ms
  - DoD: テレメトリーで `client.ws.alert` / `client.ws.reconnect.alert` / `state.latency.alert` を発火し、閾値超過を検知

---

## 16. テスト（自動化優先）
### 16.1 ユニット
- [x] `maze.generate(seed,L)`：連結性・**最短路≥4×L**（Property-Based 1,000回）
  - DoD: `server/tests/maze.test.ts` で直径の葉ノードを start/goal に選び、1,000 seed のテストで連結と最短距離4L以上を担保
- [x] `rules.required(total)=ceil(0.65*total)`：境界値
- [x] `validate.edit`：禁止/資源/重なり/経路BFS/CD
  - DoD: `server/tests/owner-path-block.test.ts` で禁止エリアと経路維持を検証
- [x] `physics.integrate`：角抜けしない・スライド補正
  - DoD: `packages/common/tests/physics.integrate.test.ts` でスライドと角押し停止を検証
- [x] `trap.apply`：重複踏み延長
- [x] ポイント下限補填：上限=規定−1 クリップ
  - DoD: `server/tests/points-scoring.test.ts` に不足補填のクリップ検証を追加

### 16.2 結合/シミュレーション（Bot）
- [x] 5,000 Tick 連続対戦で経路封鎖が常に拒否
  - DoD: `server/tests/owner-path-block.test.ts` で 5,000 Tick 連続編集を再現し `NO_PATH` を検証
- [x] 予測地点ボーナス比率 70/30 ±5% に収束
  - DoD: `server/tests/prediction-bonus-ratio.test.ts` で1,000ヒット時の比率が70/30±5%に収束することを確認
- [x] `DEL_WALL` は1回のみを保証
  - DoD: `server/tests/owner-wall-remove.test.ts` で既存壁のみ削除可・削除済み後は `WALL_REMOVE_EXHAUSTED` を検証

### 16.3 負荷/安定
- [x] 20ルーム（40接続）で p95: STATE遅延≤150ms / メッセージ≤2KB  
  - DoD: `server/tests/state-latency-load.test.ts` で40接続×4送信のシナリオを再現し、STATE遅延とメッセージサイズのp95が基準内であることを検証
- [x] BFS検証 p95≤1ms/編集  
  - DoD: `server/tests/owner-path-block.test.ts` で `owner.path_check` メトリクスの出力と値を検証
- [x] 連続編集CDがサーバで強制  
  - DoD: `server/tests/owner-edit-cooldown.test.ts` で `EDIT_COOLDOWN` エラーと残りCD通知を確認

### 16.4 受入(UX)
- [x] デバッグHUDで全パラメータが可視
  - DoD: `client/tests/DebugHUD.test.tsx` で仕様値の表示を確認
- [x] 準備中プレビューにゴール映像が含まれる
  - DoD: `client/tests/PlayerViewPreview.test.tsx` でゴールプレビュー映像の表示を確認
- [x] 規定到達で終了（到達未満なら継続）  
  - DoD: `server/tests/points-scoring.test.ts` でターゲット到達時の `RESULT` 通知と未達時継続を検証

---

## 17. パフォーマンス/非機能
- [x] サーバ送信20Hz/クライアント表示30fpsを遵守  
  - DoD: `server/tests/outbound-rate-limit.test.ts` でSTATE差分の合流と20Hz送信を検証
- [x] 体感遅延100ms以下（RTTモニタ/補間で改善）
  - DoD: `client/tests/NetClientLatency.test.ts` でSTATE遅延アラートの閾値100msを検証
- [x] メッセージ圧縮不要で2KB以内に収まること
  - DoD: `server/tests/state-message-size.test.ts` で最大スナップショットが1,200bytes以内であることを検証

---

## 18. セキュリティ/公平性
- [x] 入力制約（速度/回転）のサーバ積分
  - DoD: `server/tests/player-tick.test.ts` でTick遅延時の移動量が速度上限内に収まることを確認
- [x] 楽観UI禁止（サーバ権威のSTATE待ち）
- [x] リプレイ攻撃対策（時刻検証・連番など）

---

## 19. DevOps/CI
- [ ] wrangler セットアップ（local/dev/prod）
- [ ] ページ/ワーカー デプロイパイプライン（PRでpreviews）
- [x] CI: lint/format/typecheck/unit/e2e
- [ ] エラートラッキング（Sentry 任意）
- [ ] リリースタグとCHANGELOG運用

---

## 20. 受入チェックリスト（仕様抜粋の完了確認）
- [x] ロビー5分自動解散  
- [x] カウントダウン3s → 準備(40/5/15)固定  
  - DoD: `server/tests/prep-phase-windows.test.ts` でポイント/罠/予測の時間窓を検証
- [ ] 20×20/40×40、**最短≥4×L**  
- [ ] 視界：FOV90°, 到達4マス（4マス目減光）  
- [ ] 壁：初期本数、削除1回、CD1.0s、禁止半径2、経路維持  
- [ ] 罠：40%速度、limit/5、同時2  
- [ ] ポイント：下限不足→初期ポイント補填（上限=規定−1）  
- [ ] 規定=ceil(0.65×合計)、ゴール+規定1/5、**規定到達で終了**  
- [ ] 切断→即ポーズ→60秒勝敗  
- [ ] 30fps/20Hz/遅延100ms以下

---

## 21. 既知のリスクと対応
- [ ] 経路BFSの負荷 → 編集CD1.0s + 近傍差分BFS
- [ ] レイキャスト負荷 → レイ数制限 / 距離4打ち切り
- [ ] 切断多発 → ハートビート + 60秒タイマー

---

## 22. リリース前チェック
- [ ] 本番環境の秘密情報/環境変数を確認
- [ ] ログレベル/PII含有の有無を確認
- [ ] 回帰テストパス（ユニット/結合/負荷/受入）
- [ ] ロールバック手順/過去リリースの保持

---

### 実行順（推奨短縮版）
1) DO雛形 + 20Hz STATE配信 → 2) 迷路 + BFS検証 → 3) 移動/視界 → 4) 編集/資源/禁止 → 5) ポイント/勝敗 → 6) 切断/再接続 → 7) UI/HUD/サウンド → 8) 計測/最適化 → 9) 総合テスト/リリース
