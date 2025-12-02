
# MEIRO v1 開発仕様（Dev-Ready）

## 1. スコープ/ゴール

* PCブラウザ向けリアルタイム非対称対戦：**オーナー（俯瞰編集） vs プレイヤー（一人称探索）**。
* **1対1**, 観戦なし。**React + Phaser**でクライアント、**Cloudflare Workers + Durable Objects（DO）**でサーバ。
* **サーバ権威型**、**20Hz**サーバTick、**30fps**描画上限、**WebSocket常時接続**。
* ゲーム進行・ルール・数値・フェーズ・資源・禁止エリア・終了条件は**原仕様に完全準拠**。

---

## 2. ユースケース/成功条件

* **ロビー作成→コード共有→入室→60秒準備→探索→終了/判定→再戦**が**2分以内の操作学習**で成立。
* **体感遅延100ms以下**、通信断復帰は**60秒猶予**ポーズ運用。

---

## 3. システム構成

### 3.1 全体アーキテクチャ

```
[Browser: React+Phaser]  <--WS-->  [CF Workers Router]  --> [Durable Object: RoomInstance]
         |                                    |
   CF Pages / Vercel(静的)             KV(短期メタ)/R2(将来)
```

* **1ルーム=1 DO**。強整合でルーム状態を一元管理。
* 静的ホスティングは Cloudflare Pages または Vercel を想定。どちらの場合も WebSocket は Cloudflare Workers を利用する。

### 3.2 クライアント構成（React + Phaser）

* `App`（ルーティング/グローバル状態）
* `Lobby`（ニックネーム/入室）
* `GameRoot`

  * `OwnerView`（俯瞰UI, ズーム/パン, 編集ツール）
  * `PlayerView`（レイキャスト風一人称）
  * `HUD`（共通/役割別）
* `NetClient`（WS接続・再接続・RTT測定）
* `SoundManager`（SEのみ）
* `Replay/Recording`：v1未実装。

### 3.3 サーバ構成（Workers + DO）

* `router`：WSアップグレード/ルーム発行/入室検証
* `RoomDO`：**ゲームループ(20Hz)**、状態機械、権威判定、ブロードキャスト
  * ルーム生成/ロビーリセット/再戦時に `generateMaze` で新しい迷路(start/goal)を確定し、`goalCell` とプレイヤースポーンを再初期化
* `match`：コード生成（6桁 Base32風, O/I/1/0除外）
* `maze`：生成（棒倒し/穴掘り）、**最短経路下限保証**と**経路維持BFS**
* `rules`：ポイント/ゴールボーナス/罠/資源/クールダウン計算
* `validation`：編集禁止/重なり/資源/経路保証
* `disconnect`：60秒ポーズ→判定確定処理

---

## 4. ゲーム状態機械

```
[CREATED]->[LOBBY]->[COUNTDOWN(3s)]->[PREP(60s:40/5/15)]->[EXPLORE(limit 5..10m)]
   |                                                                               |
   +-------------------------------[TIMEOUT or WIN]--------------------------------+
```

* ロビー待機5分で自動解散。準備は**(ポイント40s→罠5s→予測15s)** 固定。再戦は**同部屋/役割50-50**。
* カウントダウン開始は**ロビー中のオーナーのみ**が `O_START` を送信して実行する。プレイヤー未参加や既に進行中の場合は `START_WAITING_FOR_PLAYER` / `START_UNAVAILABLE` を即時返す。
* DO 内の `phaseEndsAt` は**常にミリ秒タイムスタンプ(number)**で管理し、`state.storage.setAlarm()` に渡す前に `Number.isFinite` と `Invalid Date` をチェックする。不正値（`null`/`NaN`/文字列など）は `console.warn` を出してアラーム設定をスキップし、`server/tests/phase-alarm.test.ts` で DoD を担保する。

---

## 5. データモデル（権威サーバ内）

```ts
type Room = {
  roomId: string; status: 'CREATED'|'LOBBY'|'COUNTDOWN'|'PREP'|'EXPLORE'|'RESULT';
  seed: string; sizeL: 20|40; createdAt: number; timeoutAt?: number;
  owner?: ConnRef; player?: ConnRef;
  rules: Rules; // requiredRate=0.65, goalBonusRate=0.2, trapSlowRate=0.4, etc.
};

type Maze = {
  sizeL: 20|40;
  cells: Uint8Array;        // bitmask（壁/通路）
  walls: Set<Edge>;         // edge=(x,y,dir) dir∈N,E,S,W
  start: Vec2; goal: Vec2;
};

type OwnerState = {
  wallStock: number; wallRemoveLeft: 0|1; trapRights: number;
  traps: Trap[]; predictSites: Vec2[]; cdUntil: number;
  points: PointItem[]; pointLimit: number; pointTotal: number;
};

type PlayerState = {
  pos: {x:number,y:number,angle:number};
  vx:number; vy:number; slowedUntil:number; score:number; previewSeed:string;
  goalBonusAwarded:boolean;
};

type Rules = {
  pointLowerBound:number; pointCountUpper:number;
  requiredRate:number; goalBonusRate:number;
  trapSlowRate:number; trapDurMs:number; // limit/5
};

type PointItem = {x:number,y:number,value:1|3|5};
```

