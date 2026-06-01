/**
 * ManabiFolio システム ユーティリティ関数
 * 
 * 以下のスクリプトプロパティで設定可能：
 * - SPREADSHEET_ID: データ保存用スプレッドシートID（必須）
 * - TEACHER_DOMAIN: 教員メールドメイン（例: @teacher.example.ed.jp）
 * - STUDENT_DOMAIN: 生徒メールドメイン（例: @student.example.ed.jp）
 */

/**
 * ターゲットスプレッドシートを取得
 * スクリプトプロパティ「SPREADSHEET_ID」から取得
 */
function getTargetSpreadsheet() {
  const ssId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  
  if (ssId && ssId.length > 5) {
    return SpreadsheetApp.openById(ssId);
  }
  
  throw new Error("SPREADSHEET_ID が設定されていません");
}

/**
 * ユーザー情報を取得
 * TEACHER_DOMAIN / STUDENT_DOMAIN をスクリプトプロパティから取得
 * 複数ドメインはカンマ区切りで指定可能（例: @student.example.ed.jp,@demo.manabifolio.local）
 * 
 * 厳格モード：TEACHER_DOMAINまたはSTUDENT_DOMAINに一致しないユーザーは
 * isAuthorized=false となり、アクセスが拒否されます
 */
function getUserInfo() {
  const email = normalizeEmail_(Session.getActiveUser().getEmail());
  const props = PropertiesService.getScriptProperties();
  
  const teacherDomain = props.getProperty("TEACHER_DOMAIN") || "";
  const studentDomains = props.getProperty("STUDENT_DOMAIN") || "";
  
  if (!email) {
    return {
      email: "",
      isTeacher: false,
      isStudent: false,
      isAuthorized: false
    };
  }

  // 教員判定：TEACHER_DOMAINのいずれかで終わるかどうか
  const teacherDomains = parseDomainList_(teacherDomain);
  const isTeacher = teacherDomains.some(domain => email.endsWith(domain));
  
  // 生徒判定：STUDENT_DOMAINのいずれかで終わるかどうか（カンマ区切り対応）
  const studentDomainList = parseDomainList_(studentDomains);
  const isStudent = studentDomainList.some(domain => email.endsWith(domain));
  
  // 厳格モード：どちらにも該当しない場合はアクセス不可
  const isAuthorized = isTeacher || isStudent;
  
  return { 
    email: email, 
    isTeacher: isTeacher,
    isStudent: isStudent,
    isAuthorized: isAuthorized
  };
}

function parseDomainList_(value) {
  return String(value || "")
    .split(",")
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail_(email) {
  return String(email || "").trim().toLowerCase();
}

function requireAuthorizedUser_() {
  const user = getUserInfo();
  if (!user.email || !user.isAuthorized) {
    throw new Error("権限がありません");
  }
  return user;
}

function requireTeacher_() {
  const user = requireAuthorizedUser_();
  if (!user.isTeacher) {
    throw new Error("権限がありません");
  }
  return user;
}

function resolveAuthorizedEmail_(targetEmail, options) {
  const user = requireAuthorizedUser_();
  const opts = options || {};
  const ownEmail = normalizeEmail_(user.email);
  const requestedEmail = normalizeEmail_(targetEmail);
  const hasTargetEmail = requestedEmail !== "";

  if (hasTargetEmail && requestedEmail !== ownEmail && !user.isTeacher) {
    throw new Error("権限がありません");
  }

  if (opts.requireTargetForTeacher && user.isTeacher && !hasTargetEmail) {
    throw new Error("対象の生徒を指定してください");
  }

  if (opts.requireTargetForTeacher && user.isTeacher && requestedEmail === ownEmail) {
    throw new Error("対象の生徒を指定してください");
  }

  if (hasTargetEmail && requestedEmail !== ownEmail && user.isTeacher && !isAllowedStudentEmail_(requestedEmail)) {
    throw new Error("対象メールのドメインが許可されていません");
  }

  return {
    user: user,
    email: hasTargetEmail ? requestedEmail : ownEmail,
    hasTargetEmail: hasTargetEmail,
    isTargetingAnotherUser: hasTargetEmail && requestedEmail !== ownEmail
  };
}

function resolveTeacherTargetEmail_(targetEmail) {
  requireTeacher_();
  const email = normalizeEmail_(targetEmail);
  if (!email) {
    throw new Error("対象の生徒を指定してください");
  }
  if (!isAllowedStudentEmail_(email)) {
    throw new Error("対象メールのドメインが許可されていません");
  }
  return email;
}

function isAllowedStudentEmail_(email) {
  const domains = parseDomainList_(PropertiesService.getScriptProperties().getProperty("STUDENT_DOMAIN"));
  if (domains.length === 0) return false;
  const normalizedEmail = normalizeEmail_(email);
  return domains.some(domain => normalizedEmail.endsWith(domain));
}

function parseJSONSafe_(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return {};
  }
}

function getStudySubjects_() {
  return ['国語', '数学', '理科', '社会', '英語'];
}

function getIgpSkills_() {
  return ['傾聴力', '想像力', '思考力', '発信力', '協働力', '実行力'];
}
