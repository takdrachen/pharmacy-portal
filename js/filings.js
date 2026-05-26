// 届出管理モジュール — 令和8年6月診療報酬改定

const FILINGS_STORAGE_KEY = 'pharmacy_filings_status';

const FILING_CATEGORIES = [
    {
        id: 'cat_required',
        label: '必ず届出が必要（新設の施設基準）',
        colorClass: 'cat-red',
        icon: 'fas fa-exclamation-circle',
        items: [
            { id: 'f01', name: '調剤ベースアップ評価料',                                     form: '様式103',             noteHint: '要確認' },
            { id: 'f02', name: '地域支援・医薬品供給対応体制加算（1〜5）',                   form: '様式87の3の1・3の2',   noteHint: '書類準備中。後発品率89.70%で基準クリア' },
            { id: 'f03', name: '在宅薬学総合体制加算2 イ・ロ',                               form: '様式87の3の5',         noteHint: '算定する場合のみ。実績48回以上等の要件確認' },
            { id: 'f04', name: 'バイオ後続品調剤体制加算',                                   form: '様式87の3の7',         noteHint: '調剤実績なくても届出可能' },
            { id: 'f05', name: '服薬管理指導料の注1（かかりつけ薬剤師）',                   form: '様式90',               noteHint: '現在算定中でも改めて届出が必要' },
        ]
    },
    {
        id: 'cat_if_changed',
        label: '区分変更があれば届出必要',
        colorClass: 'cat-yellow',
        icon: 'fas fa-exclamation-triangle',
        items: [
            { id: 'f06', name: '調剤基本料（1・2・3イロハ・特別A）',                         form: '様式84',               noteHint: '区分変更なし→不要。変更あり→届出必要' },
            { id: 'f07', name: '在宅薬学総合体制加算1',                                      form: '様式87の3の5',         noteHint: '新規・変更・廃止の場合は届出必要' },
        ]
    },
    {
        id: 'cat_name_change',
        label: '名称変更のみ（既算定なら届出不要）',
        colorClass: 'cat-orange',
        icon: 'fas fa-info-circle',
        items: [
            { id: 'f08', name: '電子的調剤情報連携体制整備加算',                             form: '様式87の3の6',         noteHint: '旧：医療DX推進体制整備加算。新規・廃止は届出必要' },
        ]
    },
    {
        id: 'cat_no_change',
        label: '施設基準変更なし（既算定なら届出不要）',
        colorClass: 'cat-green',
        icon: 'fas fa-check-circle',
        items: [
            { id: 'f09', name: '連携強化加算',                                               form: '様式87の3の4',         noteHint: '新規算定の場合は必要。第二種協定指定確認中' },
            { id: 'f10', name: '無菌製剤処理加算',                                           form: '様式88',               noteHint: '' },
            { id: 'f11', name: '特定薬剤管理指導加算2',                                      form: '様式92',               noteHint: '' },
            { id: 'f12', name: '在宅患者訪問薬剤管理指導料',                                 form: '別紙様式3',            noteHint: '' },
            { id: 'f13', name: '在宅患者医療用麻薬持続注射療法加算・在宅中心静脈栄養法加算', form: '様式89',               noteHint: '' },
        ]
    }
];

const FILING_STATUSES = [
    { value: '未対応', cls: 'status-filing-todo' },
    { value: '対応中', cls: 'status-filing-wip'  },
    { value: '完了',   cls: 'status-filing-done' },
    { value: '不要',   cls: 'status-filing-na'   },
];

// — Storage helpers —