* 仕様の名称/係数はそのまま採用。

---

## 6. 通信仕様（WebSocket, JSON Lines）

### 6.1 コネクション

* `client->router`：`/ws?room=ABC123&role=owner|player&nick=foo`
* ルータが該当`RoomDO`へプロキシ。**DOが唯一の真実**。
* ルータ↔DOハンドシェイク：`/ws` ハンドラは `Upgrade: websocket` と GET を検証したうえで、**元の Request をそのまま Durable Object stub へ `stub.fetch(request)` で委譲する。** Worker 側では `WebSocketPair` を生成せず、ログ (`WS fetch /ws`) を残すのみ。DO 側は `url.pathname.endsWith("/ws")`（`/<DurableObjectId>/ws` 含む）を検出したら `WebSocketPair` を生成し、`server.accept()` → `registerSocket` → `DEBUG_CONNECTED` → `STATE(full)` の順で送信する。join 失敗時は JSON エラー (409/410/500) を直接返し、Worker は Response をそのままクライアントに返却する。DoD: `server/tests/websocket-handler.test.ts` で Request をそのまま stub.fetch に渡し、エラー時もレスポンスを丸ごと返すことを検証し、`server/tests/room-session-websocket.test.ts` で DO が `/ws` と `/<id>/ws` の Upgrade に対して `DEBUG_CONNECTED` / `STATE` を配信することを検証。
* DO でのセッションペイロード検証は router 側で検証済みの `room` 値をそのまま信頼し、**6桁Base32ではない DO ID（`/<DurableObjectId>/ws` 経由）であっても自身の DO ID と一致すれば受け入れる**。JSON body による `roomId` 指定も同様に扱い、`server/tests/disconnect-timeout.test.ts` / `server/tests/prediction-bonus.test.ts` などの再接続シナリオで担保する。
* Cloudflare の DO ルーティングでは `request.url.pathname` に `/<DurableObjectId>/...` のプレフィックスが付与されるため、`RoomDO.fetch()` では `endsWith("/ws")` / `endsWith("/rematch")` のように末尾一致で判定し、Upgrade 要求が GET かつ `Upgrade: websocket` のときのみ 101 を返す。

### 6.2 メッセージ型

**共通：**

```json
// 受信: サーバ→クライアント
{ "t":"STATE", "s": <compact state snapshot> }                 // 周期配信(20Hz) or 重要イベント時
{ "t":"EV", "ev":"COUNTDOWN" | "PREP" | "EXPLORE" | "RESULT", "at": 172..., "payload":{...} }
{ "t":"ERR", "code": "ROOM_FULL|INVALID_NAME|DENY_EDIT|NO_PATH|COOLDOWN|..." , "msg": "..." }
// 送信: クライアント→サーバ
{ "t":"PING", "id":123 }  → { "t":"PONG", "id":123, "svt":172... }
```

**プレイヤー：**

```json
{ "t":"P_INPUT", "yaw": 0.12, "fwd": 1|-1|0, "ts": 172... } // A/D回転, W/S前後
```

**オーナー：**

```json
{ "t":"O_EDIT", "op":"ADD_WALL", "edge": {"x":10,"y":5,"dir":"E"} }
{ "t":"O_EDIT", "op":"DEL_WALL", "edge": {"x":10,"y":5,"dir":"E"} }   // 1回のみ
{ "t":"O_EDIT", "op":"PLACE_TRAP", "pos":{"x":12,"y":7} }
{ "t":"O_EDIT", "op":"PLACE_POINT", "cell":{"x":8,"y":9}, "value":1|3|5 }
{ "t":"O_MRK",  "pos":{"x":11,"y":9} }                                // 予測地点(準備15s)
{ "t":"O_CONFIRM", "target":"<opaque-id>" }                            // 2度押し確定
{ "t":"O_CANCEL",  "target":"<opaque-id>" }
{ "t":"O_START", "mazeSize":20|40 }                                    // 20×20 / 40×40 を指定してカウントダウン開始
```

* **接続直後デバッグ**: WebSocket 接続が成立した瞬間に DO から `DEBUG_CONNECTED` を1度だけ送信し、`roomId`/`role`/`sessionId` を通知する。ブラウザの WS Messages に最低1件表示させ、`wrangler tail` でも `WS fetch /ws` → `DO connected` → `send DEBUG_CONNECTED` → `send STATE` のログを必ず残す。
* `O_START` は受信時に指定された `mazeSize` を用いて `regenerateMaze` と `resetOwnerState` を行ってからカウントダウンへ遷移する。迷路サイズの更新は `server/tests/manual-start.test.ts` / `server/tests/disconnect-heartbeat.test.ts` で検証する。
* **初期STATE保証**: どちらの役割でも初回接続時は `STATE(full:true)` を即時送信する。存在しない場合は `createInitialRoomState` で生成し、`state-broadcast` テストで担保する。
* **致命的エラー**: WebSocket ハンドラで未捕捉の例外が発生した場合は `console.error("WS handler error", err)` を記録し、`{ type:"ERROR", code:"INTERNAL_ERROR" }` を送ってから `socket.close(1011, "internal error")` で終了する。

