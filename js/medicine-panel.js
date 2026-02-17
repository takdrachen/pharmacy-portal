// 薬剤情報管理専用JavaScript

let currentMedicineFilter = 'all';
let currentMedicineViewMode = 'table'; // 'table' or 'card'

// 表示モード切替
window.setMedicineViewMode = function(mode) {
    currentMedicineViewMode = mode;
    
    // ボタンのアクティブ状態を切替
    document.getElementById('viewTableBtn').classList.toggle('active', mode === 'table');
    document.getElementById('viewCardBtn').classList.toggle('active', mode === 'card');
    
    // 表示コンテナの切替
    document.getElementById('medicineTableView').style.display = mode === 'table' ? '' : 'none';
    document.getElementById('medicineCardView').style.display = mode === 'card' ? '' : 'none';
    
    // localStorage に保存
    localStorage.setItem('medicine_view_mode', mode);
    
    // リストを再描画
    window.renderMedicineList();
};

// グローバル関数として定義
window.setMedicineFilter = function(mode) {
    currentMedicineFilter = mode;
    window.renderMedicineList();
};

// フィルタークリア
window.clearMedicineFilters = function() {
    document.getElementById('medicine-search-input').value = '';
    document.getElementById('medicine-status-filter').value = '';
    window.renderMedicineList();
};

window.openMedicineInputCard = function() {
    const card = document.getElementById('medicineInputCard');
    card.classList.add('is-open');
};

window.addMedicine = function() {
    const name = document.getElementById('inMedicineName').value.trim();
    const genericName = document.getElementById('inMedicineGenericName').value.trim();
    const salesStatus = document.getElementById('inMedicineSalesStatus').value;
    // 販売期間フィールドの値を解析
    const periodRaw = document.getElementById('inMedicineSalesStartDate').value.trim();
    let salesStartDate = periodRaw;
    let discontinuationDate = '';
    if (periodRaw.includes('～')) {
        const parts = periodRaw.split('～');
        salesStartDate = parts[0].trim();
        discontinuationDate = parts[1] ? parts[1].trim() : '';
    } else if (periodRaw.includes('~')) {
        const parts = periodRaw.split('~');
        salesStartDate = parts[0].trim();
        discontinuationDate = parts[1] ? parts[1].trim() : '';
    }
    const alternative = document.getElementById('inMedicineAlternative').value.trim();
    const supplyInfo = document.getElementById('inMedicineSupplyInfo').value.trim();
    const notes = document.getElementById('inMedicineNotes').value.trim();
    const isFavorite = document.getElementById('inMedicineIsFavorite').checked;

    if (!name) {
        showToast('薬剤名は必須です', 'warning');
        return;
    }

    const data = {
        name,
        generic_name: genericName,
        sales_status: salesStatus,
        sales_start_date: salesStartDate,
        discontinuation_date: discontinuationDate,
        alternative_medicine: alternative,
        supply_info: supplyInfo,
        notes,
        is_favorite: isFavorite
    };

    try {
        DataStorage.create('medicines', data);

        // フォームクリア
        document.getElementById('inMedicineName').value = '';
        document.getElementById('inMedicineGenericName').value = '';
        document.getElementById('inMedicineSalesStatus').value = 'その他';
        document.getElementById('inMedicineSalesStartDate').value = '';
        document.getElementById('inMedicineDiscontinuationDate').value = '';
        document.getElementById('inMedicineAlternative').value = '';
        document.getElementById('inMedicineSupplyInfo').value = '';
        document.getElementById('inMedicineNotes').value = '';
        document.getElementById('inMedicineIsFavorite').checked = false;

        // 入力カードを閉じる
        document.getElementById('medicineInputCard').classList.remove('is-open');

        // リスト更新
        if (typeof loadMedicines === 'function') {
            loadMedicines();
        }

        // 成功メッセージ
        showToast('薬剤情報を登録しました', 'success');
        // ダッシュボード更新
        if (typeof updateDashboard === 'function') updateDashboard();
    } catch (error) {
        console.error('薬剤登録エラー:', error);
        showToast('登録に失敗しました', 'error');
    }
};

// フィルタリングロジック
function getFilteredMedicines() {
    const searchText = document.getElementById('medicine-search-input').value.toLowerCase();
    const statusFilter = document.getElementById('medicine-status-filter') ? document.getElementById('medicine-status-filter').value : '';
    
    if (!window.medicinesData) return [];

    let data = [...window.medicinesData];

    // 検索フィルター（薬剤名、代替薬品、出荷調整、備考）
    if (searchText) {
        data = data.filter(item => 
            (item.name && item.name.toLowerCase().includes(searchText)) ||
            (item.alternative_medicine && item.alternative_medicine.toLowerCase().includes(searchText)) ||
            (item.supply_info && item.supply_info.toLowerCase().includes(searchText)) ||
            (item.notes && item.notes.toLowerCase().includes(searchText))
        );
    }

    // 販売状態フィルター
    if (statusFilter) {
        data = data.filter(item => item.sales_status === statusFilter);
    }

    // 新しいものから順にソート
    data.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at) : (a.id ? new Date(parseInt(a.id)) : new Date(0));
        const dateB = b.created_at ? new Date(b.created_at) : (b.id ? new Date(parseInt(b.id)) : new Date(0));
        return dateB - dateA;
    });

    // フィルターサマリーの更新
    updateFilterSummary(searchText, statusFilter, data.length);

    return data;
}

