/**
 * 緑ヶ丘調剤薬局 ポータルサイト - 設定画面
 * Googleスプレッドシート連携の設定・管理
 */

// ===== 設定画面の初期化 =====
function initSettingsUI() {
    updateConnectionStatus();
    
    // 既存の接続設定があればURLを復元
    if (typeof SheetsAPI !== 'undefined') {
        const config = SheetsAPI.getConfig();
        if (config && config.gasUrl) {
            const input = document.getElementById('gas-url-input');
            if (input) input.value = config.gasUrl;
        }
    }
    
    // モード変更イベントをリッスン
    window.addEventListener('storageModeChanged', () => {
        updateConnectionStatus();
    });
}

// ===== 接続ステータスの更新 =====
function updateConnectionStatus() {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const modeEl = document.getElementById('status-mode');
    const btnConnect = document.getElementById('btn-connect-sheets');
    const btnDisconnect = document.getElementById('btn-disconnect-sheets');
    const btnInit = document.getElementById('btn-init-sheets');
    const btnExport = document.getElementById('btn-export-sheets');
    
    if (!dot || !text) return;
    
    const mode = DataStorage.getMode();
    const modeName = DataStorage.getModeName();
    
    // ステータスドットの色
    dot.className = 'status-dot';
    if (mode === 'sheets') {
        dot.classList.add('status-connected');
        text.textContent = '接続済み';
        modeEl.textContent = modeName + '（30秒間隔で自動同期）';
        if (btnConnect) btnConnect.style.display = 'none';
        if (btnDisconnect) btnDisconnect.style.display = '';
        if (btnInit) btnInit.style.display = '';
        if (btnExport) btnExport.style.display = '';
    } else if (mode === 'server') {
        dot.classList.add('status-connected');
        text.textContent = '接続済み';
        modeEl.textContent = modeName;
        if (btnConnect) btnConnect.style.display = '';
        if (btnDisconnect) btnDisconnect.style.display = 'none';
        if (btnInit) btnInit.style.display = 'none';
        if (btnExport) btnExport.style.display = 'none';
    } else {
        dot.classList.add('status-local');
        text.textContent = 'ローカルモード';
        modeEl.textContent = 'データはこの端末のブラウザにのみ保存されています';
        if (btnConnect) btnConnect.style.display = '';
        if (btnDisconnect) btnDisconnect.style.display = 'none';
        if (btnInit) btnInit.style.display = 'none';
        if (btnExport) btnExport.style.display = 'none';
    }
}

// ===== ログ出力 =====
function appendLog(message) {
    const logContainer = document.getElementById('sheets-connection-log');
    const logContent = document.getElementById('sheets-log-content');
    if (!logContainer || !logContent) return;
    
    logContainer.style.display = 'block';
    const timestamp = new Date().toLocaleTimeString('ja-JP');
    logContent.textContent += `[${timestamp}] ${message}\n`;
    logContent.scrollTop = logContent.scrollHeight;
}

// ===== Googleスプレッドシートに接続 =====
async function connectToSheets() {
    const urlInput = document.getElementById('gas-url-input');
    const gasUrl = urlInput ? urlInput.value.trim() : '';
    
    if (!gasUrl) {
        if (typeof showToast === 'function') {
            showToast('Google Apps Script Web App URLを入力してください', 'error');
        } else {
            alert('Google Apps Script Web App URLを入力してください');
        }
        return;
    }
    
    // URLの基本バリデーション
    if (!gasUrl.startsWith('https://script.google.com/')) {
        if (typeof showToast === 'function') {
            showToast('URLはhttps://script.google.com/で始まる必要があります', 'error');
        } else {
            alert('URLはhttps://script.google.com/で始まる必要があります');
        }
        return;
    }
    
    const btn = document.getElementById('btn-connect-sheets');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 接続テスト中...';
    }
    
    appendLog('接続テストを開始...');
    appendLog(`URL: ${gasUrl}`);
    
    try {
        const result = await DataStorage.connectToSheets(gasUrl);
        appendLog('接続成功: ' + result.message);
        appendLog('データの同期を開始しました');
        
        if (typeof showToast === 'function') {
            showToast('Googleスプレッドシートに接続しました', 'success');
        }
        
        updateConnectionStatus();
        
        // UIを更新（データが変わった可能性がある）
        if (typeof refreshCurrentSection === 'function') {
            refreshCurrentSection('all');
        }
    } catch (e) {
        appendLog('接続エラー: ' + e.message);
        if (typeof showToast === 'function') {
            showToast('接続に失敗しました: ' + e.message, 'error');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-link"></i> 接続テスト・接続';
        }
    }
}

