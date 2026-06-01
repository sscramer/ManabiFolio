function getFormConfig(includeClosed = false) {
  requireAuthorizedUser_();
  return getFormConfig_(includeClosed);
}

function getFormConfig_(includeClosed = false) {
  try {
    // キャッシュチェック
    const cache = CacheService.getScriptCache();
    const cacheKey = 'formConfig_' + (includeClosed ? 'all' : 'active');
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached; // キャッシュヒット
    }

    const ss = getTargetSpreadsheet();
    const sessionSheet = ss.getSheetByName('Sessions');
    const qSheet = ss.getSheetByName('Questions');
    
    if (!sessionSheet || !qSheet) return '{}'; 

    const sessions = sessionSheet.getDataRange().getValues().slice(1);
    const questions = qSheet.getDataRange().getValues().slice(1);
    
    const config = {};
    
    sessions.forEach(row => {
      const sid = String(row[0]);
      config[sid] = {
        title: row[1],
        description: row[2],
        status: row[3],
        relatedSetTitle: row[5] || '',
        items: []
      };
    });

    questions.forEach(row => {
      const sid = String(row[0]);
      if (!config[sid]) return; 
      config[sid].items.push({
        id: row[1],
        type: row[2],
        label: row[3],
        options: row[4] ? String(row[4]).split(',') : [],
        min: row[5],
        max: row[6],
        order: row[7]
      });
    });

    Object.values(config).forEach(session => {
      session.items.sort((a, b) => a.order - b.order);
    });

    const result = JSON.stringify(config);
    
    // キャッシュに保存（10分）
    cache.put(cacheKey, result, 600);
    
    return result;

  } catch(e) {
    return JSON.stringify({ error: e.toString() });
  }
}

function getUserHistory(targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  return getHistoryByEmail_(resolved.email);
}

function getHistoryByEmail_(email) {
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('Responses');
  if (!sheet) return JSON.stringify({ data: [] });

  const data = sheet.getDataRange().getValues();
  if (data.length < 1) return JSON.stringify({ data: [] });

  let rows = data;
  if (String(data[0][0]).toLowerCase().indexOf('timestamp') !== -1) {
    rows = data.slice(1);
  }
  
  const history = rows
    .filter(row => normalizeEmail_(row[2]) === normalizeEmail_(email))
    .map(row => ({
      timestamp: new Date(row[0]).toLocaleString(),
      sessionId: String(row[1]),
      answers: parseJSONSafe_(row[3])
    }));
    
  return JSON.stringify({ data: history.reverse() });
}

function submitForm(sessionId, formJson, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;

  const ss = getTargetSpreadsheet();
  const timestamp = new Date();

  // 正常系: 本テーブルへ直接書き込み（5000msロック待機 - 直接書き込み優先）
  const lock = LockService.getScriptLock();
  if (lock.tryLock(5000)) {
    try {
      let sheet = ss.getSheetByName('Responses');
      if (!sheet) {
        sheet = ss.insertSheet('Responses');
        sheet.appendRow(['Timestamp', 'SessionID', 'Email', 'Answers_JSON']);
        console.log('Responsesシート作成完了');
      }
      const beforeRow = sheet.getLastRow();
      sheet.appendRow([timestamp, sessionId, email, formJson]);
      SpreadsheetApp.flush();
      const afterRow = sheet.getLastRow();
      console.log('DirectWrite: sessionId=' + sessionId.substring(0, 30) + ', before=' + beforeRow + ', after=' + afterRow);
      if (afterRow <= beforeRow) {
        console.error('DirectWrite失敗: 行が増えていない!');
      }
      return { success: true, queued: false, beforeRow: beforeRow, afterRow: afterRow };
    } finally {
      lock.releaseLock();
    }
  }
  
  // 異常系: CacheServiceバッファへ書き込み
  console.log('本テーブルロック取得失敗、CacheServiceへフォールバック');
  const cacheResult = writeToCacheQueue_('resp', {
    timestamp: timestamp.toISOString(),
    sessionId: sessionId,
    email: email,
    formJson: formJson
  });
  
  if (cacheResult.success) {
    return { success: true, queued: true, cache: true, key: cacheResult.key, slot: cacheResult.slot };
  }
  
  // CacheService失敗 → エラーを返す（シャードキュー廃止）
  console.error('CacheService書き込み失敗: ' + cacheResult.error);
  return { success: false, error: cacheResult.error || 'cache_write_failed' };
}