// フィルターサマリー表示
function updateFilterSummary(searchText, statusFilter, resultCount) {
    const summaryEl = document.getElementById('medicineFilterSummary');
    const textEl = document.getElementById('filterSummaryText');
    
    const filters = [];
    if (searchText) filters.push(`検索: "${searchText}"`);
    if (statusFilter) filters.push(`販売状態: ${statusFilter}`);
    
    if (filters.length > 0) {
        textEl.innerHTML = `<i class="fas fa-filter"></i> ${filters.join(' / ')} — <strong>${resultCount}件</strong>表示中`;
        summaryEl.style.display = 'flex';
    } else {
        summaryEl.style.display = 'none';
    }
}

// HTMLエスケープ
function escapeHtmlMed(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// テキスト省略
function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return escapeHtmlMed(text);
    return escapeHtmlMed(text.substring(0, maxLength)) + '...';
}

// ステータスクラス取得
function getStatusClass(salesStatus) {
    if (salesStatus === 'その他') return 'status-active';
    if (salesStatus === '販売中止') return 'status-discontinued';
    if (salesStatus === '出荷調整中') return 'status-supply';
    if (salesStatus === '新規採用') return 'status-new';
    return '';
}

// 行クラス取得
function getRowClass(salesStatus) {
    if (salesStatus === '販売中止') return ' is-discontinued';
    if (salesStatus === '出荷調整中') return ' is-supply-issue';
    if (salesStatus === '新規採用') return ' is-new';
    return '';
}

// テーブル表示のレンダリング
function renderTableView(data) {
    const listBody = document.getElementById('medicineListBody');

    if (data.length === 0) {
        listBody.innerHTML = '<div class="medicine-empty-state"><i class="fas fa-search"></i><p>条件に一致する薬剤が見つかりません</p></div>';
        return;
    }

    listBody.innerHTML = data.map(item => {
        let rowClass = 'list-row medicine-grid-layout' + getRowClass(item.sales_status);
        let statusClass = 'col-status ' + getStatusClass(item.sales_status);

        // 販売期間の統合表示
        let periodText = '';
        if (item.sales_start_date && item.discontinuation_date) {
            periodText = escapeHtmlMed(item.sales_start_date) + ' ～ ' + escapeHtmlMed(item.discontinuation_date);
        } else if (item.sales_start_date) {
            periodText = escapeHtmlMed(item.sales_start_date);
        } else if (item.discontinuation_date) {
            periodText = '～ ' + escapeHtmlMed(item.discontinuation_date);
        } else {
            periodText = '-';
        }

        return `
            <div class="${rowClass}">
                <div style="text-align:center">
                    <span class="favorite-star ${item.is_favorite ? 'active' : ''}" 
                          onclick="toggleMedicineFavorite('${item.id}', ${!item.is_favorite})" 
                          title="${item.is_favorite ? 'お気に入りから削除' : 'お気に入りに追加'}">
                        ${item.is_favorite ? '★' : '☆'}
                    </span>
                </div>
                <div class="col-medicine-name">${escapeHtmlMed(item.name)}</div>
                <div><span class="${statusClass}">${item.sales_status}</span></div>
                <div class="col-date">${periodText}</div>
                <div class="col-alternative">${escapeHtmlMed(item.alternative_medicine) || '-'}</div>
                <div class="col-supply-info">${item.supply_info ? `<span class="col-supply-badge">${escapeHtmlMed(item.supply_info)}</span>` : '-'}</div>
                <div class="col-notes-cell">${item.notes ? `<span class="col-note">${escapeHtmlMed(item.notes)}</span>` : ''}</div>
                <div class="action-cell">
                    <button class="icon-btn btn-edit" onclick="editMedicine('${item.id}')" title="編集">✏️</button>
                    <button class="icon-btn btn-delete" onclick="deleteMedicine('${item.id}')" title="削除">×</button>
                </div>
            </div>
        `;
    }).join('');
}

