/**
 * 緑ヶ丘調剤薬局 ポータルサイト - Google Apps Script Web App
 * 
 * 【セットアップ手順】
 * 1. Googleスプレッドシートを新規作成
 * 2. スプレッドシートの「拡張機能」→「Apps Script」を開く
 * 3. このコードを全てコピーして貼り付け
 * 4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」を選択
 *    - 説明: 薬局ポータルAPI
 *    - 実行するユーザー: 自分
 *    - アクセスできるユーザー: 全員
 * 5. デプロイしてURLをコピー
 * 6. ポータルサイトの設定画面にそのURLを貼り付け
 * 7. 「シート初期化」ボタンを押すと、4つのシートが自動作成されます
 * 
 * 【自動作成されるシート】
 * - medicines（薬剤情報）
 * - announcements（お知らせ）
 * - shifts（シフト）
 * - employees（従業員）
 */

// ===== メインハンドラ =====
// 全ての操作をGET経由で処理（CORS制限を回避するため）
// 書き込み操作はpayloadパラメータにJSONデータをエンコードして送信

function doGet(e) {
  var output;
  try {
    var params = e.parameter;
    
    // payloadパラメータがある場合は書き込み操作
    if (params.payload) {
      var payload = JSON.parse(decodeURIComponent(params.payload));
      output = handleWriteAction(payload);
    } else {
      // 通常のGET操作（読み取り）
      var action = params.action || 'read';
      var sheetName = params.sheet || 'medicines';
      
      if (action === 'read') {
        output = readData(sheetName);
      } else if (action === 'ping') {
        output = { success: true, message: 'Connected', timestamp: new Date().toISOString() };
      } else if (action === 'init') {
        output = initializeSheets();
      } else {
        output = { success: false, error: 'Unknown action: ' + action };
      }
    }
  } catch (err) {
    output = { success: false, error: err.toString() };
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

// POST も念のため対応（直接呼ばれた場合）
function doPost(e) {
  var output;
  try {
    var payload = JSON.parse(e.postData.contents);
    output = handleWriteAction(payload);
  } catch (err) {
    output = { success: false, error: err.toString() };
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

// 書き込み操作のルーティング
function handleWriteAction(payload) {
  var action = payload.action;
  var sheetName = payload.sheet || 'medicines';
  
  if (action === 'create') {
    return createData(sheetName, payload.data);
  } else if (action === 'update') {
    return updateData(sheetName, payload.id, payload.data);
  } else if (action === 'delete') {
    return deleteData(sheetName, payload.id);
  } else if (action === 'bulkCreate') {
    return bulkCreateData(sheetName, payload.data);
  } else if (action === 'clearAndImport') {
    return clearAndImportData(sheetName, payload.data);
  } else {
    return { success: false, error: 'Unknown write action: ' + action };
  }
}

// ===== シート初期化 =====
function initializeSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var sheetConfigs = {
    'medicines': ['id', 'name', 'genericName', 'category', 'salesStatus', 'discontinuationDate', 'alternative', 'supplyInfo', 'notes', 'isFavorite', 'createdAt', 'updatedAt'],
    'announcements': ['id', 'title', 'content', 'priority', 'date', 'category', 'author', 'createdAt', 'updatedAt'],
    'shifts': ['id', 'employeeId', 'employeeName', 'date', 'startTime', 'endTime', 'type', 'notes', 'createdAt', 'updatedAt'],
    'employees': ['id', 'name', 'furigana', 'position', 'employmentType', 'role', 'phone', 'email', 'hireDate', 'status', 'qualification', 'notes', 'createdAt', 'updatedAt']
  };
  
  var created = [];
  
  for (var name in sheetConfigs) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      created.push(name);
    }
    // ヘッダー行を設定
    var headers = sheetConfigs[name];
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4CAF50');
    headerRange.setFontColor('#FFFFFF');
    
    // 列幅を自動調整
    for (var i = 1; i <= headers.length; i++) {
      sheet.autoResizeColumn(i);
    }
    
    // 時間フィールドの列をテキスト形式に設定（スプレッドシートの自動変換を防止）
    if (name === 'shifts') {
      var timeFieldNames = ['startTime', 'endTime'];
      timeFieldNames.forEach(function(fieldName) {
        var colIdx = headers.indexOf(fieldName);
        if (colIdx !== -1) {
          // 列全体をテキスト形式に設定
          sheet.getRange(2, colIdx + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
        }
      });
    }
  }
  
  // デフォルトの「シート1」を削除（存在する場合）
  var defaultSheet = ss.getSheetByName('シート1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
  
  return { success: true, message: 'Sheets initialized', created: created };
}

// ===== READ =====
function readData(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return { success: false, error: 'Sheet not found: ' + sheetName };
  }
  
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  
  if (lastRow <= 1 || lastCol === 0) {
    return { success: true, data: [] };
  }
  
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
  var values = dataRange.getValues();
  
  // 時間のみのフィールド（HH:mm形式で保持すべきもの）
  var timeOnlyFields = ['startTime', 'endTime'];
  
  var data = values.map(function(row) {
    var obj = {};
    headers.forEach(function(header, index) {
      var val = row[index];
      // 日付オブジェクトの処理
      if (val instanceof Date) {
        if (timeOnlyFields.indexOf(header) !== -1) {
          // 時間フィールド: HH:mm形式に変換
          var hours = val.getHours();
          var minutes = val.getMinutes();
          val = ('0' + hours).slice(-2) + ':' + ('0' + minutes).slice(-2);
        } else {
          // 通常の日付フィールド: ISO文字列に変換
          val = val.toISOString();
        }
      }
      // 文字列の時間フィールドが1899年ベースのISO形式になっている場合の修正
      if (timeOnlyFields.indexOf(header) !== -1 && typeof val === 'string') {
        // 1899-12-29T... や 1899-12-30T... のパターンを検出
        var match1899 = val.match(/^1899-12-\d{2}T(\d{2}):(\d{2})/);
        if (match1899) {
          val = match1899[1] + ':' + match1899[2];
        }
        // ISO形式の日時文字列からHH:mmを抽出
        var matchISO = val.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
        if (matchISO && !val.match(/^\d{2}:\d{2}$/)) {
          val = matchISO[1] + ':' + matchISO[2];
        }
      }
      // boolean変換
      if (header === 'isFavorite') {
        val = (val === true || val === 'true' || val === 'TRUE' || val === 1);
      }
      obj[header] = val;
    });
    return obj;
  }).filter(function(obj) {
    // 空行を除外
    return obj.id && obj.id !== '';
  });
  
  return { success: true, data: data };
}

// ===== CREATE =====
function createData(sheetName, data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return { success: false, error: 'Sheet not found: ' + sheetName };
  }
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // IDを生成（未指定の場合）
  if (!data.id) {
    data.id = generateId();
  }
  
  // タイムスタンプ
  var now = new Date().toISOString();
  if (!data.createdAt) data.createdAt = now;
  if (!data.updatedAt) data.updatedAt = now;
  
  var row = headers.map(function(header) {
    var val = data[header] !== undefined ? data[header] : '';
    return val;
  });
  
  sheet.appendRow(row);
  
  // 時間フィールドのセルをテキスト形式に設定（自動変換を防止）
  var lastRow = sheet.getLastRow();
  var timeFields = ['startTime', 'endTime'];
  timeFields.forEach(function(field) {
    var colIdx = headers.indexOf(field);
    if (colIdx !== -1) {
      var cell = sheet.getRange(lastRow, colIdx + 1);
      cell.setNumberFormat('@');
      cell.setValue(data[field] || '');
    }
  });
  
  return { success: true, data: data, message: 'Created successfully' };
}

// ===== UPDATE =====
function updateData(sheetName, id, data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return { success: false, error: 'Sheet not found: ' + sheetName };
  }
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idColIndex = headers.indexOf('id') + 1;
  
  if (idColIndex === 0) {
    return { success: false, error: 'No id column found' };
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: false, error: 'No data rows found' };
  }
  
  var idValues = sheet.getRange(2, idColIndex, lastRow - 1, 1).getValues();
  
  var rowIndex = -1;
  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0]) === String(id)) {
      rowIndex = i + 2; // 1-indexed + header row
      break;
    }
  }
  
  if (rowIndex === -1) {
    return { success: false, error: 'Record not found: ' + id };
  }
  
  // 更新タイムスタンプ
  data.updatedAt = new Date().toISOString();
  
  // 既存データを取得してマージ
  var existingRow = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var updatedRow = headers.map(function(header, index) {
    if (data[header] !== undefined) {
      return data[header];
    }
    return existingRow[index];
  });
  
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([updatedRow]);
  
  // 時間フィールドのセルをテキスト形式に設定（自動変換を防止）
  var timeFields = ['startTime', 'endTime'];
  timeFields.forEach(function(field) {
    var colIdx = headers.indexOf(field);
    if (colIdx !== -1 && data[field] !== undefined) {
      var cell = sheet.getRange(rowIndex, colIdx + 1);
      cell.setNumberFormat('@');
      cell.setValue(data[field]);
    }
  });
  
  return { success: true, message: 'Updated successfully' };
}

