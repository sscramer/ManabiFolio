/**
 * Code.gs
 * 教員モード・設問管理・【複数】共通質問セット対応・ソース表示・軸転換対応バージョン
 */

function doGet(e) {
  const params = e ? e.parameter : {};
  
  // デバッグエンドポイントの有効/無効チェック
  // スクリプトプロパティ DEBUG_ENTRY が 'true' または '1' の場合のみ有効
  const debugEnabled = isDebugEntryEnabled_();
  
  // 負荷テストモード: ?loadtest=true
  if (params.loadtest === 'true' && debugEnabled) {
    const startTime = new Date().getTime();
    const results = {};
    
    try {
      // ============================================
      // 実際のユーザーセッションをシミュレート
      // ============================================
      
      // 1. getFormConfig相当
      let stepStart = new Date().getTime();
      const formConfig = getFormConfig_(true);
      results.getFormConfig = new Date().getTime() - stepStart;
      
      // 2. getUserInfo相当（ただしテスト用ダミー）
      stepStart = new Date().getTime();
      // 実際のgetUserInfoはSession.getActiveUser()を使うため、テスト用に簡略化
      const props = PropertiesService.getScriptProperties();
      const teacherDomain = props.getProperty("TEACHER_DOMAIN");
      results.getUserInfo = new Date().getTime() - stepStart;
      
      // 3. スプレッドシート読み込み（複数シート）
      const ss = getTargetSpreadsheet();
      
      stepStart = new Date().getTime();
      const userSheet = ss.getSheetByName('UserProfiles');
      const userData = userSheet ? userSheet.getDataRange().getValues() : [];
      results.readUserProfiles = new Date().getTime() - stepStart;
      
      stepStart = new Date().getTime();
      const sessionSheet = ss.getSheetByName('Sessions');
      const sessionData = sessionSheet ? sessionSheet.getDataRange().getValues() : [];
      results.readSessions = new Date().getTime() - stepStart;
      
      stepStart = new Date().getTime();
      const questionSheet = ss.getSheetByName('Questions');
      const questionData = questionSheet ? questionSheet.getDataRange().getValues() : [];
      results.readQuestions = new Date().getTime() - stepStart;
      
      stepStart = new Date().getTime();
      const responseSheet = ss.getSheetByName('Responses');
      const responseData = responseSheet ? responseSheet.getDataRange().getValues() : [];
      results.readResponses = new Date().getTime() - stepStart;
      
      // 4. getCommonQuestionSets相当
      stepStart = new Date().getTime();
      const commonSheet = ss.getSheetByName('CommonQuestionSets');
      const commonData = commonSheet ? commonSheet.getDataRange().getValues() : [];
      results.readCommonSets = new Date().getTime() - stepStart;
      
      // 5. ReadingRecords読み込み
      stepStart = new Date().getTime();
      const readingSheet = ss.getSheetByName('ReadingRecords');
      const readingData = readingSheet ? readingSheet.getDataRange().getValues() : [];
      results.readReadingRecords = new Date().getTime() - stepStart;
      
      const totalDuration = new Date().getTime() - startTime;
      
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        mode: 'loadtest_full',
        total_duration_ms: totalDuration,
        api_durations: results,
        counts: {
          users: userData.length,
          sessions: sessionData.length,
          questions: questionData.length,
          responses: responseData.length,
          commonSets: commonData.length,
          readingRecords: readingData.length
        },
        timestamp: new Date().toISOString()
      })).setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        mode: 'loadtest_full',
        error: error.toString(),
        partial_results: results
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  // シャード書き込みテストモード: ?loadtest=write
  if (params.loadtest === 'write' && debugEnabled) {
    const startTime = new Date().getTime();
    const testType = params.type || 'response'; // response or reading
    const batchId = params.batchId || ('batch_' + Date.now()); // バッチID（クライアント指定可）
    const testIndex = params.testIndex || 0; // テスト内の連番
    
    try {
      let result;
      // テストIDはバッチID + 連番で構成（後から追跡可能）
      const testId = batchId + '_' + testIndex + '_' + Math.random().toString(36).substr(2,5);
      
      if (testType === 'response') {
        // シャードキューへの書き込みテスト
        result = submitForm(
          'loadtest_session_' + batchId,
          JSON.stringify({ test: true, id: testId, batchId: batchId, index: testIndex, timestamp: new Date().toISOString() }),
          'loadtest@demo.manabifolio.local'
        );
      } else if (testType === 'reading') {
        // ReadingRecordシャードキューへの書き込みテスト
        result = addReadingRecord(
          1, // term
          'morning',
          4, // startMonth
          'LoadTest_' + batchId + '_' + testIndex,
          'some',
          3,
          'loadtest@demo.manabifolio.local'
        );
      }
      
      const totalDuration = new Date().getTime() - startTime;
      
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        mode: 'loadtest_write',
        testType: testType,
        result: result,
        duration_ms: totalDuration,
        testId: testId,
        batchId: batchId,
        testIndex: parseInt(testIndex),
        timestamp: new Date().toISOString()
      })).setMimeType(ContentService.MimeType.JSON);
      
    } catch (error) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        mode: 'loadtest_write',
        error: error.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  // データ整合性チェックモード: ?loadtest=verify
  if (params.loadtest === 'verify' && debugEnabled) {
    const batchId = params.batchId;
    const expectedCount = parseInt(params.expectedCount) || 0;
    const testType = params.type || 'response'; // response or reading
    
    try {
      const ss = getTargetSpreadsheet();
      let foundCount = 0;
      let foundRecords = [];
      let foundIndices = []; // 検出したindexリスト
      
      if (testType === 'response') {
        // Responsesシートを検索
        const responseSheet = ss.getSheetByName('Responses');
        if (responseSheet) {
          const data = responseSheet.getDataRange().getValues().slice(1);
          data.forEach(row => {
            const sessionId = String(row[1]);
            if (sessionId.includes('loadtest_session_' + batchId)) {
              foundCount++;
              try {
                const answers = JSON.parse(row[3]);
                foundIndices.push(parseInt(answers.index));  // intに変換
                foundRecords.push({
                  timestamp: row[0],
                  sessionId: sessionId,
                  batchId: answers.batchId,
                  index: answers.index
                });
              } catch(e) {
                foundRecords.push({ sessionId: sessionId, parseError: true });
              }
            }
          });
        }
        // シャードキュー廃止: CacheServiceのデータは1分トリガーで処理されるため、
        // 90秒待機後はResponsesテーブルのみ検索すれば十分
      } else if (testType === 'reading') {
        // ReadingRecordsシートを検索
        const readingSheet = ss.getSheetByName('ReadingRecords');
        if (readingSheet) {
          const data = readingSheet.getDataRange().getValues().slice(1);
          data.forEach(row => {
            const bookTitle = String(row[6]);
            if (bookTitle.includes('LoadTest_' + batchId)) {
              foundCount++;
              // bookTitleからindexを抽出（LoadTest_batchId_index形式）
              const match = bookTitle.match(/LoadTest_.*?_(\d+)$/);
              if (match) {
                foundIndices.push(parseInt(match[1]));
              }
              foundRecords.push({
                id: row[0],
                bookTitle: bookTitle
              });
            }
          });
        }
        // シャードキュー廃止: 同上
      }
      
      // 消失したindexを特定
      const missingIndices = [];
      for (let i = 0; i < expectedCount; i++) {
        if (!foundIndices.includes(i)) {
          missingIndices.push(i);
        }
      }
      
      const isMatch = foundCount === expectedCount;
      const missing = expectedCount - foundCount;
      
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        mode: 'loadtest_verify',
        batchId: batchId,
        testType: testType,
        expectedCount: expectedCount,
        foundCount: foundCount,
        match: isMatch,
        missing: missing > 0 ? missing : 0,
        duplicate: missing < 0 ? -missing : 0,
        missingIndices: missingIndices.slice(0, 50), // 消失index（最大50件）
        foundIndices: foundIndices, // 検出index全件
        records: foundRecords.slice(0, 20), // 最大20件のみ返す
        timestamp: new Date().toISOString()
      })).setMimeType(ContentService.MimeType.JSON);
      
    } catch (error) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        mode: 'loadtest_verify',
        error: error.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  // 通常モード：厳格な認証チェック
  const user = getUserInfo();
  
  if (!user.isAuthorized) {
    return HtmlService.createHtmlOutput(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>アクセス拒否 - ManabiFolio</title>
        <style>
          body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f3f4f6; }
          .container { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 500px; }
          h1 { color: #ef4444; margin-bottom: 16px; }
          p { color: #6b7280; }
          .debug { margin-top: 20px; padding: 16px; background: #f9fafb; border-radius: 8px; text-align: left; font-size: 0.85rem; }
          .debug code { background: #e5e7eb; padding: 2px 6px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚫 アクセスが拒否されました</h1>
          <p>このシステムを利用する権限がありません。</p>
          <p>所属組織のGoogleアカウントでログインしているか確認してください。</p>
        </div>
      </body>
      </html>
    `)
    .setTitle('アクセス拒否 - ManabiFolio')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('ManabiFolio')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Web AppのURLを取得する関数
 */
function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * 【重要】権限承認用関数
 */
function forceAuth() {
  UrlFetchApp.fetch("https://www.google.com");
  SpreadsheetApp.getActiveSpreadsheet();
  Session.getActiveUser().getEmail();
}

// ===== シャードキュー用定数・ヘルパー関数 =====

const RESPONSE_QUEUE_SHARD_COUNT = 10;
const READING_QUEUE_SHARD_COUNT = 10;
const QUEUE_LOCK_TIMEOUT_MS = 30000; // 30秒

/**
 * ランダムなシャードインデックスを取得
 */
function getShardIndex_(count) {
  return Math.floor(Math.random() * (count || 10));
}

/**
 * Responseキューシート名を取得
 */
function getResponseQueueSheetName_(shardIndex) {
  return 'ResponseQueue_' + shardIndex;
}

/**
 * ReadingRecordキューシート名を取得
 */
function getReadingQueueSheetName_(shardIndex) {
  return 'ReadingRecordQueue_' + shardIndex;
}

/**
 * デバッグエンドポイントが有効かどうかをチェック
 * スクリプトプロパティ DEBUG_ENTRY が 'true' または '1' なら有効
 */
function isDebugEntryEnabled_() {
  const props = PropertiesService.getScriptProperties();
  const value = props.getProperty('DEBUG_ENTRY');
  return value === 'true' || value === '1';
}

// ===== CacheServiceバッファ用ヘルパー関数 =====

const CACHE_QUEUE_TTL = 600; // 10分

/**
 * キャッシュキュー用のタイムスタンプ文字列を生成（YYYYMMDD_HHMM形式・分単位）
 */
function getCacheQueueTimestamp_(date) {
  date = date || new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return y + m + d + '_' + h + min;
}

/**
 * キャッシュキューにデータを書き込む
 * @param {string} prefix - キープレフィックス（'resp' or 'read'）
 * @param {Object} data - 保存するデータ
 * @returns {Object} {success: boolean, slot: number}
 */
function writeToCacheQueue_(prefix, data) {
  const SLOT_COUNT = 5000; // 1分あたり5000スロット
  const MAX_RETRIES = 10; // 衝突時の最大リトライ回数
  
  try {
    const cache = CacheService.getScriptCache();
    const ts = getCacheQueueTimestamp_();
    const nonce = Utilities.getUuid().substr(0, 8); // 衝突検出用
    data._nonce = nonce;
    const jsonData = JSON.stringify(data);
    
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      // ランダムスロット選択
      const slot = Math.floor(Math.random() * SLOT_COUNT);
      const key = prefix + '_' + ts + '_' + slot;
      
      // 書き込み
      cache.put(key, jsonData, CACHE_QUEUE_TTL);
      
      // 読み戻して自分のデータか確認（衝突検出）
      const readBack = cache.get(key);
      if (readBack) {
        try {
          const parsed = JSON.parse(readBack);
          if (parsed._nonce === nonce) {
            // 自分のデータ → 成功
            return { success: true, slot: slot, key: key };
          }
        } catch (e) {}
      }
      // 衝突 → 別スロットでリトライ
      Utilities.sleep(10);
    }
    
    // 全リトライ失敗
    console.error('CacheService全スロット衝突: ' + prefix);
    return { success: false, error: 'all_slots_collision' };
    
  } catch (e) {
    console.error('CacheService書き込みエラー: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * 過去のキャッシュキューからデータを取得（秒単位スロット方式）
 * @param {string} prefix - キープレフィックス（'resp' or 'read'）
 * @param {number} minutesBack - 何分前を対象とするか（デフォルト: 1）
 * @returns {Array} データ配列
 */
function getCacheQueueDataBySlots_(prefix, minutesBack) {
  const SLOT_COUNT = 5000; // 1分あたり5000スロット
  const BATCH_SIZE = 1000; // getAll上限（GAS最大1000キー）
  minutesBack = minutesBack || 1;
  
  const cache = CacheService.getScriptCache();
  const results = [];
  
  // 分境界にアラインしてスキャン
  const now = new Date();
  const currentMinuteStart = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(), 0, 0
  );
  const targetMinuteStart = new Date(currentMinuteStart.getTime() - minutesBack * 60 * 1000);
  const ts = getCacheQueueTimestamp_(targetMinuteStart);
  
  // 2000スロットを100件ずつgetAll（20回）
  for (let batchStart = 0; batchStart < SLOT_COUNT; batchStart += BATCH_SIZE) {
    const keys = [];
    for (let i = 0; i < BATCH_SIZE && (batchStart + i) < SLOT_COUNT; i++) {
      keys.push(prefix + '_' + ts + '_' + (batchStart + i));
    }
    
    const values = cache.getAll(keys);
    
    for (const key of Object.keys(values)) {
      if (values[key]) {
        try {
          const data = JSON.parse(values[key]);
          delete data._nonce; // nonceは削除
          results.push({ key: key, data: data });
          cache.remove(key); // 処理済みなので削除
        } catch (e) {
          console.error('JSONパースエラー: ' + key);
        }
      }
    }
  }
  
  return results;
}

// 旧関数（互換性のため残す、ただし中身は空）
function getCacheQueueKeys_(prefix, minutesBack) {
  console.log('getCacheQueueKeys is deprecated. Use getCacheQueueDataBySlots instead.');
  return [];
}

function getCacheQueueData_(key) {
  console.log('getCacheQueueData is deprecated. Use getCacheQueueDataBySlots instead.');
  return null;
}
