// ========================================
// データストレージ層
// 3つのモード:
//   1. Googleスプレッドシート連携モード（GAS Web App経由）
//   2. サーバーモード（Express + SQLite）
//   3. ローカルストレージモード（フォールバック）
// ========================================

const DataStorage = {
    // APIベースURL
    API_BASE: '/api',

    // 接続モード: 'sheets' | 'server' | 'local'
    _mode: null,

    // サーバー接続状態
    _serverAvailable: null,

    // ストレージキー（フォールバック用）
    KEYS: {
        announcements: 'pharmacy_announcements',
        shifts: 'pharmacy_shifts',
        medicines: 'pharmacy_medicines',
        employees: 'pharmacy_employees'
    },

    // フィールド名マッピング（ローカル ↔ スプレッドシート）
    FIELD_MAP_TO_SHEETS: {
        generic_name: 'genericName',
        sales_status: 'salesStatus',
        sales_start_date: 'salesStartDate',
        discontinuation_date: 'discontinuationDate',
        alternative_medicine: 'alternative',
        supply_info: 'supplyInfo',
        is_favorite: 'isFavorite',
        created_at: 'createdAt',
        updated_at: 'updatedAt',
        staff_name: 'employeeName',
        shift_type: 'type',
        start_time: 'startTime',
        end_time: 'endTime',
        hire_date: 'hireDate',
        employment_type: 'employmentType'
    },

    FIELD_MAP_FROM_SHEETS: {},

    // 初期化時にリバースマップを構築
    _buildReverseMap() {
        for (const [local, sheets] of Object.entries(this.FIELD_MAP_TO_SHEETS)) {
            this.FIELD_MAP_FROM_SHEETS[sheets] = local;
        }
    },

    // ローカル形式 → スプレッドシート形式に変換
    _toSheetsFormat(record) {
        const converted = {};
        for (const [key, value] of Object.entries(record)) {
            const sheetsKey = this.FIELD_MAP_TO_SHEETS[key] || key;
            converted[sheetsKey] = value;
        }
        return converted;
    },

    // スプレッドシート形式 → ローカル形式に変換
    _fromSheetsFormat(record) {
        const converted = {};
        // 時間のみのフィールド（スプレッドシート側のキー名）
        const timeOnlyFields = ['startTime', 'endTime'];
        for (const [key, value] of Object.entries(record)) {
            const localKey = this.FIELD_MAP_FROM_SHEETS[key] || key;
            let val = value;
            // 時間フィールドの1899年ベースISO形式をHH:mmに変換
            if (timeOnlyFields.includes(key) && typeof val === 'string') {
                const match1899 = val.match(/^1899-12-\d{2}T(\d{2}):(\d{2})/);
                if (match1899) {
                    val = match1899[1] + ':' + match1899[2];
                } else {
                    const matchISO = val.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
                    if (matchISO && !/^\d{2}:\d{2}$/.test(val)) {
                        val = matchISO[1] + ':' + matchISO[2];
                    }
                }
            }
            converted[localKey] = val;
        }
        return converted;
    },

    // UUID生成
    generateId() {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    // 現在のモードを取得
    getMode() {
        return this._mode || 'local';
    },

    // モード表示名
    getModeName() {
        switch (this._mode) {
            case 'sheets': return 'Googleスプレッドシート連携';
            case 'server': return '共有データベース';
            default: return 'ローカルストレージ';
        }
    },

    // Googleスプレッドシート接続チェック
    async checkSheets() {
        if (typeof SheetsAPI === 'undefined') return false;
        return SheetsAPI.isConnected();
    },

    // サーバー接続チェック
    async checkServer() {
        if (this._serverAvailable !== null) return this._serverAvailable;
        try {
            const res = await fetch(`${this.API_BASE}/medicines`, { method: 'GET', signal: AbortSignal.timeout(2000) });
            this._serverAvailable = res.ok;
        } catch (e) {
            this._serverAvailable = false;
        }
        return this._serverAvailable;
    },

    // ========================================
    // 同期API（localStorage用 - フォールバック）
    // ========================================
    _localGetAll(tableName) {
        const key = this.KEYS[tableName];
        if (!key) return [];
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error(`ローカルデータ読み込みエラー (${tableName}):`, e);
            return [];
        }
    },

    _localSaveAll(tableName, data) {
        const key = this.KEYS[tableName];
        if (!key) return false;
        try {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error(`ローカルデータ保存エラー (${tableName}):`, e);
            return false;
        }
    },

    // ========================================
    // 統一API（同期 - 既存コードとの互換性維持）
    // ========================================

    // 内部キャッシュ
    _cache: {},

    // データ取得（同期 - キャッシュから返す）
    getAll(tableName) {
        if (this._cache[tableName]) {
            return [...this._cache[tableName]];
        }
        const local = this._localGetAll(tableName);
        this._cache[tableName] = local;
        return [...local];
    },

    // 単一レコード取得
    getById(tableName, id) {
        const all = this.getAll(tableName);
        return all.find(item => item.id === id) || null;
    },

    // レコード追加（同期 + バックグラウンド同期）
    create(tableName, record) {
        const all = this.getAll(tableName);
        record.id = this.generateId();
        record.created_at = new Date().toISOString();
        record.updated_at = new Date().toISOString();
        all.push(record);
        this._cache[tableName] = all;
        this._localSaveAll(tableName, all);

        // バックグラウンドで同期
        this._syncCreate(tableName, record);
        return record;
    },

    // レコード更新（同期 + バックグラウンド同期）
    update(tableName, id, updates) {
        const all = this.getAll(tableName);
        const index = all.findIndex(item => item.id === id);
        if (index === -1) return null;
        all[index] = { ...all[index], ...updates, updated_at: new Date().toISOString() };
        this._cache[tableName] = all;
        this._localSaveAll(tableName, all);

        // バックグラウンドで同期
        this._syncUpdate(tableName, id, updates);
        return all[index];
    },

    // レコード削除（同期 + バックグラウンド同期）
    delete(tableName, id) {
        const all = this.getAll(tableName);
        const filtered = all.filter(item => item.id !== id);
        if (filtered.length === all.length) return false;
        this._cache[tableName] = filtered;
        this._localSaveAll(tableName, filtered);

        // バックグラウンドで同期
        this._syncDelete(tableName, id);
        return true;
    },

    // ========================================
    // バックグラウンド同期メソッド（モード別）
    // ========================================
    async _syncCreate(tableName, record) {
        if (this._mode === 'sheets') {
            try {
                const sheetsRecord = this._toSheetsFormat(record);
                await SheetsAPI.create(tableName, sheetsRecord);
            } catch (e) {
                console.warn(`スプレッドシート同期エラー (create ${tableName}):`, e);
            }
        } else if (this._mode === 'server') {
            try {
                await fetch(`${this.API_BASE}/${tableName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(record)
                });
            } catch (e) {
                console.warn(`サーバー同期エラー (create ${tableName}):`, e);
            }
        }
    },

    async _syncUpdate(tableName, id, updates) {
        if (this._mode === 'sheets') {
            try {
                const sheetsUpdates = this._toSheetsFormat(updates);
                await SheetsAPI.update(tableName, id, sheetsUpdates);
            } catch (e) {
                console.warn(`スプレッドシート同期エラー (update ${tableName}):`, e);
            }
        } else if (this._mode === 'server') {
            try {
                await fetch(`${this.API_BASE}/${tableName}/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updates)
                });
            } catch (e) {
                console.warn(`サーバー同期エラー (update ${tableName}):`, e);
            }
        }
    },

    async _syncDelete(tableName, id) {
        if (this._mode === 'sheets') {
            try {
                await SheetsAPI.remove(tableName, id);
            } catch (e) {
                console.warn(`スプレッドシート同期エラー (delete ${tableName}):`, e);
            }
        } else if (this._mode === 'server') {
            try {
                await fetch(`${this.API_BASE}/${tableName}/${id}`, {
                    method: 'DELETE'
                });
            } catch (e) {
                console.warn(`サーバー同期エラー (delete ${tableName}):`, e);
            }
        }
    },

    // ========================================
    // Googleスプレッドシートからのデータロード
    // ========================================
    async loadFromSheets() {
        const tables = ['announcements', 'shifts', 'medicines', 'employees'];
        for (const table of tables) {
            try {
                const data = await SheetsAPI.readAll(table);
                // スプレッドシート形式 → ローカル形式に変換
                const localData = data.map(record => this._fromSheetsFormat(record));
                this._cache[table] = localData;
                this._localSaveAll(table, localData);
            } catch (e) {
                console.warn(`スプレッドシートデータ取得エラー (${table}):`, e);
                this._cache[table] = this._localGetAll(table);
            }
        }
        console.log('Googleスプレッドシートからデータをロードしました。');
    },

    // ========================================
    // サーバーからのデータロード
    // ========================================
    async loadFromServer() {
        const tables = ['announcements', 'shifts', 'medicines', 'employees'];
        for (const table of tables) {
            try {
                const res = await fetch(`${this.API_BASE}/${table}`);
                if (res.ok) {
                    const data = await res.json();
                    this._cache[table] = data;
                    this._localSaveAll(table, data);
                }
            } catch (e) {
                console.warn(`サーバーデータ取得エラー (${table}):`, e);
                this._cache[table] = this._localGetAll(table);
            }
        }
        console.log('サーバーからデータをロードしました。');
    },

    // ========================================
    // ローカルデータをスプレッドシートにエクスポート
    // ========================================
    async exportToSheets() {
        if (!(await this.checkSheets())) {
            throw new Error('スプレッドシートに接続されていません');
        }

        const tables = ['medicines', 'announcements', 'shifts', 'employees'];
        const results = {};

        for (const table of tables) {
            try {
                const localData = this.getAll(table);
                const sheetsData = localData.map(record => this._toSheetsFormat(record));
                const result = await SheetsAPI.clearAndImport(table, sheetsData);
                results[table] = { success: true, count: result.count };
            } catch (e) {
                results[table] = { success: false, error: e.message };
            }
        }

        return results;
    },

    // ========================================
    // 定期同期（他端末の変更を反映）
    // ========================================
    _syncInterval: null,

    startAutoSync(intervalMs = 30000) {
        if (this._syncInterval) clearInterval(this._syncInterval);
        if (this._mode === 'local') return;

        this._syncInterval = setInterval(async () => {
            const tables = ['announcements', 'shifts', 'medicines', 'employees'];
            for (const table of tables) {
                try {
                    let newData;
                    if (this._mode === 'sheets') {
                        const sheetsData = await SheetsAPI.readAll(table);
                        newData = sheetsData.map(record => this._fromSheetsFormat(record));
                    } else if (this._mode === 'server') {
                        const res = await fetch(`${this.API_BASE}/${table}`);
                        if (!res.ok) continue;
                        newData = await res.json();
                    } else {
                        continue;
                    }

                    const oldData = JSON.stringify(this._cache[table] || []);
                    const newDataStr = JSON.stringify(newData);
                    if (oldData !== newDataStr) {
                        this._cache[table] = newData;
                        this._localSaveAll(table, newData);
                        window.dispatchEvent(new CustomEvent('dataSync', { detail: { table } }));
                    }
                } catch (e) {
                    // 同期失敗は無視（次回リトライ）
                }
            }
        }, intervalMs);

        console.log(`自動同期を開始しました（${intervalMs / 1000}秒間隔、${this.getModeName()}）`);
    },

    stopAutoSync() {
        if (this._syncInterval) {
            clearInterval(this._syncInterval);
            this._syncInterval = null;
        }
    },

    // ========================================
    // スプレッドシート接続設定の変更
    // ========================================
    async connectToSheets(gasUrl) {
        if (typeof SheetsAPI === 'undefined') {
            throw new Error('SheetsAPI モジュールが読み込まれていません');
        }

        // 接続テスト
        const result = await SheetsAPI.testConnection(gasUrl);
        if (!result.success) {
            throw new Error('接続テスト失敗: ' + (result.error || '不明なエラー'));
        }

        // 設定を保存
        SheetsAPI.saveConfig({
            gasUrl: gasUrl,
            connected: true,
            connectedAt: new Date().toISOString()
        });

        // モードを切り替え
        this._mode = 'sheets';
        this.stopAutoSync();

        // スプレッドシートからデータをロード
        await this.loadFromSheets();

        // 自動同期を開始
        this.startAutoSync(30000);

        // UIを更新
        window.dispatchEvent(new CustomEvent('storageModeChanged', { detail: { mode: 'sheets' } }));

        return { success: true, message: 'Googleスプレッドシートに接続しました' };
    },

    // スプレッドシート接続を解除
    disconnectSheets() {
        if (typeof SheetsAPI !== 'undefined') {
            SheetsAPI.clearConfig();
        }
        this._mode = 'local';
        this.stopAutoSync();
        window.dispatchEvent(new CustomEvent('storageModeChanged', { detail: { mode: 'local' } }));
    },

    // ========================================
    // ローカルサンプルデータ（フォールバック用）
    // ========================================
    initSampleData() {
        // 薬剤サンプルデータ
        if (this._localGetAll('medicines').length === 0) {
            const sampleMedicines = [
                { name: 'ロキソプロフェンNa錦60mg', generic_name: 'ロキソプロフェンナトリウム水和物', category: '内服薬', sales_status: 'その他', discontinuation_date: '', alternative_medicine: '', supply_info: '', notes: '解熱鎮痛消炎剤。食後服用。', is_favorite: true },
                { name: 'アムロジピンOD錦5mg', generic_name: 'アムロジピンベシル酸塩', category: '内服薬', sales_status: 'その他', discontinuation_date: '', alternative_medicine: '', supply_info: '', notes: 'Ca拮抗薬。高血圧症・狭心症に使用。', is_favorite: true },
                { name: 'メトホルミン塩酸塩錠250mg「XX」', generic_name: 'メトホルミン塩酸塩', category: '内服薬', sales_status: '出荷調整中', discontinuation_date: '', alternative_medicine: 'メトホルミン塩酸塩錠250mg「YY」', supply_info: '2026年1月より出荷調整中。代替品への切替を推奨。', notes: 'ビグアナイド系糖尿病治療薬', is_favorite: false },
                { name: 'ガスモチン錠5mg', generic_name: 'モサプリドクエン酸塩水和物', category: '内服薬', sales_status: '販売中止', discontinuation_date: '2025年12月31日', alternative_medicine: 'モサプリドクエン酸塩錠5mg「サワイ」', supply_info: '', notes: '消化管運動促進薬。先発品販売中止。', is_favorite: false },
                { name: 'ヒルドイドソフト軟膏0.3%', generic_name: 'ヘパリン類似物質', category: '外用薬', sales_status: 'その他', discontinuation_date: '', alternative_medicine: '', supply_info: '', notes: '保湿・血行促進。皮脂欠乏症に使用。', is_favorite: true },
                { name: 'ツムラ葛根湯エキス顮粒（医療用）', generic_name: '葛根湯', category: '漢方薬', sales_status: 'その他', discontinuation_date: '', alternative_medicine: '', supply_info: '', notes: '感冒の初期、肩こりなどに使用。', is_favorite: false },
                { name: 'リンデロンVG軟膏0.12%', generic_name: 'ベタメタゾン吉草酸エステル・ゲンタマイシン硫酸塩', category: '外用薬', sales_status: 'その他', discontinuation_date: '', alternative_medicine: '', supply_info: '', notes: 'ステロイド＋抗生物質配合外用薬', is_favorite: false },
                { name: 'セレコキシブ錠100mg「サワイ」', generic_name: 'セレコキシブ', category: '内服薬', sales_status: '新規採用', discontinuation_date: '', alternative_medicine: '', supply_info: '', notes: 'COX-2選択的阻害薬。2026年2月より採用。', is_favorite: false }
            ];
            sampleMedicines.forEach(med => {
                med.id = this.generateId();
                med.created_at = new Date().toISOString();
                med.updated_at = new Date().toISOString();
            });
            this._localSaveAll('medicines', sampleMedicines);
            this._cache['medicines'] = sampleMedicines;
        }

        // 従業員サンプルデータ
        if (this._localGetAll('employees').length === 0) {
            const sampleEmployees = [
                { name: '山田 太郎', furigana: 'やまだ たろう', position: '管理薬剤師', employment_type: '正社員', phone: '090-1234-5678', email: 'yamada@example.com', hire_date: '2015-04-01', status: '在籍', qualification: '', notes: '管理薬剤師兼務' },
                { name: '佐藤 花子', furigana: 'さとう はなこ', position: '薬剤師', employment_type: '正社員', phone: '090-2345-6789', email: 'sato@example.com', hire_date: '2018-04-01', status: '在籍', qualification: '', notes: '' },
                { name: '鈴木 一郎', furigana: 'すずき いちろう', position: '薬剤師', employment_type: 'パート', phone: '090-3456-7890', email: 'suzuki@example.com', hire_date: '2020-10-01', status: '在籍', qualification: '', notes: '月水金勤務' },
                { name: '田中 美咲', furigana: 'たなか みさき', position: '医療事務', employment_type: '正社員', phone: '090-4567-8901', email: 'tanaka@example.com', hire_date: '2021-04-01', status: '在籍', qualification: '', notes: '' }
            ];
            sampleEmployees.forEach(emp => {
                emp.id = this.generateId();
                emp.created_at = new Date().toISOString();
                emp.updated_at = new Date().toISOString();
            });
            this._localSaveAll('employees', sampleEmployees);
            this._cache['employees'] = sampleEmployees;
        }

        // お知らせサンプルデータ
        if (this._localGetAll('announcements').length === 0) {
            const sampleAnnouncements = [
                { title: 'ガスモチン錠5mg 販売中止のお知らせ', category: '業務連絡', priority: '重要', author: '山田 太郎', content: 'ガスモチン錠5mgが2025年12月31日をもって販売中止となりました。代替薬としてモサプリドクエン酸塩錠5mg「サワイ」への切替をお願いします。', date: '2026-01-15T09:00:00.000Z' },
                { title: '2月の調剤報酬改定研修について', category: '研修情報', priority: '通常', author: '佐藤 花子', content: '2026年2月20日（金）18:00より、調剤報酬改定に関する研修を実施します。全スタッフ参加をお願いします。場所：薬局2階会議室。', date: '2026-02-01T10:00:00.000Z' },
                { title: 'メトホルミン塩酸塩錠 出荷調整情報', category: '業務連絡', priority: '緊急', author: '山田 太郎', content: 'メトホルミン塩酸塩錠250mg「XX」が出荷調整中です。在庫が少なくなっています。代替品「YY」への切替を検討してください。', date: '2026-02-10T08:30:00.000Z' }
            ];
            sampleAnnouncements.forEach(ann => {
                ann.id = this.generateId();
                ann.created_at = new Date().toISOString();
                ann.updated_at = new Date().toISOString();
            });
            this._localSaveAll('announcements', sampleAnnouncements);
            this._cache['announcements'] = sampleAnnouncements;
        }

        // シフトサンプルデータ
        if (this._localGetAll('shifts').length === 0) {
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth();
            const staffNames = ['山田 太郎', '佐藤 花子', '鈴木 一郎', '田中 美咲'];
            const shiftTypes = ['早番', '日勤', '遅番', '全日'];
            const timeSlots = [
                { start: '08:30', end: '17:00' },
                { start: '09:00', end: '18:00' },
                { start: '10:00', end: '19:00' },
                { start: '08:30', end: '19:00' }
            ];
            const shifts = [];
            for (let day = 1; day <= 28; day++) {
                const date = new Date(year, month, day);
                const dow = date.getDay();
                if (dow === 0 || dow === 6) continue;
                staffNames.forEach((staff, idx) => {
                    if (staff === '鈴木 一郎' && dow !== 1 && dow !== 3 && dow !== 5) return;
                    const typeIdx = (day + idx) % shiftTypes.length;
                    shifts.push({
                        id: this.generateId(),
                        staff_name: staff,
                        date: date.toISOString(),
                        shift_type: shiftTypes[typeIdx],
                        start_time: timeSlots[typeIdx].start,
                        end_time: timeSlots[typeIdx].end,
                        notes: '',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                });
            }
            this._localSaveAll('shifts', shifts);
            this._cache['shifts'] = shifts;
        }
    }
};

// ========================================
// 初期化
// ========================================
(async function() {
    // リバースマップを構築
    DataStorage._buildReverseMap();

    // 1. Googleスプレッドシート接続を確認
    if (typeof SheetsAPI !== 'undefined' && SheetsAPI.isConnected()) {
        DataStorage._mode = 'sheets';
        console.log('接続モード: Googleスプレッドシート連携');
        try {
            await DataStorage.loadFromSheets();
        } catch (e) {
            console.warn('スプレッドシートからのロードに失敗。ローカルにフォールバック:', e);
            DataStorage._mode = 'local';
            DataStorage.initSampleData();
        }
    }
    // 2. サーバー接続を確認
    else {
        const serverOk = await DataStorage.checkServer();
        if (serverOk) {
            DataStorage._mode = 'server';
            console.log('接続モード: 共有データベース（サーバー）');
            await DataStorage.loadFromServer();
        } else {
            DataStorage._mode = 'local';
            console.log('接続モード: ローカルストレージ');
            DataStorage.initSampleData();
        }
    }

    // 自動同期を開始（ローカルモード以外）
    DataStorage.startAutoSync(30000);

    // データ同期イベントでUIを更新
    window.addEventListener('dataSync', (e) => {
        const table = e.detail.table;
        console.log(`データ同期: ${table} が更新されました`);
        if (typeof refreshCurrentSection === 'function') {
            refreshCurrentSection(table);
        }
    });

    // データストレージ初期化完了を通知
    DataStorage._ready = true;
    window.dispatchEvent(new CustomEvent('storageReady'));
    console.log(`データストレージ初期化完了（${DataStorage.getModeName()}）`);
})();

// グローバルに公開
window.DataStorage = DataStorage;
