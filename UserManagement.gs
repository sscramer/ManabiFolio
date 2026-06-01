function setupSheets() {
  requireTeacher_();
  const ss = getTargetSpreadsheet();
  
  let sessionSheet = ss.getSheetByName('Sessions');
  if (!sessionSheet) {
    sessionSheet = ss.insertSheet('Sessions');
    sessionSheet.appendRow(['SessionID', 'Title', 'Description', 'Status', 'CreatedAt', 'RelatedSetTitle']);
    // ダミーデータなし - ヘッダーのみ
  } else {
    const headers = sessionSheet.getRange(1, 1, 1, sessionSheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('RelatedSetTitle') === -1) {
      sessionSheet.getRange(1, headers.length + 1).setValue('RelatedSetTitle');
    }
  }
  
  let qSheet = ss.getSheetByName('Questions');
  if (!qSheet) {
    qSheet = ss.insertSheet('Questions');
    qSheet.appendRow(['SessionID', 'QuestionID', 'Type', 'Label', 'Options', 'Min', 'Max', 'Order']);
    // ダミーデータなし - ヘッダーのみ
  }

  let commonQSheet = ss.getSheetByName('CommonQuestionSets');
  if (!commonQSheet) {
    commonQSheet = ss.insertSheet('CommonQuestionSets');
    commonQSheet.appendRow(['SetID', 'SetTitle', 'QuestionID', 'Type', 'Label', 'Options', 'Min', 'Max', 'Order']);
    // ダミーデータなし - ヘッダーのみ
  }

  let userSheet = ss.getSheetByName('UserProfiles');
  if (!userSheet) {
    userSheet = ss.insertSheet('UserProfiles');
    userSheet.appendRow(['Year', 'Email', 'Grade', 'Class', 'Number', 'Name', 'RegisteredAt']);
  }

  let configSheet = ss.getSheetByName('SystemConfig');
  if (!configSheet) {
    configSheet = ss.insertSheet('SystemConfig');
    configSheet.appendRow(['Key', 'Value']);
    configSheet.appendRow(['CurrentYear', 'R7年度']);
  }

  // ResponseQueueシート（キューイング方式用）
  let queueSheet = ss.getSheetByName('ResponseQueue');
  if (!queueSheet) {
    queueSheet = ss.insertSheet('ResponseQueue');
    queueSheet.appendRow(['Timestamp', 'SessionID', 'Email', 'Answers_JSON', 'Status', 'QueuedAt']);
  }

  let studyLogSheet = ss.getSheetByName('StudyLogs');
  if (!studyLogSheet) {
    studyLogSheet = ss.insertSheet('StudyLogs');
    studyLogSheet.appendRow(['Timestamp', 'Date', 'Year', 'Email', 'Grade', 'Class', 'Number', 'Name', 'Subject', 'Minutes', 'Content']);
  }

  let igpSheet = ss.getSheetByName('IGPRecords');
  if (!igpSheet) {
    igpSheet = ss.insertSheet('IGPRecords');
    igpSheet.appendRow(['Timestamp', 'Email', 'TermKey', 'TermLabel', 'Skill1', 'Skill2', 'Skill3', 'Skill4', 'Skill5', 'Skill6', 'Note']);
  }
}

/**
 * DB初期化用のリセットキーを取得
 * スクリプトプロパティ「DB_RESET_KEY」から取得。未設定時はデフォルト値を使用
 */
function getResetKey_() {
  const key = PropertiesService.getScriptProperties().getProperty("DB_RESET_KEY");
  return key || "DELETE_ALL"; // デフォルト値（後方互換）
}

function resetAllData(confirmation) {
  requireTeacher_();
  
  const expectedKey = getResetKey_();
  if (confirmation !== expectedKey) throw new Error("確認コードが正しくありません");
  
  const ss = getTargetSpreadsheet();
  const targets = ['Sessions', 'Questions', 'Responses', 'CommonQuestionSets', 'UserProfiles', 'SystemConfig', 'StudyLogs', 'IGPRecords'];
  
  targets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) ss.deleteSheet(sheet);
  });
  
  setupSheets();
  return { success: true };
}

function getSystemYear() {
    const ss = getTargetSpreadsheet();
    const sheet = ss.getSheetByName('SystemConfig');
    if (!sheet) return "R7年度";
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === "CurrentYear") return data[i][1];
    }
    return "R7年度";
}

