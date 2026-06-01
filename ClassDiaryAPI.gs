/**
 * ClassDiaryAPI.gs
 * 学級日誌API - 生徒・教師共用
 * 日誌エントリ、曜日別マスタ、科目マスタの操作を提供
 */

// ===== 日誌エントリ操作 =====

/**
 * 指定日の日誌を取得する
 * @param {string} grade - 学年
 * @param {string} cls - クラス
 * @param {string} dateStr - 日付（YYYY-MM-DD）
 * @returns {string} JSON形式の日誌データ
 */
function getDiaryEntry(grade, cls, dateStr) {
  assertCanAccessClass_(grade, cls, '自分のクラスの日誌のみ閲覧できます');

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('ClassDiaryEntries');
  
  if (!sheet) {
    // 空エントリを返す（マスタから時間割を読み込むため）
    return JSON.stringify({ 
      entry: null, 
      scheduleMaster: getScheduleForDate_(grade, cls, dateStr),
      subjects: getSubjectListInternal_(grade, cls)
    });
  }

  const data = sheet.getDataRange().getValues().slice(1);
  const targetDate = new Date(dateStr).toDateString();
  
  for (const row of data) {
    if (String(row[1]) === year && 
        String(row[2]) === String(grade) && 
        String(row[3]) === String(cls) &&
        new Date(row[4]).toDateString() === targetDate) {
      
      const entry = {
        id: row[0],
        year: row[1],
        grade: row[2],
        cls: row[3],
        date: row[4],
        schedule: [row[5], row[6], row[7], row[8], row[9], row[10], row[11]], // 1-7限
        attendance: (() => {
          try { return JSON.parse(row[12]); }
          catch (e) { return { absent: [], late: [], earlyLeave: [], absence: [] }; }
        })() || { absent: [], late: [], earlyLeave: [], absence: [] },
        specialNotes: row[13],
        dutyComment: row[14],
        createdAt: row[15],
        updatedAt: row[16]
      };
      
      return JSON.stringify({ 
        entry: entry,
        scheduleMaster: null, // 既存データあり
        subjects: getSubjectListInternal_(grade, cls)
      });
    }
  }

  // 見つからない場合、マスタから時間割を取得
  return JSON.stringify({ 
    entry: null, 
    scheduleMaster: getScheduleForDate_(grade, cls, dateStr),
    subjects: getSubjectListInternal_(grade, cls)
  });
}

/**
 * 日誌を保存する
 * @param {string} grade - 学年
 * @param {string} cls - クラス
 * @param {string} dateStr - 日付
 * @param {Object} data - 日誌データ
 * @returns {Object} 結果
 */
function saveDiaryEntry(grade, cls, dateStr, data) {
  assertCanAccessClass_(grade, cls, '自分のクラスの日誌のみ編集できます');

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  let sheet = ss.getSheetByName('ClassDiaryEntries');
  
  // シートがなければ作成
  if (!sheet) {
    sheet = ss.insertSheet('ClassDiaryEntries');
    sheet.appendRow([
      'Id', 'Year', 'Grade', 'Class', 'Date',
      'Schedule1', 'Schedule2', 'Schedule3', 'Schedule4', 'Schedule5', 'Schedule6', 'Schedule7',
      'Attendance', 'SpecialNotes', 'DutyComment', 'CreatedAt', 'UpdatedAt'
    ]);
  }

  const timestamp = new Date();
  const sheetData = sheet.getDataRange().getValues();
  const targetDate = new Date(dateStr).toDateString();
  
  // 既存エントリを検索
  for (let i = 1; i < sheetData.length; i++) {
    const row = sheetData[i];
    if (String(row[1]) === year && 
        String(row[2]) === String(grade) && 
        String(row[3]) === String(cls) &&
        new Date(row[4]).toDateString() === targetDate) {
      
      // 更新
      const schedule = data.schedule || [];
      sheet.getRange(i + 1, 6, 1, 7).setValues([[
        schedule[0] || '', schedule[1] || '', schedule[2] || '', schedule[3] || '',
        schedule[4] || '', schedule[5] || '', schedule[6] || ''
      ]]);
      sheet.getRange(i + 1, 13).setValue(JSON.stringify(data.attendance || {}));
      sheet.getRange(i + 1, 14).setValue(data.specialNotes || '');
      sheet.getRange(i + 1, 15).setValue(data.dutyComment || '');
      sheet.getRange(i + 1, 17).setValue(timestamp);
      
      return { success: true, updated: true };
    }
  }

  // 新規作成
  const schedule = data.schedule || [];
  const recordId = 'diary_' + Utilities.formatDate(timestamp, 'JST', 'yyyyMMdd_HHmmss_') + 
                   Math.random().toString(36).substr(2, 5);

  sheet.appendRow([
    recordId, year, grade, cls, new Date(dateStr),
    schedule[0] || '', schedule[1] || '', schedule[2] || '', schedule[3] || '',
    schedule[4] || '', schedule[5] || '', schedule[6] || '',
    JSON.stringify(data.attendance || {}),
    data.specialNotes || '',
    data.dutyComment || '',
    timestamp,
    timestamp
  ]);

  return { success: true, created: true, recordId: recordId };
}

