/**
 * ManabiFolio システム自動テストスクリプト
 * 
 * GASエディタから実行してテスト結果を確認できます。
 * 実行方法: GASエディタ → 関数を選択 → ▶ 実行
 */

/**
 * テストスイートの実行（メイン）
 * 全てのテストを順番に実行し、結果をログに出力
 */
function runAllTests() {
  console.log('========================================');
  console.log('ManabiFolio システムテスト開始');
  console.log('========================================');
  
  const results = [];
  
  // 各テストを実行
  results.push(testCacheService());
  results.push(testQueueWrite());
  results.push(testReadingRecordQueue()); // 新しいテストを追加
  results.push(testQueueProcessing());
  results.push(testFormConfigCache());
  
  // 結果サマリー
  console.log('');
  console.log('========================================');
  console.log('テスト結果サマリー');
  console.log('========================================');
  
  let passed = 0;
  let failed = 0;
  
  results.forEach(r => {
    if (r.success) {
      passed++;
      console.log(`✅ ${r.name}: PASSED`);
    } else {
      failed++;
      console.log(`❌ ${r.name}: FAILED - ${r.error}`);
    }
  });
  
  console.log('');
  console.log(`結果: ${passed}/${results.length} テスト成功`);
  
  return { passed, failed, total: results.length };
}

/**
 * テスト1: CacheServiceの動作確認
 */
function testCacheService() {
  const testName = 'CacheService動作テスト';
  try {
    const cache = CacheService.getScriptCache();
    const testKey = 'test_key_' + new Date().getTime();
    const testValue = 'test_value_' + Math.random();
    
    // キャッシュに書き込み
    cache.put(testKey, testValue, 60);
    
    // キャッシュから読み取り
    const retrieved = cache.get(testKey);
    
    // 検証
    if (retrieved !== testValue) {
      throw new Error(`Expected ${testValue}, got ${retrieved}`);
    }
    
    // クリーンアップ
    cache.remove(testKey);
    
    console.log(`[${testName}] キャッシュの読み書きが正常に動作`);
    return { name: testName, success: true };
  } catch (e) {
    return { name: testName, success: false, error: e.toString() };
  }
}

/**
 * テスト2: ResponseQueueへの書き込みテスト
 */
function testQueueWrite() {
  const testName = 'ResponseQueueへの書き込みテスト';
  try {
    const ss = getTargetSpreadsheet();
    let queueSheet = ss.getSheetByName('ResponseQueue');
    
    // シートがなければ作成
    if (!queueSheet) {
      queueSheet = ss.insertSheet('ResponseQueue');
      queueSheet.appendRow(['Timestamp', 'SessionID', 'Email', 'Answers_JSON', 'Status', 'QueuedAt']);
    }
    
    const testData = {
      timestamp: new Date(),
      sessionId: 'test_session_' + new Date().getTime(),
      email: 'test@student.example.ed.jp',
      answers: JSON.stringify({ q1: 'test' }),
      status: 'test_pending',
      queuedAt: new Date()
    };
    
    const initialRowCount = queueSheet.getLastRow();
    
    // 書き込み
    queueSheet.appendRow([
      testData.timestamp,
      testData.sessionId,
      testData.email,
      testData.answers,
      testData.status,
      testData.queuedAt
    ]);
    
    const afterRowCount = queueSheet.getLastRow();
    
    // 検証
    if (afterRowCount !== initialRowCount + 1) {
      throw new Error('行が追加されていません');
    }
    
    // クリーンアップ（テストデータを削除）
    queueSheet.deleteRow(afterRowCount);
    
    console.log(`[${testName}] キューへの書き込みが正常に動作`);
    return { name: testName, success: true };
  } catch (e) {
    return { name: testName, success: false, error: e.toString() };
  }
}

/**
 * テスト5: 読書記録キューへの書き込みと処理テスト
 */
