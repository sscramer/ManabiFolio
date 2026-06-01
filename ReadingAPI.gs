/**
 * 読書履歴調査API
 * 学期ごとの目標設定、読書記録、振り返りを管理
 */

// ===== 生徒向けAPI =====

/**
 * 読書データを取得する
 * @param {number} term - 学期（1/2/3）
 * @param {string} targetEmail - 対象Email（教員のみ指定可、省略時は本人）
 * @returns {string} JSON形式の読書データ
 */
function getReadingData(term, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;
  const year = getSystemYear();
  const ss = getTargetSpreadsheet();

  // 目標を取得
  const goal = getReadingGoalInternal_(ss, year, email, term);
  
  // 記録を取得
  const records = getReadingRecordsInternal_(ss, year, email, term);
  
  // 振り返りを取得
  const reflection = getReadingReflectionInternal_(ss, year, email, term);

  return JSON.stringify({
    term: term,
    goal: goal,
    records: {
      morning: records.filter(r => r.category === 'morning'),
      other: records.filter(r => r.category === 'other')
    },
    reflection: reflection,
    stats: {
      totalBooks: records.length,
      completedBooks: records.filter(r => r.readAmount === 'all').length
    }
  });
}

/**
 * 目標冊数を設定する
 */
function setReadingGoal(term, targetBooks, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;
  const year = getSystemYear();
  const ss = getTargetSpreadsheet();

  let sheet = ss.getSheetByName('ReadingGoals');
  if (!sheet) {
    sheet = ss.insertSheet('ReadingGoals');
    sheet.appendRow(['Year', 'Email', 'Term', 'TargetBooks', 'UpdatedAt']);
  }

  const data = sheet.getDataRange().getValues();
  let found = false;

  // 既存の目標を更新
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(year).trim() && 
        String(data[i][1]).toLowerCase().trim() === email && 
        String(data[i][2]).trim() === String(term).trim()) {
      sheet.getRange(i + 1, 4).setValue(Number(targetBooks));
      sheet.getRange(i + 1, 5).setValue(new Date());
      found = true;
      break;
    }
  }

  // 新規作成
  if (!found) {
    sheet.appendRow([String(year).trim(), email, String(term).trim(), Number(targetBooks), new Date()]);
  }

  return { success: true };
}

/**
 * 読書記録を追加する
 */
function addReadingRecord(term, category, startMonth, bookTitle, readAmount, evaluation, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;
  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  const timestamp = new Date();
  const recordId = 'rec_' + Utilities.formatDate(timestamp, 'JST', 'yyyyMMdd_HHmmss_') 
                 + Math.random().toString(36).substr(2, 5);

  // 正常系: 本テーブルへ直接書き込み（5000msロック待機 - 直接書き込み優先）
  const lock = LockService.getScriptLock();
  if (lock.tryLock(5000)) {
    try {
      let sheet = ss.getSheetByName('ReadingRecords');
      if (!sheet) {
        sheet = ss.insertSheet('ReadingRecords');
        sheet.appendRow(['Id', 'Year', 'Email', 'Term', 'Category', 'StartMonth', 
                         'BookTitle', 'ReadAmount', 'Evaluation', 'CreatedAt']);
      }
      sheet.appendRow([recordId, String(year), email, String(term), category, startMonth, 
                       bookTitle, readAmount, evaluation, timestamp]);
      SpreadsheetApp.flush();
      return { success: true, recordId, queued: false };
    } finally {
      lock.releaseLock();
    }
  }
  
  // 異常系1: CacheServiceバッファへ書き込み
  console.log('本テーブルロック取得失敗、CacheServiceへフォールバック');
  const cacheResult = writeToCacheQueue_('read', {
    recordId: recordId,
    year: String(year),
    email: email,
    term: String(term),
    category: category,
    startMonth: startMonth,
    bookTitle: bookTitle,
    readAmount: readAmount,
    evaluation: evaluation,
    timestamp: timestamp.toISOString()
  });
  
  if (cacheResult.success) {
    return { success: true, recordId, queued: true, cache: true, key: cacheResult.key, slot: cacheResult.slot };
  }
  
  // CacheService失敗 → エラーを返す（シャードキュー廃止）
  console.error('CacheService書き込み失敗: ' + cacheResult.error);
  return { success: false, error: cacheResult.error || 'cache_write_failed' };
}

