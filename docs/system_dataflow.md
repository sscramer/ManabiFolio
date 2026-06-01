# ManabiFolio システムデータフロー図

本ドキュメントでは、ManabiFolioシステムのバックグラウンド処理（キューイング・バックアップ）を含むデータフローを図解します。

---

## システム全体のデータフロー

```mermaid
flowchart TB
    subgraph Client["ユーザー端末"]
        UI["Webインターフェース<br/>（index.html）"]
    end

    subgraph GAS["Google Apps Script"]
        API["フロントエンドAPI<br/>（StudentAPI / TeacherAPI）"]
        Batch["バッチプロセッサ<br/>（BatchProcessor.gs）"]
        Backup["バックアップ処理<br/>（backupDatabase）"]
    end

    subgraph Storage["Google Spreadsheet（データベース）"]
        subgraph MainSheets["メインシート"]
            Users["Users"]
            Sessions["Sessions"]
            Responses["Responses"]
            ReadingRecords["ReadingRecords"]
            InterviewRecords["InterviewRecords"]
            StudyLogs["StudyLogs"]
            IGPRecords["IGPRecords"]
        end
        subgraph QueueSheets["キューシート"]
            ResponseQueue["ResponseQueue"]
            ReadingRecordQueue["ReadingRecordQueue"]
        end
    end

    subgraph Backup_Storage["Google Drive"]
        BackupFiles["バックアップファイル<br/>ManabiFolio_backup_YYYYMMDD"]
    end

    UI --> API
    API --> MainSheets
    API -.高負荷時.-> QueueSheets
    Batch --> QueueSheets
    Batch --> MainSheets
    Backup --> Storage
    Storage --> BackupFiles
```

---

## 関連ドキュメント

- **DB仕様書**: [database_schema.md](./database_schema.md) - 全シートのカラム定義とER図

---

## キューイングシステムの詳細フロー

```mermaid
flowchart TB
    subgraph UserAction["ユーザー操作"]
        Submit["回答/記録を送信"]
    end

    subgraph API["API処理（StudentAPI.gs / ReadingAPI.gs）"]
        TryLock["ロック取得を試行<br/>（30秒タイムアウト）"]
        LockSuccess{"ロック取得<br/>成功？"}
        DirectWrite["直接書き込み<br/>（即時反映）"]
        QueueWrite["キューに書き込み<br/>（Status: pending）"]
    end

    subgraph Sheets["スプレッドシート"]
        Responses["Responses<br/>（振り返り回答）"]
        ReadingRecords["ReadingRecords<br/>（読書記録）"]
        ResponseQueue["ResponseQueue"]
        ReadingRecordQueue["ReadingRecordQueue"]
    end

    subgraph BatchJob["バッチ処理（1分間隔トリガー）"]
        ProcessQueue["processAllQueues()"]
        ProcessResponse["processResponseQueue_()"]
        ProcessReading["processReadingRecordQueue_()"]
        MoveData["キューからメインシートへ移動<br/>Status: pending → processed"]
    end

    Submit --> TryLock
    TryLock --> LockSuccess
    LockSuccess -->|成功| DirectWrite
    LockSuccess -->|失敗（競合）| QueueWrite
    DirectWrite --> Responses
    DirectWrite --> ReadingRecords
    QueueWrite --> ResponseQueue
    QueueWrite --> ReadingRecordQueue

    ProcessQueue --> ProcessResponse
    ProcessQueue --> ProcessReading
    ProcessResponse --> MoveData
    ProcessReading --> MoveData
    MoveData --> Responses
    MoveData --> ReadingRecords
```

---

## 面談記録のデータフロー【新機能】

```mermaid
flowchart TB
    subgraph Teacher["教員操作"]
        SelectStudent["生徒を選択"]
        AddRecord["面談記録を追加"]
        ViewHistory["過去記録を閲覧"]
    end

    subgraph API["InterviewAPI.gs"]
        GetStudents["getInterviewSummaryByClass()"]
        GetRecords["getStudentInterviews()"]
        SaveRecord["addInterviewRecord()"]
        UpdateRecord["updateInterviewRecord()"]
        DeleteRecord["deleteInterviewRecord()"]
    end

    subgraph Storage["スプレッドシート"]
        UserProfiles["UserProfiles<br/>（生徒情報）"]
        InterviewRecords["InterviewRecords<br/>（面談記録）"]
    end

    SelectStudent --> GetStudents
    GetStudents --> UserProfiles
    GetStudents --> InterviewRecords

    ViewHistory --> GetRecords
    GetRecords --> InterviewRecords

    AddRecord --> SaveRecord
    SaveRecord --> InterviewRecords

    Teacher --> UpdateRecord
    UpdateRecord --> InterviewRecords

    Teacher --> DeleteRecord
    DeleteRecord --> InterviewRecords
```

