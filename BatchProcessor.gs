/**
 * バッチ処理用スクリプト
 * ResponseQueueからResponsesへデータを移動する
 * 
 * ※ 時間トリガー（1分間隔）での実行を推奨
 * GASエディタ → トリガー → トリガーを追加 → 時間主導型 → 分タイマー → 1分ごと
 */

/**
 * ResponseQueueシートからpending状態のデータをResponsesシートに移動する
 * トリガーで定期実行される
 */
const QUEUE_LOCK_WAIT_MS = 30000;
const BATCH_SIZE = 200; // 50→200に拡大（CacheService処理高速化）

/**
 * すべてのキューを処理する（トリガー実行用エントリポイント）
 */
function processAllQueues() {
  console.log('バッチ処理開始: processAllQueues');
  
  // バッチ重複防止ロック
  const batchLock = LockService.getScriptLock();
  if (!batchLock.tryLock(5000)) {
    console.log('別のバッチ処理が実行中、スキップ');
    return { skipped: true };
  }
  
  try {
    // キャッシュキュー処理（最優先）
    const cacheRespResult = processCacheQueueResponse_();
    const cacheReadResult = processCacheQueueReading_();
    
    // シャードキュー処理（新方式）
    const respShardResult = processResponseQueueShards_();
    const readShardResult = processReadingRecordQueueShards_();
    
    // 旧キュー処理（移行期間中）
    const res1 = processResponseQueue_();
    const res2 = processReadingRecordQueue_();
    
    console.log(`バッチ処理終了: CacheResp=${cacheRespResult.processed}, CacheRead=${cacheReadResult.processed}, ResponseShards=${respShardResult.processed}, ReadingShards=${readShardResult.processed}, LegacyResp=${res1.processed}, LegacyRead=${res2.processed}`);
    return { 
      cacheResponses: cacheRespResult,
      cacheReadings: cacheReadResult,
      responseShards: respShardResult, 
      readingShards: readShardResult,
      legacyResponses: res1, 
      legacyReadingRecords: res2 
    };
  } finally {
    batchLock.releaseLock();
  }
}

/**
 * ResponseQueueシートからpending状態のデータをResponsesシートに移動する
 */
function processResponseQueue_() {
  const ss = getTargetSpreadsheet();
  const queueSheet = ss.getSheetByName('ResponseQueue');
  const responseSheet = ss.getSheetByName('Responses');
  
  if (!queueSheet) {
    console.log('ResponseQueueシートが存在しません');
    return { processed: 0 };
  }
  
  if (!responseSheet) {
    console.log('Responsesシートが存在しません');
    return { processed: 0 };
  }
  
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { // 30秒待機
    console.log('ロック取得に失敗しました');
    return { processed: 0, error: 'lock_failed' };
  }
  
  try {
    const queueData = queueSheet.getDataRange().getValues();
    if (queueData.length <= 1) {
      return { processed: 0 }; // ヘッダーのみ
    }
    
    const header = queueData[0];
    const statusColIndex = header.indexOf('Status');
    
    const pendingRows = [];
    const pendingRowIndexes = [];
    
    // pending状態の行を収集
    for (let i = 1; i < queueData.length; i++) {
      if (queueData[i][statusColIndex] === 'pending') {
        pendingRows.push([
          queueData[i][0], // Timestamp
          queueData[i][1], // SessionID
          queueData[i][2], // Email
          queueData[i][3]  // Answers_JSON
        ]);
        pendingRowIndexes.push(i + 1); // 1-indexed
      }
    }
    
    if (pendingRows.length === 0) {
      return { processed: 0 };
    }
    
    // Responsesシートに一括追加
    const startRow = responseSheet.getLastRow() + 1;
    responseSheet.getRange(startRow, 1, pendingRows.length, 4).setValues(pendingRows);
    
    // キューの状態を'processed'に更新（逆順で処理して行ずれを防ぐ）
    pendingRowIndexes.reverse().forEach(rowIndex => {
      queueSheet.getRange(rowIndex, statusColIndex + 1).setValue('processed');
    });
    
    console.log(`${pendingRows.length}件のレスポンスを処理しました`);
    return { processed: pendingRows.length };
    
  } finally {
    lock.releaseLock();
  }
}