/**
 * 読書記録を削除する
 */
function deleteReadingRecord(recordId, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;
  const ss = getTargetSpreadsheet();

  const sheet = ss.getSheetByName('ReadingRecords');
  if (!sheet) return { success: false, error: 'シートがありません' };

  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === recordId && String(data[i][2]).toLowerCase().trim() === email) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  return { success: false, error: '記録が見つかりません' };
}

/**
 * 読書記録を更新する
 */
function updateReadingRecord(recordId, startMonth, bookTitle, readAmount, evaluation, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;
  const ss = getTargetSpreadsheet();

  const sheet = ss.getSheetByName('ReadingRecords');
  if (!sheet) return { success: false, error: 'シートがありません' };

  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    // IDとEmailで一致を確認
    if (String(data[i][0]) === recordId && String(data[i][2]).toLowerCase().trim() === email) {
      // 指定された列を更新
      // StartMonth (index 5 -> Col 6)
      sheet.getRange(i + 1, 6).setValue(startMonth);
      // BookTitle (index 6 -> Col 7)
      sheet.getRange(i + 1, 7).setValue(bookTitle);
      // ReadAmount (index 7 -> Col 8)
      sheet.getRange(i + 1, 8).setValue(readAmount);
      // Evaluation (index 8 -> Col 9)
      sheet.getRange(i + 1, 9).setValue(evaluation);
      
      return { success: true };
    }
  }

  return { success: false, error: '記録が見つかりません' };
}

/**
 * 振り返りを保存する
 */
function setReadingReflection(term, reflectionText, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;
  const year = getSystemYear();
  const ss = getTargetSpreadsheet();

  let sheet = ss.getSheetByName('ReadingReflections');
  if (!sheet) {
    sheet = ss.insertSheet('ReadingReflections');
    sheet.appendRow(['Year', 'Email', 'Term', 'Reflection', 'UpdatedAt']);
  }

  const data = sheet.getDataRange().getValues();
  let found = false;

  // 既存の振り返りを更新
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(year) && 
        String(data[i][1]).toLowerCase().trim() === email && 
        String(data[i][2]) === String(term)) {
      sheet.getRange(i + 1, 4).setValue(reflectionText);
      sheet.getRange(i + 1, 5).setValue(new Date());
      found = true;
      break;
    }
  }

  // 新規作成
  if (!found) {
    sheet.appendRow([String(year), email, String(term), reflectionText, new Date()]);
  }

  return { success: true };
}

// ===== 教員向けAPI =====

/**
 * 読書統計を取得する
 */