### InterviewRecordsシートの構造

| カラム | 型 | 説明 |
|--------|-----|------|
| Id | string | 記録ID（int_YYYYMMDD_HHMMSS_xxx） |
| StudentEmail | string | 生徒メールアドレス |
| InterviewDate | date | 面談日 |
| Roles | json | 対応者役割（JSON配列） |
| TeacherEmail | string | 記録教員 |
| Content | string | 面談内容 |
| CreatedAt | datetime | 作成日時 |

> **Note**: 年度情報を持たないため、年度を跨いでも同一生徒の記録を参照可能

---

## キューシートの構造

### ResponseQueue（振り返り回答キュー）

| カラム | 説明 |
|--------|------|
| Timestamp | 回答タイムスタンプ |
| SessionID | セッションID |
| Email | ユーザーメールアドレス |
| Answers_JSON | 回答データ（JSON形式） |
| Status | pending / processed |
| QueuedAt | キュー追加日時 |

### ReadingRecordQueue（読書記録キュー）

| カラム | 説明 |
|--------|------|
| Term | 学期 |
| Type | 種別（朝読書/その他） |
| Month | 読み始めた月 |
| Title | 書籍タイトル |
| Amount | 読んだ量 |
| Rating | 評価 |
| Email | ユーザーメールアドレス |
| Status | pending / processed |
| QueuedAt | キュー追加日時 |

---

## バックアップシステムの詳細フロー

```mermaid
flowchart TB
    subgraph Trigger["日次トリガー"]
        DailyTrigger["毎日 AM 3:00"]
    end

    subgraph Process["backupDatabase()"]
        GetSS["データベース<br/>スプレッドシート取得"]
        CreateCopy["ファイルをコピー<br/>ManabiFolio_backup_YYYYMMDD"]
        CheckFolder{"BACKUP_FOLDER_ID<br/>設定あり？"}
        SaveToFolder["指定フォルダに保存"]
        SaveToRoot["ルートに保存"]
    end

    subgraph Storage["Google Drive"]
        BackupFolder["バックアップフォルダ"]
        RootFolder["マイドライブ"]
    end

    DailyTrigger --> GetSS
    GetSS --> CreateCopy
    CreateCopy --> CheckFolder
    CheckFolder -->|あり| SaveToFolder
    CheckFolder -->|なし| SaveToRoot
    SaveToFolder --> BackupFolder
    SaveToRoot --> RootFolder
```

---

## トリガー設定一覧

| トリガー | 関数 | 実行間隔 | 目的 |
|---------|------|---------|------|
| 時間主導型 | `processAllQueues()` | 1分ごと | キューの処理 |
| 時間主導型 | `backupDatabase()` | 毎日AM3:00 | データバックアップ |
| 時間主導型 | `cleanupProcessedQueue_()` | 週1回（任意） | 古いキューデータの削除 |

---

## キュー処理の状態遷移

```mermaid
stateDiagram-v2
    [*] --> pending: ユーザーが送信（ロック競合時）
    pending --> processed: バッチ処理でメインシートに移動
    processed --> [*]: cleanupで削除（1週間後）
```

---

## エラー発生時のフロー

```mermaid
flowchart TB
    subgraph NormalFlow["通常フロー"]
        User["ユーザー送信"]
        TryLock["ロック取得試行"]
        Success["正常完了<br/>（即時/キュー経由）"]
    end

    subgraph ErrorHandling["エラー発生時"]
        LockFail["ロック取得失敗"]
        QueueFallback["キューに退避"]
        BatchRetry["バッチ処理でリトライ"]
        BatchFail["バッチ処理失敗"]
        Manual["手動確認が必要"]
    end

    User --> TryLock
    TryLock -->|成功| Success
    TryLock -->|タイムアウト| LockFail
    LockFail --> QueueFallback
    QueueFallback --> BatchRetry
    BatchRetry -->|成功| Success
    BatchRetry -->|失敗| BatchFail
    BatchFail --> Manual
```

---

## 設定プロパティ

キューイング・バックアップシステムで使用するスクリプトプロパティ：

| プロパティ名 | 説明 | 例 |
|-------------|------|-----|
| `SPREADSHEET_ID` | データベーススプレッドシートID | `<your-spreadsheet-id>` |
| `BACKUP_FOLDER_ID` | バックアップ先DriveフォルダID | `<backup-folder-id>` |

---

## 定数設定

| 定数名 | 値 | 説明 |
|--------|-----|------|
| `QUEUE_LOCK_WAIT_MS` | 30000 | ロック取得タイムアウト（30秒） |
| `BATCH_SIZE` | 50 | 1回のバッチ処理件数 |
