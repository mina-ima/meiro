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
- [x] Node.js LTS / npm を統一（バージョンピン）  
  - DoD: `.tool-versions` or `.nvmrc` / `.npmrc`
- [x] パッケージ導入  
  - client: React, Phaser, Zustand, Zod, Vite
  - server: Cloudflare Workers, Durable Objects, wrangler, Zod
  - 共通: eslint, prettier, vitest, tsconfig
  - DoD: `npm install` でワークスペース全体がビルド・起動
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
  - [x] `router.ts`（HTTP API） + `ws-handler.ts`（WSアップグレード）
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
- [x] フェーズアラーム: `phaseEndsAt` が null/NaN/非数のときはアラーム設定をスキップし警告ログを残す
  - DoD: `server/tests/phase-alarm.test.ts` が通過すること

---

## 5. 通信（WebSocket, JSON Lines）
- [x] 接続: `/ws?room=ID&role=owner|player&nick=foo`
  - DoD: 役割検証・重複入室禁止
- [x] ルータ↔DOハンドシェイク: `/ws` ハンドラは `Upgrade: websocket` + GET を検証し、元の Request をそのまま DO stub へ渡す。DO 側は `/ws`（および `/<id>/ws`）を検出したら `WebSocketPair` を自前生成して `DEBUG_CONNECTED` → `STATE` を送出し、join 失敗時は JSON エラーを返す
  - DoD: `server/tests/websocket-handler.test.ts` で Request をそのまま stub.fetch に渡すことと DO 応答をそのまま relay することを検証し、`server/tests/room-session-websocket.test.ts` で `/ws` と `/<id>/ws` の Upgrade が 101 + DEBUG/STATE を送ることを検証
  - MEMO: `server/tests/helpers/upgrade-request.ts` で `/ws` 接続リクエスト作成＋モックWSの差し替えを共通化し、`server/tests/disconnect-timeout.test.ts` などの再接続ケースで DO ID ベースの `roomId` 受付を検証
- [x] Worker→DO 委譲: Worker は `/ws` の Request をそのまま `stub.fetch(request)` に渡し、DO 応答 (101/409/410/500) を変換せずにクライアントへ返す
  - DoD: `server/tests/websocket-handler.test.ts` で Request オブジェクトがそのまま stub に渡ることと、DO 応答が透過的に返却されることを検証
- [x] DO 内部ルート判定: Cloudflare が `/<DurableObjectId>/` を付与するため `/ws` / `/rematch` は `endsWith()` 判定でマッチさせる
  - DoD: `server/tests/room-session-websocket.test.ts` で `https://example/<id>/ws` への Upgrade が 101 になる
- [x] メッセージ定義（Zod）
  - [x] 共通: `STATE`, `EV`, `ERR`, `PING`/`PONG`
  - [x] プレイヤー: `P_INPUT(yaw, fwd, ts)`
  - [x] オーナー: `O_EDIT(ADD_WALL|DEL_WALL|PLACE_TRAP)`, `O_MRK`, `O_CONFIRM`, `O_CANCEL`, `O_START`
  - DoD: 型安全なシリアライズ/バリデーション
- [x] 送受信頻度
  - DoD: サーバ送信20Hz上限、STATE差分p95≤2KB（迷路付きフルSTATEは20KB以内）
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
- [x] 罠/予測地点の配置UI：HUDにドラッグ/クリック可能なパレットを表示し、準備フェーズ中に迷路上へ直感的に配置できる
  - DoD: `client/src/views/OwnerView.tsx` で SVG マップへのドラッグ＆ドロップ/クリック配置を実装し、`client/tests/OwnerView.test.tsx` で送信メッセージを検証

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
- [x] ロビーUI：ニックネーム入力とルーム作成/参加フォーム
  - DoD: `client/tests/AppLobby.test.tsx` で新規ルーム作成・既存ルーム参加のフローと、HTTPエンドポイント未設定時の警告表示/ボタン無効化を検証