function getReadingStats(term, targetGrade, targetClass) {
  requireTeacher_();

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();

  // 対象生徒を取得
  const uSheet = ss.getSheetByName('UserProfiles');
  if (!uSheet) return JSON.stringify({ error: 'UserProfilesシートがありません' });

  const uData = uSheet.getDataRange().getValues().slice(1);
  const students = [];

  uData.forEach(row => {
    if (String(row[0]).trim() !== String(year).trim()) return;
    if (targetGrade && String(row[2]).trim() !== String(targetGrade).trim()) return;
    if (targetClass && String(row[3]).trim() !== String(targetClass).trim()) return;

    students.push({
      email: String(row[1]).toLowerCase().trim(),
      grade: String(row[2]),
      cls: String(row[3]),
      number: row[4],
      name: row[5]
    });
  });

  if (students.length === 0) {
    return JSON.stringify({ 
      students: [], 
      stats: { totalStudents: 0, avgBooks: 0, avgCompleted: 0 } 
    });
  }

  // 読書記録を取得
  const rSheet = ss.getSheetByName('ReadingRecords');
  const recordsByEmail = {};
  
  if (rSheet) {
    const rData = rSheet.getDataRange().getValues().slice(1);
    rData.forEach(row => {
      if (String(row[1]) !== String(year) || String(row[3]) !== String(term)) return;
      const email = String(row[2]).toLowerCase().trim();
      if (!recordsByEmail[email]) recordsByEmail[email] = [];
      recordsByEmail[email].push({
        category: row[4],
        startMonth: row[5],
        bookTitle: row[6],
        readAmount: row[7],
        evaluation: row[8],
        createdAt: row[9]
      });
    });
  }

  // 目標を取得
  const gSheet = ss.getSheetByName('ReadingGoals');
  const goalsByEmail = {};
  
  if (gSheet) {
    const gData = gSheet.getDataRange().getValues().slice(1);
    gData.forEach(row => {
      if (String(row[0]) !== String(year) || String(row[2]) !== String(term)) return;
      goalsByEmail[String(row[1]).toLowerCase().trim()] = Number(row[3]) || 0;
    });
  }

  // 生徒データにマージ
  let totalBooks = 0;
  let totalCompleted = 0;
  let totalGoal = 0;

  const enrichedStudents = students.map(s => {
    const records = recordsByEmail[s.email] || [];
    const goal = goalsByEmail[s.email] || 0;
    const completed = records.filter(r => r.readAmount === 'all').length;

    totalBooks += records.length;
    totalCompleted += completed;
    totalGoal += goal;

    return {
      ...s,
      records: records, // Include full records
      totalBooks: records.length,
      completedBooks: completed,
      goal: goal,
      morningBooks: records.filter(r => r.category === 'morning').length,
      otherBooks: records.filter(r => r.category === 'other').length
    };
  });

  // 出席番号でソート
  enrichedStudents.sort((a, b) => {
    if (a.grade !== b.grade) return parseInt(a.grade) - parseInt(b.grade);
    if (a.cls !== b.cls) return parseInt(a.cls) - parseInt(b.cls);
    return parseInt(a.number) - parseInt(b.number);
  });

  return JSON.stringify({
    term: term,
    students: enrichedStudents,
    stats: {
      totalStudents: students.length,
      totalBooks: totalBooks,
      completedBooks: totalCompleted, // Fix key name consistency if frontend expects completedBirds or similar? Frontend is asking for totalStudents which was undefined? 
      // The error "Cannot read properties of undefined (reading 'totalStudents')" in `renderReadingStats` implies `res` itself might be parsing incorrectly or `res.stats` is undefined.
      // But looking at the existing code, it does return stats.
      // Wait, if students.length is 0, it returns early with stats object.
      // If students.length > 0, it returns aggregation.
      // Let's ensure the keys match exactly what frontend likely expects or what was defined.
      // Frontend renderReadingStats uses: res.stats.totalStudents, res.stats.avgBooks, res.stats.avgCompleted
      // The original code had: totalStudents, totalBooks, totalCompleted, avgBooks, avgCompleted, totalGoal, avgGoal.
      // This looks correct.
      // But maybe `students` itself is undefined? No, code defines it.
      // Maybe the error is in `getReadingStats` failing before return?
      // Ah, the user error might be from the previous version of `index.html` calling the WRONG function (getVisualReadingStats) which didn't exist, returning undefined/error, leading to the failure in `withSuccessHandler`.
      // But the user said "Still getting error" AFTER I supposedly fixed the function name.
      // Wait, look at the error log provided AGAIN.
      // "Uncaught TypeError: google.script.run...getVisualReadingStats is not a function" -> This was the FIRST error.
      // "Error in protected function: Cannot read properties of undefined (reading 'totalStudents')" -> This is a NEW error.
      // This error happens inside `renderReadingStats` at `userCodeAppPanel?createOAuthDialog=true:1486:84`.
      // This implies `res.stats` is undefined.
      // Why would `res.stats` be undefined?
      // `getReadingStats` returns `JSON.stringify({...})`.
      // If `getReadingStats` fails to find UserProfiles, it returns JSON with stats (0).
      // If it finds students but no records, it returns stats.
      // The only case it might fail is if `JSON.parse` fails or `res` is null.
      // Let's add robustness to `getReadingStats` to ensure it never returns partial objects.
      
      totalBooks: totalBooks,
      totalCompleted: totalCompleted,
      avgBooks: students.length > 0 ? (totalBooks / students.length).toFixed(1) : "0", // Changed to string "0" to match toFixed return type
      avgCompleted: students.length > 0 ? (totalCompleted / students.length).toFixed(1) : "0",
      totalGoal: totalGoal,
      avgGoal: students.length > 0 ? (totalGoal / students.length).toFixed(1) : "0"
    }
  });
}