// ===== 接続解除 =====
function disconnectSheets() {
    if (!confirm('Googleスプレッドシートとの接続を解除しますか？\nデータはローカルストレージに保持されます。')) {
        return;
    }
    
    DataStorage.disconnectSheets();
    appendLog('接続を解除しました');
    
    if (typeof showToast === 'function') {
        showToast('接続を解除しました。ローカルモードに切り替わりました。', 'info');
    }
    
    updateConnectionStatus();
}

// ===== シート初期化 =====
async function initializeSheets() {
    if (!confirm('スプレッドシートのシートを初期化しますか？\n（ヘッダー行が設定されます。既存データは影響を受けません）')) {
        return;
    }
    
    appendLog('シート初期化を開始...');
    
    try {
        const result = await SheetsAPI.initializeSheets();
        appendLog('シート初期化完了: ' + JSON.stringify(result));
        
        if (typeof showToast === 'function') {
            showToast('シートの初期化が完了しました', 'success');
        }
    } catch (e) {
        appendLog('シート初期化エラー: ' + e.message);
        if (typeof showToast === 'function') {
            showToast('シート初期化に失敗しました: ' + e.message, 'error');
        }
    }
}

// ===== ローカルデータをスプレッドシートにエクスポート =====
async function exportToSheets() {
    if (!confirm('現在のローカルデータをGoogleスプレッドシートにエクスポートしますか？\n（スプレッドシートの既存データは上書きされます）')) {
        return;
    }
    
    const btn = document.getElementById('btn-export-sheets');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> エクスポート中...';
    }
    
    appendLog('エクスポートを開始...');
    
    try {
        const results = await DataStorage.exportToSheets();
        
        for (const [table, result] of Object.entries(results)) {
            if (result.success) {
                appendLog(`${table}: ${result.count}件エクスポート完了`);
            } else {
                appendLog(`${table}: エラー - ${result.error}`);
            }
        }
        
        if (typeof showToast === 'function') {
            showToast('エクスポートが完了しました', 'success');
        }
    } catch (e) {
        appendLog('エクスポートエラー: ' + e.message);
        if (typeof showToast === 'function') {
            showToast('エクスポートに失敗しました: ' + e.message, 'error');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-upload"></i> ローカルデータをエクスポート';
        }
    }
}