function testReadingRecordQueue() {
  const testName = '読書記録キューテスト';
  try {
    const ss = getTargetSpreadsheet();
    
    // 1. レコード追加（通常は高速ロック成功で直接書き込まれる。queued=false）
    const res = addReadingRecord(1, 'morning', '4-10', 'テスト本_Direct', 'all', 'great', 'test_q@student.example.ed.jp');
    if (!res.success) throw new Error('addReadingRecord(Direct) failed');
    console.log(`[${testName}] 直接書き込み成功: queued=${res.queued}`);
    
    // 2. レコード追加（強制キューイング。queued=true）
    const resQueue = addReadingRecord(1, 'morning', '4-10', 'テスト本_Queue', 'all', 'great', 'test_q@student.example.ed.jp', true);
    if (!resQueue.success) throw new Error('addReadingRecord(Queue) failed');
    if (!resQueue.queued) throw new Error('forceQueue=true なのに queued=false です');
    console.log(`[${testName}] キュー書き込み成功: queued=${resQueue.queued}`);
    
    // 3. バッチ処理関数の動作確認
    const batchRes = processReadingRecordQueue_();
    if (batchRes.error) throw new Error('processReadingRecordQueue error: ' + batchRes.error);
    console.log(`[${testName}] バッチ処理成功: processed=${batchRes.processed}`);
    
    // 3. テストデータ削除
    // ReadingRecords (Main Sheet)
    const rSheet = ss.getSheetByName('ReadingRecords');
    if (rSheet) {
        const data = rSheet.getDataRange().getValues();
        for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][2]) === 'test_q@student.example.ed.jp') { // Emailで検索
                rSheet.deleteRow(i + 1);
            }
        }
    }
    
    // ReadingRecordQueue (Queue Sheet)
    const qSheet = ss.getSheetByName('ReadingRecordQueue');
    if (qSheet) {
        const data = qSheet.getDataRange().getValues();
        for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][3]) === 'test_q@student.example.ed.jp') { // Emailで検索 (Queueは4列目)
                qSheet.deleteRow(i + 1);
            }
        }
    }

    return { name: testName, success: true };
  } catch (e) {
    return { name: testName, success: false, error: e.toString() };
  }
}



/**
 * テスト3: キュー処理の動作確認
 */
function testQueueProcessing() {
  const testName = 'キュー処理テスト';
  try {
    const result = getQueueStatus();
    
    if (result.exists === undefined) {
      throw new Error('getQueueStatus()が正しい形式を返していません');
    }
    
    console.log(`[${testName}] キューステータス: pending=${result.pending}, processed=${result.processed}`);
    return { name: testName, success: true };
  } catch (e) {
    return { name: testName, success: false, error: e.toString() };
  }
}

/**
 * テスト4: FormConfigキャッシュの動作確認
 */
function testFormConfigCache() {
  const testName = 'FormConfigキャッシュテスト';
  try {
    // キャッシュをクリア
    flushFormConfigCache();
    
    // 1回目の呼び出し（キャッシュミス）
    const startTime1 = new Date().getTime();
    const result1 = getFormConfig(true);
    const duration1 = new Date().getTime() - startTime1;
    
    // 2回目の呼び出し（キャッシュヒット）
    const startTime2 = new Date().getTime();
    const result2 = getFormConfig(true);
    const duration2 = new Date().getTime() - startTime2;
    
    // 検証: 結果が同じであること
    if (result1 !== result2) {
      throw new Error('キャッシュされた結果が異なります');
    }
    
    console.log(`[${testName}] 1回目: ${duration1}ms, 2回目: ${duration2}ms`);
    console.log(`[${testName}] キャッシュによる高速化: ${duration2 < duration1 ? '確認' : '未確認（データが小さい可能性）'}`);
    
    return { name: testName, success: true };
  } catch (e) {
    return { name: testName, success: false, error: e.toString() };
  }
}

/**
 * 負荷テスト（模擬的な同時アクセス）
 * ※注意: 実行に時間がかかります
 */
function testConcurrentSubmissions() {
  const testName = '同時送信模擬テスト';
  try {
    const iterations = 5;
    const results = [];
    
    console.log(`[${testName}] ${iterations}回の連続送信を実行中...`);
    
    for (let i = 0; i < iterations; i++) {
      const startTime = new Date().getTime();
      
      // テスト用の送信（実際にはキューに追加される）
      const ss = getTargetSpreadsheet();
      let queueSheet = ss.getSheetByName('ResponseQueue');
      if (!queueSheet) {
        queueSheet = ss.insertSheet('ResponseQueue');
        queueSheet.appendRow(['Timestamp', 'SessionID', 'Email', 'Answers_JSON', 'Status', 'QueuedAt']);
      }
      
      queueSheet.appendRow([
        new Date(),
        'test_concurrent_' + i,
        'test' + i + '@student.example.ed.jp',
        JSON.stringify({ q1: 'test' + i }),
        'test_pending',
        new Date()
      ]);
      
      const duration = new Date().getTime() - startTime;
      results.push(duration);
    }
    
    const avgDuration = results.reduce((a, b) => a + b, 0) / results.length;
    console.log(`[${testName}] 平均書き込み時間: ${avgDuration.toFixed(1)}ms`);
    
    // クリーンアップ（テストデータを削除）
    const queueSheet = ss.getSheetByName('ResponseQueue');
    const data = queueSheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][1]).startsWith('test_concurrent_')) {
        queueSheet.deleteRow(i + 1);
      }
    }
    
    return { name: testName, success: true };
  } catch (e) {
    return { name: testName, success: false, error: e.toString() };
  }
}