/**
 * 読書履歴未提出者を取得する（各学期で読書記録が1冊もない生徒）
 */
function getReadingMissingStudents(term, targetGrade, targetClass) {
  requireTeacher_();
  const year = getSystemYear();
  const ss = getTargetSpreadsheet();

  // 対象生徒を取得
  const uSheet = ss.getSheetByName('UserProfiles');
  if (!uSheet) return JSON.stringify({ error: 'UserProfilesシートがありません' });

  const uData = uSheet.getDataRange().getValues().slice(1);
  const students = [];

  uData.forEach(row => {
    if (String(row[0]).trim() !== String(year).trim()) return;
    if (targetGrade && String(row[2]).trim() !== String(targetGrade).trim()) return;
    if (targetClass && String(row[3]).trim() !== String(targetClass).trim()) return;

    students.push({
      email: String(row[1]),
      grade: String(row[2]),
      cls: String(row[3]),
      number: row[4],
      name: row[5],
      hasRecords: false
    });
  });

  if (students.length === 0) {
    return JSON.stringify({ 
      students: [], 
      submitted: [],
      missing: [],
      stats: { total: 0, submitted: 0, missing: 0, rate: 0 }
    });
  }

  // 読書記録を取得（対象学期）
  const rSheet = ss.getSheetByName('ReadingRecords');
  const submittedEmails = new Set();
  
  if (rSheet) {
    const rData = rSheet.getDataRange().getValues().slice(1);
    rData.forEach(row => {
      if (String(row[1]).trim() === String(year).trim() && String(row[3]).trim() === String(term).trim()) {
        submittedEmails.add(String(row[2]).toLowerCase().trim());
      }
    });
  }

  // 提出状況および目標値を集計
  const gSheet = ss.getSheetByName('ReadingGoals');
  const goalsMap = new Map(); // email -> goal
  if (gSheet) {
    const gData = gSheet.getDataRange().getValues().slice(1);
    const targetYear = String(year).trim();
    const targetTerm = String(term).trim();
    gData.forEach(row => {
      // Fallback matching logic for malformed data
      let rowYear = String(row[0]).trim();
      let rowEmail = String(row[1]).toLowerCase().trim();
      let rowTerm = String(row[2]).trim();
      let rowGoal = Number(row[3]) || 0;

      // If column 0 looks like email, shift columns
      if (rowYear.includes('@')) {
        rowEmail = rowYear.toLowerCase();
        rowTerm = String(row[1]).trim();
        rowGoal = Number(row[2]) || 0;
        // In this case we can't check year, so we match by term/email only (not ideal but rescues data)
        if (rowTerm === targetTerm) {
          goalsMap.set(rowEmail, rowGoal);
        }
      } else if (rowYear === targetYear && rowTerm === targetTerm) {
        goalsMap.set(rowEmail, rowGoal);
      }
    });
  }

  students.forEach(s => {
    const email = s.email.toLowerCase().trim();
    s.hasRecords = submittedEmails.has(email);
    s.goal = goalsMap.get(email) || 0;
  });

  // 出席番号でソート
  students.sort((a, b) => {
    if (a.grade !== b.grade) return parseInt(a.grade) - parseInt(b.grade);
    if (a.cls !== b.cls) return parseInt(a.cls) - parseInt(b.cls);
    return parseInt(a.number) - parseInt(b.number);
  });

  const submitted = students.filter(s => s.hasRecords);
  const missing = students.filter(s => !s.hasRecords);

  return JSON.stringify({
    term: term,
    students: students,
    submitted: submitted,
    missing: missing,
    // Add these for frontend compatibility
    submittedCount: submitted.length,
    missingCount: missing.length,
    missingList: missing,
    stats: {
      total: students.length,
      submitted: submitted.length,
      missing: missing.length,
      rate: students.length > 0 ? Math.round((submitted.length / students.length) * 100) : 0
    }
  });
}