// ===== DELETE =====
function deleteData(sheetName, id) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return { success: false, error: 'Sheet not found: ' + sheetName };
  }
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idColIndex = headers.indexOf('id') + 1;
  
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: false, error: 'No data rows found' };
  }
  
  var idValues = sheet.getRange(2, idColIndex, lastRow - 1, 1).getValues();
  
  var rowIndex = -1;
  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0]) === String(id)) {
      rowIndex = i + 2;
      break;
    }
  }
  
  if (rowIndex === -1) {
    return { success: false, error: 'Record not found: ' + id };
  }
  
  sheet.deleteRow(rowIndex);
  
  return { success: true, message: 'Deleted successfully' };
}

// ===== BULK CREATE =====
function bulkCreateData(sheetName, dataArray) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return { success: false, error: 'Sheet not found: ' + sheetName };
  }
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var now = new Date().toISOString();
  
  var rows = dataArray.map(function(data) {
    if (!data.id) data.id = generateId();
    if (!data.createdAt) data.createdAt = now;
    if (!data.updatedAt) data.updatedAt = now;
    
    return headers.map(function(header) {
      return data[header] !== undefined ? data[header] : '';
    });
  });
  
  if (rows.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
    
    // 時間フィールドの列をテキスト形式に設定（自動変換を防止）
    var timeFields = ['startTime', 'endTime'];
    timeFields.forEach(function(field) {
      var colIdx = headers.indexOf(field);
      if (colIdx !== -1) {
        sheet.getRange(startRow, colIdx + 1, rows.length, 1).setNumberFormat('@');
      }
    });
  }
  
  return { success: true, count: rows.length, message: 'Bulk created successfully' };
}

// ===== CLEAR AND IMPORT =====
function clearAndImportData(sheetName, dataArray) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return { success: false, error: 'Sheet not found: ' + sheetName };
  }
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // ヘッダー以外を削除
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  
  // データをインポート
  var now = new Date().toISOString();
  var rows = dataArray.map(function(data) {
    if (!data.id) data.id = generateId();
    if (!data.createdAt) data.createdAt = now;
    if (!data.updatedAt) data.updatedAt = now;
    
    return headers.map(function(header) {
      return data[header] !== undefined ? data[header] : '';
    });
  });
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    
    // 時間フィールドの列をテキスト形式に設定（自動変換を防止）
    var timeFields = ['startTime', 'endTime'];
    timeFields.forEach(function(field) {
      var colIdx = headers.indexOf(field);
      if (colIdx !== -1) {
        sheet.getRange(2, colIdx + 1, rows.length, 1).setNumberFormat('@');
      }
    });
  }
  
  return { success: true, count: rows.length, message: 'Import completed' };
}

// ===== ユーティリティ =====
function generateId() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}
