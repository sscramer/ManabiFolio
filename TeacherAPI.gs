function getTeacherAllResponses(sessionId) {
  requireTeacher_();

  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('Responses');
  if (!sheet) return JSON.stringify([]);

  const data = sheet.getDataRange().getValues();
  const rows = (String(data[0][0]).toLowerCase().indexOf('timestamp') !== -1) ? data.slice(1) : data;

  const results = rows
    .filter(row => String(row[1]) === sessionId)
    .map(row => ({
      timestamp: new Date(row[0]).toLocaleString(),
      email: row[2],
      answers: parseJSONSafe_(row[3])
    }));
    
  return JSON.stringify(results.reverse());
}

function createSession(title, desc, questionsJson, relatedSetTitle) {
  requireTeacher_();

  const ss = getTargetSpreadsheet();
  const sSheet = ss.getSheetByName('Sessions');
  const qSheet = ss.getSheetByName('Questions');

  if (!sSheet || !qSheet) throw new Error("DBシートが存在しません。Setupを実行してください。");

  const sessionId = "sess_" + Utilities.formatDate(new Date(), "JST", "yyyyMMdd_HHmmss");
  
  sSheet.appendRow([
    sessionId, 
    title, 
    desc, 
    'Active', 
    new Date(), 
    relatedSetTitle || '' 
  ]);

  const questions = JSON.parse(questionsJson);
  questions.forEach((q, idx) => {
    qSheet.appendRow([
      sessionId,
      q.id,
      q.type,
      q.label,
      q.options ? q.options.join(',') : '',
      q.min,
      q.max,
      idx + 1
    ]);
  });
  
  // キャッシュをクリアして新しいセッションを即座に反映
  flushFormConfigCache();
  
  return { success: true };
}

function toggleSessionStatus(sessionId, newStatus) {
  requireTeacher_();
  
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('Sessions');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sessionId) {
      sheet.getRange(i + 1, 4).setValue(newStatus);
      return { success: true };
    }
  }
  throw new Error("セッションが見つかりません");
}

function getAnnualResponses(targetSetTitle) {
  requireTeacher_();
  
  const ss = getTargetSpreadsheet();
  
  const sSheet = ss.getSheetByName('Sessions');
  const sData = sSheet.getDataRange().getValues().slice(1);
  const targetSessions = sData.filter(r => r[5] === targetSetTitle);
  const sessionMap = {}; 
  targetSessions.forEach(r => sessionMap[String(r[0])] = r[1]);
  const sessionIds = Object.keys(sessionMap);
  
  if (sessionIds.length === 0) return JSON.stringify({questions:[], data:[]});
  
  const qSheet = ss.getSheetByName('Questions');
  const qData = qSheet.getDataRange().getValues(); 
  
  const relevantQs = qData.filter(r => sessionIds.includes(String(r[0])));
  const qMap = {}; 
  relevantQs.forEach(r => {
      const qid = String(r[1]);
      if(!qMap[qid]) {
          qMap[qid] = { id: qid, label: r[3], order: Number(r[7]) };
      }
  });
  const questions = Object.values(qMap).sort((a,b) => a.order - b.order);

  const rSheet = ss.getSheetByName('Responses');
  const rData = rSheet.getDataRange().getValues().slice(1);
  
  const resultData = [];
  rData.forEach(row => {
      const sid = String(row[1]);
      if(sessionMap[sid]) {
          const answers = row[3] ? parseJSONSafe_(row[3]) : {};
          resultData.push({
              email: row[2],
              sessionTitle: sessionMap[sid],
              timestamp: row[0],
              answers: answers
          });
      }
  });

  resultData.sort((a,b) => {
      if(a.email < b.email) return -1;
      if(a.email > b.email) return 1;
      return new Date(a.timestamp) - new Date(b.timestamp);
  });

  return JSON.stringify({
      questions: questions,
      data: resultData
  });
}