### 13.2 プレイヤーUI
- [x] 準備中プレビュー（5秒クリップ連続再生）
- [x] **必ずゴールが1回映る** ロジック
  - DoD: client/tests/PlayerViewPreview.test.tsx でプレビューを検証

### 13.3 オーナーUI
- [x] 俯瞰マップ：ズーム/パン（最大 9マスが画面内）
- [x] 編集操作：確認ポップ→再クリックで確定、右クリック/Escでキャンセル
- [x] 表示：プレイヤー位置、壁残数、削除権(0/1)、罠権、CD、禁止エリア、規定/現ポイント
  - DoD: client/tests/OwnerView.test.tsx でズーム/センタリング操作を検証
- [x] プレイヤーマーカーを小型の三角形で描画して迷路セルを覆わないようにする
  - DoD: client/tests/OwnerView.test.tsx の `プレイヤー位置は迷路を隠さないよう小さな三角形で描画する` シナリオでSVGポリゴンと辺長を検証
- [x] 参加状況と手動開始：ロビー中はオーナー/プレイヤーの入室状態を表示し、プレイヤー参加後にのみ「ゲーム開始」ボタンを有効化して `O_START` を送信
  - DoD: client/tests/OwnerView.test.tsx で参加表示とボタン送信を検証、server/tests/manual-start.test.ts で手動開始のサーバ挙動を検証
- [x] 共有用ルームID表示：オーナービューのヘッダーで現在のルームコードを強調表示し、未取得時は「取得中」を表示
  - DoD: client/tests/OwnerView.test.tsx の `room-id` テストケースで DOM 表示を検証
- [x] 自動生成迷路の描画：サーバ STATE の `maze` 情報を俯瞰マップに反映し、スタート/ゴールをハイライト。未受信時はプレースホルダー表示に切り替える
  - DoD: client/tests/OwnerView.test.tsx の `受信した迷路データから壁を描画する` シナリオ、server/tests/state-sync.test.ts の `迷路情報` ケースで `maze` が配信されることを確認
- [x] 初期設定HUDの簡略化：オーナービューでは罠権利/同時設置数・禁止エリア距離・編集クールダウン残り・予測地点残数・設定残り時間をまとめて表示し、迷路プレビューと合わせて共有する
  - DoD: client/tests/OwnerView.test.tsx の `HUDでは初期設定` シナリオに加え、client/tests/AppOwnerForbiddenDistance.test.tsx / client/tests/OwnerCooldownDisplay.test.tsx で動的な距離・クールダウン表示を検証
- [x] ロビー中は準備案内のみを表示し、カウントダウン以降に俯瞰マップと初期設定HUDをレンダリングする
  - DoD: client/tests/OwnerView.test.tsx の `ゲーム開始前は迷路HUDを隠し`、client/tests/AppPredictionIntegration.test.tsx、client/tests/AppOptimisticUi.test.tsx で STATE 適用後のみHUDが現れることを検証
- [x] ロビー中はDebugHUDを非表示とし、countdown以降のみ表示する
  - DoD: client/tests/DebugHUD.test.tsx の `ロビー中はDebugHUDを表示しない` でSTATE適用後でも `phase=lobby` の間はDOMに現れないことを確認
- [x] ロビー迷路サイズ選択：オーナーはゲーム開始ボタン直上のメニューから 20×20 / 40×40 を選択し、`O_START` 送信時に指定サイズをサーバーへ伝える
  - DoD: client/tests/OwnerView.test.tsx の `迷路サイズを選択` テストで UI と送信内容を検証し、server/tests/manual-start.test.ts / server/tests/disconnect-heartbeat.test.ts で指定サイズでの再生成を検証
