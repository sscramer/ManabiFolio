function getAllStudentEmails() {
  requireTeacher_();

  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('Responses');
  if (!sheet) return '[]';

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return '[]';

  const emails = new Set();
  let startRow = 0;
  if (String(data[0][0]).toLowerCase().indexOf('timestamp') !== -1) {
    startRow = 1;
  }

  for (let i = startRow; i < data.length; i++) {
    const email = String(data[i][2]).trim();
    if (email) emails.add(email);
  }

  return JSON.stringify(Array.from(emails).sort());
}

function getGeminiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
}

function generateAiGuidance(targetEmail) {
  const email = resolveTeacherTargetEmail_(targetEmail);

  const apiKey = getGeminiApiKey_();
  if (!apiKey) throw new Error("Gemini API Keyが設定されていません。GASのエディタで [プロジェクトの設定] > [スクリプトプロパティ] に 'GEMINI_API_KEY' を追加してください。");

  const historyJson = getHistoryByEmail_(email);
  const history = JSON.parse(historyJson).data;

  if (!history || history.length === 0) {
    return "該当生徒の回答データが見つかりません。";
  }

  const configJson = getFormConfig_(false);
  const config = JSON.parse(configJson);

  let contextText = `対象生徒: ${email}\n\n`;

  const sortedHistory = [...history].reverse(); 

  sortedHistory.forEach(h => {
    const sessionInfo = config[h.sessionId];
    const sessionTitle = sessionInfo ? sessionInfo.title : h.sessionId;
    const dateStr = h.timestamp;
    
    contextText += `### 活動: ${sessionTitle} (${dateStr})\n`;
    
    const answers = h.answers;
    for (const [qId, ansVal] of Object.entries(answers)) {
      if (!ansVal) continue;
      
      let label = qId;
      if (sessionInfo && sessionInfo.items) {
        const qItem = sessionInfo.items.find(i => i.id === qId);
        if (qItem) label = qItem.label;
      }
      
      contextText += `Q. ${label}\n   A. ${ansVal}\n`;
    }
    contextText += "\n";
  });

  const prompt = `あなたは${getAiSchoolContext_()}です。
以下の生徒の振り返りポートフォリオ（アンケート回答データ）を読み込み、高等学校生徒指導要録（様式第2参照）の以下の各項目について、文章案を作成してください。

## 作成項目と観点
以下の3つの項目について、それぞれ200文字〜400文字程度で記述してください。

1. **総合的な探究の時間の記録**
   - 「活動内容」および「評価（取り組みのプロセス、課題解決能力、自己の在り方生き方への考察など）」を含めて記述してください。
   
2. **特別活動の記録**
   - ホームルーム活動、生徒会活動、学校行事などへの関わり方、役割、協力姿勢について記述してください。

3. **指導上参考となる諸事項（総合所見および部活動・進路指導など）**
   - 人物像、学習態度、行動の特徴、長所、進路への意識、部活動での活躍、取得資格、特技などを総合的に記述してください。

## 執筆ルール
- **文体**: 公的な文書として適切な「だ・である」調（常体）で記述してください。客観的かつ肯定的（生徒の成長を促す）な表現を心がけてください。
- **根拠**: 抽象的な褒め言葉だけでなく、ポートフォリオからの具体的な引用やエピソード（「〜の行事で〜という感想を持っていたことから...」など）を織り交ぜてください。
- **情報不足の場合**: アンケートの内容から当該項目の内容が全く推測できない場合は、無理に創作せず、その項目の欄に **＜情報不足により推定して出力＞** と出力し、推定した文言を出力してください。

## 生徒データ
${contextText}`;

  return callGemini_(prompt, apiKey);
}

function callGemini_(prompt, apiKey) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      return `エラーが発生しました (Code: ${responseCode}):\n${responseText}`;
    }

    const data = JSON.parse(responseText);
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
      return data.candidates[0].content.parts[0].text;
    } else {
      return "AIからの応答を解析できませんでした。";
    }
  } catch (e) {
    return `通信エラーが発生しました: ${e.toString()}`;
  }
}

/**
 * クラス単位でAI指導要録用のCSVデータを生成
 * 冒頭に共通指示文、各生徒行に回答データと3つの出力列を配置
 * @param {string} grade - 学年
 * @param {string} cls - 組
 * @returns {string} CSV形式の文字列
 */
