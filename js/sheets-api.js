/**
 * 緑ヶ丘調剤薬局 ポータルサイト - Google Sheets API連携モジュール
 * Google Apps Script Web Appと通信してCRUD操作を行う
 * 
 * 注意: GAS Web AppはCORSに制限があるため、
 * 書き込み操作もGETリクエスト経由で行う方式を採用。
 * データはBase64エンコードしてURLパラメータで送信する。
 */

const SheetsAPI = {
  // 設定キー
  CONFIG_KEY: 'pharmacy_sheets_config',
  
  // リクエストキュー（順次実行用）
  _requestQueue: [],
  _isProcessing: false,
  
  // 設定を取得
  getConfig() {
    try {
      const config = localStorage.getItem(this.CONFIG_KEY);
      return config ? JSON.parse(config) : null;
    } catch {
      return null;
    }
  },
  
  // 設定を保存
  saveConfig(config) {
    localStorage.setItem(this.CONFIG_KEY, JSON.stringify(config));
  },
  
  // 設定を削除
  clearConfig() {
    localStorage.removeItem(this.CONFIG_KEY);
  },
  
  // 接続済みかチェック
  isConnected() {
    const config = this.getConfig();
    return config && config.gasUrl && config.connected === true;
  },
  
  // GAS Web App URLを取得
  getGasUrl() {
    const config = this.getConfig();
    return config ? config.gasUrl : null;
  },
  
  // === API通信（全てGETベース） ===
  
  // GETリクエスト（読み取り用）
  async fetchGet(params) {
    const url = this.getGasUrl();
    if (!url) throw new Error('GAS Web App URLが設定されていません');
    
    const queryString = new URLSearchParams(params).toString();
    const fullUrl = url + '?' + queryString;
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      redirect: 'follow'
    });
    
    if (!response.ok) {
      throw new Error('API Error: ' + response.status);
    }
    
    return await response.json();
  },
  
  // POSTリクエスト（書き込み用 - GAS doPost経由）
  // GASのdoPostはCORS制限があるため、formデータとして送信
  async fetchPost(body) {
    const url = this.getGasUrl();
    if (!url) throw new Error('GAS Web App URLが設定されていません');
    
    // FormDataを使ってno-corsモードで送信し、
    // 結果はポーリングで確認する方式ではなく、
    // GETリクエストにデータをエンコードして送る方式を採用
    const encodedData = encodeURIComponent(JSON.stringify(body));
    const fullUrl = url + '?payload=' + encodedData;
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      redirect: 'follow'
    });
    
    if (!response.ok) {
      throw new Error('API Error: ' + response.status);
    }
    
    return await response.json();
  },
  
  // リクエストをキューに追加して順次実行
  async _enqueueRequest(requestFn) {
    return new Promise((resolve, reject) => {
      this._requestQueue.push({ fn: requestFn, resolve, reject });
      this._processQueue();
    });
  },
  
  async _processQueue() {
    if (this._isProcessing || this._requestQueue.length === 0) return;
    
    this._isProcessing = true;
    const { fn, resolve, reject } = this._requestQueue.shift();
    
    try {
      const result = await fn();
      resolve(result);
    } catch (e) {
      reject(e);
    } finally {
      this._isProcessing = false;
      // 次のリクエストを処理（少し遅延を入れてGASのレート制限を回避）
      if (this._requestQueue.length > 0) {
        setTimeout(() => this._processQueue(), 300);
      }
    }
  },
  
  // === 接続テスト ===
  async testConnection(gasUrl) {
    try {
      const queryString = new URLSearchParams({ action: 'ping' }).toString();
      const fullUrl = gasUrl + '?' + queryString;
      
      const response = await fetch(fullUrl, {
        method: 'GET',
        redirect: 'follow'
      });
      
      if (!response.ok) {
        return { success: false, error: 'HTTP Error: ' + response.status };
      }
      
      const result = await response.json();
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  
  // === シート初期化 ===
  async initializeSheets() {
    return await this.fetchGet({ action: 'init' });
  },
  
  // === CRUD操作 ===
  
  // 全データ読み込み
  async readAll(sheetName) {
    const result = await this.fetchGet({ action: 'read', sheet: sheetName });
    if (!result.success) {
      throw new Error(result.error || 'Read failed');
    }
    return result.data;
  },
  
  // 新規作成（キュー経由で順次実行）
  async create(sheetName, data) {
    return this._enqueueRequest(async () => {
      const result = await this.fetchPost({
        action: 'create',
        sheet: sheetName,
        data: data
      });
      if (!result.success) {
        throw new Error(result.error || 'Create failed');
      }
      return result.data;
    });
  },
  
  // 更新（キュー経由で順次実行）
  async update(sheetName, id, data) {
    return this._enqueueRequest(async () => {
      const result = await this.fetchPost({
        action: 'update',
        sheet: sheetName,
        id: id,
        data: data
      });
      if (!result.success) {
        throw new Error(result.error || 'Update failed');
      }
      return result;
    });
  },
  
  // 削除（キュー経由で順次実行）
  async remove(sheetName, id) {
    return this._enqueueRequest(async () => {
      const result = await this.fetchPost({
        action: 'delete',
        sheet: sheetName,
        id: id
      });
      if (!result.success) {
        throw new Error(result.error || 'Delete failed');
      }
      return result;
    });
  },
  
  // 一括作成（キュー経由で順次実行）
  async bulkCreate(sheetName, dataArray) {
    return this._enqueueRequest(async () => {
      const result = await this.fetchPost({
        action: 'bulkCreate',
        sheet: sheetName,
        data: dataArray
      });
      if (!result.success) {
        throw new Error(result.error || 'Bulk create failed');
      }
      return result;
    });
  },
  
  // クリアしてインポート（キュー経由で順次実行）
  async clearAndImport(sheetName, dataArray) {
    return this._enqueueRequest(async () => {
      const result = await this.fetchPost({
        action: 'clearAndImport',
        sheet: sheetName,
        data: dataArray
      });
      if (!result.success) {
        throw new Error(result.error || 'Import failed');
      }
      return result;
    });
  }
};
