# シャードキュー実装 技術ドキュメント

## 目的

スプレッドシートへの同時書き込み時の競合を軽減し、高負荷時の安定性を向上させる。

---

## アーキテクチャ

```
リクエスト
    ↓
本テーブルへ直接書き込み試行（2秒ロック）
    ↓
┌─成功─→ 即時反映 → 「保存しました」
│
└─失敗─→ シャードキュー（10枚）へフォールバック
          → 「反映まで最大1分かかる場合があります」
              ↓（バッチ処理：1分間隔トリガー）
          本テーブルへ一括移動（setValues）
```

---

## 変更ファイル一覧

### バックエンド（GAS）

| ファイル | 変更内容 |
|----------|----------|
| `Code.gs` | シャード定数、ヘルパー関数、DEBUG_ENTRY制御、loadtestハンドラ |
| `StudentAPI.gs` | submitForm → 本テーブル優先＋シャードフォールバック |
| `ReadingAPI.gs` | addReadingRecord → 本テーブル優先＋シャードフォールバック |
| `BatchProcessor.gs` | シャード巡回処理、クリーンアップ関数群 |

### フロントエンド

| ファイル | 変更内容 |
|----------|----------|
| `index.html` | キュー時メッセージ表示（submitForm, addReadingRecord） |

---

## 追加関数一覧

### Code.gs

| 関数名 | 用途 |
|--------|------|
| `getShardIndex_(count)` | ランダムなシャードインデックス取得 |
| `getResponseQueueSheetName_(i)` | `ResponseQueue_X` シート名取得 |
| `getReadingQueueSheetName_(i)` | `ReadingRecordQueue_X` シート名取得 |
| `isDebugEntryEnabled_()` | デバッグエンドポイント有効判定 |

### BatchProcessor.gs

| 関数名 | 用途 |
|--------|------|
| `processResponseQueueShards_()` | Responseシャード10枚を巡回処理 |
| `processReadingRecordQueueShards_()` | ReadingRecordシャード10枚を巡回処理 |
| `initializeShardQueues()` | シャードシート20枚を事前作成 |
| `cleanupAllQueues()` | 全キューの処理済みデータ削除（トリガー用） |
| `cleanupShardQueues_()` | シャードキューのみクリーンアップ |
| `cleanupLoadTestData()` | 負荷テストデータのみ削除 |
| `setupNightlyCleanupTrigger()` | 夜間クリーンアップトリガー設定 |

---

## スクリプトプロパティ

| プロパティ名 | 値 | 説明 |
|-------------|-----|------|
| `DEBUG_ENTRY` | `true` / `1` | 負荷テストエンドポイント有効 |
| `DEBUG_ENTRY` | `false` / 未設定 | 負荷テストエンドポイント無効（本番推奨） |

---

## シャードキューシート構成

### ResponseQueue_0 〜 ResponseQueue_9

| 列 | 内容 |
|----|------|
| Timestamp | 送信日時 |
| SessionID | セッションID |
| Email | ユーザーメール |
| Answers_JSON | 回答データ（JSON） |
| Status | pending / processed |
| QueuedAt | キュー追加日時 |

### ReadingRecordQueue_0 〜 ReadingRecordQueue_9

| 列 | 内容 |
|----|------|
| Timestamp | 送信日時 |
| RecordID | レコードID |
| Year | 年度 |
| Email | ユーザーメール |
| Term | 学期 |
| Category | カテゴリ |
| StartMonth | 開始月 |
| BookTitle | 書籍タイトル |
| ReadAmount | 読書量 |
| Evaluation | 評価 |
| CreatedAt | 作成日時 |
| Status | pending / processed |
| QueuedAt | キュー追加日時 |

---

## フロントエンド仕様

### メッセージ表示

| 状況 | メッセージ | 種別 |
|------|----------|------|
| 本テーブル直書き成功 | 「保存しました」「記録しました」 | success |
| シャードキューへフォールバック | 「反映まで最大1分かかる場合があります（再読込が必要）」 | info |

---

## 負荷テストツール

### 使用方法

```bash
# 読み込みテスト
python tools/load_test.py -n 10 -w 5

# 書き込みテスト（Response）
python tools/load_test.py --mode write --type response -n 10 -w 5

# 書き込みテスト（ReadingRecord）
python tools/load_test.py --mode write --type reading -n 10 -w 5
```

> ⚠️ 負荷テスト機能は `DEBUG_ENTRY = true` の場合のみ有効

### テストデータ削除

```
GASエディタで実行: cleanupLoadTestData()
```

---

## 性能特性

| 負荷パターン | 本テーブル直書き | 平均応答時間 |
|-------------|-----------------|-------------|
| 5並列 50件（通常負荷） | 100% | 約3秒 |
| 80並列 300件（極端な高負荷） | 約2% | 約10秒 |

---

## トリガー設定

| トリガー | 実行関数 | 頻度 | 備考 |
|----------|----------|------|------|
| バッチ処理 | `processAllQueues` | 1分間隔 | 既存維持 |
| 夜間クリーンアップ | `cleanupAllQueues` | 毎日2:00AM | 新規追加 |
| 日次バックアップ | `backupDatabase` | 毎日3:00AM | 既存維持 |

---

## デプロイ手順

1. **スクリプトプロパティ設定**
   - `DEBUG_ENTRY = true` を追加（検証時のみ）

2. **コードデプロイ**
   - `Code.gs`, `StudentAPI.gs`, `ReadingAPI.gs`, `BatchProcessor.gs`, `index.html` をコピー

3. **シャードシート初期化**
   - `initializeShardQueues()` を実行

4. **トリガー設定**
   - `setupNightlyCleanupTrigger()` を実行

5. **動作確認**
   - フォーム送信テスト
   - `processAllQueues()` 手動実行

6. **本番設定**
   - `DEBUG_ENTRY` を `false` に変更または削除