// カード表示のレンダリング
function renderCardView(data) {
    const cardContainer = document.getElementById('medicineCardView');

    if (data.length === 0) {
        cardContainer.innerHTML = '<div class="medicine-empty-state"><i class="fas fa-search"></i><p>条件に一致する薬剤が見つかりません</p></div>';
        return;
    }

    cardContainer.innerHTML = data.map(item => {
        let statusClass = getStatusClass(item.sales_status);
        let cardBorderClass = '';
        if (item.sales_status === '販売中止') cardBorderClass = 'card-discontinued';
        else if (item.sales_status === '出荷調整中') cardBorderClass = 'card-supply-issue';
        else if (item.sales_status === '新規採用') cardBorderClass = 'card-new';

        // 販売期間の統合表示
        let periodText = '';
        if (item.sales_start_date && item.discontinuation_date) {
            periodText = escapeHtmlMed(item.sales_start_date) + ' ～ ' + escapeHtmlMed(item.discontinuation_date);
        } else if (item.sales_start_date) {
            periodText = escapeHtmlMed(item.sales_start_date);
        } else if (item.discontinuation_date) {
            periodText = '～ ' + escapeHtmlMed(item.discontinuation_date);
        }

        return `
            <div class="medicine-card ${cardBorderClass}">
                <div class="medicine-card-header">
                    <div class="medicine-card-title-row">
                        <span class="favorite-star ${item.is_favorite ? 'active' : ''}" 
                              onclick="toggleMedicineFavorite('${item.id}', ${!item.is_favorite})" 
                              title="${item.is_favorite ? 'お気に入りから削除' : 'お気に入りに追加'}">
                            ${item.is_favorite ? '★' : '☆'}
                        </span>
                        <h4 class="medicine-card-name">${escapeHtmlMed(item.name)}</h4>
                    </div>
                    <div class="medicine-card-actions">
                        <button class="icon-btn btn-edit" onclick="editMedicine('${item.id}')" title="編集"><i class="fas fa-edit"></i></button>
                        <button class="icon-btn btn-delete" onclick="deleteMedicine('${item.id}')" title="削除"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div class="medicine-card-badges">
                    <span class="col-status ${statusClass}">${item.sales_status}</span>
                </div>
                ${periodText ? `
                <div class="medicine-card-dates">
                    <span class="medicine-card-date"><i class="fas fa-calendar-alt"></i> ${periodText}</span>
                </div>` : ''}
                ${item.alternative_medicine ? `
                <div class="medicine-card-info">
                    <i class="fas fa-exchange-alt"></i>
                    <span>代替: ${escapeHtmlMed(item.alternative_medicine)}</span>
                </div>` : ''}
                ${item.supply_info ? `
                <div class="medicine-card-info medicine-card-supply">
                    <i class="fas fa-exclamation-circle"></i>
                    <span>${escapeHtmlMed(item.supply_info)}</span>
                </div>` : ''}
                ${item.notes ? `
                <div class="medicine-card-notes">
                    <span>${escapeHtmlMed(item.notes)}</span>
                </div>` : ''}
            </div>
        `;
    }).join('');
}

// メインレンダリング関数
window.renderMedicineList = function() {
    if (!window.medicinesData) {
        document.getElementById('medicineListBody').innerHTML = '<div style="padding:20px; text-align:center; color:#ccc;">データを読み込み中...</div>';
        return;
    }

    const data = getFilteredMedicines();

    // 現在の表示モードに応じてレンダリング
    if (currentMedicineViewMode === 'card') {
        renderCardView(data);
    } else {
        renderTableView(data);
    }
};

// 初期化時にlocalStorageから表示モードを復元
window.addEventListener('DOMContentLoaded', function() {
    const savedMode = localStorage.getItem('medicine_view_mode');
    if (savedMode === 'card' || savedMode === 'table') {
        currentMedicineViewMode = savedMode;
        if (savedMode === 'card') {
            document.getElementById('viewTableBtn').classList.remove('active');
            document.getElementById('viewCardBtn').classList.add('active');
            document.getElementById('medicineTableView').style.display = 'none';
            document.getElementById('medicineCardView').style.display = '';
        }
    }
});

window.toggleMedicineFavorite = function(id, isFavorite) {
    try {
        DataStorage.update('medicines', id, { is_favorite: isFavorite });
        if (typeof loadMedicines === 'function') {
            loadMedicines();
        }
    } catch (error) {
        console.error('お気に入り更新エラー:', error);
    }
};

window.editMedicine = function(id) {
    const medicine = DataStorage.getById('medicines', id);
    if (medicine) {
        // main.js の編集用モーダルを使用
        if (typeof openMedicineModal === 'function') {
            openMedicineModal(medicine);
        } else {
            // フォールバック: 簡易編集
            const newName = prompt('薬剤名:', medicine.name);
            if (newName === null) return;
            
            DataStorage.update('medicines', id, { name: newName });
            
            if (typeof loadMedicines === 'function') {
                loadMedicines();
            }
        }
    } else {
        console.error('薬剤情報が見つかりません:', id);
    }
};

window.deleteMedicine = async function(id) {
    const confirmed = await showConfirmDialog('薬剤情報の削除', 'この薬剤情報を削除してもよろしいですか？\nこの操作は取り消せません。');
    if (!confirmed) return;
    
    try {
        DataStorage.delete('medicines', id);
        if (typeof loadMedicines === 'function') {
            loadMedicines();
        }
        showToast('薬剤情報を削除しました', 'success');
        if (typeof updateDashboard === 'function') updateDashboard();
    } catch (error) {
        console.error('薬剤削除エラー:', error);
        showToast('削除に失敗しました', 'error');
    }
};