function generateAiDataCSV(grade, cls) {
  requireTeacher_();
  
  const currentYear = getSystemYear();
  const ss = getTargetSpreadsheet();
  
  // 対象クラスの生徒を取得
  const uSheet = ss.getSheetByName('UserProfiles');
  if (!uSheet) throw new Error("UserProfilesシートが存在しません");
  
  const uData = uSheet.getDataRange().getValues().slice(1);
  const students = uData
    .filter(row => 
      String(row[0]).trim() === String(currentYear).trim() &&
      String(row[2]).trim() === String(grade).trim() &&
      String(row[3]).trim() === String(cls).trim()
    )
    .map(row => ({
      email: String(row[1]),
      grade: String(row[2]),
      cls: String(row[3]),
      number: row[4],
      name: row[5]
    }))
    .sort((a, b) => parseInt(a.number) - parseInt(b.number));
  
  if (students.length === 0) {
    throw new Error("対象クラスに生徒が登録されていません");
  }
  
  // フォーム設定を取得
  const configJson = getFormConfig_(false);
  const config = JSON.parse(configJson);
  
  // 共通指示文
  const instructions = `【Gemini用指示】
あなたは${getAiSchoolContext_()}です。
以下の行ごとに生徒別に記述されているポートフォリオ回答データを読み込み、高等学校生徒指導要録（様式第2参照）の以下の各項目について、文章案を作成し、各行の右側の３つの項目を埋めなさい。
出力結果は表形式（Table）で出力し、各行に元々含まれているポートフォリオ回答データも原文のママ省略せずに含めて全員分のデータについて回答すること、最終的な出力の前に執筆ルールについて改めて確認すること。
「以下のCSVファイルをダウンロードしてご確認ください」はシステムにより失敗するので絶対に用いないこと（あなたが保存したcsvファイルはユーザーは閲覧できないのでそのような提示を行わない）。

## 作成項目と観点
以下の3つの項目について、それぞれ200文字〜400文字程度で記述してください。

1. **総合的な探究の時間の記録**
   - 「活動内容」および「評価（取り組みのプロセス、課題解決能力、自己の在り方生き方への考察など）」を含めて記述してください。   
2. **特別活動の記録**
   - ホームルーム活動、生徒会活動、学校行事などへの関わり方、役割、協力姿勢について記述してください。
3. **指導上参考となる諸事項（総合所見および部活動・進路指導など）**
   - 人物像、学習態度、行動の特徴、長所、進路への意識、部活動での活躍、取得資格、特技などを総合的に記述してください。

## 執筆ルール
- **文体**: 公的な文書として適切な「だ・である」調（常体）で記述してください。客観的かつ肯定的（生徒の成長を促す）な表現を心がけてください。
- **根拠**: 抽象的な褒め言葉だけでなく、ポートフォリオからの具体的な引用やエピソード（「〜の行事で〜という感想を持っていたことから...」など）を織り交ぜてください。
- **情報不足の場合**: アンケートの内容から当該項目の内容が全く推測できない場合は、無理に創作せず、その項目の欄に **＜情報不足により推定して出力＞** と出力し、推定した文言を出力してください。

全員分のデータについて回答すること
---データ開始---`;

  // CSVデータを構築
  const rows = [];
  
  // ヘッダー
  rows.push([
    '番号',
    'ポートフォリオ回答データ',
    '総合的な探究の時間の記録',
    '特別活動の記録',
    '指導上参考となる諸事項（総合所見および部活動・進路指導など）'
  ]);
  
  // 各生徒のデータを取得してCSV行を生成
  students.forEach(student => {
    const promptData = buildStudentPromptData_(student.email, config);
    
    rows.push([
      student.number,
      promptData.rawData || '（回答データなし）',
      '', // Geminiが埋める
      '', // Geminiが埋める
      ''  // Geminiが埋める
    ]);
  });
  
  // CSV形式に変換
  const csvContent = rows.map(row => 
    row.map(cell => {
      // セル内の改行やカンマをエスケープ
      const str = String(cell || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }).join(',')
  ).join('\n');
  
  // 冒頭に指示文を追加
  return instructions + '\n\n' + csvContent;
}

/**
 * 個別生徒のAI指導要録用CSVデータを生成
 * @param {string} email - 生徒のメールアドレス
 * @returns {string} CSV形式の文字列
 */
function generateSingleStudentCSV(email) {
  const targetEmail = resolveTeacherTargetEmail_(email);
  
  // フォーム設定を取得
  const configJson = getFormConfig_(false);
  const config = JSON.parse(configJson);
  
  // 生徒のプロンプトデータを取得
  const promptData = buildStudentPromptData_(targetEmail, config);
  
  if (!promptData.rawData) {
    throw new Error("該当生徒の回答データが見つかりません");
  }
  
  // 共通指示文（生徒1人用に調整）
  const instructions = `【Gemini用指示】
あなたは${getAiSchoolContext_()}です。
以下の生徒のポートフォリオ回答データを読み込み、高等学校生徒指導要録（様式第2参照）の以下の各項目について、文章案を作成してください。

## 作成項目と観点
以下の3つの項目について、それぞれ200文字〜400文字程度で記述してください。

1. **総合的な探究の時間の記録**
   - 「活動内容」および「評価（取り組みのプロセス、課題解決能力、自己の在り方生き方への考察など）」を含めて記述してください。
   
2. **特別活動の記録**
   - ホームルーム活動、生徒会活動、学校行事などへの関わり方、役割、協力姿勢について記述してください。

3. **指導上参考となる諸事項（総合所見および部活動・進路指導など）**
   - 人物像、学習態度、行動の特徴、長所、進路への意識、部活動での活躍、取得資格、特技などを総合的に記述してください。

## 執筆ルール
- **文体**: 公的な文書として適切な「だ・である」調（常体）で記述してください。
- **根拠**: ポートフォリオからの具体的な引用やエピソードを織り交ぜてください。
- **情報不足の場合**: ＜情報不足により推定して出力＞と記載し推定文を出力してください。

---生徒データ---
${promptData.rawData}`;

  return instructions;
}

/**
 * 生徒のプロンプトデータを構築（内部関数）
 * @returns {Object} { summary, rawData, prompt }
 */
function buildStudentPromptData_(email, config) {
  const historyJson = getHistoryByEmail_(email);
  const history = JSON.parse(historyJson).data || [];
  
  if (history.length === 0) {
    return {
      summary: '回答データなし',
      rawData: '',
      prompt: '該当生徒の回答データが見つかりません。'
    };
  }
  
  // 回答データの要約と生データを作成
  const sortedHistory = [...history].reverse();
  let contextText = `対象生徒: ${email}\n\n`;
  let rawDataText = ''; // 回答データのみ（プロンプト指示なし）
  let summaryLines = [];
  
  sortedHistory.forEach(h => {
    const sessionInfo = config[h.sessionId];
    const sessionTitle = sessionInfo ? sessionInfo.title : h.sessionId;
    const dateStr = h.timestamp;
    
    summaryLines.push(`${sessionTitle}(${dateStr})`);
    contextText += `### 活動: ${sessionTitle} (${dateStr})\n`;
    rawDataText += `【${sessionTitle}】(${dateStr})\n`;
    
    const answers = h.answers;
    for (const [qId, ansVal] of Object.entries(answers)) {
      if (!ansVal) continue;
      
      let label = qId;
      if (sessionInfo && sessionInfo.items) {
        const qItem = sessionInfo.items.find(i => i.id === qId);
        if (qItem) label = qItem.label;
      }
      
      contextText += `Q. ${label}\n   A. ${ansVal}\n`;
      rawDataText += `Q: ${label}\nA: ${ansVal}\n`;
    }
    contextText += "\n";
    rawDataText += "\n";
  });
  
  const summary = `${history.length}件: ${summaryLines.slice(0, 3).join(', ')}${summaryLines.length > 3 ? '...' : ''}`;
  
  const prompt = `あなたは${getAiSchoolContext_()}です。
以下の生徒の振り返りポートフォリオ（アンケート回答データ）を読み込み、高等学校生徒指導要録（様式第2参照）の以下の各項目について、文章案を作成してください。

## 作成項目と観点
以下の3つの項目について、それぞれ200文字〜400文字程度で記述してください。

1. **総合的な探究の時間の記録**
   - 「活動内容」および「評価（取り組みのプロセス、課題解決能力、自己の在り方生き方への考察など）」を含めて記述してください。
   
2. **特別活動の記録**
   - ホームルーム活動、生徒会活動、学校行事などへの関わり方、役割、協力姿勢について記述してください。

3. **指導上参考となる諸事項（総合所見および部活動・進路指導など）**
   - 人物像、学習態度、行動の特徴、長所、進路への意識、部活動での活躍、取得資格、特技などを総合的に記述してください。

## 執筆ルール
- **文体**: 公的な文書として適切な「だ・である」調（常体）で記述してください。客観的かつ肯定的（生徒の成長を促す）な表現を心がけてください。
- **根拠**: 抽象的な褒め言葉だけでなく、ポートフォリオからの具体的な引用やエピソード（「〜の行事で〜という感想を持っていたことから...」など）を織り交ぜてください。
- **情報不足の場合**: アンケートの内容から当該項目の内容が全く推測できない場合は、無理に創作せず、その項目の欄に **＜情報不足により推定して出力＞** と出力し、推定した文言を出力してください。

## 生徒データ
${contextText}`;
  
  return {
    summary: summary,
    rawData: rawDataText,
    prompt: prompt
  };
}

function getAiSchoolContext_() {
  const value = PropertiesService.getScriptProperties().getProperty("AI_SCHOOL_CONTEXT");
  return value || "日本の学校の教員";
}