// ===== 内部ヘルパー関数 =====

function getReadingGoalInternal_(ss, year, email, term) {
  const sheet = ss.getSheetByName('ReadingGoals');
  if (!sheet) return 0;

  const data = sheet.getDataRange().getValues().slice(1);
  const targetEmail = String(email).toLowerCase().trim();
  const targetYear = String(year).trim();
  const targetTerm = String(term).trim();

  for (const row of data) {
    let rowYear = String(row[0]).trim();
    let rowEmail = String(row[1]).toLowerCase().trim();
    let rowTerm = String(row[2]).trim();
    let rowGoal = Number(row[3]) || 0;

    // Fallback: If 1st column is email, shift columns
    if (rowYear.includes('@')) {
      rowEmail = rowYear.toLowerCase();
      rowTerm = String(row[1]).trim();
      rowGoal = Number(row[2]) || 0;
      if (rowEmail === targetEmail && rowTerm === targetTerm) return rowGoal;
    } else {
      if (rowYear === targetYear && rowEmail === targetEmail && rowTerm === targetTerm) return rowGoal;
    }
  }
  return 0;
}

function getReadingRecordsInternal_(ss, year, email, term) {
  const sheet = ss.getSheetByName('ReadingRecords');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues().slice(1);
  const records = [];
  const targetEmail = String(email).toLowerCase().trim();
  const targetYear = String(year).trim();
  const targetTerm = String(term).trim();

  data.forEach(row => {
    let rowYear = String(row[1]).trim();
    let rowEmail = String(row[2]).toLowerCase().trim();
    let rowTerm = String(row[3]).trim();

    // Fallback: If 2nd column (index 1) is email, shift columns
    // Header is ['Id', 'Year', 'Email', 'Term', ...]
    let match = false;
    if (rowYear.includes('@')) {
      rowEmail = rowYear.toLowerCase();
      rowTerm = String(row[2]).trim();
      if (rowEmail === targetEmail && rowTerm === targetTerm) match = true;
    } else {
      if (rowYear === targetYear && rowEmail === targetEmail && rowTerm === targetTerm) match = true;
    }

    if (match) {
      records.push({
        id: row[0],
        category: row[4],
        startMonth: row[5],
        bookTitle: row[6],
        readAmount: row[7],
        evaluation: row[8],
        createdAt: row[9]
      });
    }
  });

  return records;
}

function getReadingReflectionInternal_(ss, year, email, term) {
  const sheet = ss.getSheetByName('ReadingReflections');
  if (!sheet) return '';

  const data = sheet.getDataRange().getValues().slice(1);
  const targetEmail = String(email).toLowerCase().trim();
  const targetYear = String(year).trim();
  const targetTerm = String(term).trim();

  for (const row of data) {
    let rowYear = String(row[0]).trim();
    let rowEmail = String(row[1]).toLowerCase().trim();
    let rowTerm = String(row[2]).trim();
    let rowRef = row[3] || '';

    if (rowYear.includes('@')) {
      rowEmail = rowYear.toLowerCase();
      rowTerm = String(row[1]).trim();
      rowRef = row[2] || '';
      if (rowEmail === targetEmail && rowTerm === targetTerm) return rowRef;
    } else {
      if (rowYear === targetYear && rowEmail === targetEmail && rowTerm === targetTerm) return rowRef;
    }
  }
  return '';
}