- [x] オーナービューに「設定」ボタンを設置し、ロビー中のみDebugHUDをオンデマンド表示する
  - DoD: client/tests/OwnerView.test.tsx でロビー時のみボタンが表示されることを検証し、client/tests/DebugHUD.test.tsx の `設定ボタンでDebugHUDを開閉できる` / `ゲーム開始後は設定ボタンも表示されない` で挙動を検証

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
- [x] DOハンドシェイク可観測性: 接続直後の `DEBUG_CONNECTED` / `STATE` / 致命的エラー通知
  - DoD: `server/tests/state-broadcast.test.ts` で `DEBUG_CONNECTED` / 初回 `STATE` を検証し、`RoomDurableObject` が `DO connected` / `send DEBUG_CONNECTED` / `send STATE` / `send ERROR` を `console.log` へ出力し、ルーターが `WS fetch /ws` を必ず記録する

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
- [x] 20ルーム（40接続）で p95: STATE遅延≤150ms / メッセージ≤2KB（初回フルSTATE除く）  
  - DoD: `server/tests/state-latency-load.test.ts` で40接続×4送信のシナリオを再現し、STATE遅延とメッセージサイズ（p95）が基準内であることを検証
- [x] BFS検証 p95≤1ms/編集  
  - DoD: `server/tests/owner-path-block.test.ts` で `owner.path_check` メトリクスの出力と値を検証
- [x] 連続編集CDがサーバで強制  
  - DoD: `server/tests/owner-edit-cooldown.test.ts` で `EDIT_COOLDOWN` エラーと残りCD通知を確認

### 16.4 受入(UX)
- [x] デバッグHUDで全パラメータが可視
  - DoD: `client/tests/DebugHUD.test.tsx` で仕様値の表示を確認
- [x] 準備中プレビューにゴール映像が含まれる
  - DoD: `client/tests/PlayerViewPreview.test.tsx` でゴールプレビュー映像の表示を確認
- [x] 準備中プレビューが迷路固有の分岐情報を一人称視点風で表示する
  - DoD: `client/tests/PlayerViewPreview.test.tsx` で方向ヒント付きスタート/ゴールクリップを検証
- [x] 規定到達で終了（到達未満なら継続）  
  - DoD: `server/tests/points-scoring.test.ts` でターゲット到達時の `RESULT` 通知と未達時継続を検証

---

## 17. パフォーマンス/非機能
- [x] サーバ送信20Hz/クライアント表示30fpsを遵守  
  - DoD: `server/tests/outbound-rate-limit.test.ts` でSTATE差分の合流と20Hz送信を検証
- [x] 体感遅延100ms以下（RTTモニタ/補間で改善）
  - DoD: `client/tests/NetClientLatency.test.ts` でSTATE遅延アラートの閾値100msを検証
- [x] メッセージ圧縮不要でSTATE差分は2KB以内/フルSTATEは20KB以内に収まること
  - DoD: `server/tests/state-message-size.test.ts` で最大スナップショットが20,000bytes以内であることを検証

---

## 18. セキュリティ/公平性
- [x] 入力制約（速度/回転）のサーバ積分
  - DoD: `server/tests/player-tick.test.ts` でTick遅延時の移動量が速度上限内に収まることを確認
- [x] 楽観UI禁止（サーバ権威のSTATE待ち）
- [x] リプレイ攻撃対策（時刻検証・連番など）

---

## 19. DevOps/CI
- [x] wrangler セットアップ（local/dev/prod）
  - DoD: `server/tests/wrangler-config.test.ts` で local/dev/prod 環境とルーティング/ENVIRONMENT 変数が検証される
- [x] ページ/ワーカー デプロイパイプライン（PRでpreviews）
  - DoD: `.github/workflows/deploy-preview.yml` で lint/typecheck/test 実行後に `wrangler deploy --env preview` と Cloudflare Pages へのアップロードを実施し、`CF_ACCOUNT_ID`/`CF_WORKERS_API_TOKEN`/`CF_PAGES_API_TOKEN`/`CF_PAGES_PROJECT` を参照する
- [x] CI: lint/format/typecheck/unit/e2e
- [x] エラートラッキング（Sentry 任意）
  - DoD: `client/tests/SentryInit.test.ts` で DSN 初期化と例外転送を検証
