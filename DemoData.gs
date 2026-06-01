/**
 * ダミーデータ管理
 * 1年6組の40人ダミー生徒とテストデータを作成・削除
 */

const DUMMY_GRADE = '1';
const DUMMY_CLASS = '1';
const DUMMY_EMAIL_DOMAIN = '@demo.manabifolio.local';
const DUMMY_COUNT = 40;

/**
 * ダミーデータを作成する（1年6組40人）
 */
function createDummyData() {
  requireTeacher_();

  const year = getSystemYear();
  const ss = getTargetSpreadsheet();
  const demo = getDemoDataConfig_();

  // 1. 生徒プロファイルを作成
  let uSheet = ss.getSheetByName('UserProfiles');
  if (!uSheet) {
    uSheet = ss.insertSheet('UserProfiles');
    uSheet.appendRow(['Year', 'Email', 'Grade', 'Class', 'Number', 'Name']);
  }

  const names = generateDummyNames_();
  for (let i = 1; i <= demo.count; i++) {
    const email = `demo${i.toString().padStart(2, '0')}${demo.emailDomain}`;
    uSheet.appendRow([year, email, demo.grade, demo.cls, i, names[(i - 1) % names.length]]);
  }

  // 2. ダミー回答データを作成
  createDummyResponses_(ss, year, demo);

  // 3. ダミー読書履歴データを作成
  createDummyReadingRecords_(ss, year, demo);

  return { success: true, message: `${demo.count}人のダミー生徒を${demo.grade}年${demo.cls}組に作成しました` };
}

/**
 * ダミーの名前を生成
 */
function generateDummyNames_() {
  const lastNames = ['佐藤', '鈴木', '高橋', '田中', '渡邉', '伊藤', '山本', '中村', '小林', '加藤',
                     '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水',
                     '山崎', '森', '池田', '橋本', '阿部', '石川', '長谷川', '藤田', '岡田', '近藤',
                     '前田', '石井', '小川', '後藤', '岡本', '村上', '太田', '金子', '藤井', '三浦'];
  const firstNames = ['太郎', '次郎', '三郎', '四郎', '花子', '幸子', '由美', '明', '健', '誠',
                      '翔', '大輝', '悠真', '陽向', '蓮', '樹', '海翔', '結月', '美優', '凛',
                      '優', '遥', '愛', '咲', '楓', '心', '和馬', '直樹', '智也', '雄太',
                      '翼', '慶太', '龍也', '勇人', '康介', '健太', '拓海', '彩', '萌', '菜々子'];
  
  const names = [];
  for (let i = 0; i < DUMMY_COUNT; i++) {
    names.push(lastNames[i % lastNames.length] + ' ' + firstNames[i % firstNames.length]);
  }
  return names;
}

/**
 * ダミー回答データを作成
 */
function createDummyResponses_(ss, year, demo) {
  // セッション一覧を取得
  const sSheet = ss.getSheetByName('Sessions');
  if (!sSheet) return;

  const sData = sSheet.getDataRange().getValues().slice(1);
  if (sData.length === 0) return;

  // 最初のアクティブセッションを使用
  let targetSession = null;
  for (const row of sData) {
    if (String(row[3]) === 'Active') {
      targetSession = { id: row[0], title: row[1] };
      break;
    }
  }

  if (!targetSession) return;

  // 質問を取得
  const qSheet = ss.getSheetByName('Questions');
  if (!qSheet) return;

  const qData = qSheet.getDataRange().getValues().slice(1);
  const questions = qData.filter(row => String(row[0]) === targetSession.id);

  if (questions.length === 0) return;

  // Responsesシートへダミーデータ
  let rSheet = ss.getSheetByName('Responses');
  if (!rSheet) {
    rSheet = ss.insertSheet('Responses');
    rSheet.appendRow(['Timestamp', 'SessionId', 'Email', 'Answers']);
  }

  // 30人だけ回答（10人は未回答のダミー）
  const responseCount = Math.min(30, demo.count);
  for (let i = 1; i <= responseCount; i++) {
    const email = `demo${i.toString().padStart(2, '0')}${demo.emailDomain}`;
    
    const answers = {};
    questions.forEach((q, idx) => {
      const qType = q[2];
      const qId = q[1];
      
      if (qType === 'text' || qType === 'textarea') {
        answers[qId] = `これはダミー回答${i}です。${q[3]}についての回答をここに書きます。`;
      } else if (qType === 'number') {
        answers[qId] = Math.floor(Math.random() * 5) + 1;
      } else if (qType === 'select' || qType === 'radio') {
        const options = q[4] ? q[4].split(',') : ['選択肢1', '選択肢2', '選択肢3'];
        answers[qId] = options[Math.floor(Math.random() * options.length)];
      }
    });

    rSheet.appendRow([
      new Date(),
      targetSession.id,
      email,
      JSON.stringify(answers)
    ]);
  }
}

/**
 * ダミー読書履歴データを作成
 */