function loadFilingsState() {
    try {
        const raw = localStorage.getItem(FILINGS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function saveFilingsState(state) {
    try {
        localStorage.setItem(FILINGS_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('届出管理データ保存エラー:', e);
    }
}

function getItemState(state, itemId, noteHint) {
    if (state[itemId]) return state[itemId];
    return { status: '未対応', notes: noteHint || '', updated_at: '' };
}

function allItems() {
    return FILING_CATEGORIES.flatMap(c => c.items);
}

function findItem(itemId) {
    return allItems().find(i => i.id === itemId);
}

// — XSS helper —

function escapeHtmlFil(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// — Render —

function renderFilingsSection() {
    const state = loadFilingsState();
    renderProgressBar(state);
    renderCategories(state);
}

function renderProgressBar(state) {
    const el = document.getElementById('filingsProgressBar');
    if (!el) return;

    const counts = { '未対応': 0, '対応中': 0, '完了': 0, '不要': 0 };
    allItems().forEach(item => {
        const s = getItemState(state, item.id, item.noteHint).status;
        if (counts[s] !== undefined) counts[s]++;
    });
    const total = allItems().length;

    const donePct    = counts['完了']   / total * 100;
    const wipPct     = counts['対応中'] / total * 100;
    const naPct      = counts['不要']   / total * 100;

    el.innerHTML = `
        <div class="filings-progress-summary">
            <span class="fp-chip fp-chip-todo">未対応 <strong>${counts['未対応']}</strong></span>
            <span class="fp-chip fp-chip-wip">対応中 <strong>${counts['対応中']}</strong></span>
            <span class="fp-chip fp-chip-done">完了 <strong>${counts['完了']}</strong></span>
            <span class="fp-chip fp-chip-na">不要 <strong>${counts['不要']}</strong></span>
            <span class="fp-chip fp-chip-total">全${total}件</span>
        </div>
        <div class="filings-progress-track">
            <div class="fp-bar fp-bar-done"  style="width:${donePct}%"></div>
            <div class="fp-bar fp-bar-wip"   style="width:${wipPct}%"></div>
            <div class="fp-bar fp-bar-na"    style="width:${naPct}%"></div>
        </div>
    `;
}

function renderCategories(state) {
    const el = document.getElementById('filingsCategories');
    if (!el) return;
    el.innerHTML = FILING_CATEGORIES.map(cat => renderCategory(cat, state)).join('');
}

function renderCategory(cat, state) {
    const rows = cat.items.map(item => {
        const s = getItemState(state, item.id, item.noteHint);
        const statusDef = FILING_STATUSES.find(x => x.value === s.status) || FILING_STATUSES[0];
        const notesPreview = s.notes
            ? `<span class="filing-notes-preview">${escapeHtmlFil(s.notes.length > 40 ? s.notes.slice(0, 40) + '…' : s.notes)}</span>`
            : '<span class="filing-notes-empty">—</span>';

        return `
            <div class="filing-row">
                <div class="filing-col-name">${escapeHtmlFil(item.name)}</div>
                <div class="filing-col-form">
                    <span class="filing-form-badge">${escapeHtmlFil(item.form)}</span>
                </div>
                <div class="filing-col-status">
                    <button class="filing-status-btn ${statusDef.cls}"
                            onclick="cycleFilingStatus('${item.id}')"
                            title="クリックでステータス変更">
                        ${escapeHtmlFil(s.status)}
                    </button>
                </div>
                <div class="filing-col-notes">
                    ${notesPreview}
                    <button class="filing-notes-edit-btn icon-btn"
                            onclick="openFilingNotesModal('${item.id}')"
                            title="メモ編集">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="filings-category-block ${cat.colorClass}">
            <div class="filings-category-header">
                <i class="${escapeHtmlFil(cat.icon)}"></i>
                <span>${escapeHtmlFil(cat.label)}</span>
                <span class="filings-category-count">${cat.items.length}件</span>
            </div>
            <div class="filings-category-table">
                <div class="filing-row filing-row-header">
                    <div class="filing-col-name">届出項目</div>
                    <div class="filing-col-form">様式番号</div>
                    <div class="filing-col-status">ステータス</div>
                    <div class="filing-col-notes">メモ</div>
                </div>
                ${rows}
            </div>
        </div>
    `;
}

// — Event handlers —

window.cycleFilingStatus = function(itemId) {
    const state = loadFilingsState();
    const item  = findItem(itemId);
    const s     = getItemState(state, itemId, item ? item.noteHint : '');
    const idx   = FILING_STATUSES.findIndex(x => x.value === s.status);
    const next  = FILING_STATUSES[(idx + 1) % FILING_STATUSES.length].value;
    const now   = typeof toJSTString === 'function' ? toJSTString() : new Date().toISOString();
    state[itemId] = { ...s, status: next, updated_at: now };
    saveFilingsState(state);
    renderFilingsSection();
};

let _currentEditingFilingId = null;

window.openFilingNotesModal = function(itemId) {
    _currentEditingFilingId = itemId;
    const item  = findItem(itemId);
    const state = loadFilingsState();
    const s     = getItemState(state, itemId, item ? item.noteHint : '');

    document.getElementById('filing-notes-modal-title').textContent = item ? item.name : 'メモ編集';
    document.getElementById('filing-notes-input').value = s.notes || '';
    document.getElementById('filing-notes-modal').classList.add('active');
    setTimeout(() => document.getElementById('filing-notes-input').focus(), 50);
};

window.closeFilingNotesModal = function() {
    document.getElementById('filing-notes-modal').classList.remove('active');
    _currentEditingFilingId = null;
};

window.saveFilingNotes = function() {
    if (!_currentEditingFilingId) return;
    const item  = findItem(_currentEditingFilingId);
    const state = loadFilingsState();
    const s     = getItemState(state, _currentEditingFilingId, item ? item.noteHint : '');
    const notes = document.getElementById('filing-notes-input').value;
    const now   = typeof toJSTString === 'function' ? toJSTString() : new Date().toISOString();

    state[_currentEditingFilingId] = { ...s, notes, updated_at: now };
    saveFilingsState(state);
    closeFilingNotesModal();
    renderFilingsSection();
    if (typeof showToast === 'function') showToast('メモを保存しました', 'success');
};

// — Init —

window.initFilingsSection = function() {
    renderFilingsSection();
};