### 6.3 差分/頻度

* **スナップショット**：Phase遷移/編集確定（`O_CONFIRM`）時は全量、小刻み更新は**位置/スコア等の差分**。
* **サーバ→クライアント送信**は**20Hz**上限の送信キューで排出（通常メッセージはp95で≤2KB、迷路を含む初回フルSTATEは最大約20KBを許容）。クライアント補間表示。
* STATEペイロード内の座標データは `[x,y]`（点/罠/予測）や `[x,y,value]`（ポイント）形式に圧縮し、40×40迷路を含むフルスナップショットでも約20KB以内に収める。
* 差分STATEは送信キューで最新のみ保持し、古い差分は破棄して**遅延を100ms以下に抑える**。
* STATEの `owner` スナップショットには `wallStock`/`wallRemoveLeft`/`trapCharges` に加えて `editCooldownDuration`（ms）と `forbiddenDistance`（マンハッタン距離）が含まれ、クライアントHUDでそのまま表示する（`server/tests/state-sync.test.ts` / `client/tests/AppOwnerForbiddenDistance.test.tsx`）。

---

## 7. ロジック詳細

### 7.1 迷路生成と最短路制約

* アルゴリズム：**棒倒し法/穴掘り法**。生成後に**最短路長 ≥ 4×L** を満たすまで再試行（K=4）。
* `start/goal`は迷路直径の葉ノードから選び、十分距離を取ってランダム配置。ゴールは常に1つ。

### 7.2 経路維持バリデーション

* 編集時：**BFS**で`player→goal`の到達路が**最低1本**あることを確認。**なければ即不許可**。

### 7.3 物理/移動

* **回転**：360°/秒。**移動**：2.0マス/秒。半径0.35マスの円コリジョン。角衝突は**スライド補正**。
* サーバーTickは実時間の経過を用いて積分し、遅延が発生しても移動/回転が上限値を超過しないよう強制。
* レイキャスト視界：FOV 90°、到達4マス（4マス目減光）＋最大90本。遮蔽あり。

### 7.4 罠

* 通路中心のみ。踏むと**速度40%**、**残り制限時間の1/5**持続（連続踏みで延長）。同時2個まで。
* 検証: `server/tests/trap-effects.test.ts`（速度低下・同時設置数）、`server/tests/trap-apply.test.ts`（持続時間延長）

### 7.5 壁資源と編集

* 単位は**1辺=1本**。初期本数（20×20:48本 / 40×40:140本）はRoomDO生成時に `owner.wallStock` へ割り当てる。
* 壁削除権は `owner.wallRemoveLeft` で管理し、**1回のみ**使用可（使用時は壁本数+1で返却）。
* 罠権利は `owner.trapCharges` としてサーバが保持し、**初期値=1**（準備フェーズ即時設置可）。残数0時は `PLACE_TRAP` を拒否。
* **予測地点ボーナス**：通過ごとに**壁+1(70%) or 罠権利+1(30%)**。（RoomDO実装済 / server/tests/prediction-bonus.test.ts）
  * バッチ抽選で長期的に70/30±5%へ収束させる（server/tests/prediction-bonus-ratio.test.ts）
* **禁止エリア**：プレイヤー**マンハッタン距離2**以内編集不可。距離判定はプレイヤー座標をセルインデックスへ切り捨てて算出し、境界付近でも誤検知しない。
* 壁削除は**既存の壁セル**のみ許可。存在しない壁を指定した場合は `DENY_EDIT` で拒否し、削除権/在庫は変化しない。

### 7.6 ポイント/勝敗

* 配置は準備40秒のみ。**合計下限**と**個数上限**適用、下限未達は**不足分をプレイヤー初期ポイント**に補填（上限=規定−1）。
  * 補填で付与されたポイント量は `pointCompensationAward` としてSTATEスナップショットに含め、クライアントHUDで通知する（server/tests/points-scoring.test.ts / client/tests/PlayerViewCompensationNotice.test.tsx）。
* **規定ポイント=ceil(0.65 × 合計配置ポイント)**、ゴールで**規定の1/5加点**。**規定到達で即終了**し、HUD直下に「規定ポイント達成！」通知を表示する（server/tests/points-scoring.test.ts / client/tests/PlayerViewTargetCompletion.test.tsx）。
  * サーバ側は `server/src/logic/rules.ts` に `requiredScore` ヘルパーを用意し、`server/tests/rules.test.ts` の境界テストで係数・切り上げ処理を担保。

### 7.7 切断

* いずれか切断→**即ポーズ**。**60秒**復帰なければ**不在側の敗北**（双方不在はノーゲーム）。（`server/tests/disconnect-timeout.test.ts` / `server/tests/heartbeat-timeout.test.ts` でポーズ維持とハートビート由来の自動切断を検証）