function createDummyReadingRecords_(ss, year, demo) {
  const bookTitles = [
    '走れメロス', '人間失格', '銀河鉄道の夜', '羅生門', '坊っちゃん',
    'ハリー・ポッター', '君の名は。', 'コンビニ人間', '1Q84', 'ノルウェイの森',
    'モモ', 'エルマーのぼうけん', 'はてしない物語', '十五少年漂流記', '赤毛のアン'
  ];

  // ReadingGoals
  let gSheet = ss.getSheetByName('ReadingGoals');
  if (!gSheet) {
    gSheet = ss.insertSheet('ReadingGoals');
    gSheet.appendRow(['Year', 'Email', 'Term', 'TargetBooks', 'UpdatedAt']);
  }

  // ReadingRecords
  let rSheet = ss.getSheetByName('ReadingRecords');
  if (!rSheet) {
    rSheet = ss.insertSheet('ReadingRecords');
    rSheet.appendRow(['Id', 'Year', 'Email', 'Term', 'Category', 'StartMonth', 'BookTitle', 'ReadAmount', 'Evaluation', 'CreatedAt']);
  }

  // ReadingReflections
  let refSheet = ss.getSheetByName('ReadingReflections');
  if (!refSheet) {
    refSheet = ss.insertSheet('ReadingReflections');
    refSheet.appendRow(['Year', 'Email', 'Term', 'Reflection', 'UpdatedAt']);
  }

  const amounts = ['all', 'half', 'little'];
  const evals = ['great', 'ok', 'below'];
  const categories = ['morning', 'other'];

  // 35人に読書履歴を作成（5人は未入力のダミー）
  const readingCount = Math.min(35, demo.count);
  for (let i = 1; i <= readingCount; i++) {
    const email = `demo${i.toString().padStart(2, '0')}${demo.emailDomain}`;
    
    // 1学期のデータ
    const term = 1;
    const bookCount = Math.floor(Math.random() * 5) + 1;

    // 目標設定
    gSheet.appendRow([year, email, term, bookCount + Math.floor(Math.random() * 3), new Date()]);

    // 読書記録
    for (let b = 0; b < bookCount; b++) {
      const recordId = 'demo_rec_' + i + '_' + b;
      rSheet.appendRow([
        recordId,
        year,
        email,
        term,
        categories[Math.floor(Math.random() * categories.length)],
        4 + Math.floor(Math.random() * 4), // 4-7月
        bookTitles[Math.floor(Math.random() * bookTitles.length)],
        amounts[Math.floor(Math.random() * amounts.length)],
        evals[Math.floor(Math.random() * evals.length)],
        new Date()
      ]);
    }

    // 振り返り
    refSheet.appendRow([
      year,
      email,
      term,
      `${bookCount}冊読みました。特に面白かったのは最初に読んだ本です。来学期はもっとたくさん読みたいと思います。`,
      new Date()
    ]);
  }
}

/**
 * ダミーデータを削除する（1年6組のすべてのダミーを削除）
 */
function deleteDummyData() {
  requireTeacher_();

  const ss = getTargetSpreadsheet();
  const demo = getDemoDataConfig_();
  let deletedCount = 0;

  // シートからデモ用ドメインを含む行を削除
  const sheetsToClean = ['UserProfiles', 'Responses', 'ReadingGoals', 'ReadingRecords', 'ReadingReflections'];

  sheetsToClean.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    const rowsToDelete = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // Email列を探してデモ用ドメインを含むかチェック
      for (let j = 0; j < row.length; j++) {
        if (String(row[j]).includes(demo.emailDomain)) {
          rowsToDelete.push(i + 1);
          break;
        }
      }
    }

    // 逆順で削除（行番号がずれないように）
    rowsToDelete.reverse().forEach(rowNum => {
      sheet.deleteRow(rowNum);
      deletedCount++;
    });
  });

  return { success: true, message: `${deletedCount}件のダミーデータを削除しました` };
}

/**
 * ダミーデータが存在するかチェック
 */
function checkDummyDataExists() {
  requireTeacher_();
  const ss = getTargetSpreadsheet();
  const demo = getDemoDataConfig_();
  const uSheet = ss.getSheetByName('UserProfiles');
  if (!uSheet) return { exists: false, count: 0 };

  const data = uSheet.getDataRange().getValues().slice(1);
  const count = data.filter(row => String(row[1]).includes(demo.emailDomain)).length;

  return { exists: count > 0, count: count };
}

function getDemoDataConfig_() {
  const props = PropertiesService.getScriptProperties();
  const count = Number(props.getProperty("DEMO_STUDENT_COUNT") || DUMMY_COUNT);
  return {
    grade: props.getProperty("DEMO_GRADE") || DUMMY_GRADE,
    cls: props.getProperty("DEMO_CLASS") || DUMMY_CLASS,
    emailDomain: props.getProperty("DEMO_EMAIL_DOMAIN") || DUMMY_EMAIL_DOMAIN,
    count: Number.isFinite(count) && count > 0 ? Math.floor(count) : DUMMY_COUNT
  };
}