/**
 * 月間の日誌一覧を取得する（カレンダー用）
 * @param {string} grade - 学年
 * @param {string} cls - クラス
 * @param {number} yearNum - 年（西暦）
 * @param {number} month - 月（1-12）
 * @returns {string} JSON形式の日付リスト
 */
function getMonthDiaries(grade, cls, yearNum, month) {
  assertCanAccessClass_(grade, cls, '自分のクラスの日誌のみ閲覧できます');

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('ClassDiaryEntries');
  
  if (!sheet) return JSON.stringify({ dates: [] });

  const data = sheet.getDataRange().getValues().slice(1);
  const dates = [];

  data.forEach(row => {
    if (String(row[1]) === year && 
        String(row[2]) === String(grade) && 
        String(row[3]) === String(cls)) {
      const d = new Date(row[4]);
      if (d.getFullYear() === yearNum && (d.getMonth() + 1) === month) {
        dates.push(d.getDate());
      }
    }
  });

  return JSON.stringify({ dates: dates });
}

// ===== 曜日別マスタ操作 =====

/**
 * 曜日別時間割マスタを取得する
 * @param {string} grade - 学年
 * @param {string} cls - クラス
 * @returns {string} JSON形式のマスタデータ
 */
function getScheduleMaster(grade, cls) {
  assertCanAccessClass_(grade, cls, '自分のクラスのマスタのみ閲覧できます');

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('ClassScheduleMaster');
  
  if (!sheet) return JSON.stringify({ master: {} });

  const data = sheet.getDataRange().getValues().slice(1);
  const master = {}; // { 1: [科目1, 科目2, ...], 2: [...], ... }

  data.forEach(row => {
    if (String(row[0]) === year && 
        String(row[1]) === String(grade) && 
        String(row[2]) === String(cls)) {
      const dow = parseInt(row[3]); // 1=月, 2=火, ...
      master[dow] = [row[4], row[5], row[6], row[7], row[8], row[9], row[10]];
    }
  });

  return JSON.stringify({ master: master });
}

/**
 * 曜日別時間割マスタを保存する
 * @param {string} grade - 学年
 * @param {string} cls - クラス
 * @param {number} dayOfWeek - 曜日（1=月〜5=金）
 * @param {Array} schedules - 時間割配列
 * @returns {Object} 結果
 */
function saveScheduleMaster(grade, cls, dayOfWeek, schedules) {
  assertCanAccessClass_(grade, cls, '自分のクラスのマスタのみ編集できます');

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  let sheet = ss.getSheetByName('ClassScheduleMaster');
  
  if (!sheet) {
    sheet = ss.insertSheet('ClassScheduleMaster');
    sheet.appendRow(['Year', 'Grade', 'Class', 'DayOfWeek', 
      'Schedule1', 'Schedule2', 'Schedule3', 'Schedule4', 'Schedule5', 'Schedule6', 'Schedule7']);
  }

  const data = sheet.getDataRange().getValues();
  
  // 既存を検索
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0]) === year && 
        String(row[1]) === String(grade) && 
        String(row[2]) === String(cls) &&
        parseInt(row[3]) === dayOfWeek) {
      // 更新
      sheet.getRange(i + 1, 5, 1, 7).setValues([[
        schedules[0] || '', schedules[1] || '', schedules[2] || '', schedules[3] || '',
        schedules[4] || '', schedules[5] || '', schedules[6] || ''
      ]]);
      return { success: true, updated: true };
    }
  }

  // 新規
  sheet.appendRow([
    year, grade, cls, dayOfWeek,
    schedules[0] || '', schedules[1] || '', schedules[2] || '', schedules[3] || '',
    schedules[4] || '', schedules[5] || '', schedules[6] || ''
  ]);

  return { success: true, created: true };
}

/**
 * 指定日付の曜日に対応するマスタを取得（内部用）
 */