/**
 * ReadingRecordQueueシートからpending状態のデータをReadingRecordsシートに移動する
 */
function processReadingRecordQueue_() {
  const ss = getTargetSpreadsheet();
  const queueSheet = ss.getSheetByName('ReadingRecordQueue');
  const targetSheet = ss.getSheetByName('ReadingRecords');
  
  if (!queueSheet) {
    // console.log('ReadingRecordQueueシートが存在しません（まだ作成されていない可能性があります）'); // 初期状態ではログ省略
    return { processed: 0 };
  }
  
  if (!targetSheet) {
    console.log('ReadingRecordsシートが存在しません');
    return { processed: 0 };
  }
  
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(QUEUE_LOCK_WAIT_MS)) {
    console.log('ReadingRecordQueue: ロック取得に失敗しました');
    return { processed: 0, error: 'lock_failed' };
  }
  
  try {
    const queueData = queueSheet.getDataRange().getValues();
    if (queueData.length <= 1) return { processed: 0 };
    
    const header = queueData[0];
    const statusIdx = header.indexOf('Status');
    if (statusIdx === -1) return { processed: 0, error: 'no_status_column' };
    
    // データ列のマッピング (Queue -> Target)
    // Queue: Timestamp, RecordID, Year, Email, Term, Category, StartMonth, BookTitle, ReadAmount, Evaluation, CreatedAt, Status, QueuedAt
    // Target: Id, Year, Email, Term, Category, StartMonth, BookTitle, ReadAmount, Evaluation, CreatedAt
    // ※ Targetは [Id, Year, Email, Term, Category, StartMonth, BookTitle, ReadAmount, Evaluation, CreatedAt] の10列
    
    // Queueのヘッダーからインデックスを取得
    const hMap = {};
    header.forEach((h, i) => hMap[h] = i);
    
    const pendingRows = [];
    const pendingRowIndexes = [];
    
    for (let i = 1; i < queueData.length; i++) {
        if (queueData[i][statusIdx] === 'pending') {
            const row = queueData[i];
            // Targetシートの形式に合わせて配列を作成
            const newRow = [
                row[hMap['RecordID']],
                row[hMap['Year']],
                row[hMap['Email']],
                row[hMap['Term']],
                row[hMap['Category']],
                row[hMap['StartMonth']],
                row[hMap['BookTitle']],
                row[hMap['ReadAmount']],
                row[hMap['Evaluation']],
                row[hMap['CreatedAt']] 
            ];
            pendingRows.push(newRow);
            pendingRowIndexes.push(i + 1);
            if (pendingRows.length >= BATCH_SIZE) break; // バッチサイズ制限
        }
    }
    
    if (pendingRows.length === 0) return { processed: 0 };
    
    // Targetシートへ書き込み
    targetSheet.getRange(targetSheet.getLastRow() + 1, 1, pendingRows.length, 10).setValues(pendingRows);
    
    // ステータス更新
    pendingRowIndexes.reverse().forEach(rowIndex => {
        queueSheet.getRange(rowIndex, statusIdx + 1).setValue('processed');
    });
    
    console.log(`ReadingRecords: ${pendingRows.length}件処理しました`);
    return { processed: pendingRows.length };
    
  } catch (e) {
    console.error('processReadingRecordQueue Error:', e);
    return { processed: 0, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 処理済みのキューデータをクリーンアップする（定期実行用）
 * 1週間以上前の処理済みデータを削除
 */
function cleanupProcessedQueue_() {
  const ss = getTargetSpreadsheet();
  cleanupSheet_(ss, 'ResponseQueue');
  cleanupSheet_(ss, 'ReadingRecordQueue');
}

function cleanupSheet_(ss, sheetName) {
  const queueSheet = ss.getSheetByName(sheetName);
  
  if (!queueSheet) return { deleted: 0 };
  
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { deleted: 0, error: 'lock_failed' };
  
  try {
    const data = queueSheet.getDataRange().getValues();
    if (data.length <= 1) return { deleted: 0 };
    
    const header = data[0];
    const statusColIndex = header.indexOf('Status');
    const queuedAtColIndex = header.indexOf('QueuedAt');
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const rowsToDelete = [];
    
    for (let i = 1; i < data.length; i++) {
      const status = data[i][statusColIndex];
      const queuedAt = new Date(data[i][queuedAtColIndex]);
      
      if (status === 'processed' && queuedAt < oneWeekAgo) {
        rowsToDelete.push(i + 1);
      }
    }
    
    // 逆順で削除（行ずれ防止）
    rowsToDelete.reverse().forEach(rowIndex => {
      queueSheet.deleteRow(rowIndex);
    });
    
    console.log(`${rowsToDelete.length}件の古いキューデータを削除しました`);
    return { deleted: rowsToDelete.length };
    
  } finally {
    lock.releaseLock();
  }
  console.log(`${sheetName}: ${rowsToDelete.length}件の古いキューを削除`);
}

// ===== キャッシュキュー処理関数 =====

/**
 * キャッシュキューからResponsesを処理（スロット方式）
 */
function processCacheQueueResponse_() {
  let processed = 0;
  
  try {
    // 過去1-3分のデータを処理
    let allData = [];
    for (let m = 1; m <= 3; m++) {
      const data = getCacheQueueDataBySlots_('resp', m);
      allData = allData.concat(data);
    }
    
    if (allData.length === 0) return { processed: 0 };
    
    const ss = getTargetSpreadsheet();
    let targetSheet = ss.getSheetByName('Responses');
    if (!targetSheet) {
      targetSheet = ss.insertSheet('Responses');
      targetSheet.appendRow(['Timestamp', 'SessionID', 'Email', 'Answers_JSON']);
    }
    
    const rows = [];
    for (const item of allData) {
      const data = item.data;
      rows.push([
        new Date(data.timestamp),
        data.sessionId,
        data.email,
        data.formJson
      ]);
      // BATCH_SIZE制限を削除 - 全件書き込み（削除済みデータの消失防止）
    }
    
    if (rows.length > 0) {
      const lastRow = targetSheet.getLastRow();
      targetSheet.getRange(lastRow + 1, 1, rows.length, 4).setValues(rows);
      processed = rows.length;
      console.log(`CacheQueue Response (Slot): ${processed}件処理`);
    }
    
  } catch (e) {
    console.error('processCacheQueueResponse Error:', e);
  }
  
  return { processed };
}

/**
 * キャッシュキューからReadingRecordsを処理（スロット方式）
 */
function processCacheQueueReading_() {
  let processed = 0;
  
  try {
    // 過去1-3分のデータを処理
    let allData = [];
    for (let m = 1; m <= 3; m++) {
      const data = getCacheQueueDataBySlots_('read', m);
      allData = allData.concat(data);
    }
    
    if (allData.length === 0) return { processed: 0 };
    
    const ss = getTargetSpreadsheet();
    let targetSheet = ss.getSheetByName('ReadingRecords');
    if (!targetSheet) {
      targetSheet = ss.insertSheet('ReadingRecords');
      targetSheet.appendRow(['Id', 'Year', 'Email', 'Term', 'Category', 'StartMonth', 
                             'BookTitle', 'ReadAmount', 'Evaluation', 'CreatedAt']);
    }
    
    const rows = [];
    for (const item of allData) {
      const data = item.data;
      rows.push([
        data.recordId,
        data.year,
        data.email,
        data.term,
        data.category,
        data.startMonth,
        data.bookTitle,
        data.readAmount,
        data.evaluation,
        new Date(data.timestamp)
      ]);
      // BATCH_SIZE制限を削除 - 全件書き込み
    }
    
    if (rows.length > 0) {
      const lastRow = targetSheet.getLastRow();
      targetSheet.getRange(lastRow + 1, 1, rows.length, 10).setValues(rows);
      processed = rows.length;
      console.log(`CacheQueue Reading (Slot): ${processed}件処理`);
    }
    
  } catch (e) {
    console.error('processCacheQueueReading Error:', e);
  }
  
  return { processed };
}

// ===== シャードキュー処理関数 =====

/**
 * ResponseQueueシャード（10枚）を巡回して処理
 */
function processResponseQueueShards_() {
  const ss = getTargetSpreadsheet();
  let totalProcessed = 0;
  
  for (let i = 0; i < RESPONSE_QUEUE_SHARD_COUNT; i++) {
    const queueName = getResponseQueueSheetName_(i);
    const queueSheet = ss.getSheetByName(queueName);
    if (!queueSheet) continue;
    
    const queueData = queueSheet.getDataRange().getValues();
    if (queueData.length <= 1) continue;
    
    const header = queueData[0];
    const statusIdx = header.indexOf('Status');
    if (statusIdx === -1) continue;
    
    const pendingRows = [];
    const pendingRowIndices = [];
    
    for (let j = 1; j < queueData.length; j++) {
      if (queueData[j][statusIdx] === 'pending') {
        pendingRows.push([queueData[j][0], queueData[j][1], queueData[j][2], queueData[j][3]]);
        pendingRowIndices.push(j + 1);
        if (pendingRows.length >= BATCH_SIZE) break;
      }
    }
    
    if (pendingRows.length === 0) continue;
    
    // 一括書き込み
    let targetSheet = ss.getSheetByName('Responses');
    if (!targetSheet) {
      targetSheet = ss.insertSheet('Responses');
      targetSheet.appendRow(['Timestamp', 'SessionID', 'Email', 'Answers_JSON']);
    }
    const lastRow = targetSheet.getLastRow();
    targetSheet.getRange(lastRow + 1, 1, pendingRows.length, 4).setValues(pendingRows);
    
    // ステータス更新
    pendingRowIndices.forEach(rowIdx => {
      queueSheet.getRange(rowIdx, statusIdx + 1).setValue('processed');
    });
    
    totalProcessed += pendingRows.length;
    console.log(`ResponseShard_${i}: ${pendingRows.length}件処理`);
  }
  
  return { processed: totalProcessed };
}

/**
 * ReadingRecordQueueシャード（10枚）を巡回して処理
 */
function processReadingRecordQueueShards_() {
  const ss = getTargetSpreadsheet();
  let totalProcessed = 0;
  
  for (let i = 0; i < READING_QUEUE_SHARD_COUNT; i++) {
    const queueName = getReadingQueueSheetName_(i);
    const queueSheet = ss.getSheetByName(queueName);
    if (!queueSheet) continue;
    
    const queueData = queueSheet.getDataRange().getValues();
    if (queueData.length <= 1) continue;
    
    const header = queueData[0];
    const statusIdx = header.indexOf('Status');
    if (statusIdx === -1) continue;
    
    // ヘッダーマッピング
    const hMap = {};
    header.forEach((h, idx) => hMap[h] = idx);
    
    const pendingRows = [];
    const pendingRowIndices = [];
    
    for (let j = 1; j < queueData.length; j++) {
      if (queueData[j][statusIdx] === 'pending') {
        const row = queueData[j];
        pendingRows.push([
          row[hMap['RecordID']],
          row[hMap['Year']],
          row[hMap['Email']],
          row[hMap['Term']],
          row[hMap['Category']],
          row[hMap['StartMonth']],
          row[hMap['BookTitle']],
          row[hMap['ReadAmount']],
          row[hMap['Evaluation']],
          row[hMap['CreatedAt']]
        ]);
        pendingRowIndices.push(j + 1);
        if (pendingRows.length >= BATCH_SIZE) break;
      }
    }
    
    if (pendingRows.length === 0) continue;
    
    // 一括書き込み
    let targetSheet = ss.getSheetByName('ReadingRecords');
    if (!targetSheet) {
      targetSheet = ss.insertSheet('ReadingRecords');
      targetSheet.appendRow(['Id', 'Year', 'Email', 'Term', 'Category', 'StartMonth', 
                             'BookTitle', 'ReadAmount', 'Evaluation', 'CreatedAt']);
    }
    const lastRow = targetSheet.getLastRow();
    targetSheet.getRange(lastRow + 1, 1, pendingRows.length, 10).setValues(pendingRows);
    
    // ステータス更新
    pendingRowIndices.forEach(rowIdx => {
      queueSheet.getRange(rowIdx, statusIdx + 1).setValue('processed');
    });
    
    totalProcessed += pendingRows.length;
    console.log(`ReadingShard_${i}: ${pendingRows.length}件処理`);
  }
  
  return { processed: totalProcessed };
}

/**
 * シャードキューのクリーンアップ
 */
function cleanupShardQueues_() {
  const ss = getTargetSpreadsheet();
  let totalDeleted = 0;
  
  // ResponseQueueシャード
  for (let i = 0; i < RESPONSE_QUEUE_SHARD_COUNT; i++) {
    const result = cleanupSheet_(ss, getResponseQueueSheetName_(i));
    totalDeleted += result.deleted || 0;
  }
  
  // ReadingRecordQueueシャード
  for (let i = 0; i < READING_QUEUE_SHARD_COUNT; i++) {
    const result = cleanupSheet_(ss, getReadingQueueSheetName_(i));
    totalDeleted += result.deleted || 0;
  }
  
  console.log(`シャードキュークリーンアップ完了: ${totalDeleted}件削除`);
  return { deleted: totalDeleted };
}

/**
 * 負荷テストデータを削除する
 * loadtest@demo.manabifolio.local や loadtest_session_ を含むデータを削除
 */
function cleanupLoadTestData() {
  requireTeacher_();
  const ss = getTargetSpreadsheet();
  let totalDeleted = 0;
  
  console.log('負荷テストデータのクリーンアップ開始...');
  
  // Responsesシートからテストデータを削除
  totalDeleted += cleanupTestRowsFromSheet_(ss, 'Responses', 'loadtest');
  
  // ReadingRecordsシートからテストデータを削除
  totalDeleted += cleanupTestRowsFromSheet_(ss, 'ReadingRecords', 'loadtest');
  
  // ResponseQueueシャードからテストデータを削除
  for (let i = 0; i < RESPONSE_QUEUE_SHARD_COUNT; i++) {
    totalDeleted += cleanupTestRowsFromSheet_(ss, getResponseQueueSheetName_(i), 'loadtest');
  }
  
  // ReadingRecordQueueシャードからテストデータを削除
  for (let i = 0; i < READING_QUEUE_SHARD_COUNT; i++) {
    totalDeleted += cleanupTestRowsFromSheet_(ss, getReadingQueueSheetName_(i), 'loadtest');
  }
  
  console.log(`負荷テストデータクリーンアップ完了: ${totalDeleted}件削除`);
  return { success: true, deleted: totalDeleted };
}

/**
 * シートから特定のキーワードを含む行を削除
 */
function cleanupTestRowsFromSheet_(ss, sheetName, keyword) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return 0;
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 0;
  
  const rowsToDelete = [];
  
  for (let i = 1; i < data.length; i++) {
    const rowStr = JSON.stringify(data[i]).toLowerCase();
    if (rowStr.includes(keyword)) {
      rowsToDelete.push(i + 1); // 1-indexed
    }
  }
  
  // 逆順で削除（行ずれ防止）
  rowsToDelete.reverse().forEach(rowIndex => {
    sheet.deleteRow(rowIndex);
  });
  
  if (rowsToDelete.length > 0) {
    console.log(`  ${sheetName}: ${rowsToDelete.length}件削除`);
  }
  
  return rowsToDelete.length;
}

/**
 * 全キューのクリーンアップ（トリガー実行用）
 * 旧キュー＋新シャードキューの処理済みデータを削除
 */
function cleanupAllQueues() {
  console.log('全キュークリーンアップ開始...');
  const res1 = cleanupProcessedQueue_();  // 旧キュー
  const res2 = cleanupShardQueues_();     // 新シャードキュー
  console.log(`全キュークリーンアップ完了: 旧=${res1?.deleted || 0}件, シャード=${res2?.deleted || 0}件`);
  return { legacy: res1, shards: res2 };
}

/**
 * 夜間クリーンアップトリガーを設定（手動実行用）
 * 毎日深夜2時に cleanupAllQueues を実行
 */
function setupNightlyCleanupTrigger() {
  requireTeacher_();
  // 既存のcleanupAllQueuesトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'cleanupAllQueues') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 毎日AM2時に実行するトリガーを作成
  ScriptApp.newTrigger('cleanupAllQueues')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
    
  console.log('夜間クリーンアップトリガーを設定しました（毎日2:00AM）');
  return { success: true, message: '夜間クリーンアップトリガーを設定しました（毎日2:00AM）' };
}

/**
 * シャードキューシートを事前作成する（初期セットアップ用）
 * ResponseQueue_0〜9 と ReadingRecordQueue_0〜9 を作成
 */
function initializeShardQueues() {
  requireTeacher_();
  const ss = getTargetSpreadsheet();
  let created = 0;
  
  console.log('シャードキューシートの初期化開始...');
  
  // ResponseQueueシャード作成
  for (let i = 0; i < RESPONSE_QUEUE_SHARD_COUNT; i++) {
    const sheetName = getResponseQueueSheetName_(i);
    if (!ss.getSheetByName(sheetName)) {
      const sheet = ss.insertSheet(sheetName);
      sheet.appendRow(['Timestamp', 'SessionID', 'Email', 'Answers_JSON', 'Status', 'QueuedAt']);
      created++;
      console.log(`  作成: ${sheetName}`);
    }
  }
  
  // ReadingRecordQueueシャード作成
  for (let i = 0; i < READING_QUEUE_SHARD_COUNT; i++) {
    const sheetName = getReadingQueueSheetName_(i);
    if (!ss.getSheetByName(sheetName)) {
      const sheet = ss.insertSheet(sheetName);
      sheet.appendRow(['Timestamp', 'RecordID', 'Year', 'Email', 'Term', 'Category', 
                       'StartMonth', 'BookTitle', 'ReadAmount', 'Evaluation', 'CreatedAt', 'Status', 'QueuedAt']);
      created++;
      console.log(`  作成: ${sheetName}`);
    }
  }
  
  console.log(`シャードキュー初期化完了: ${created}シート作成`);
  return { success: true, created: created };
}

/**
 * フォーム設定のキャッシュをクリアする
 * セッション作成・編集後に呼び出す
 */
function flushFormConfigCache() {
  requireTeacher_();
  const cache = CacheService.getScriptCache();
  cache.remove('formConfig_all');
  cache.remove('formConfig_active');
  console.log('フォーム設定キャッシュをクリアしました');
  return { success: true };
}

/**
 * キューの状態を取得する（デバッグ用）
 */
function getQueueStatus() {
  requireTeacher_();
  const ss = getTargetSpreadsheet();
  const queueSheet = ss.getSheetByName('ResponseQueue');
  
  if (!queueSheet) return { exists: false };
  
  const data = queueSheet.getDataRange().getValues();
  if (data.length <= 1) return { exists: true, pending: 0, processed: 0 };
  
  const header = data[0];
  const statusColIndex = header.indexOf('Status');
  
  let pending = 0;
  let processed = 0;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][statusColIndex] === 'pending') pending++;
    else if (data[i][statusColIndex] === 'processed') processed++;
  }
  
  return { exists: true, pending, processed, total: data.length - 1 };
}