// ============================================================
// 負荷テスト関数群
// ============================================================

/**
 * 複数API呼び出しによる負荷テスト
 * 様々なAPIを連続で呼び出し、応答時間を計測
 */
function runLoadTest() {
  console.log('========================================');
  console.log('負荷テスト開始');
  console.log('========================================');
  
  const results = [];
  
  // テスト1: getFormConfig を複数回呼び出し
  results.push(...testFormConfigLoad(10));
  
  // テスト2: スプレッドシート読み込み負荷
  results.push(...testSpreadsheetReadLoad(5));
  
  // テスト3: キュー書き込み負荷
  results.push(...testQueueWriteLoad(10));
  
  // テスト4: 複合API呼び出し
  results.push(...testMixedApiLoad(5));
  
  // サマリー出力
  printLoadTestSummary(results);
  
  return results;
}

/**
 * getFormConfig連続呼び出しテスト
 */
function testFormConfigLoad(iterations) {
  const results = [];
  console.log(`\n[FormConfig負荷テスト] ${iterations}回実行`);
  
  // キャッシュをクリアして純粋な負荷を計測
  flushFormConfigCache();
  
  for (let i = 0; i < iterations; i++) {
    const start = new Date().getTime();
    try {
      getFormConfig(true);
      const duration = new Date().getTime() - start;
      results.push({ api: 'getFormConfig', iteration: i, duration, success: true });
      console.log(`  [${i+1}/${iterations}] ${duration}ms`);
    } catch (e) {
      const duration = new Date().getTime() - start;
      results.push({ api: 'getFormConfig', iteration: i, duration, success: false, error: e.toString() });
      console.log(`  [${i+1}/${iterations}] FAILED: ${e.message}`);
    }
  }
  
  return results;
}

/**
 * スプレッドシート読み込み負荷テスト
 */
function testSpreadsheetReadLoad(iterations) {
  const results = [];
  console.log(`\n[スプレッドシート読込負荷テスト] ${iterations}回実行`);
  
  const ss = getTargetSpreadsheet();
  const sheetNames = ['UserProfiles', 'Sessions', 'Questions', 'Responses'];
  
  for (let i = 0; i < iterations; i++) {
    for (const sheetName of sheetNames) {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) continue;
      
      const start = new Date().getTime();
      try {
        const data = sheet.getDataRange().getValues();
        const duration = new Date().getTime() - start;
        results.push({ 
          api: `readSheet_${sheetName}`, 
          iteration: i, 
          duration, 
          success: true,
          rowCount: data.length 
        });
        console.log(`  [${i+1}] ${sheetName}: ${duration}ms (${data.length}行)`);
      } catch (e) {
        const duration = new Date().getTime() - start;
        results.push({ api: `readSheet_${sheetName}`, iteration: i, duration, success: false, error: e.toString() });
      }
    }
  }
  
  return results;
}

/**
 * キュー書き込み負荷テスト
 */
function testQueueWriteLoad(iterations) {
  const results = [];
  console.log(`\n[キュー書込負荷テスト] ${iterations}回実行`);
  
  const ss = getTargetSpreadsheet();
  let queueSheet = ss.getSheetByName('ResponseQueue');
  if (!queueSheet) {
    queueSheet = ss.insertSheet('ResponseQueue');
    queueSheet.appendRow(['Timestamp', 'SessionID', 'Email', 'Answers_JSON', 'Status', 'QueuedAt']);
  }
  
  const testSessionIds = [];
  
  for (let i = 0; i < iterations; i++) {
    const sessionId = 'load_test_' + new Date().getTime() + '_' + i;
    testSessionIds.push(sessionId);
    
    const start = new Date().getTime();
    try {
      queueSheet.appendRow([
        new Date(),
        sessionId,
        'loadtest_' + i + '@demo.manabifolio.local',
        JSON.stringify({ q1: 'loadtest_' + i, q2: Math.random() }),
        'pending',
        new Date()
      ]);
      const duration = new Date().getTime() - start;
      results.push({ api: 'queueWrite', iteration: i, duration, success: true });
      console.log(`  [${i+1}/${iterations}] ${duration}ms`);
    } catch (e) {
      const duration = new Date().getTime() - start;
      results.push({ api: 'queueWrite', iteration: i, duration, success: false, error: e.toString() });
    }
  }
  
  // クリーンアップ
  console.log('  クリーンアップ中...');
  const data = queueSheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (testSessionIds.includes(String(data[i][1]))) {
      queueSheet.deleteRow(i + 1);
    }
  }
  
  return results;
}