function getTeacherClassData(targetId, targetGrade, targetClass) {
    requireTeacher_();

    const currentYear = getSystemYear();
    const ss = getTargetSpreadsheet();

    // 1. Get filtered students from UserProfiles
    const uSheet = ss.getSheetByName('UserProfiles');
    if (!uSheet) return JSON.stringify({ questions: [], data: [], message: "UserProfiles sheet missing" });

    const uData = uSheet.getDataRange().getValues().slice(1);
    const targetEmails = new Set();

    uData.forEach(row => {
        // Year, Email, Grade, Class
        if (String(row[0]) === currentYear &&
            String(row[2]) === String(targetGrade) &&
            String(row[3]) === String(targetClass)) {
            targetEmails.add(String(row[1]));
        }
    });

    if (targetEmails.size === 0) return JSON.stringify({ questions: [], data: [], message: "No students found for this class." });

    // 2. Identify target sessions
    const sSheet = ss.getSheetByName('Sessions');
    const sData = sSheet.getDataRange().getValues().slice(1);
    
    // Check if targetId is a specific SessionID
    let targetSessions = sData.filter(r => String(r[0]) === targetId);
    
    // If not found as SessionID, try as RelatedSetTitle
    if (targetSessions.length === 0) {
        targetSessions = sData.filter(r => r[5] === targetId);
    }

    const sessionMap = {};
    targetSessions.forEach(r => sessionMap[String(r[0])] = r[1]);
    const sessionIds = Object.keys(sessionMap);

    if (sessionIds.length === 0) return JSON.stringify({ questions: [], data: [], message: "No sessions found." });

    const qSheet = ss.getSheetByName('Questions');
    const qData = qSheet.getDataRange().getValues();
    const relevantQs = qData.filter(r => sessionIds.includes(String(r[0])));
    const qMap = {};
    relevantQs.forEach(r => {
        const qid = String(r[1]);
        if (!qMap[qid]) {
            qMap[qid] = { id: qid, label: r[3], order: Number(r[7]) };
        }
    });
    const questions = Object.values(qMap).sort((a, b) => a.order - b.order);

    // 3. Get Responses
    const rSheet = ss.getSheetByName('Responses');
    const rData = rSheet.getDataRange().getValues().slice(1);

    const resultData = [];
    rData.forEach(row => {
        const sid = String(row[1]);
        const email = String(row[2]);

        // Filter by session AND target emails
        if (sessionMap[sid] && targetEmails.has(email)) {
            const answers = row[3] ? parseJSONSafe_(row[3]) : {};
            resultData.push({
                email: email,
                sessionTitle: sessionMap[sid],
                timestamp: row[0],
                answers: answers
            });
        }
    });

    const studentInfoMap = {};
    uData.forEach(row => {
        if (targetEmails.has(String(row[1]))) {
            studentInfoMap[String(row[1])] = { number: row[4], name: row[5] };
        }
    });

    // Enrich results
    const enrichedData = resultData.map(d => ({
        ...d,
        studentNumber: studentInfoMap[d.email] ? studentInfoMap[d.email].number : '',
        studentName: studentInfoMap[d.email] ? studentInfoMap[d.email].name : ''
    }));

    // Sort by Number then Timestamp
    enrichedData.sort((a, b) => {
        const numA = parseInt(a.studentNumber) || 999;
        const numB = parseInt(b.studentNumber) || 999;
        if (numA !== numB) return numA - numB;
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    return JSON.stringify({
        questions: questions,
        data: enrichedData,
        meta: {
            year: currentYear,
            grade: targetGrade,
            class: targetClass
        }
    });
}

function getStudentStudyAverages(targetEmail) {
  const email = resolveTeacherTargetEmail_(targetEmail);

  const currentYear = getSystemYear();
  const profile = getStudyProfileByEmail_(currentYear, email);
  if (!profile) throw new Error("生徒情報が見つかりません");

  const rows = getStudyLogRows_(currentYear)
    .filter(row => normalizeEmail_(row[3]) === email);

  const result = buildStudyAverages_(rows);
  return JSON.stringify({
    email: email,
    profile: profile,
    subjectAverages: result.subjectAverages,
    totals: result.totals
  });
}

function getClassStudyAverages(targetGrade, targetClass) {
  requireTeacher_();
  if (!targetGrade || !targetClass) throw new Error("学年と組を指定してください");

  const currentYear = getSystemYear();
  const rows = getStudyLogRows_(currentYear)
    .filter(row => String(row[4]) === String(targetGrade) && String(row[5]) === String(targetClass));

  const result = buildStudyAverages_(rows);
  const studentCount = getStudyStudentCount_(currentYear, targetGrade, targetClass);

  return JSON.stringify({
    grade: String(targetGrade),
    cls: String(targetClass),
    studentCount: studentCount,
    subjectAverages: result.subjectAverages,
    totals: result.totals
  });
}

function getGradeStudyAverages(targetGrade) {
  requireTeacher_();
  if (!targetGrade) throw new Error("学年を指定してください");

  const currentYear = getSystemYear();
  const rows = getStudyLogRows_(currentYear)
    .filter(row => String(row[4]) === String(targetGrade));

  const result = buildStudyAverages_(rows);
  const studentCount = getStudyStudentCount_(currentYear, targetGrade, null);

  return JSON.stringify({
    grade: String(targetGrade),
    studentCount: studentCount,
    subjectAverages: result.subjectAverages,
    totals: result.totals
  });
}

function getStudyLogRows_(year) {
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('StudyLogs');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const rows = (data.length > 0 && String(data[0][0]).toLowerCase().indexOf('timestamp') !== -1)
    ? data.slice(1)
    : data;

  return rows.filter(row => String(row[2]) === String(year));
}

function buildStudyAverages_(rows) {
  const subjectTotals = {};
  const subjectCounts = {};
  let totalMinutes = 0;
  let totalEntries = 0;

  rows.forEach(row => {
    const subject = String(row[8]);
    const minutes = Number(row[9]) || 0;
    totalMinutes += minutes;
    totalEntries += 1;
    subjectTotals[subject] = (subjectTotals[subject] || 0) + minutes;
    subjectCounts[subject] = (subjectCounts[subject] || 0) + 1;
  });

  const subjectAverages = {};
  getStudySubjects_().forEach(subject => {
    const total = subjectTotals[subject] || 0;
    const count = subjectCounts[subject] || 0;
    subjectAverages[subject] = count ? Math.round((total / count) * 10) / 10 : 0;
  });

  const average = totalEntries ? Math.round((totalMinutes / totalEntries) * 10) / 10 : 0;

  return {
    subjectAverages: subjectAverages,
    totals: {
      minutes: totalMinutes,
      entries: totalEntries,
      average: average
    }
  };
}

function getStudyProfileByEmail_(year, email) {
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('UserProfiles');
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues().slice(1);
  const normalizedEmail = normalizeEmail_(email);
  const row = data.find(r => String(r[0]) === String(year) && normalizeEmail_(r[1]) === normalizedEmail);
  if (!row) return null;

  return {
    grade: row[2],
    cls: row[3],
    number: row[4],
    name: row[5]
  };
}

function getStudyStudentCount_(year, grade, cls) {
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('UserProfiles');
  if (!sheet) return 0;

  const data = sheet.getDataRange().getValues().slice(1);
  const students = data.filter(row => {
    if (String(row[0]) !== String(year)) return false;
    if (grade && String(row[2]) !== String(grade)) return false;
    if (cls && String(row[3]) !== String(cls)) return false;
    return true;
  });
  return students.length;
}

/**
 * 提出状況を取得する（未提出者チェック用）
 * @param {string} sessionId - 対象セッションID
 * @param {string} targetGrade - 対象学年（空の場合は全学年）
 * @param {string} targetClass - 対象クラス（空の場合は全組）
 * @returns {string} JSON形式の提出状況データ
 */
function getSubmissionStatus(sessionId, targetGrade, targetClass) {
    requireTeacher_();
    const currentYear = getSystemYear();
    const ss = getTargetSpreadsheet();

    // 1. UserProfilesから対象生徒を取得
    const uSheet = ss.getSheetByName('UserProfiles');
    if (!uSheet) return JSON.stringify({ error: "UserProfilesシートがありません" });

    const uData = uSheet.getDataRange().getValues().slice(1);
    const students = [];

    uData.forEach(row => {
        // Year, Email, Grade, Class, Number, Name
        if (String(row[0]) !== currentYear) return;
        if (targetGrade && String(row[2]) !== String(targetGrade)) return;
        if (targetClass && String(row[3]) !== String(targetClass)) return;

        students.push({
            email: String(row[1]),
            grade: String(row[2]),
            cls: String(row[3]),
            number: row[4],
            name: row[5],
            submitted: false,
            submittedAt: null
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

    // 2. Responsesから提出済みのEmailを取得
    const rSheet = ss.getSheetByName('Responses');
    if (!rSheet) return JSON.stringify({ error: "Responsesシートがありません" });

    const rData = rSheet.getDataRange().getValues().slice(1);
    const submittedEmails = new Map(); // email -> timestamp

    rData.forEach(row => {
        if (String(row[1]) === sessionId) {
            const email = String(row[2]);
            const timestamp = row[0];
            // 最新の提出日時を保持
            if (!submittedEmails.has(email) || new Date(timestamp) > new Date(submittedEmails.get(email))) {
                submittedEmails.set(email, timestamp);
            }
        }
    });

    // 3. 生徒データに提出状況をマージ
    students.forEach(student => {
        if (submittedEmails.has(student.email)) {
            student.submitted = true;
            student.submittedAt = submittedEmails.get(student.email);
        }
    });

    // 出席番号でソート
    students.sort((a, b) => {
        if (a.grade !== b.grade) return parseInt(a.grade) - parseInt(b.grade);
        if (a.cls !== b.cls) return parseInt(a.cls) - parseInt(b.cls);
        return parseInt(a.number) - parseInt(b.number);
    });

    const submitted = students.filter(s => s.submitted);
    const missing = students.filter(s => !s.submitted);

    return JSON.stringify({
        students: students,
        submitted: submitted,
        missing: missing,
        stats: {
            total: students.length,
            submitted: submitted.length,
            missing: missing.length,
            rate: students.length > 0 ? Math.round((submitted.length / students.length) * 100) : 0
        }
    });
}

/**
 * ダッシュボード用の統計情報を取得する
 * @returns {string} JSON形式の統計データ
 */
function getDashboardStats() {
    requireTeacher_();

    const currentYear = getSystemYear();
    const ss = getTargetSpreadsheet();

    // セッション数（Active/Closedのみ）
    const sSheet = ss.getSheetByName('Sessions');
    let activeSessions = 0;
    if (sSheet) {
        const sData = sSheet.getDataRange().getValues().slice(1);
        activeSessions = sData.filter(r => String(r[3]) === 'Active').length;
    }

    // 総回答数
    const rSheet = ss.getSheetByName('Responses');
    let totalResponses = 0;
    if (rSheet) {
        totalResponses = rSheet.getLastRow() - 1; // ヘッダー行を除く
        if (totalResponses < 0) totalResponses = 0;
    }

    // 登録生徒数（今年度）
    const uSheet = ss.getSheetByName('UserProfiles');
    let totalStudents = 0;
    if (uSheet) {
        const uData = uSheet.getDataRange().getValues().slice(1);
        totalStudents = uData.filter(r => String(r[0]) === currentYear).length;
    }

    // 共通セット数
    const cSheet = ss.getSheetByName('CommonQuestionSets');
    let totalSets = 0;
    if (cSheet) {
        const cData = cSheet.getDataRange().getValues().slice(1);
        const setIds = new Set();
        cData.forEach(r => setIds.add(String(r[0])));
        totalSets = setIds.size;
    }

    return JSON.stringify({
        activeSessions: activeSessions,
        totalResponses: totalResponses,
        totalStudents: totalStudents,
        totalSets: totalSets
    });
}

/**
 * クラス別データ出力用に共通セットとセッションのリストを取得
 */
function getExportTargetList() {
    requireTeacher_();

    const ss = getTargetSpreadsheet();
    const result = { sets: [], sessions: [] };

    // 共通セット（CommonSets）を取得
    const cSheet = ss.getSheetByName('CommonSets');
    if (cSheet) {
        const cData = cSheet.getDataRange().getValues().slice(1);
        const setTitles = new Set();
        cData.forEach(row => {
            if (row[0] && !setTitles.has(String(row[0]))) {
                setTitles.add(String(row[0]));
                result.sets.push({ title: String(row[0]) });
            }
        });
    }

    // セッション（Sessions）を取得
    const sSheet = ss.getSheetByName('Sessions');
    if (sSheet) {
        const sData = sSheet.getDataRange().getValues().slice(1);
        sData.forEach(row => {
            result.sessions.push({
                id: String(row[0]),
                title: String(row[1]),
                status: String(row[3]),
                relatedSet: String(row[5] || '')
            });
        });
    }

    return JSON.stringify(result);
}