// ===== バックアップ機能 =====

/**
 * DBスプレッドシートの完全バックアップを作成
 * 日次トリガーで実行することを想定
 * バックアップ先はスクリプトプロパティ「BACKUP_FOLDER_ID」で指定（任意）
 */
function backupDatabase() {
  requireTeacher_();
  const ss = getTargetSpreadsheet();
  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'JST', 'yyyy-MM-dd_HHmmss');
  const backupName = `manabifolio_backup_${dateStr}`;
  
  // バックアップ先フォルダを取得（スクリプトプロパティから）
  const folderId = PropertiesService.getScriptProperties().getProperty("BACKUP_FOLDER_ID");
  
  let copiedFile;
  try {
    if (folderId) {
      const folder = DriveApp.getFolderById(folderId);
      copiedFile = DriveApp.getFileById(ss.getId()).makeCopy(backupName, folder);
    } else {
      // フォルダ未設定時は同じ場所にコピー
      copiedFile = DriveApp.getFileById(ss.getId()).makeCopy(backupName);
    }
    
    console.log(`Backup created: ${backupName} (${copiedFile.getId()})`);
    return { 
      success: true, 
      backupName: backupName, 
      fileId: copiedFile.getId(),
      timestamp: now.toISOString()
    };
  } catch (e) {
    console.error('Backup failed:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 定期バックアップのトリガーを設定（手動実行用）
 * GASエディタから一度実行すると、日次トリガーが設定されます
 */
function setupDailyBackupTrigger() {
  requireTeacher_();
  // 既存のbackupDatabaseトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'backupDatabase') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 毎日AM3時に実行するトリガーを作成
  ScriptApp.newTrigger('backupDatabase')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
    
  console.log('Daily backup trigger set for 3:00 AM');
  return { success: true, message: '日次バックアップトリガーを設定しました（毎日3:00AM）' };
}