---

## 8. UI/UX実装要点

### 8.1 プレイヤー

* **ミニマップなし**、**ヘッドボブなし**。HUD：残時間（mm:ssタイマー）、現在ポイント/規定ポイント、ゴール到達ボーナス値、達成率(%)進捗バー。
* 不足補填が適用された探索開始時はHUDに「初期ポイント補填 +N」を表示してプレイヤーへ明示する。
* 準備中は**5秒ランダム通路プレビュー**を連続再生（**必ずゴールが1回映る**）。simpleMazePreview のミニマルSVG＋テキストオーバーレイで案内し、`client/tests/PlayerViewPreview.test.tsx` は prep プレビューが描画されるスモークのみ。
  * 詳細なレンガジオメトリや `data-*` 属性検証は撤廃し、床/壁/空の簡素構成だけを維持する。
* 探索フェーズ中のプレイヤービューは迷路データとレイキャスト結果を反映した**レンガ調の一人称描画**とし、黒背景の上に実際の壁ヒット位置へ赤いブリックカラムを描画する。床/天井/側壁は遠近によって暗度を変えたレンガパターンで埋め、開いている方向はカラムが欠けて通路が見えるようにする（`client/tests/PlayerViewRaycaster.test.tsx`）。
* Canvas描画ループは `useFixedFrameLoop` で `requestAnimationFrame` を間引き、30fps上限を保証する。
* **切断ポーズ中**はプレイヤー/オーナー共通で画面中央に半透明オーバーレイを重ね、「通信が途切れています」「残りXX秒で不在側敗北」をカウントダウン表示する（復帰で自動解除）。
* 更新メモ(2025-10-03): start/junction/goal プレビューの床・壁ジオメトリ、フェード、空色ポータル占有率を仕様どおりに最終調整（PlayerView.tsx / PlayerViewPreview.test.tsx 反映）
* 更新メモ(2025-11-24): プレビューSVGを簡略化し、PlayerViewPreview.test.tsx をスモーク化（詳細ジオメトリ/データ属性検証を削除、simpleMazePreview.tsへ集約）
* 更新メモ(2025-12-03): FancyMazePreview の junction を左右2レイヤーの横通路＋forward=false時のみ前壁で十字路風に調整し、`client/tests/fancyMazePreview.test.tsx` で回帰
* 更新メモ(2025-12-18): simpleMazePreview を「床1枚＋左右壁1枚」の輪郭に固定し、junction/goals で forward 開放時に前壁を描かないことと分岐の狭まりを `client/tests/simpleMazePreview.test.tsx` で回帰検証
* 更新メモ(2025-12-19): simpleMazePreview のオーバーレイを極薄にし、junction の左右開口を穴あき壁＋短い横廊下で表現（`client/tests/simpleMazePreview.test.tsx` で回帰）
* 更新メモ(2025-12-20): simpleMazePreview を旧レイキャスト風の一本道・単一輪郭に寄せ、左右開口を四角い切り欠き＋短い横廊下で描画（`client/tests/simpleMazePreview.test.tsx` 回帰）

### 8.2 オーナー

* 俯瞰全体マップ、**ズーム/パン**（最小=迷路全体, 最大=9マスを画面内）。初期表示は40×40でも全域が欠けないズーム（等倍）で描画し、ビューポート自体も 480px 角の固定サイズを確保する（client/src/views/OwnerView.tsx / client/tests/OwnerView.test.tsx）。
* プレイヤー位置のマーカーは **セルを覆わない小型の上向き三角形(▲)** とし、禁止距離サークルと重なっても迷路や罠/予測の視認性が損なわれないようにする。`client/tests/OwnerView.test.tsx` でSVGポリゴン・辺長が1マス未満であることを検証する。
* ロビー（`phase=lobby`）中は迷路/HUDを描画せず、「ゲーム開始」を押すと迷路自動設計と60秒の準備フェーズが始まる旨を案内する。ボタン押下後（`countdown`/`prep`/`explore`）のみ俯瞰マップと初期設定HUDを表示し、**罠権利/同時設置数**、**禁止エリア距離**、**編集クールダウン残り**、**予測地点の残り数**、**設定可能な残り時間**だけに絞る（壁残数や得点は表示しない）。（client/src/views/OwnerView.tsx / client/tests/OwnerView.test.tsx / client/tests/AppPredictionIntegration.test.tsx / client/tests/AppOptimisticUi.test.tsx / client/tests/OwnerCooldownDisplay.test.tsx / client/tests/AppOwnerForbiddenDistance.test.tsx）。
* 準備フェーズ中はHUD直下に **罠🪤 / 予測地点🎯 の配置パレット**を表示し、ドラッグ＆ドロップ（またはアクセシビリティ向けのクリック→マップクリック）で通路上に配置できるようにする。ドロップ時に `O_EDIT(PLACE_TRAP)` / `O_MRK` を送信し、設置後は自動的に選択解除。迷路データ未受信やフェーズ外ではパレットを無効化し、残り時間内に「罠1個 + 予測地点3個」の初期目標を説明する（client/src/views/OwnerView.tsx / client/tests/OwnerView.test.tsx）。
* 編集は**確認ポップ→同じ場所を再クリックで確定**。**右クリック/Escでキャンセル**。**1.0秒CD**。
* ロビー中は参加状況（オーナー/プレイヤーの入室可視化）と「ゲーム開始」ボタンを表示。プレイヤー入室後のみ有効化し、押下で `O_START` を送信してカウントダウンを始動する。ボタン直上には**迷路サイズ選択（20×20 / 40×40）**用のメニューを配置し、オーナーは開始時に希望サイズを指定できる（client/tests/OwnerView.test.tsx）。
* 接続後はヘッダー部に**現在のルームID**を常時表示し、取得前は「取得中」とプレースホルダーを出す。オーナー自身がコードを共有できるよう `client/tests/OwnerView.test.tsx` でDOM表示を検証する。
* 迷路自動生成完了後は `STATE.snapshot.maze` で受信したセル/壁データをもとに俯瞰マップへ実際の壁レイアウトを描画し、スタート/ゴールセルを薄くハイライトする。迷路データ未受信時は「迷路生成中…」の代替表示へ切り替える（client/tests/OwnerView.test.tsx / server/tests/state-sync.test.ts）。