// ===== GASコードをクリップボードにコピー =====
async function copyGasCode() {
    // 最新のGASコード（時間フィールドのテキスト形式対応版）
    const gasCode = `/**
 * 緑ヶ丘調剤薬局 ポータルサイト - Google Apps Script Web App
 * 
 * 【セットアップ手順】
 * 1. Googleスプレッドシートを新規作成
 * 2. このコードを全てコピーして「拡張機能」→「Apps Script」に貼り付け
 * 3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」を選択
 *    - 実行するユーザー: 自分
 *    - アクセスできるユーザー: 全員
 * 4. デプロイしてURLをコピー
 * 5. ポータルサイトの設定画面にそのURLを貼り付け
 * 6. 「シート初期化」ボタンを押すと4つのシートが自動作成されます
 */

// ===== メインハンドラ =====
function doGet(e) {
  var output;
  try {
    var params = e.parameter;
    if (params.payload) {
      var payload = JSON.parse(decodeURIComponent(params.payload));
      output = handleWriteAction(payload);
    } else {
      var action = params.action || 'read';
      var sheetName = params.sheet || 'medicines';
      if (action === 'read') { output = readData(sheetName); }
      else if (action === 'ping') { output = { success: true, message: 'Connected', timestamp: new Date().toISOString() }; }
      else if (action === 'init') { output = initializeSheets(); }
      else { output = { success: false, error: 'Unknown action: ' + action }; }
    }
  } catch (err) { output = { success: false, error: err.toString() }; }
  return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var output;
  try {
    var payload = JSON.parse(e.postData.contents);
    output = handleWriteAction(payload);
  } catch (err) { output = { success: false, error: err.toString() }; }
  return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
}

function handleWriteAction(payload) {
  var action = payload.action;
  var sheetName = payload.sheet || 'medicines';
  if (action === 'create') { return createData(sheetName, payload.data); }
  else if (action === 'update') { return updateData(sheetName, payload.id, payload.data); }
  else if (action === 'delete') { return deleteData(sheetName, payload.id); }
  else if (action === 'bulkCreate') { return bulkCreateData(sheetName, payload.data); }
  else if (action === 'clearAndImport') { return clearAndImportData(sheetName, payload.data); }
  else { return { success: false, error: 'Unknown write action: ' + action }; }
}

// ===== シート初期化 =====
function initializeSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetConfigs = {
    'medicines': ['id','name','genericName','category','salesStatus','discontinuationDate','alternative','supplyInfo','notes','isFavorite','createdAt','updatedAt'],
    'announcements': ['id','title','content','priority','date','category','author','createdAt','updatedAt'],
    'shifts': ['id','employeeId','employeeName','date','startTime','endTime','type','notes','createdAt','updatedAt'],
    'employees': ['id','name','furigana','position','employmentType','role','phone','email','hireDate','status','qualification','notes','createdAt','updatedAt']
  };
  var created = [];
  for (var name in sheetConfigs) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) { sheet = ss.insertSheet(name); created.push(name); }
    var headers = sheetConfigs[name];
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4CAF50');
    headerRange.setFontColor('#FFFFFF');
    for (var i = 1; i <= headers.length; i++) { sheet.autoResizeColumn(i); }
    // 時間フィールドの列をテキスト形式に設定（スプレッドシートの自動変換を防止）
    if (name === 'shifts') {
      var timeFieldNames = ['startTime', 'endTime'];
      timeFieldNames.forEach(function(fieldName) {
        var colIdx = headers.indexOf(fieldName);
        if (colIdx !== -1) {
          sheet.getRange(2, colIdx + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
        }
      });
    }
  }
  var defaultSheet = ss.getSheetByName('シート1');
  if (defaultSheet && ss.getSheets().length > 1) { ss.deleteSheet(defaultSheet); }
  return { success: true, message: 'Sheets initialized', created: created };
}

// ===== READ =====
function readData(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { success: false, error: 'Sheet not found: ' + sheetName };
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return { success: true, data: [] };
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var timeOnlyFields = ['startTime', 'endTime'];
  var data = values.map(function(row) {
    var obj = {};
    headers.forEach(function(header, index) {
      var val = row[index];
      if (val instanceof Date) {
        if (timeOnlyFields.indexOf(header) !== -1) {
          var hours = val.getHours();
          var minutes = val.getMinutes();
          val = ('0' + hours).slice(-2) + ':' + ('0' + minutes).slice(-2);
        } else {
          val = val.toISOString();
        }
      }
      if (timeOnlyFields.indexOf(header) !== -1 && typeof val === 'string') {
        var match1899 = val.match(/^1899-12-\\d{2}T(\\d{2}):(\\d{2})/);
        if (match1899) { val = match1899[1] + ':' + match1899[2]; }
        var matchISO = val.match(/^\\d{4}-\\d{2}-\\d{2}T(\\d{2}):(\\d{2})/);
        if (matchISO && !val.match(/^\\d{2}:\\d{2}$/)) { val = matchISO[1] + ':' + matchISO[2]; }
      }
      if (header === 'isFavorite') { val = (val === true || val === 'true' || val === 'TRUE' || val === 1); }
      obj[header] = val;
    });
    return obj;
  }).filter(function(obj) { return obj.id && obj.id !== ''; });
  return { success: true, data: data };
}

// ===== CREATE =====
function createData(sheetName, data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { success: false, error: 'Sheet not found: ' + sheetName };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (!data.id) data.id = generateId();
  var now = new Date().toISOString();
  if (!data.createdAt) data.createdAt = now;
  if (!data.updatedAt) data.updatedAt = now;
  var row = headers.map(function(header) { return data[header] !== undefined ? data[header] : ''; });
  sheet.appendRow(row);
  // 時間フィールドのセルをテキスト形式に設定
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
  if (!sheet) return { success: false, error: 'Sheet not found: ' + sheetName };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idColIndex = headers.indexOf('id') + 1;
  if (idColIndex === 0) return { success: false, error: 'No id column found' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false, error: 'No data rows found' };
  var idValues = sheet.getRange(2, idColIndex, lastRow - 1, 1).getValues();
  var rowIndex = -1;
  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0]) === String(id)) { rowIndex = i + 2; break; }
  }
  if (rowIndex === -1) return { success: false, error: 'Record not found: ' + id };
  data.updatedAt = new Date().toISOString();
  var existingRow = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var updatedRow = headers.map(function(header, index) {
    if (data[header] !== undefined) return data[header];
    return existingRow[index];
  });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([updatedRow]);
  // 時間フィールドのセルをテキスト形式に設定
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
  if (!sheet) return { success: false, error: 'Sheet not found: ' + sheetName };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idColIndex = headers.indexOf('id') + 1;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false, error: 'No data rows found' };
  var idValues = sheet.getRange(2, idColIndex, lastRow - 1, 1).getValues();
  var rowIndex = -1;
  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0]) === String(id)) { rowIndex = i + 2; break; }
  }
  if (rowIndex === -1) return { success: false, error: 'Record not found: ' + id };
  sheet.deleteRow(rowIndex);
  return { success: true, message: 'Deleted successfully' };
}

// ===== BULK CREATE =====
function bulkCreateData(sheetName, dataArray) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { success: false, error: 'Sheet not found: ' + sheetName };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var now = new Date().toISOString();
  var rows = dataArray.map(function(data) {
    if (!data.id) data.id = generateId();
    if (!data.createdAt) data.createdAt = now;
    if (!data.updatedAt) data.updatedAt = now;
    return headers.map(function(header) { return data[header] !== undefined ? data[header] : ''; });
  });
  if (rows.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
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
  if (!sheet) return { success: false, error: 'Sheet not found: ' + sheetName };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) { sheet.deleteRows(2, lastRow - 1); }
  var now = new Date().toISOString();
  var rows = dataArray.map(function(data) {
    if (!data.id) data.id = generateId();
    if (!data.createdAt) data.createdAt = now;
    if (!data.updatedAt) data.updatedAt = now;
    return headers.map(function(header) { return data[header] !== undefined ? data[header] : ''; });
  });
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
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

function generateId() { return Utilities.getUuid().replace(/-/g, '').substring(0, 12); }
`;

    try {
        await navigator.clipboard.writeText(gasCode);
        if (typeof showToast === 'function') {
            showToast('GASコードをクリップボードにコピーしました', 'success');
        }
    } catch (e) {
        // フォールバック: テキストエリアを使ってコピー
        const textarea = document.createElement('textarea');
        textarea.value = gasCode;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            if (typeof showToast === 'function') {
                showToast('GASコードをクリップボードにコピーしました', 'success');
            }
        } catch (e2) {
            if (typeof showToast === 'function') {
                showToast('コピーに失敗しました。手動でコピーしてください。', 'error');
            }
        }
        document.body.removeChild(textarea);
    }
}

// ===== ページロード時の初期化 =====
window.addEventListener('storageReady', () => {
    initSettingsUI();
});

// storageReadyが既に発火済みの場合
if (typeof DataStorage !== 'undefined' && DataStorage._ready) {
    initSettingsUI();
}
