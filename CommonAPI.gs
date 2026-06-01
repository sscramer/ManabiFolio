function getCommonQuestionSets() {
  try {
    requireAuthorizedUser_();
    const ss = getTargetSpreadsheet();
    const sheet = ss.getSheetByName('CommonQuestionSets'); 
    
    if (!sheet) return JSON.stringify({}); 
    
    const data = sheet.getDataRange().getValues().slice(1);
    
    const sets = {};
    
    data.forEach(row => {
      const setId = String(row[0]);
      if (!sets[setId]) {
        sets[setId] = {
          id: setId,
          title: row[1],
          items: []
        };
      }
      
      sets[setId].items.push({
        id: row[2],
        type: row[3],
        label: row[4],
        options: row[5] ? String(row[5]).split(',') : [],
        min: row[6],
        max: row[7],
        order: row[8]
      });
    });
    
    Object.values(sets).forEach(s => {
      s.items.sort((a,b) => a.order - b.order);
    });
    
    return JSON.stringify(sets);
  } catch(e) {
    return JSON.stringify({});
  }
}

function saveCommonQuestionSet(setId, setTitle, jsonQuestions) {
  requireTeacher_();

  const ss = getTargetSpreadsheet();
  let sheet = ss.getSheetByName('CommonQuestionSets');
  if (!sheet) {
    sheet = ss.insertSheet('CommonQuestionSets');
    sheet.appendRow(['SetID', 'SetTitle', 'QuestionID', 'Type', 'Label', 'Options', 'Min', 'Max', 'Order']);
  }
  
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const body = data.slice(1);
  
  const otherSets = body.filter(row => String(row[0]) !== setId);
  
  sheet.clearContents();
  sheet.appendRow(header);
  
  if (otherSets.length > 0) {
    sheet.getRange(2, 1, otherSets.length, otherSets[0].length).setValues(otherSets);
  }
  
  const questions = JSON.parse(jsonQuestions);
  const newRows = questions.map((q, idx) => {
    const qId = q.id || ('cq_' + new Date().getTime() + '_' + idx);
    return [
      setId,
      setTitle,
      qId,
      q.type,
      q.label,
      q.options ? q.options.join(',') : '',
      q.min,
      q.max,
      idx + 1
    ];
  });
  
  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, 9).setValues(newRows);
  }
  
  return { success: true };
}

function deleteCommonQuestionSet(setId) {
  requireTeacher_();

  const ss = getTargetSpreadsheet();
  const sheet = ss.getSheetByName('CommonQuestionSets');
  if (!sheet) return;
  
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const body = data.slice(1);
  
  const remaining = body.filter(row => String(row[0]) !== setId);
  
  sheet.clearContents();
  sheet.appendRow(header);
  
  if (remaining.length > 0) {
    sheet.getRange(2, 1, remaining.length, remaining[0].length).setValues(remaining);
  }
  
  return { success: true };
}