### 8.3 サウンド

* SEのみ。初期音量70%。**壁/罠の視界反映は無演出即時**。
* `SoundBus` が全SEの音量を0〜1でクランプ管理し、トグルで一括ミュート・未登録ID再生時は警告のみを出す。

### 8.4 デバッグHUD

* `App` 下部に `DebugHUD` を常設し、**速度/視界/ズーム倍率/編集CD/禁止距離/資源上限/ポイント係数/罠効果**などの仕様値と現在値を一覧表示する。オーナービューではロビー（`phase=lobby`）中のみヘッダー右上に「設定」ボタンを表示し、押下中だけDebugHUDを展開する。`countdown` 以降やプレイヤービューでは一切表示しない（client/src/views/OwnerView.tsx / client/tests/OwnerView.test.tsx / client/tests/DebugHUD.test.tsx / client/src/ui/DebugHUD.tsx）。

---

## 9. エラーハンドリング/リジェクト理由

### 9.1 クライアント側（表示）

* **トースト + 赤アウトライン**＋短文原因。
* 代表コード（`ERR.code`）：

  * `INVALID_NAME`（文字種/長さNG）
  * `INVALID_ROOM`（ルームコード不正：Base32風6桁〈O/I/0/1除外〉ではない）
  * `ROOM_NOT_FOUND` / `ROOM_FULL` / `ROOM_EXPIRED`
  * `DENY_EDIT`（禁止エリア/資源不足/重ね不可）
  * `TRAP_INVALID_CELL`（罠を通路中心に置いていない）
  * `NO_PATH`（経路保証違反）
  * `EDIT_COOLDOWN`（連続編集。`data.remainingMs` で残りCDを通知。`server/tests/owner-edit-cooldown.test.ts` で検証済み）
  * `LIMIT_REACHED`（予測/罠/本数上限）
  * `PHASE_LOCKED`（フェーズ外操作）
* 表示文言例：

  * `ROOM_FULL` → 「ルームが満員です。別のルームIDを使用してください。」
  * `INVALID_NAME` → 「ニックネームが不正です。使用可能な文字で入力してください。」
  * 未定義コード → 「不明なエラーが発生しました。時間をおいて再試行してください。」
* トーストは約3.5秒で自動消失し、同時に複数件を重ねて表示できる。

### 9.2 サーバ側（ロジック）

* **検証順序**（重要）：Phase→対象範囲→資源→重なり→**経路BFS**→CD→確定→ブロードキャスト。
* すべて**サーバで確定**、クライアントは楽観描画せず**権威更新を待つ**。
* 初回STATEを受信するまでは `App` が「接続待機中」ビューのみを表示し、Owner/PlayerビューやHUDはレンダリングしない。
* ロビー画面ではニックネーム入力（2〜10文字、英数・ハイフン・アンダースコア、入力時に大文字へ正規化）とルームコード入力（Base32風6桁でO/I/0/1を除外）を提供し、`POST /rooms`（HTTPエンドポイントは `VITE_HTTP_ORIGIN` または `VITE_WS_URL` 由来の https 化）で新規ルームIDを発行してオーナーとして接続する。既存ルーム参加は役割（owner/player）ラジオを選択し、ニックネーム・コードが有効な場合のみ `setRoom` を通じて WebSocket 接続を開始する。HTTP エンドポイントを解決できない場合はロビーに警告を表示し、ルーム作成ボタンを無効化して環境変数設定を促す。検証エラーは `INVALID_NAME` / `INVALID_ROOM`、通信失敗は `NETWORK_ERROR` トーストで通知する。

---

## 10. 非機能/パフォーマンス

