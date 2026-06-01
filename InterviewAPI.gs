/**
 * InterviewAPI.gs
 * 生徒面談記録API - 教員専用
 * 面談記録のCRUD操作を提供
 */

// ===== 面談記録取得 =====

/**
 * 特定生徒の面談記録を取得する
 * @param {string} studentEmail - 対象生徒のメールアドレス
 * @returns {string} JSON形式の面談記録データ
 */
function getStudentInterviews(studentEmail) {
  requireTeacher_();

  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('InterviewRecords');
  
  if (!sheet) {
    return JSON.stringify({ records: [] });
  }

  const data = sheet.getDataRange().getValues().slice(1);
  const targetEmail = resolveTeacherTargetEmail_(studentEmail);
  
  const records = data
    .filter(row => String(row[1]).toLowerCase().trim() === targetEmail)
    .map(row => ({
      id: row[0],
      studentEmail: row[1],
      interviewDate: row[2],
      roles: parseJSONSafe_(row[3]) || [],
      teacherEmail: row[4],
      content: row[5],
      createdAt: row[6]
    }))
    .sort((a, b) => new Date(b.interviewDate) - new Date(a.interviewDate)); // 新しい順

  return JSON.stringify({ records: records });
}

/**
 * クラス別の面談記録一覧を取得する
 * @param {string} grade - 学年
 * @param {string} cls - クラス
 * @returns {string} JSON形式の面談記録サマリーデータ
 */
function getInterviewSummaryByClass(grade, cls) {
  requireTeacher_();

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  
  // 対象生徒を取得
  const uSheet = ss.getSheetByName('UserProfiles');
  if (!uSheet) return JSON.stringify({ students: [] });

  const uData = uSheet.getDataRange().getValues().slice(1);
  const students = [];

  uData.forEach(row => {
    if (String(row[0]).trim() !== String(year).trim()) return;
    if (grade && String(row[2]).trim() !== String(grade).trim()) return;
    if (cls && String(row[3]).trim() !== String(cls).trim()) return;

    students.push({
      email: String(row[1]).toLowerCase().trim(),
      grade: String(row[2]),
      cls: String(row[3]),
      number: row[4],
      name: row[5],
      interviewCount: 0,
      lastInterviewDate: null
    });
  });

  // 面談記録を取得してカウント
  const iSheet = ss.getSheetByName('InterviewRecords');
  if (iSheet) {
    const iData = iSheet.getDataRange().getValues().slice(1);
    const countMap = {};
    const dateMap = {};

    iData.forEach(row => {
      const email = String(row[1]).toLowerCase().trim();
      if (!countMap[email]) {
        countMap[email] = 0;
        dateMap[email] = null;
      }
      countMap[email]++;
      const d = new Date(row[2]);
      if (!dateMap[email] || d > dateMap[email]) {
        dateMap[email] = d;
      }
    });

    students.forEach(s => {
      s.interviewCount = countMap[s.email] || 0;
      s.lastInterviewDate = dateMap[s.email] ? dateMap[s.email].toLocaleDateString('ja-JP') : null;
    });
  }

  // 出席番号でソート
  students.sort((a, b) => {
    if (a.grade !== b.grade) return parseInt(a.grade) - parseInt(b.grade);
    if (a.cls !== b.cls) return parseInt(a.cls) - parseInt(b.cls);
    return parseInt(a.number) - parseInt(b.number);
  });

  return JSON.stringify({ students: students });
}

// ===== 面談記録追加 =====

/**
 * 面談記録を追加する
 * @param {string} studentEmail - 生徒のメールアドレス
 * @param {string} interviewDate - 面談日（YYYY-MM-DD形式）
 * @param {string} rolesJson - 対応者の役割（JSON配列）
 * @param {string} content - 面談内容
 * @returns {Object} 結果
 */
function addInterviewRecord(studentEmail, interviewDate, rolesJson, content) {
  const user = requireTeacher_();
  const targetEmail = resolveTeacherTargetEmail_(studentEmail);

  const ss = getTargetSpreadsheet();
  let sheet = ss.getSheetByName('InterviewRecords');
  
  // シートがなければ作成
  if (!sheet) {
    sheet = ss.insertSheet('InterviewRecords');
    sheet.appendRow(['Id', 'StudentEmail', 'InterviewDate', 'Roles', 'TeacherEmail', 'Content', 'CreatedAt']);
  }

  const timestamp = new Date();
  const recordId = 'int_' + Utilities.formatDate(timestamp, 'JST', 'yyyyMMdd_HHmmss_') + Math.random().toString(36).substr(2, 5);

  sheet.appendRow([
    recordId,
    targetEmail,
    interviewDate,
    rolesJson,
    user.email,
    content,
    timestamp
  ]);

  return { success: true, recordId: recordId };
}

// ===== 面談記録更新 =====

/**
 * 面談記録を更新する
 * @param {string} recordId - 記録ID
 * @param {string} interviewDate - 面談日
 * @param {string} rolesJson - 対応者の役割（JSON配列）
 * @param {string} content - 面談内容
 * @returns {Object} 結果
 */
function updateInterviewRecord(recordId, interviewDate, rolesJson, content) {
  requireTeacher_();

  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('InterviewRecords');
  if (!sheet) return { success: false, error: 'シートがありません' };

  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === recordId) {
      // InterviewDate (Col 3)
      sheet.getRange(i + 1, 3).setValue(interviewDate);
      // Roles (Col 4)
      sheet.getRange(i + 1, 4).setValue(rolesJson);
      // Content (Col 6)
      sheet.getRange(i + 1, 6).setValue(content);
      
      return { success: true };
    }
  }

  return { success: false, error: '記録が見つかりません' };
}

// ===== 面談記録削除 =====

/**
 * 面談記録を削除する
 * @param {string} recordId - 記録ID
 * @returns {Object} 結果
 */
function deleteInterviewRecord(recordId) {
  requireTeacher_();

  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('InterviewRecords');
  if (!sheet) return { success: false, error: 'シートがありません' };

  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === recordId) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  return { success: false, error: '記録が見つかりません' };
}

// ===== ユーティリティ =====

/**
 * 対応者の役割リストを取得する
 * @returns {Array} 役割リスト
 */
function getInterviewRoleOptions() {
  requireTeacher_();
  return [
    { value: 'homeroom', label: '担任' },
    { value: 'assistant', label: '副担任' },
    { value: 'grade_chief', label: '学年主任' },
    { value: 'grade_teacher', label: '学年教員' },
    { value: 'club_advisor', label: '部活動顧問' },
    { value: 'other', label: 'その他' }
  ];
}