- [x] リリースタグとCHANGELOG運用
  - DoD: `CHANGELOG.md` と README「リリースフロー」に手順を定義し、`packages/common/tests/release-process.test.ts` で存在と記述を検証

---

## 20. 受入チェックリスト（仕様抜粋の完了確認）
- [x] ロビー5分自動解散  
- [x] カウントダウン3s → 準備(40/5/15)固定  
  - DoD: `server/tests/prep-phase-windows.test.ts` でポイント/罠/予測の時間窓を検証
- [x] 20×20/40×40、**最短≥4×L**  
  - DoD: `server/tests/room-maze-initialization.test.ts` で `createInitialRoomState` が生成する迷路の start/goal と最短距離を検証
- [x] 視界：FOV90°, 到達4マス（4マス目減光）  
  - DoD: `client/tests/PlayerViewRaycaster.test.tsx` で境界4マス目の減光を検証
- [x] 壁：初期本数、削除1回、CD1.0s、禁止半径2、経路維持  
  - DoD: `server/tests/owner-resources.test.ts` で初期化値を検証し、`server/tests/owner-path-block.test.ts` で経路維持と禁止距離の拒否判定を保証。`client/tests/OwnerView.test.tsx` / `client/tests/DebugHUD.test.tsx` / `client/tests/AppOwnerForbiddenDistance.test.tsx` でHUD表示を確認。
- [x] 罠：40%速度、limit/5、同時2  
  - DoD: `server/tests/trap-effects.test.ts` で速度低下と同時設置数上限を検証し、`server/tests/trap-apply.test.ts` で持続時間の延長を検証
- [x] ポイント：下限不足→初期ポイント補填（上限=規定−1）  
  - DoD: `server/tests/points-scoring.test.ts` / `client/tests/PlayerViewCompensationNotice.test.tsx`
- [x] 規定=ceil(0.65×合計)、ゴール+規定1/5、**規定到達で終了**  
  - DoD: `server/tests/points-scoring.test.ts` でゴールボーナス到達時のRESULTを検証し、`client/tests/PlayerViewTargetCompletion.test.tsx` で達成通知表示を確認。
- [x] 切断→即ポーズ→60秒勝敗  
  - DoD: `server/tests/disconnect-timeout.test.ts` / `server/tests/heartbeat-timeout.test.ts` でポーズ開始と60秒判定遷移を検証
- [x] 30fps/20Hz/遅延100ms以下
  - DoD: `client/tests/FrameLoop.test.tsx` で30fps上限を確認し、`server/tests/outbound-rate-limit.test.ts` で20Hz送信を検証。`client/tests/NetClientLatency.test.ts` / `server/tests/metrics-alerts.test.ts` で遅延アラート閾値100msを確認。
- [x] 切断→即ポーズ→60秒勝敗  
  - DoD: `client/tests/GamePauseDisplay.test.tsx` でポーズオーバーレイと残り秒数表示を検証

---

## 21. 既知のリスクと対応
- [x] 経路BFSの負荷 → 編集CD1.0s + 近傍差分BFS
  - DoD: `server/tests/owner-path-block.test.ts` でキャッシュヒット時に `owner.path_check.checked=false` となる成功/失敗ケースを検証
- [x] レイキャスト負荷 → レイ数制限 / 距離4打ち切り  
  - DoD: `client/tests/Raycaster.test.ts` で最大90本・距離4マスへのクリップを検証
- [x] 切断多発 → ハートビート + 60秒タイマー  
  - DoD: `server/tests/heartbeat-timeout.test.ts` でハートビート途絶時に即ポーズと60秒敗北タイマー開始を検証

---

## 22. リリース前チェック
- [x] 本番環境の秘密情報/環境変数を確認
  - DoD: `.env.example` に必要なシークレットを列挙し、`README` に説明を追記。`packages/common/tests/production-env.test.ts` で検証。