/**
 * 複合API呼び出しテスト（実際の利用パターンをシミュレート）
 */
function testMixedApiLoad(iterations) {
  const results = [];
  console.log(`\n[複合API負荷テスト] ${iterations}回実行`);
  
  for (let i = 0; i < iterations; i++) {
    console.log(`  --- イテレーション ${i+1}/${iterations} ---`);
    
    // 1. FormConfig取得
    let start = new Date().getTime();
    try {
      getFormConfig(true);
      results.push({ api: 'mixed_formConfig', iteration: i, duration: new Date().getTime() - start, success: true });
    } catch (e) {
      results.push({ api: 'mixed_formConfig', iteration: i, duration: new Date().getTime() - start, success: false, error: e.toString() });
    }
    
    // 2. UserProfiles読み込み
    start = new Date().getTime();
    try {
      const ss = getTargetSpreadsheet();
      const sheet = ss.getSheetByName('UserProfiles');
      if (sheet) sheet.getDataRange().getValues();
      results.push({ api: 'mixed_userProfiles', iteration: i, duration: new Date().getTime() - start, success: true });
    } catch (e) {
      results.push({ api: 'mixed_userProfiles', iteration: i, duration: new Date().getTime() - start, success: false, error: e.toString() });
    }
    
    // 3. Responses読み込み
    start = new Date().getTime();
    try {
      const ss = getTargetSpreadsheet();
      const sheet = ss.getSheetByName('Responses');
      if (sheet) sheet.getDataRange().getValues();
      results.push({ api: 'mixed_responses', iteration: i, duration: new Date().getTime() - start, success: true });
    } catch (e) {
      results.push({ api: 'mixed_responses', iteration: i, duration: new Date().getTime() - start, success: false, error: e.toString() });
    }
  }
  
  return results;
}

/**
 * 負荷テスト結果のサマリーを出力
 */
function printLoadTestSummary(results) {
  console.log('\n========================================');
  console.log('負荷テスト結果サマリー');
  console.log('========================================');
  
  // API別に集計
  const byApi = {};
  results.forEach(r => {
    if (!byApi[r.api]) {
      byApi[r.api] = { total: 0, success: 0, failed: 0, durations: [] };
    }
    byApi[r.api].total++;
    if (r.success) {
      byApi[r.api].success++;
      byApi[r.api].durations.push(r.duration);
    } else {
      byApi[r.api].failed++;
    }
  });
  
  for (const [api, stats] of Object.entries(byApi)) {
    const avgDuration = stats.durations.length > 0 
      ? (stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length).toFixed(1)
      : 'N/A';
    const minDuration = stats.durations.length > 0 ? Math.min(...stats.durations) : 'N/A';
    const maxDuration = stats.durations.length > 0 ? Math.max(...stats.durations) : 'N/A';
    
    console.log(`\n[${api}]`);
    console.log(`  成功/失敗: ${stats.success}/${stats.failed}`);
    console.log(`  応答時間(ms): 平均=${avgDuration}, 最小=${minDuration}, 最大=${maxDuration}`);
  }
  
  // 全体統計
  const totalSuccess = results.filter(r => r.success).length;
  const totalFailed = results.filter(r => !r.success).length;
  const allDurations = results.filter(r => r.success).map(r => r.duration);
  const totalAvg = allDurations.length > 0 
    ? (allDurations.reduce((a, b) => a + b, 0) / allDurations.length).toFixed(1)
    : 'N/A';
  
  console.log('\n----------------------------------------');
  console.log(`総計: ${totalSuccess}成功 / ${totalFailed}失敗`);
  console.log(`全体平均応答時間: ${totalAvg}ms`);
  console.log('========================================');
}

/**
 * 簡易負荷テスト（GASエディタから実行用）
 * 少ない回数で動作確認
 */
function runQuickLoadTest() {
  console.log('クイック負荷テスト（各3回）');
  const results = [];
  
  results.push(...testFormConfigLoad(3));
  results.push(...testSpreadsheetReadLoad(1));
  results.push(...testQueueWriteLoad(3));
  
  printLoadTestSummary(results);
  return results;
}