function getMyAnnualResponses(targetSetTitle) {
  const user = requireAuthorizedUser_();
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
      const email = String(row[2]);
      
      if(sessionMap[sid] && email === user.email) {
          const answers = row[3] ? parseJSONSafe_(row[3]) : {};
          resultData.push({
              sessionTitle: sessionMap[sid],
              timestamp: row[0], // Keep as raw for sorting
              answers: answers
          });
      }
  });

  resultData.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));

  return JSON.stringify({
      questions: questions,
      data: resultData
  });
}

function submitStudyLog(dateStr, subject, minutes, content, targetEmail) {
  const entries = [{ subject: subject, minutes: minutes }];
  return submitStudyLogs(dateStr, entries, content, targetEmail);
}

function submitStudyLogs(dateStr, entries, content, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const user = resolved.user;
  const email = resolved.email;

  const dateKey = normalizeStudyDate_(dateStr);
  if (!dateKey) throw new Error("日付を入力してください");
  if (!entries || !Array.isArray(entries) || entries.length === 0) throw new Error("学習時間を入力してください");

  const allowedSubjects = getStudySubjects_();
  const normalizedEntries = entries.map(entry => {
    const subject = entry && entry.subject ? String(entry.subject) : '';
    const minutesNum = Number(entry && entry.minutes);
    if (!allowedSubjects.includes(subject)) throw new Error("教科が正しくありません");
    if (!Number.isFinite(minutesNum) || minutesNum <= 0) throw new Error("学習時間を正しく入力してください");
    return { subject: subject, minutes: minutesNum };
  });

  const reg = checkUserRegistration(email);
  const year = reg.registered ? reg.year : getSystemYear();
  let profile = reg.profile;
  if (!profile) {
    if (user.isTeacher) {
      profile = {
        grade: '',
        cls: '',
        number: '',
        name: user.name || '教員'
      };
    } else {
      throw new Error("未登録のユーザーです");
    }
  }

  const ss = getTargetSpreadsheet();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error("しばらく待ってから再度お試しください");

  try {
    let sheet = ss.getSheetByName('StudyLogs');
    if (!sheet) {
      sheet = ss.insertSheet('StudyLogs');
      sheet.appendRow(['Timestamp', 'Date', 'Year', 'Email', 'Grade', 'Class', 'Number', 'Name', 'Subject', 'Minutes', 'Content']);
    }

    const data = sheet.getDataRange().getValues();
    const hasHeader = data.length > 0 && String(data[0][0]).toLowerCase().indexOf('timestamp') !== -1;
    const rows = hasHeader ? data.slice(1) : data;
    const baseRowIndex = hasHeader ? 2 : 1;

    const rowIndexMap = {};
    rows.forEach((row, idx) => {
    if (String(row[2]) !== String(year)) return;
    if (String(row[3]) !== String(email)) return;
    if (normalizeStudyDate_(row[1]) !== dateKey) return;
      const subjectKey = String(row[8]);
      if (!subjectKey) return;
      rowIndexMap[subjectKey] = baseRowIndex + idx;
    });

    const contentValue = content === undefined || content === null ? '' : String(content);
    let created = 0;
    let updated = 0;

    normalizedEntries.forEach(entry => {
      const rowIndex = rowIndexMap[entry.subject];
      const rowValues = [
        new Date(),
        dateKey,
      year,
      email,
      profile.grade,
      profile.cls,
      profile.number,
      profile.name,
        entry.subject,
        entry.minutes,
        contentValue
      ];
      if (rowIndex) {
        sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
        updated += 1;
      } else {
        sheet.appendRow(rowValues);
        created += 1;
      }
    });

    if (contentValue !== '') {
      rows.forEach((row, idx) => {
      if (String(row[2]) !== String(year)) return;
      if (String(row[3]) !== String(email)) return;
      if (normalizeStudyDate_(row[1]) !== dateKey) return;
      sheet.getRange(baseRowIndex + idx, 11).setValue(contentValue);
    });
    }

    SpreadsheetApp.flush();
    return { success: true, created: created, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

function getStudyLogsByDate(dateStr, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;

  const dateKey = normalizeStudyDate_(dateStr);
  if (!dateKey) throw new Error("日付を入力してください");

  const currentYear = getSystemYear();
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('StudyLogs');
  if (!sheet) return JSON.stringify({ date: dateKey, subjects: {}, content: '' });

  const data = sheet.getDataRange().getValues();
  const rows = (data.length > 0 && String(data[0][0]).toLowerCase().indexOf('timestamp') !== -1)
    ? data.slice(1)
    : data;

  const subjects = {};
  let latestTimestamp = null;
  let content = '';

  rows.forEach(row => {
    if (String(row[2]) !== String(currentYear)) return;
    if (String(row[3]) !== String(email)) return;
    if (normalizeStudyDate_(row[1]) !== dateKey) return;
    const subjectVal = String(row[8]);
    const minutesVal = Number(row[9]) || 0;
    subjects[subjectVal] = minutesVal;
    const ts = row[0] instanceof Date ? row[0] : new Date(row[0]);
    if (!latestTimestamp || ts > latestTimestamp) {
      latestTimestamp = ts;
      content = row[10] || '';
    }
  });

  return JSON.stringify({ date: dateKey, subjects: subjects, content: content });
}

function getMyStudyLogs(targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;

  const currentYear = getSystemYear();
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('StudyLogs');
  if (!sheet) {
    return JSON.stringify({
      logs: [],
      dailyTotals: [],
      subjectAverages: {},
      totals: { minutes: 0, entries: 0, average: 0 }
    });
  }

  const data = sheet.getDataRange().getValues();
  const rows = (data.length > 0 && String(data[0][0]).toLowerCase().indexOf('timestamp') !== -1)
    ? data.slice(1)
    : data;

  const logs = [];
  const dailyMap = {};
  const dailySubjects = {};
  const dailyContent = {};
  const dailyTimestamp = {};
  const subjectTotals = {};
  const subjectCounts = {};
  let totalMinutes = 0;

  rows.forEach(row => {
    if (String(row[2]) !== String(currentYear)) return;
    if (String(row[3]) !== String(email)) return;

    const dateVal = normalizeStudyDate_(row[1]);
    if (!dateVal) return;
    const subjectVal = String(row[8]);
    const minutesVal = Number(row[9]) || 0;

    logs.push({
      timestamp: row[0],
      date: dateVal,
      subject: subjectVal,
      minutes: minutesVal,
      content: row[10] || ''
    });

    totalMinutes += minutesVal;
    dailyMap[dateVal] = (dailyMap[dateVal] || 0) + minutesVal;
    if (!dailySubjects[dateVal]) dailySubjects[dateVal] = {};
    dailySubjects[dateVal][subjectVal] = (dailySubjects[dateVal][subjectVal] || 0) + minutesVal;
    const ts = row[0] instanceof Date ? row[0] : new Date(row[0]);
    if (!dailyTimestamp[dateVal] || ts > dailyTimestamp[dateVal]) {
      dailyTimestamp[dateVal] = ts;
      dailyContent[dateVal] = row[10] || '';
    }
    subjectTotals[subjectVal] = (subjectTotals[subjectVal] || 0) + minutesVal;
    subjectCounts[subjectVal] = (subjectCounts[subjectVal] || 0) + 1;
  });

  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const sortedDates = Object.keys(dailyMap).sort();
  const dailyTotals = sortedDates.map(date => ({ date: date, minutes: dailyMap[date] }));

  const subjectAverages = {};
  getStudySubjects_().forEach(subject => {
    const total = subjectTotals[subject] || 0;
    const count = subjectCounts[subject] || 0;
    subjectAverages[subject] = count ? Math.round((total / count) * 10) / 10 : 0;
  });

  const average = logs.length ? Math.round((totalMinutes / logs.length) * 10) / 10 : 0;

  const recentDates = sortedDates.slice(-10);
  const recentDays = recentDates.map(date => ({
    date: date,
    subjects: dailySubjects[date] || {},
    content: dailyContent[date] || ''
  }));

  return JSON.stringify({
    logs: logs,
    dailyTotals: dailyTotals,
    dailySubjects: dailySubjects,
    recentDays: recentDays,
    subjectAverages: subjectAverages,
    totals: {
      minutes: totalMinutes,
      entries: logs.length,
      average: average
    }
  });
}

function saveIgpRecord(termKey, termLabel, scores, note, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail, { requireTargetForTeacher: true });
  const email = resolved.email;

  if (!termKey) throw new Error("学期を指定してください");
  if (!scores || !Array.isArray(scores) || scores.length !== 6) throw new Error("スコアが正しくありません");

  const skillScores = scores.map(v => {
    const num = Number(v);
    if (!Number.isFinite(num) || num < 1 || num > 5) throw new Error("スコアは1〜5で入力してください");
    return num;
  });

  const ss = getTargetSpreadsheet();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error("しばらく待ってから再度お試しください");

  try {
    let sheet = ss.getSheetByName('IGPRecords');
    if (!sheet) {
      sheet = ss.insertSheet('IGPRecords');
      sheet.appendRow(['Timestamp', 'Email', 'TermKey', 'TermLabel', 'Skill1', 'Skill2', 'Skill3', 'Skill4', 'Skill5', 'Skill6', 'Note']);
    }

    const data = sheet.getDataRange().getValues();
    const hasHeader = data.length > 0 && String(data[0][0]).toLowerCase().indexOf('timestamp') !== -1;
    const rows = hasHeader ? data.slice(1) : data;
    const baseRowIndex = hasHeader ? 2 : 1;

    let existingRowIndex = null;
    rows.forEach((row, idx) => {
      if (String(row[1]) !== String(email)) return;
      if (String(row[2]) !== String(termKey)) return;
      existingRowIndex = baseRowIndex + idx;
    });

    const currentYear = getSystemYear();
    const currentYearKey = normalizeIgpYearKey_(currentYear);
    const termYearKey = extractIgpYearKey_(termKey);
    if (currentYearKey && termYearKey && currentYearKey !== termYearKey && !existingRowIndex) {
      throw new Error("過去年度の新規登録はできません");
    }

    const label = termLabel || formatIgpTermLabel_(termKey);

    const rowValues = [
      new Date(),
      email,
      termKey,
      label,
      skillScores[0],
      skillScores[1],
      skillScores[2],
      skillScores[3],
      skillScores[4],
      skillScores[5],
      note || ''
    ];

    if (existingRowIndex) {
      sheet.getRange(existingRowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }

    SpreadsheetApp.flush();
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function getIgpRecords(targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;

  const currentYear = getSystemYear();
  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('IGPRecords');
  if (!sheet) return JSON.stringify({ records: [], latest: null, previous: null, currentYear: currentYear });

  const data = sheet.getDataRange().getValues();
  const rows = (data.length > 0 && String(data[0][0]).toLowerCase().indexOf('timestamp') !== -1)
    ? data.slice(1)
    : data;

  const records = rows.filter(row => String(row[1]) === String(email)).map(row => {
    const termKey = row[2];
    const termLabel = row[3] || formatIgpTermLabel_(termKey);
    return {
      timestamp: row[0],
      termKey: termKey,
      termLabel: termLabel,
      scores: [row[4], row[5], row[6], row[7], row[8], row[9]].map(v => Number(v) || 0),
      note: row[10] || ''
    };
  });

  records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return JSON.stringify({
    records: records,
    latest: records[0] || null,
    previous: records[1] || null,
    currentYear: currentYear
  });
}

function getIgpCompare(termKeyA, termKeyB, targetEmail) {
  const resolved = resolveAuthorizedEmail_(targetEmail);
  const email = resolved.email;

  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('IGPRecords');
  if (!sheet) return JSON.stringify({ current: null, previous: null });

  const data = sheet.getDataRange().getValues();
  const rows = (data.length > 0 && String(data[0][0]).toLowerCase().indexOf('timestamp') !== -1)
    ? data.slice(1)
    : data;

  const records = rows.filter(row => String(row[1]) === String(email)).map(row => ({
    timestamp: row[0],
    termKey: row[2],
    termLabel: row[3],
    scores: [row[4], row[5], row[6], row[7], row[8], row[9]].map(v => Number(v) || 0),
    note: row[10] || ''
  }));

  const current = records.find(r => String(r.termKey) === String(termKeyA)) || null;
  const previous = records.find(r => String(r.termKey) === String(termKeyB)) || null;

  return JSON.stringify({ current: current, previous: previous });
}

function normalizeIgpYearKey_(yearValue) {
  if (!yearValue) return '';
  const str = String(yearValue).trim();
  return str.replace('年度', '').trim();
}

function extractIgpYearKey_(termKey) {
  if (!termKey) return '';
  const parts = String(termKey).split('-');
  return parts[0] || '';
}

function formatIgpTermLabel_(termKey) {
  if (!termKey) return '';
  const parts = String(termKey).split('-');
  const year = parts[0] || '';
  const term = parts[1] || '';
  const termNum = term.replace('T', '');
  return termNum ? `${year} ${termNum}学期` : `${year}`;
}

function normalizeStudyDate_(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
    const parts = str.split('/');
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return str;
}