- [x] ログレベル/PII含有の有無を確認
  - DoD: `packages/common/tests/logging-safety.test.ts` で `console.log` 利用禁止とニックネームのログ混入を検証
- [x] 回帰テストパス（ユニット/結合/負荷/受入）
- [x] ロールバック手順/過去リリースの保持  
  - DoD: `README` にロールバック手順と保持方針を明記し、`packages/common/tests/release-process.test.ts` で検証

---

## 23. Cloudflare Pages デプロイ対応
- [x] Cloudflare Workers の本番デプロイを行い、WebSocket エンドポイント `wss://...` を確定する  
  - DoD: 稼働中の本番 URL を記録し、接続テストログを残す（`docs/deployment-log.md` に `wss://meiro-server.minamidenshi.workers.dev/ws` と 101 Switching Protocols ログを追記）
- [x] Cloudflare Pages でクライアント用プロジェクトを作成し、ビルド設定を `npm run build --workspace @meiro/client` / `client/dist` に構成する  
  - DoD: 初回ビルドが成功し、アセットが `client/dist` に出力される（`docs/deployment-log.md` に `client/dist/index.html` 生成ログを記録）
  - 補足: GitHub 連携で Cloudflare Pages のプロジェクトを作成し、自動デプロイ運用を行う
- [x] Cloudflare Pages の環境変数に `VITE_WS_URL` を追加し、Cloudflare Workers の WebSocket URL を設定する  
  - DoD: Production/Preview の両環境で値が反映されている（`docs/deployment-log.md` 2024-05-22 記録を参照）
- [x] デプロイ後に Cloudflare Pages ホストのクライアントから実際にゲームへ接続して動作確認する  
  - DoD: ブラウザ上でルーム作成→接続→フェーズ進行まで確認し、問題があればログに記録（`docs/deployment-log.md` 2024-05-23 記録を参照）
- [x] 手順と確認項目を README などのドキュメントに追記する  
  - DoD: Cloudflare Pages + Cloudflare Workers 併用構成を再現できる説明が残る（`README.md` セクション「Cloudflare Pages + Cloudflare Workers 併用デプロイ手順」に記載）

---

## 24. 表示改善フィードバック（2025-05-24）
- [x] プレイヤープレビュー画像で壁/通路コントラストを強調  
  - DoD: `client/tests/PlayerViewPreview.test.tsx` の新規テストで床グリッド非表示と通路ハイライトの強調を検証
- [x] 探索フェーズのプレイヤービューを1点透視のワイヤーフレーム＋床/側壁レイヤーで刷新  
  - DoD: `client/tests/PlayerViewRaycaster.test.tsx` で黒背景・赤線ガイドに加えて床グロー/側壁シルエットと開口部で壁列が抜ける挙動を検証
- [x] プレイヤービューのレイキャストに迷路セルの壁情報を反映し、距離に応じて縦線の高さ/透明度を変化  
  - DoD: `client/tests/PlayerViewRaycaster.test.tsx` の新規テストで迷路壁による距離変化と縦線描画の強弱を検証
- [x] プレイヤービューで dead-end / corner / junction を判別して前方ワイヤーフレームと `dataset` に反映  
  - DoD: `client/tests/PlayerViewRaycaster.test.tsx` の視界シルエット3テストでデータ属性と描画切替を確認
- [x] プレイヤービューで4マス先を黒フォグで遮光し、近距離の壁にテクスチャストライプを描画  
  - DoD: `client/tests/PlayerViewRaycaster.test.tsx` のフォグ/テクスチャ検証テストで床グローと黒フォグ、壁テクスチャの出力を確認

---

### 実行順（推奨短縮版）
1) DO雛形 + 20Hz STATE配信 → 2) 迷路 + BFS検証 → 3) 移動/視界 → 4) 編集/資源/禁止 → 5) ポイント/勝敗 → 6) 切断/再接続 → 7) UI/HUD/サウンド → 8) 計測/最適化 → 9) 総合テスト/リリース