* 首描画30fps、**サーバ送信20Hz**、**STATE差分はp95で2KB以下/フルSTATEは20KB以下**を目安。
* ルーム同時接続2名、**ポーズ中もTick継続**（最小化）。
* **起動→ロビー3秒以内**（キャッシュ後）。**対応ブラウザ**：最新Chrome/Edge/Firefox。

---

## 11. セキュリティ/公平性

* クライアント入力は**速度/回転の制約内**でサーバ積分。
* 不正検知：入力レート上限、**過去時刻ts拒否**（直前より古いタイムスタンプはリプレイ扱いで破棄）、未来時刻補正、位置スナップ（迷路境界外/非有限値は再配置し、許容距離超過は直前座標へスナップ＋記録）。
* オーナー操作は**1.0秒CD**＋フェーズ/範囲検証。

---

## 12. 設定/チューニング

* ルーム作成時パラメータ：

  * `sizeL`: 20|40（default 40）
  * `timeLimitSec`: 300..600（default 300）
* ビルド時環境：

  * `VITE_WS_URL`, `CF_ACCOUNT_ID`, `CF_WORKERS_API_TOKEN`, `CF_PAGES_API_TOKEN`, `CF_PAGES_PROJECT`, `SENTRY_DSN`（任意）など。`VITE_WS_URL` はクライアント初期化時の必須値で、未設定だとアプリのロードが即座に失敗する。

---

## 13. 実装計画（MVP→拡張）

1. **基盤**：WS接続/再接続, ルーム生成/入室, STATE同期
2. **迷路**：生成＋最短路下限制約、start/goal配置
3. **移動/視界**：20Hz積分, スライド補正, レイキャスト描画
4. **資源/編集**：壁追加/削除/罠, 確認2クリック, CD, 禁止/重なり/経路BFS
5. **ポイント/勝敗**：配置UI, required計算, ゴールボーナス, 即終了
6. **準備フェーズ演出**：通路プレビュー（ゴール必ず映る）
7. **切断/ポーズ/復帰**
8. **音/HUD/細部UI**
9. **最適化/負荷/計測/リグレッション**

---

## 14. ディレクトリ/技術詳細

```
/client
  /src
    /net (NetClient.ts, types.ts)
    /views (OwnerView.tsx, PlayerView.tsx, HUD.tsx)
    /game (Raycaster.ts, Physics.ts, Assets/, Sound.ts)
    /state (zustand等)
    main.tsx
/server
  router.ts
  room-do.ts
  logic/ (maze.ts, rules.ts, validate.ts, bfs.ts)
  schema/ (ws.ts, state.ts)
  utils/ (rng.ts, id.ts, time.ts)
```

---

## 15. デプロイ/運用

* **サーバ**：Cloudflare Workers + Durable Objects を本番環境にデプロイ済み。稼働中の WebSocket エンドポイントは `wss://meiro-server.minamidenshi.workers.dev/ws` で、接続確認ログを `docs/deployment-log.md` に記録済み。
* **クライアント（Cloudflare Pages 静的ホスト）**：
  * Cloudflare Pages プロジェクトを作成し、リポジトリの `client` ディレクトリをビルド対象に設定。
  * Build Command=`npm run build --workspace @meiro/client`、Output Directory=`client/dist`。
  * 初回ビルドの出力（例: `client/dist/index.html`）と設定内容は `docs/deployment-log.md` に記録し、再現手順を残している。
  * 環境変数 `VITE_WS_URL` に Cloudflare Workers の WebSocket オリジン `wss://meiro-server.minamidenshi.workers.dev` を設定（Production/Preview 両方。設定内容は `docs/deployment-log.md` 2024-05-22 記録で追跡）。
  * GitHub 連携で Cloudflare Pages を構成し、main/Pull Request ごとに自動ビルド/デプロイが走る運用を推奨。
* **動作検証**：デプロイ完了後、Cloudflare Pages 上のクライアントからルーム作成→接続→フェーズ遷移までを確認し、問題時はログ収集（実施ログは `docs/deployment-log.md` 2024-05-23 記録）。
* **ドキュメント**：README などの手順書に Cloudflare Pages + Cloudflare Workers の併用構成を記載し、再現手順が明文化されていること（`README.md` の「Cloudflare Pages + Cloudflare Workers 併用デプロイ手順」節で手順/確認項目を列挙）。