function setSystemYear(year) {
    requireTeacher_();

    const ss = getTargetSpreadsheet();
    let sheet = ss.getSheetByName('SystemConfig');
    if (!sheet) {
        setupSheets();
        sheet = ss.getSheetByName('SystemConfig');
    }

    const data = sheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === "CurrentYear") {
            sheet.getRange(i + 1, 2).setValue(year);
            found = true;
            break;
        }
    }
    if (!found) {
        sheet.appendRow(["CurrentYear", year]);
    }
    return { success: true, year: year };
}

function checkUserRegistration(targetEmail) {
    const resolved = resolveAuthorizedEmail_(targetEmail);
    const user = resolved.user;
    const currentYear = getSystemYear();

    const emailToCheck = resolved.email;
    const treatAsTeacher = user.isTeacher && !resolved.hasTargetEmail;

    if (treatAsTeacher) {
        return { registered: true, year: currentYear, isTeacher: true };
    }

    const ss = getTargetSpreadsheet();
    const sheet = ss.getSheetByName('UserProfiles');
    if (!sheet) return { registered: false, year: currentYear, isTeacher: false };

    const data = sheet.getDataRange().getValues();
    
    // Check if emailToCheck is registered for currentYear
    // Columns: Year, Email, Grade, Class, Number, Name
    const userRow = data.find(row =>
        String(row[0]) === currentYear &&
        normalizeEmail_(row[1]) === emailToCheck
    );

    if (userRow) {
        return { 
            registered: true, 
            year: currentYear, 
            isTeacher: false,
            profile: {
                grade: userRow[2],
                cls: userRow[3], // 'class' is reserved keyword often better to avoid or use string
                number: userRow[4],
                name: userRow[5]
            }
        };
    }

    return { registered: false, year: currentYear, isTeacher: false };
}

function registerUserProfile(grade, cls, number, name, targetEmail) {
    const resolved = resolveAuthorizedEmail_(targetEmail);
    const currentYear = getSystemYear();

    const emailToRegister = resolved.email;

    const ss = getTargetSpreadsheet();
    let sheet = ss.getSheetByName('UserProfiles');
    if (!sheet) {
        setupSheets();
        sheet = ss.getSheetByName('UserProfiles');
    }

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === currentYear && normalizeEmail_(data[i][1]) === emailToRegister) {
            sheet.getRange(i + 1, 3, 1, 5).setValues([[grade, cls, number, name, new Date()]]);
            return { success: true };
        }
    }

    sheet.appendRow([currentYear, emailToRegister, grade, cls, number, name, new Date()]);
    return { success: true };
}

function getClassUserList(grade, cls) {
    requireTeacher_();

    const currentYear = getSystemYear();
    const ss = getTargetSpreadsheet();
    const uSheet = ss.getSheetByName('UserProfiles');
    if (!uSheet) return JSON.stringify([]);

    const data = uSheet.getDataRange().getValues().slice(1);
    
    // Columns: Year, Email, Grade, Class, Number, Name, RegisteredAt
    const users = data.filter(row => 
        String(row[0]) === currentYear &&
        String(row[2]) === String(grade) &&
        String(row[3]) === String(cls)
    ).map(row => ({
        email: row[1],
        grade: row[2],
        class: row[3],
        number: row[4],
        name: row[5],
        registeredAt: row[6]
    }));

    // Sort by Number
    users.sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));

    return JSON.stringify(users);
}

function updateUserProfile(currentEmail, newGrade, newCls, newNumber, newName, newEmail) {
    requireTeacher_();
    
    // Validate inputs
    const normalizedCurrentEmail = normalizeEmail_(currentEmail);
    const normalizedNewEmail = normalizeEmail_(newEmail);
    if (!normalizedCurrentEmail) throw new Error("Target email is missing");

    const currentYear = getSystemYear();
    const ss = getTargetSpreadsheet();
    const uSheet = ss.getSheetByName('UserProfiles');
    if (!uSheet) throw new Error("UserProfiles sheet not found");

    const data = uSheet.getDataRange().getValues();
    let rowIndex = -1;

    // Find the row
    for(let i=1; i < data.length; i++) {
        if(String(data[i][0]) === currentYear && normalizeEmail_(data[i][1]) === normalizedCurrentEmail) {
            rowIndex = i + 1; // 1-based index
            break;
        }
    }

    if (rowIndex === -1) throw new Error("User not found: " + normalizedCurrentEmail);

    // Update Col 2 (Email), Col 3-6 (Grade, Class, Number, Name)
    uSheet.getRange(rowIndex, 2).setValue(normalizedNewEmail || normalizedCurrentEmail);
    uSheet.getRange(rowIndex, 3, 1, 4).setValues([[newGrade, newCls, newNumber, newName]]);

    return { success: true };
}
