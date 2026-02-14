// ========================================
// API ベースのデータストレージ層
// サーバーサイドSQLiteと通信し、全端末でデータを共有
// サーバー未接続時はlocalStorageにフォールバック
// ========================================

const DataStorage = {
    // APIベースURL
    API_BASE: '/api',

    // サーバー接続状態
    _serverAvailable: null,

    // ストレージキー（フォールバック用）
    KEYS: {
        announcements: 'pharmacy_announcements',
        shifts: 'pharmacy_shifts',
        medicines: 'pharmacy_medicines',
        employees: 'pharmacy_employees'
    },

    // UUID生成
    generateId() {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
        if (this._serverAvailable) {
            console.log('サーバー接続: OK（共有データベースモード）');
        } else {
            console.log('サーバー接続: 不可（ローカルストレージモード）');
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
    // サーバーモード時はキャッシュから返し、バックグラウンドで同期
    // ========================================

    // 内部キャッシュ
    _cache: {},
    _cacheReady: {},

    // データ取得（同期 - キャッシュから返す）
    getAll(tableName) {
        // キャッシュがあればキャッシュから返す
        if (this._cache[tableName]) {
            return [...this._cache[tableName]];
        }
        // フォールバック: localStorageから
        const local = this._localGetAll(tableName);
        this._cache[tableName] = local;
        return [...local];
    },

    // 単一レコード取得
    getById(tableName, id) {
        const all = this.getAll(tableName);
        return all.find(item => item.id === id) || null;
    },

    // レコード追加（同期 + バックグラウンドAPI）
    create(tableName, record) {
        const all = this.getAll(tableName);
        record.id = this.generateId();
        record.created_at = new Date().toISOString();
        record.updated_at = new Date().toISOString();
        all.push(record);
        this._cache[tableName] = all;
        this._localSaveAll(tableName, all);

        // バックグラウンドでサーバーに同期
        this._syncCreate(tableName, record);
        return record;
    },

    // レコード更新（同期 + バックグラウンドAPI）
    update(tableName, id, updates) {
        const all = this.getAll(tableName);
        const index = all.findIndex(item => item.id === id);
        if (index === -1) return null;
        all[index] = { ...all[index], ...updates, updated_at: new Date().toISOString() };
        this._cache[tableName] = all;
        this._localSaveAll(tableName, all);

        // バックグラウンドでサーバーに同期
        this._syncUpdate(tableName, id, updates);
        return all[index];
    },

    // レコード削除（同期 + バックグラウンドAPI）
    delete(tableName, id) {
        const all = this.getAll(tableName);
        const filtered = all.filter(item => item.id !== id);
        if (filtered.length === all.length) return false;
        this._cache[tableName] = filtered;
        this._localSaveAll(tableName, filtered);

        // バックグラウンドでサーバーに同期
        this._syncDelete(tableName, id);
        return true;
    },

    // ========================================
    // バックグラウンド同期メソッド
    // ========================================
    async _syncCreate(tableName, record) {
        if (!this._serverAvailable) return;
        try {
            await fetch(`${this.API_BASE}/${tableName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record)
            });
        } catch (e) {
            console.warn(`サーバー同期エラー (create ${tableName}):`, e);
        }
    },

    async _syncUpdate(tableName, id, updates) {
        if (!this._serverAvailable) return;
        try {
            await fetch(`${this.API_BASE}/${tableName}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
        } catch (e) {
            console.warn(`サーバー同期エラー (update ${tableName}):`, e);
        }
    },

    async _syncDelete(tableName, id) {
        if (!this._serverAvailable) return;
        try {
            await fetch(`${this.API_BASE}/${tableName}/${id}`, {
                method: 'DELETE'
            });
        } catch (e) {
            console.warn(`サーバー同期エラー (delete ${tableName}):`, e);
        }
    },

    // ========================================
    // サーバーからの初期データロード
    // ========================================
    async loadFromServer() {
        const isAvailable = await this.checkServer();
        if (!isAvailable) {
            // サーバー不可の場合、ローカルにサンプルデータを投入
            this.initSampleData();
            return;
        }

        // サーバーから全テーブルのデータを取得してキャッシュに保存
        const tables = ['announcements', 'shifts', 'medicines', 'employees'];
        for (const table of tables) {
            try {
                const res = await fetch(`${this.API_BASE}/${table}`);
                if (res.ok) {
                    const data = await res.json();
                    this._cache[table] = data;
                    // ローカルにもバックアップ保存
                    this._localSaveAll(table, data);
                }
            } catch (e) {
                console.warn(`サーバーデータ取得エラー (${table}):`, e);
                // フォールバック: ローカルから
                this._cache[table] = this._localGetAll(table);
            }
        }

        console.log('サーバーからデータをロードしました。');
    },

    // ========================================
    // 定期同期（他端末の変更を反映）
    // ========================================
    _syncInterval: null,

    startAutoSync(intervalMs = 30000) {
        if (this._syncInterval) clearInterval(this._syncInterval);
        if (!this._serverAvailable) return;

        this._syncInterval = setInterval(async () => {
            const tables = ['announcements', 'shifts', 'medicines', 'employees'];
            for (const table of tables) {
                try {
                    const res = await fetch(`${this.API_BASE}/${table}`);
                    if (res.ok) {
                        const data = await res.json();
                        const oldData = JSON.stringify(this._cache[table] || []);
                        const newData = JSON.stringify(data);
                        if (oldData !== newData) {
                            this._cache[table] = data;
                            this._localSaveAll(table, data);
                            // データ変更イベントを発火
                            window.dispatchEvent(new CustomEvent('dataSync', { detail: { table } }));
                        }
                    }
                } catch (e) {
                    // 同期失敗は無視（次回リトライ）
                }
            }
        }, intervalMs);

        console.log(`自動同期を開始しました（${intervalMs / 1000}秒間隔）`);
    },

    stopAutoSync() {
        if (this._syncInterval) {
            clearInterval(this._syncInterval);
            this._syncInterval = null;
        }
    },

    // ========================================
    // ローカルサンプルデータ（サーバー不可時のフォールバック）
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
                { name: '鈴木 一郎', furigana: 'すずき いちろう', position: '薬剤師', employment_type: 'パート', phone: '080-3456-7890', email: '', hire_date: '2020-10-01', status: '在籍', qualification: '', notes: '月・水・金勤務' },
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
// 初期化: サーバー接続を確認し、データをロード
// ========================================
(async function() {
    await DataStorage.loadFromServer();
    // サーバー接続時は30秒間隔で自動同期
    DataStorage.startAutoSync(30000);

    // データ同期イベントでUIを更新
    window.addEventListener('dataSync', (e) => {
        const table = e.detail.table;
        console.log(`データ同期: ${table} が更新されました`);
        // 各セクションの再描画をトリガー
        if (typeof refreshCurrentSection === 'function') {
            refreshCurrentSection(table);
        }
    });

    // データストレージ初期化完了を通知
    DataStorage._ready = true;
    window.dispatchEvent(new CustomEvent('storageReady'));
    console.log('データストレージ初期化完了');
})();

// グローバルに公開
window.DataStorage = DataStorage;