* **依存**：React, Phaser, zod(スキーマ), colyseus/protobufなし(JSONでOK), vite, workers-types。
* **シリアライズ**：JSON（要コンパクト化：短key/数値配列）。
* ルートに `README.md` を置き、モノレポ構成と主要コマンドを記載。
* 配布ライセンスは MIT。`LICENSE` と `NOTICE` をルートに配置し、著作権表記を明示。
* ブランチ戦略は `main` を安定ブランチとし、`feature/*`・`fix/*` からPR経由で取り込む。
* CI は `.github/workflows/ci.yml` でフォーマットチェック・Lint・Typecheck・Test を自動実行。
* PR作成時は `.github/workflows/deploy-preview.yml` で Cloudflare Workers/Pages のプレビューデプロイを実施。`npm run lint` → `npm run typecheck` → `npm test` → `npm run build --workspace @meiro/client` を経て、`cloudflare/wrangler-action@3` で `wrangler deploy --env preview` を実行し、続けて `cloudflare/pages-action@v1` で `client/dist` を Pages プロジェクトへアップロード。必要なシークレットは `CF_ACCOUNT_ID`/`CF_WORKERS_API_TOKEN`/`CF_PAGES_API_TOKEN`/`CF_PAGES_PROJECT` を想定。
* リリース作業は `CHANGELOG.md` を更新し、`npm run format && npm run lint && npm run typecheck && npm test` を通したうえで `git tag -a vX.Y.Z` を発行し push するフローを README「リリースフロー」に明記する。併せてロールバック手順と過去リリース保持方針も README に記載し、`packages/common/tests/release-process.test.ts` で両方を検証。

---

## 15. 疎通/サンプルフロー（時系列）

1. Owner: `POST /create` → `roomId`取得 → WS接続
2. Player: `roomId`入力 → WS接続
3. DO：`LOBBY→COUNTDOWN(3s)→PREP(60s)`をブロードキャスト
4. Owner：ポイント配置→罠→予測、各確定で`STATE`更新
5. Explore開始：Player入力`P_INPUT`をサーバ積分→位置/スコア配信
6. Owner編集：`O_EDIT`→検証→確定→`STATE`配信
7. Player規定到達→`RESULT`配信→再戦フロー

---

## 16. ロギング/計測/運用

* **クライアント**：起動, 接続, Phase遷移, 操作失敗（ERR.code別）, RTT, FPS。
* **サーバ**：部屋寿命, 参加/離脱, Phase時間, 編集拒否率, BFS所要時間, メッセージサイズ。  
  * BFS検証は `owner.path_check` メトリクスで記録（`durationMs`, `blocked`, `checked`）
* アラート：**WS失敗率/再接続率/STATE遅延>100ms**（`client.ws.alert` / `client.ws.reconnect.alert` / `client.latency.alert` を発火）。
* **エラートラッキング**：`client/src/logging/sentry.ts` で Sentry を初期化し、`VITE_SENTRY_DSN` 指定時のみ `@sentry/browser` を有効化。`client/tests/SentryInit.test.ts` で DSN 有無と例外送信を検証。
* **ログ方針**：Durable Object やクライアントテレメトリは `console.info` / `console.warn` / `console.error` のみに限定し、ユーザ入力（`nick` などの PII）を含めない。`packages/common/tests/logging-safety.test.ts` で静的検査する。

---

## 17. テスト計画（実行順）

### 17.1 ユニット

* `maze.generate(seed,L)`：**連結性**、**最短路≥4×L**、ランダム種で**1,000回**性質テスト（Property-Based）。
* `rules.required(total)=ceil(0.65*total)` 正確性。
* `validate.edit`：禁止エリア/資源/重なり/経路BFS/クールダウン（`server/tests/owner-path-block.test.ts` で禁止距離と経路維持を担保）。
* `physics.integrate`：壁スライド/角抜けしない（`packages/common/tests/physics.integrate.test.ts` で担保）。
* `trap.apply`：重複踏み延長（`server/tests/trap-apply.test.ts` で既存slowUntilへの加算を検証）。
* `points.lowerBound補填`：上限=規定−1のクリップ（`server/tests/points-scoring.test.ts` で検証）。

### 17.2 結合/シミュレーション

* **Bot**（Player/Owner）で**5,000 Tick**連続対戦：

  * 経路封鎖を**常に拒否**できること
  * 予測地点通過→資源ランダム付与の**比率収束（70/30±5%）**
  * DEL_WALLは**1回のみ**
* 切断再接続：60秒以内復帰→ポーズ解除、超過→規定の勝敗遷移。

### 17.3 負荷/安定

* 20ルーム同時（40接続）で**STATE遅延p95≤150ms**, メッセージp95≤2KB（`server/tests/state-latency-load.test.ts`）。※迷路を含む初回フルSTATEのみ約20KB。
* BFS検証p95≤1ms/編集。
* 連続編集CDの**サーバ強制**確認。

### 17.4 UX/受入（Acceptance）

* 仕様数値（速度/視界/HUD/ズーム倍率/クールダウン/禁止半径/上限下限）が**全て目視確認**できるデバッグHUD。
* 準備中プレビューに**必ずゴール映像が含まれる**（3枚の静止クリップを5秒間隔で表示し、ゴール直前クリップを1回含める）。simpleMazePreview の簡素SVGを採用し、`client/tests/PlayerViewPreview.test.tsx` のスモークで prep プレビューがクラッシュしないことのみ確認（詳細ジオメトリ/データ属性検証は撤廃）。
* プレビュー画像は地面テクスチャや2色床を廃し、暗い壁×淡い通路のハイコントラストと前方グローだけで通路を明瞭に示す。
* 探索中ビューも黒背景＋全て赤線/赤ドットのワイヤーフレームで幾何学的に表示し、Canvasレイヤーだけで通路立体感を再現する。
* ゴール到達＝**即終了ではなく**規定未達なら続行し、**規定到達で終了**。