function getScheduleForDate_(grade, cls, dateStr) {
  const d = new Date(dateStr);
  const dow = d.getDay(); // 0=日, 1=月, ...
  
  // 土日は空
  if (dow === 0 || dow === 6) return null;

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('ClassScheduleMaster');
  
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues().slice(1);
  
  for (const row of data) {
    if (String(row[0]) === year && 
        String(row[1]) === String(grade) && 
        String(row[2]) === String(cls) &&
        parseInt(row[3]) === dow) {
      return [row[4], row[5], row[6], row[7], row[8], row[9], row[10]];
    }
  }

  return null;
}

// ===== 科目マスタ操作 =====

/**
 * 科目マスタを取得する
 * @param {string} grade - 学年
 * @param {string} cls - クラス
 * @returns {string} JSON形式の科目リスト
 */
function getSubjectMaster(grade, cls) {
  assertCanAccessClass_(grade, cls, '自分のクラスの科目のみ閲覧できます');
  
  return JSON.stringify({ subjects: getSubjectListInternal_(grade, cls) });
}

/**
 * 科目マスタを保存する
 * @param {string} grade - 学年
 * @param {string} cls - クラス
 * @param {Array} subjects - 科目リスト
 * @returns {Object} 結果
 */
function saveSubjectMaster(grade, cls, subjects) {
  requireTeacher_();

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  let sheet = ss.getSheetByName('SubjectMaster');
  
  if (!sheet) {
    sheet = ss.insertSheet('SubjectMaster');
    sheet.appendRow(['Year', 'Grade', 'Class', 'SubjectName', 'Order']);
  }

  // 既存の科目を削除
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    if (String(row[0]) === year && 
        String(row[1]) === String(grade) && 
        String(row[2]) === String(cls)) {
      rowsToDelete.push(i + 1);
    }
  }
  
  // 逆順で削除
  rowsToDelete.forEach(r => sheet.deleteRow(r));

  // 新しい科目を追加
  subjects.forEach((subj, idx) => {
    if (subj && subj.trim()) {
      sheet.appendRow([year, grade, cls, subj.trim(), idx + 1]);
    }
  });

  return { success: true };
}

/**
 * 科目リスト取得（内部用）
 */
function getSubjectListInternal_(grade, cls) {
  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('SubjectMaster');
  
  if (!sheet) {
    return getDefaultSubjects_(grade, cls);
  }

  const data = sheet.getDataRange().getValues().slice(1);
  const subjects = [];

  data.forEach(row => {
    if (String(row[0]) === year && 
        String(row[1]) === String(grade) && 
        String(row[2]) === String(cls)) {
      subjects.push({ name: row[3], order: row[4] });
    }
  });

  // 順序でソート
  subjects.sort((a, b) => a.order - b.order);
  
  return subjects.length > 0 ? subjects.map(s => s.name) : getDefaultSubjects_(grade, cls);
}

/**
 * 学年・クラスに応じたデフォルト科目リストを取得
 */
function getDefaultSubjects_(grade, cls) {
  return ['国語', '数学', '英語', '物理', '化学', '生物', '地学', 
          '日本史', '世界史', '地理', '政治経済', '倫理', 
          '情報', '体育', '保健', '音楽', '美術', '家庭', 'LHR', 'HR', 'その他（始業式などの式典・他）'];
}

/**
 * 現在のユーザープロフィールを取得（内部用）
 */
function getCurrentUserProfile_() {
  const user = requireAuthorizedUser_();
  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('UserProfiles');
  
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues().slice(1);
  const email = normalizeEmail_(user.email);

  for (const row of data) {
    if (String(row[0]) === year && normalizeEmail_(row[1]) === email) {
      return {
        year: row[0],
        email: row[1],
        grade: String(row[2]),
        cls: String(row[3]),
        number: row[4],
        name: row[5]
      };
    }
  }

  return null;
}

/**
 * クラス名簿を取得（出欠入力用）
 * @param {string} grade - 学年
 * @param {string} cls - クラス
 * @returns {string} JSON形式の生徒リスト
 */
function getClassRoster(grade, cls) {
  assertCanAccessClass_(grade, cls, '自分のクラスの名簿のみ閲覧できます');

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('UserProfiles');
  
  if (!sheet) return JSON.stringify({ students: [] });

  const data = sheet.getDataRange().getValues().slice(1);
  const students = [];

  data.forEach(row => {
    if (String(row[0]) === year && 
        String(row[2]) === String(grade) && 
        String(row[3]) === String(cls)) {
      students.push({
        email: row[1],
        number: row[4],
        name: row[5]
      });
    }
  });

  students.sort((a, b) => parseInt(a.number) - parseInt(b.number));

  return JSON.stringify({ students: students });
}

function assertCanAccessClass_(grade, cls, message) {
  return requireTeacher_();
}
