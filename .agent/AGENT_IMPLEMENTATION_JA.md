# AIエージェント向け ManabiFolio ポートフォリオシステム実装メモ

このドキュメントは、「ManabiFolio」ポートフォリオ・プロトタイプシステムの実装詳細、アーキテクチャ、および設計上の決定事項を記述したものです。将来のAIエージェントがコードベースを理解するための資料として意図されています。

## 1. アーキテクチャ概要
- **プラットフォーム**: Google Apps Script (GAS)
- **フロントエンド**: HTML/JS + CSS。`HtmlService` を介して提供されるシングルページアプリケーション (SPA) 構成 (`index.html`)。
- **バックエンド**: GAS (`Code.gs`)。Googleスプレッドシートをデータベースとして使用。
- **通信**: `google.script.run` による非同期クライアント-サーバー通信。

## 2. データモデル (Google Spreadsheets)
システムは単一のスプレッドシートを使用し、以下のシートで構成されています。

### `Sessions`
各アンケート/ポートフォリオセッションのメタデータを保存。
- **カラム**: `ID` | `Title` | `Description` | `Status` | `CreatedAt` | `RelatedSetTitle`
- **重要な概念**:
    - `Status`: 'Active' (回答可), 'Closed' (閲覧のみ), 'Archived' (リストから非表示)。
    - `RelatedSetTitle`: 同じ「共通質問セット」から作成されたセッション同士を紐付けるキー。UIでのグループ化や通年データの集計に使用される。

### `Questions`
各セッションの実際の質問定義を保存。
- **カラム**: `SessionID` | `QuestionID` | `Type` | `Label` | `Options` | `Min` | `Max` | `Order`
- **注意**: 質問は作成時に共通セットからコピーされます。これによりセッションごとのカスタマイズが可能になりますが、分析時に紐付けロジックが必要になります（マトリクス表示の項を参照）。

### `Responses`
生徒の回答データを保存。
- **カラム**: `Timestamp` | `SessionID` | `Email` | `Answers_JSON`
- **注意**:
    - `Answers_JSON` は `{ "question_id": "answer_value", ... }` 形式のJSON文字列。
    - カラム順序は厳密に `[Timestamp, SessionID, Email, Answers_JSON]` である必要があります。GASでの配列解析時に注意してください。

### `CommonQuestionSets`
再利用可能な質問セット（例：「月次振り返り」）のテンプレートを保存。
- **カラム**: `SetID` | `SetTitle` | `QuestionID` | `Type` | `Label` | `Options` | `Min` | `Max` | `Order`
- **構造**: リレーショナル形式（1つの質問につき1行）。

## 3. 主要機能と実装ロジック

### マトリクス表示（生徒用ポートフォリオ）
生徒が特定のシリーズ（例：4月、5月、6月）の回答履歴を並べて比較表示する機能。
- **ロジック**: `index.html` 内の `renderStudentSession` に実装。
- **リンク**: `RelatedSetTitle` が一致するセッションを抽出。
- **質問のマッチング**:
    1.  プライマリ: `QuestionID` でマッチング。
    2.  フォールバック: IDが異なる場合（セットを作り直した場合など）、`Label`（質問文）でマッチング。

### CSVエクスポート
- **教員用（一括）**: `RelatedSetTitle` シリーズに属する全セッション・全生徒の回答を集約して出力。
    - 実装: `TeacherAPI.gs: getAnnualResponses`
    - マトリクス形式: 行=Email+Session, 列=Questions
- **生徒用（個人）**: リクエストしたユーザーのデータのみを出力。
    - 実装: `StudentAPI.gs: getMyAnnualResponses`

### セッション管理
- **アーカイブ**: UI上の「削除」は論理削除（`Status` = 'Archived'）として機能。ドロップダウンには出ないがDBには残る。
- **ID生成**: 重複回避のため `sess_yyyyMMdd_HHmmss` 形式を使用。

### データリセット
- **管理ツール**: `UserManagement.gs` の `resetAllData`。全シートを削除・再作成する。実行には `DB_RESET_KEY` スクリプトプロパティ、または既定の確認コードが必要。

### 同時実行制御 (Concurrency)
- **送信処理**: `submitForm` 内で `LockService` を使用し、書き込みをキューイング（最大10秒待機）することで競合を防いでいる。
- **規模**: クラス単位（約40人）での利用を想定。150人以上の同時書き込みはGASの制限に抵触する可能性があるため、時間をずらしての送信を推奨。

## 4. クライアントサイド (index.html)
- **状態管理**:
    - `configData`: セッションのメタデータマップ。
    - `userHistoryData`: ユーザーの過去回答配列。
    - `commonSetsData`: エディタ用にオンデマンドでロード。
- **ルーティング**: シンプルな `showView(viewId)` 関数で div の表示/非表示を切り替え。
- **なりすまし**: `impersonatedEmail` 変数により、デバッグ時に別ユーザーとして振る舞うことが可能。

## 5. 注意点・将来の課題
- **パフォーマンス**: データ増加に伴い全件取得が遅くなる可能性があります。ページネーションや範囲取得は未実装です。
- **質問IDの一貫性**: 共通セットを編集（質問の追加/削除）した場合、CSVのヘッダーはターゲットセッションの質問定義、またはIDの和集合に基づいて生成されるため、列ズレに注意が必要です。
- **セキュリティ**: サーバー側認可は `Utils.gs` に集約されています。空のアクティブユーザーメールは拒否され、教員/生徒ロールはスクリプトプロパティのドメインで判定されます。`targetEmail` を扱う経路は共有認可ヘルパーを必ず通してください。

---
*ManabiFolio 公開OSS版向けに更新済み。*