---

## 18. 既知の未実装/将来項目

* 観戦/履歴/統計/リプレイ/チュートリアル/テーマスキン（将来）。

---

## 19. リスク/落とし穴

* **経路BFSの頻発**：編集連打時の負荷。→ CD1.0s＋**近傍差分BFS**（`RoomDurableObject` が経路キャッシュ/ブロックキャッシュを保持し、`server/tests/owner-path-block.test.ts` で `owner.path_check.checked=false` を確認）で局所チェック最適化。
* **視界レイキャストの負荷**：FOV90°×レイ数。→ 最大90本/距離4マスで打ち切り（`client/tests/Raycaster.test.ts`）。
* **切断処理**：ブラウザ閉じ/スリープ多発。→ ハートビート＋**サーバ側60秒タイマー**（`server/tests/disconnect-timeout.test.ts` / `server/tests/heartbeat-timeout.test.ts`）。

---

## 20. 開発・動作手順（最小再現）

```bash
# client
npm run dev --workspace @meiro/client    # http://localhost:5173
# server (wrangler)
npm install --workspace @meiro/server
npm run dev --workspace @meiro/server -- --local
```

* .env（例）

* `VITE_WS_URL=ws://127.0.0.1:8787`
  * `NODE_ENV=development`
* `wrangler.toml` はベース設定に加えて `env.local` / `env.dev` / `env.preview` / `env.prod` を持ち、環境ごとの `name` / ルーティング or `workers_dev` / `WS_ORIGIN` / `ENVIRONMENT` を定義（`server/tests/wrangler-config.test.ts`）

---

## 21. 受け入れチェックリスト（抜粋）

* [x] ロビー5分自動解散
* [x] カウントダウン3s → 準備(40/5/15)固定（`server/tests/prep-phase-windows.test.ts`）
* [x] 20×20/40×40、**最短≥4×L**（`server/tests/room-maze-initialization.test.ts`）
* [x] 視界：FOV90°, 到達4マス（4マス目減光）＋迷路セルを2倍格子に投影してASCIIワイヤーフレームと床/壁レイヤーを動的描画し、4マス以遠は黒フォグで遮光＆閉じた壁面にはテクスチャストライプを描く（`client/tests/PlayerViewRaycaster.test.tsx`）
* [x] プレイヤービュー：正面方向のみのワイヤーフレームに奥行きを反映し、dead-end / corner / junction 判定を `dataset` と描画で提示（`client/tests/PlayerViewRaycaster.test.tsx` 追加テスト）
* [x] プレビュー：simpleMazePreview による prep スモーク（床/壁/空の簡素SVG。詳細ジオメトリ検証は撤廃、`client/tests/PlayerViewPreview.test.tsx`）
* [x] 壁：初期本数、削除1回、CD1.0s、禁止半径2、経路維持（`server/tests/owner-resources.test.ts` / `server/tests/owner-path-block.test.ts` / `client/tests/OwnerView.test.tsx` / `client/tests/DebugHUD.test.tsx` / `client/tests/AppOwnerForbiddenDistance.test.tsx`）
* [x] 罠：40%速度、limit/5、同時2
* [x] ポイント：下限不足→初期ポイント補填（上限=規定−1）
* [x] 規定=ceil(0.65×合計)、ゴール+規定1/5、**規定到達で終了**（`server/tests/points-scoring.test.ts`）
* [x] 切断→即ポーズ→60秒勝敗
* [x] 30fps/20Hz/遅延100ms以下（`client/tests/FrameLoop.test.tsx` / `server/tests/outbound-rate-limit.test.ts` / `client/tests/NetClientLatency.test.ts` / `server/tests/metrics-alerts.test.ts`）

---

## 22. 変更容易性のための設計ノート

* **パラメトリック**：全係数は`rules`に集約（A/Bやイベントで差し替え可）。
* **ステート分離**：`Room`/`Maze`/`OwnerState`/`PlayerState`/`Rules`を疎に。
* **メッセージ後方互換**：`t`/`op`の列挙拡張、未知フィールドは無視。

---

## 23. 付記：不確実点と仮定

* レイキャスト実装は**Phaser上の自前**とし、シェーダは必須ではない（パフォーマンス次第で最適化）。
* JSON圧縮は**まず不要**、サイズ上限内で運用。
* 罠持続の「制限時間」は**ラウンド設定時間**に依存（例：5分→60秒）として実装。

---

**次アクション（すぐ始める）**

1. `RoomDO`の雛形と20Hzループを作成（STATEスケルトン配信）。
2. 迷路生成＋BFSユニットテスト（1,000ケース）。
3. Player移動/衝突/視界のMVP → Owner編集のMVP → 勝敗処理。

不明点が出たら、上記仕様の「受入れチェックリスト」に照らして判断してください。


Medical References:
1. None — DOI: file-KpXCKMcQWrqAEiT6RG2RjV
