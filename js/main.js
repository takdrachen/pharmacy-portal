
let currentSection = 'dashboard';
let currentMonth = new Date();
let currentEditingAnnouncementId = null;
let currentEditingShiftId = null;
let currentEditingMedicineId = null;
let currentMedicineDetailId = null;
let currentEditingEmployeeId = null;
let currentEmployeeFilter = 'active'; // 'active' or 'all'
let employeesList = []; // 従業員マスタのキャッシュ

// 日本の祝日データ（2026年）
const holidays2026 = {
    '2026-01-01': '元日',
    '2026-01-12': '成人の日',
    '2026-02-11': '建国記念の日',
    '2026-02-23': '天皇誕生日',
    '2026-03-20': '春分の日',
    '2026-04-29': '昭和の日',
    '2026-05-03': '憲法記念日',
    '2026-05-04': 'みどりの日',
    '2026-05-05': 'こどもの日',
    '2026-05-06': '振替休日',
    '2026-07-20': '海の日',
    '2026-08-11': '山の日',
    '2026-09-21': '敬老の日',
    '2026-09-22': '秋分の日',
    '2026-10-12': 'スポーツの日',
    '2026-11-03': '文化の日',
    '2026-11-23': '勤労感謝の日'
};

// 祝日かどうかをチェック
function isHoliday(date) {
    const dateStr = formatDateISO(date);
    return holidays2026[dateStr] || null;
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('緑ヶ丘調剤薬局ポータル初期化開始');
    
    try {
        initNavigation();
        console.log('ナビゲーション初期化完了');
    } catch (e) {
        console.error('ナビゲーション初期化エラー:', e);
    }
    
    try {
        initAnnouncementSection();
        console.log('お知らせセクション初期化完了');
    } catch (e) {
        console.error('お知らせセクション初期化エラー:', e);
    }
    
    try {
        initShiftSection();
        console.log('シフトセクション初期化完了');
    } catch (e) {
        console.error('シフトセクション初期化エラー:', e);
    }
    
    try {
        initMedicineSection();
        console.log('薬剤セクション初期化完了');
    } catch (e) {
        console.error('薬剤セクション初期化エラー:', e);
    }
    
    try {
        initEmployeeSection();
        console.log('従業員セクション初期化完了');
    } catch (e) {
        console.error('従業員セクション初期化エラー:', e);
    }
    
    try {
        initAIChatSection();
        console.log('AIチャットセクション初期化完了');
    } catch (e) {
        console.error('AIチャットセクション初期化エラー:', e);
    }
    
    // データストレージの初期化完了を待ってからデータを読み込む
    function loadAllData() {
        console.log('データ読み込み開始...');
        loadAnnouncements();
        loadEmployees();
        loadShifts();
        loadMedicines();
        
        // ダッシュボード初期化
        try {
            updateDashboard();
            console.log('ダッシュボード初期化完了');
        } catch (e) {
            console.error('ダッシュボード初期化エラー:', e);
        }
        console.log('初期化処理完了');
    }
    
    // DataStorageが既に初期化済みなら即座にデータ読み込み、そうでなければイベントを待つ
    if (window.DataStorage && window.DataStorage._ready) {
        loadAllData();
    } else {
        window.addEventListener('storageReady', () => {
            loadAllData();
        }, { once: true });
    }
});

// ナビゲーション初期化
function initNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.dataset.section;
            switchSection(section);
        });
    });
}

// セクション切り替え
function switchSection(section) {
    // ナビゲーションボタンの切り替え
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.section === section) {
            btn.classList.add('active');
        }
    });
    
    // コンテンツセクションの切り替え
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.remove('active');
    });
    document.getElementById(`${section}-section`).classList.add('active');
    
    currentSection = section;
    
    // セクション切り替え時にデータを再読み込み
    switch (section) {
        case 'dashboard':
            updateDashboard();
            break;
        case 'announcements':
            loadAnnouncements();
            break;
        case 'shifts':
            loadShifts();
            break;
        case 'medicines':
            loadMedicines();
            break;
        case 'employees':
            loadEmployees();
            break;
    }
    
    // ページトップにスクロール
    window.scrollTo(0, 0);
}

// ========== データ同期時のUI更新 ==========
function refreshCurrentSection(table) {
    // 同期されたテーブルに応じて現在のセクションを再描画
    if (table === 'announcements') {
        loadAnnouncements();
        if (currentSection === 'dashboard') updateDashboard();
    } else if (table === 'shifts') {
        loadShifts();
        if (currentSection === 'dashboard') updateDashboard();
    } else if (table === 'medicines') {
        loadMedicines();
        if (typeof renderMedicineList === 'function') renderMedicineList();
        if (currentSection === 'dashboard') updateDashboard();
    } else if (table === 'employees') {
        loadEmployees();
        if (currentSection === 'dashboard') updateDashboard();
    }
}
window.refreshCurrentSection = refreshCurrentSection;

// ========== ダッシュボード機能 ==========

function updateDashboard() {
    // 日付表示
    const now = new Date();
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const dateEl = document.getElementById('dashboard-date');
    if (dateEl) {
        dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${days[now.getDay()]}）`;
    }
    
    // サマリーカード
    const todayStr = formatDateISO(now);
    const allShifts = DataStorage.getAll('shifts');
    const todayShifts = allShifts.filter(s => {
        const shiftDate = new Date(s.date);
        return formatDateISO(shiftDate) === todayStr;
    });
    
    const announcements = DataStorage.getAll('announcements');
    const medicines = DataStorage.getAll('medicines');
    const employees = DataStorage.getAll('employees').filter(e => e.status === '在籍');
    
    document.getElementById('dash-today-shifts').textContent = todayShifts.length + '名';
    document.getElementById('dash-announcements-count').textContent = announcements.length + '件';
    document.getElementById('dash-medicines-count').textContent = medicines.length + '件';
    document.getElementById('dash-employees-count').textContent = employees.length + '名';
    
    // 今日のシフト一覧
    const shiftListEl = document.getElementById('dash-today-shift-list');
    if (todayShifts.length === 0) {
        shiftListEl.innerHTML = '<div class="dash-empty"><i class="fas fa-calendar-check"></i>今日のシフトはありません</div>';
    } else {
        shiftListEl.innerHTML = todayShifts.map(s => {
            const timeStr = (s.start_time && s.end_time) ? `${s.start_time} - ${s.end_time}` : '';
            return `
                <div class="dash-shift-item">
                    <span class="dash-shift-name">${escapeHtml(s.staff_name)}</span>
                    <span class="dash-shift-type type-${s.shift_type}">${s.shift_type}</span>
                    <span class="dash-shift-time">${timeStr}</span>
                </div>
            `;
        }).join('');
    }
    
    // 要注意薬剤（出荷調整中・販売中止）
    const alertMedicines = medicines.filter(m => m.sales_status === '出荷調整中' || m.sales_status === '販売中止');
    const alertMedEl = document.getElementById('dash-alert-medicines');
    if (alertMedicines.length === 0) {
        alertMedEl.innerHTML = '<div class="dash-empty"><i class="fas fa-check-circle"></i>要注意薬剤はありません</div>';
    } else {
        alertMedEl.innerHTML = alertMedicines.map(m => {
            const altText = m.alternative_medicine ? `→ ${m.alternative_medicine}` : '';
            return `
                <div class="dash-medicine-item">
                    <span class="dash-medicine-status status-${m.sales_status}">${m.sales_status}</span>
                    <span class="dash-medicine-name">${escapeHtml(m.name)}</span>
                    ${altText ? `<span class="dash-medicine-alt"><i class="fas fa-arrow-right"></i> ${escapeHtml(m.alternative_medicine)}</span>` : ''}
                </div>
            `;
        }).join('');
    }
    
    // 最新のお知らせ（最大5件）
    const recentAnnouncements = [...announcements].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    const announcementsEl = document.getElementById('dash-recent-announcements');
    if (recentAnnouncements.length === 0) {
        announcementsEl.innerHTML = '<div class="dash-empty"><i class="fas fa-bullhorn"></i>お知らせはありません</div>';
    } else {
        announcementsEl.innerHTML = recentAnnouncements.map(a => {
            const date = new Date(a.date);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
            const excerpt = a.content ? (a.content.length > 60 ? a.content.substring(0, 60) + '...' : a.content) : '';
            return `
                <div class="dash-announcement-item" onclick="switchSection('announcements')">
                    <div class="dash-announcement-header">
                        <span class="dash-announcement-priority priority-${a.priority}">${a.priority}</span>
                        <span class="dash-announcement-title">${escapeHtml(a.title)}</span>
                        <span class="dash-announcement-date">${dateStr}</span>
                    </div>
                    <div class="dash-announcement-excerpt">${escapeHtml(excerpt)}</div>
                </div>
            `;
        }).join('');
    }
}

// ========== トースト通知 ==========

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-times-circle',
        warning: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="toast-icon ${icons[type] || icons.info}"></i>
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" onclick="this.parentElement.classList.add('toast-hiding'); setTimeout(() => this.parentElement.remove(), 250)">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    container.appendChild(toast);
    
    // 自動消去（3秒後）
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('toast-hiding');
            setTimeout(() => toast.remove(), 250);
        }
    }, 3000);
}

// ========== 確認ダイアログ ==========

function showConfirmDialog(title, message, okLabel = '削除する') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-dialog');
        document.getElementById('confirm-dialog-title').textContent = title;
        document.getElementById('confirm-dialog-message').textContent = message;
        document.getElementById('confirm-dialog-ok').textContent = okLabel;
        
        overlay.style.display = 'flex';
        
        const okBtn = document.getElementById('confirm-dialog-ok');
        const cancelBtn = document.getElementById('confirm-dialog-cancel');
        
        function cleanup() {
            overlay.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onOverlayClick);
        }
        
        function onOk() {
            cleanup();
            resolve(true);
        }
        
        function onCancel() {
            cleanup();
            resolve(false);
        }
        
        function onOverlayClick(e) {
            if (e.target === overlay) {
                cleanup();
                resolve(false);
            }
        }
        
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onOverlayClick);
    });
}

// ========== お知らせ掲示板機能 ==========

function initAnnouncementSection() {
    // 新規投稿ボタン
    document.getElementById('add-announcement-btn').addEventListener('click', () => {
        openAnnouncementModal();
    });
    
    // フォーム送信
    document.getElementById('announcement-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveAnnouncement();
    });
    
    // フィルター変更
    document.getElementById('announcement-category-filter').addEventListener('change', loadAnnouncements);
    document.getElementById('announcement-priority-filter').addEventListener('change', loadAnnouncements);
}

function loadAnnouncements() {
    const categoryFilter = document.getElementById('announcement-category-filter').value;
    const priorityFilter = document.getElementById('announcement-priority-filter').value;
    
    try {
        let announcements = DataStorage.getAll('announcements');
        
        // 日付降順ソート
        announcements.sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date));
        
        // フィルタリング
        if (categoryFilter) {
            announcements = announcements.filter(a => a.category === categoryFilter);
        }
        if (priorityFilter) {
            announcements = announcements.filter(a => a.priority === priorityFilter);
        }
        
        displayAnnouncements(announcements);
    } catch (error) {
        console.error('お知らせの読み込みに失敗しました:', error);
        displayAnnouncements([]);
    }
}

function displayAnnouncements(announcements) {
    const container = document.getElementById('announcements-list');
    
    if (announcements.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-bullhorn"></i>
                <p>お知らせはありません</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = announcements.map(ann => {
        const date = new Date(ann.date || ann.created_at);
        const dateStr = formatDate(date);
        
        return `
            <div class="announcement-card priority-${ann.priority}">
                <div class="announcement-header">
                    <div>
                        <div class="announcement-title">${escapeHtml(ann.title)}</div>
                        <div class="announcement-meta">
                            <span><i class="fas fa-user"></i> ${escapeHtml(ann.author)}</span>
                            <span><i class="fas fa-calendar"></i> ${dateStr}</span>
                        </div>
                    </div>
                    <div>
                        <span class="badge badge-category">${ann.category}</span>
                        <span class="badge badge-priority-${ann.priority}">${ann.priority}</span>
                    </div>
                </div>
                <div class="announcement-content">${escapeHtml(ann.content)}</div>
                <div class="announcement-footer">
                    <div class="announcement-actions">
                        <button class="icon-btn" onclick="editAnnouncement('${ann.id}')" title="編集">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="icon-btn" onclick="deleteAnnouncement('${ann.id}')" title="削除">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function openAnnouncementModal(announcement = null) {
    const modal = document.getElementById('announcement-modal');
    const form = document.getElementById('announcement-form');
    const title = document.getElementById('announcement-modal-title');
    
    if (announcement) {
        title.textContent = 'お知らせ編集';
        document.getElementById('announcement-id').value = announcement.id;
        document.getElementById('announcement-title').value = announcement.title;
        document.getElementById('announcement-category').value = announcement.category;
        document.getElementById('announcement-priority').value = announcement.priority;
        document.getElementById('announcement-author').value = announcement.author;
        document.getElementById('announcement-content').value = announcement.content;
        currentEditingAnnouncementId = announcement.id;
    } else {
        title.textContent = '新規お知らせ投稿';
        form.reset();
        currentEditingAnnouncementId = null;
    }
    
    modal.classList.add('active');
}

function closeAnnouncementModal() {
    document.getElementById('announcement-modal').classList.remove('active');
    document.getElementById('announcement-form').reset();
    currentEditingAnnouncementId = null;
}

function saveAnnouncement() {
    const data = {
        title: document.getElementById('announcement-title').value,
        category: document.getElementById('announcement-category').value,
        priority: document.getElementById('announcement-priority').value,
        author: document.getElementById('announcement-author').value,
        content: document.getElementById('announcement-content').value,
        date: new Date().toISOString()
    };
    
    try {
        if (currentEditingAnnouncementId) {
            DataStorage.update('announcements', currentEditingAnnouncementId, data);
        } else {
            DataStorage.create('announcements', data);
        }
        
        closeAnnouncementModal();
        loadAnnouncements();
        updateDashboard();
        showToast('お知らせを保存しました', 'success');
    } catch (error) {
        console.error('お知らせの保存に失敗しました:', error);
        showToast('保存に失敗しました。もう一度お試しください。', 'error');
    }
}

function editAnnouncement(id) {
    const announcement = DataStorage.getById('announcements', id);
    if (announcement) {
        openAnnouncementModal(announcement);
    } else {
        console.error('お知らせが見つかりません:', id);
    }
}

async function deleteAnnouncement(id) {
    const confirmed = await showConfirmDialog('お知らせの削除', 'このお知らせを削除してもよろしいですか？\nこの操作は取り消せません。');
    if (!confirmed) return;
    
    try {
        DataStorage.delete('announcements', id);
        loadAnnouncements();
        updateDashboard();
        showToast('お知らせを削除しました', 'success');
    } catch (error) {
        console.error('お知らせの削除に失敗しました:', error);
        showToast('削除に失敗しました。もう一度お試しください。', 'error');
    }
}

// ========== シフト管理機能 ==========

function initShiftSection() {
    // シフト追加ボタン
    document.getElementById('add-shift-btn').addEventListener('click', () => {
        openShiftModal();
    });
    
    // フォーム送信
    document.getElementById('shift-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveShift();
    });
    
    // 月切り替えボタン
    document.getElementById('prev-month-btn').addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() - 1);
        loadShifts();
    });
    
    document.getElementById('next-month-btn').addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() + 1);
        loadShifts();
    });
    
    updateMonthDisplay();
}

function updateMonthDisplay() {
    const display = document.getElementById('current-month-display');
    display.textContent = `${currentMonth.getFullYear()}年 ${currentMonth.getMonth() + 1}月`;
}

function loadShifts() {
    updateMonthDisplay();
    
    try {
        const shifts = DataStorage.getAll('shifts');
        
        // 現在の月のシフトのみフィルタリング
        const monthShifts = shifts.filter(shift => {
            const shiftDate = new Date(shift.date);
            return shiftDate.getMonth() === currentMonth.getMonth() &&
                   shiftDate.getFullYear() === currentMonth.getFullYear();
        });
        
        displayCalendar(monthShifts);
        displayStaffShiftList(monthShifts);
        
        // シフトモーダルのスタッフ選択肢を更新
        updateShiftStaffOptions();
    } catch (error) {
        console.error('シフトの読み込みに失敗しました:', error);
        displayCalendar([]);
        displayStaffShiftList([]);
    }
}

function updateShiftStaffOptions() {
    const select = document.getElementById('shift-staff-name');
    if (!select) return;
    
    // 既存のオプションをクリア（最初の「選択してください」以外）
    while (select.options.length > 1) {
        select.remove(1);
    }
    
    // 従業員リストからスタッフ名を追加
    const employees = DataStorage.getAll('employees');
    employees.filter(e => e.status === '在籍').forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.name;
        option.textContent = emp.name;
        select.appendChild(option);
    });
}

function displayCalendar(shifts) {
    const calendarGrid = document.getElementById('calendar-grid');
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    
    let html = '';
    
    // 前月の空白セル
    for (let i = 0; i < startDayOfWeek; i++) {
        html += '<div class="calendar-day other-month"></div>';
    }
    
    // 日付セル
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(year, month, day);
        const dateStr = formatDateISO(date);
        const dayOfWeek = date.getDay();
        const today = new Date();
        const isToday = date.getDate() === today.getDate() && 
                       date.getMonth() === today.getMonth() && 
                       date.getFullYear() === today.getFullYear();
        
        const holidayName = isHoliday(date);
        
        let cellClass = 'calendar-day';
        if (isToday) cellClass += ' today';
        if (dayOfWeek === 0 || holidayName) cellClass += ' sunday-holiday';
        if (dayOfWeek === 6 && !holidayName) cellClass += ' saturday';
        
        // この日のシフトを取得
        const dayShifts = shifts.filter(s => {
            const sDate = new Date(s.date);
            return sDate.getDate() === day && 
                   sDate.getMonth() === month && 
                   sDate.getFullYear() === year;
        });
        
        html += `<div class="${cellClass}" data-date="${dateStr}">`;
        html += `<div class="day-number">${day}`;
        if (holidayName) {
            html += `<span class="holiday-label">${holidayName}</span>`;
        }
        html += `</div>`;
        
        // シフト表示
        html += '<div class="day-shifts">';
        dayShifts.forEach(shift => {
            const typeClass = getShiftTypeClass(shift.shift_type);
            const lastName = shift.staff_name.split(/\s+/)[0];
            html += `<div class="shift-item ${typeClass}" title="${escapeHtml(shift.staff_name)}: ${escapeHtml(shift.shift_type)} ${shift.start_time || ''}〜${shift.end_time || ''}">`;
            html += `<span class="shift-staff-name">${escapeHtml(lastName)}</span>`;
            html += `<span class="shift-type-label">${escapeHtml(shift.shift_type)}</span>`;
            html += `</div>`;
        });
        html += '</div>';
        
        html += '</div>';
    }
    
    // 後方の空白セル（7の倍数になるまで）
    const totalCells = startDayOfWeek + lastDay.getDate();
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 0; i < remaining; i++) {
        html += '<div class="calendar-day other-month"></div>';
    }
    
    calendarGrid.innerHTML = html;
}

function getShiftTypeClass(type) {
    switch (type) {
        case '早番': return 'shift-early';
        case '日勤': return 'shift-day';
        case '遅番': return 'shift-late';
        case '夜勤': return 'shift-night';
        case '全日': return 'shift-full';
        case '休み': return 'shift-off';
        default: return 'shift-other';
    }
}

function displayStaffShiftList(shifts) {
    const container = document.getElementById('staff-shift-list');
    
    if (shifts.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-calendar"></i><p>シフトが登録されていません</p></div>';
        return;
    }
    
    // スタッフ別にグループ化
    const staffShifts = {};
    shifts.forEach(shift => {
        if (!staffShifts[shift.staff_name]) {
            staffShifts[shift.staff_name] = [];
        }
        staffShifts[shift.staff_name].push(shift);
    });
    
    let html = '';
    Object.entries(staffShifts).sort((a, b) => a[0].localeCompare(b[0], 'ja')).forEach(([staff, staffShiftList]) => {
        staffShiftList.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        html += `
            <div class="staff-shift-card">
                <div class="staff-name"><i class="fas fa-user"></i> ${escapeHtml(staff)} <span style="color:var(--text-secondary);font-size:var(--font-size-sm);font-weight:var(--font-weight-medium)">(${staffShiftList.length}件)</span></div>
        `;
        
        staffShiftList.forEach(shift => {
            const date = new Date(shift.date);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
            const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
            const dayName = dayNames[date.getDay()];
            const typeClass = getShiftTypeClass(shift.shift_type);
            const dayClass = date.getDay() === 0 ? ' style="color:var(--color-error)"' : date.getDay() === 6 ? ' style="color:var(--color-info)"' : '';
            
            html += `
                <div class="shift-details">
                    <span class="shift-date"${dayClass}>${dateStr}(${dayName})</span>
                    <span class="shift-type-badge ${typeClass}">${shift.shift_type}</span>
                    ${shift.start_time ? `<span class="shift-time">${shift.start_time}〜${shift.end_time || ''}</span>` : '<span></span>'}
                    <div class="shift-actions">
                        <button class="icon-btn" onclick="editShift('${shift.id}')" title="編集"><i class="fas fa-edit"></i></button>
                        <button class="icon-btn" onclick="deleteShift('${shift.id}')" title="削除"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
    });
    
    container.innerHTML = html;
}

function openShiftModal(shift = null) {
    const modal = document.getElementById('shift-modal');
    const form = document.getElementById('shift-form');
    const title = document.getElementById('shift-modal-title');
    
    // スタッフ選択肢を更新
    updateShiftStaffOptions();
    
    if (shift) {
        title.textContent = 'シフト編集';
        document.getElementById('shift-id').value = shift.id;
        document.getElementById('shift-staff-name').value = shift.staff_name;
        document.getElementById('shift-date').value = shift.date ? shift.date.split('T')[0] : '';
        document.getElementById('shift-type').value = shift.shift_type;
        document.getElementById('shift-start-time').value = shift.start_time || '';
        document.getElementById('shift-end-time').value = shift.end_time || '';
        document.getElementById('shift-notes').value = shift.notes || '';
        currentEditingShiftId = shift.id;
    } else {
        title.textContent = 'シフト追加';
        form.reset();
        currentEditingShiftId = null;
    }
    
    modal.classList.add('active');
}

function closeShiftModal() {
    document.getElementById('shift-modal').classList.remove('active');
    document.getElementById('shift-form').reset();
    currentEditingShiftId = null;
}

function saveShift() {
    const data = {
        staff_name: document.getElementById('shift-staff-name').value,
        date: new Date(document.getElementById('shift-date').value).toISOString(),
        shift_type: document.getElementById('shift-type').value,
        start_time: document.getElementById('shift-start-time').value,
        end_time: document.getElementById('shift-end-time').value,
        notes: document.getElementById('shift-notes').value
    };
    
    try {
        if (currentEditingShiftId) {
            DataStorage.update('shifts', currentEditingShiftId, data);
        } else {
            DataStorage.create('shifts', data);
        }
        
        closeShiftModal();
        loadShifts();
        updateDashboard();
        showToast('シフトを保存しました', 'success');
    } catch (error) {
        console.error('シフトの保存に失敗しました:', error);
        showToast('保存に失敗しました。もう一度お試しください。', 'error');
    }
}

function editShift(id) {
    const shift = DataStorage.getById('shifts', id);
    if (shift) {
        openShiftModal(shift);
    } else {
        console.error('シフトが見つかりません:', id);
    }
}

async function deleteShift(id) {
    const confirmed = await showConfirmDialog('シフトの削除', 'このシフトを削除してもよろしいですか？\nこの操作は取り消せません。');
    if (!confirmed) return;
    
    try {
        DataStorage.delete('shifts', id);
        loadShifts();
        updateDashboard();
        showToast('シフトを削除しました', 'success');
    } catch (error) {
        console.error('シフトの削除に失敗しました:', error);
        showToast('削除に失敗しました。もう一度お試しください。', 'error');
    }
}

// 勤務時間帯プリセット設定
function setShiftType(type) {
    document.getElementById('shift-type').value = type;
}

// ========== 薬剤情報検索機能 ==========

function initMedicineSection() {
    // 薬剤編集モーダルのフォーム送信ハンドラー
    const medicineForm = document.getElementById('medicine-form');
    if (medicineForm) {
        medicineForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveMedicine();
        });
    }
}

function loadMedicines() {
    try {
        window.medicinesData = DataStorage.getAll('medicines');
    } catch (error) {
        console.error('薬剤情報の読み込みに失敗しました:', error);
        window.medicinesData = window.medicinesData || [];
    }
    // 成功・失敗に関わらずリストを更新
    if (typeof window.renderMedicineList === 'function') {
        window.renderMedicineList();
    }
}

// displayFavoriteMedicines と displayMedicines は新UIでは medicine-panel.js の renderMedicineList に統合済み

function openMedicineModal(medicine = null) {
    const modal = document.getElementById('medicine-modal');
    const form = document.getElementById('medicine-form');
    const title = document.getElementById('medicine-modal-title');
    
    if (medicine) {
        title.textContent = '薬剤情報編集';
        document.getElementById('medicine-id').value = medicine.id;
        document.getElementById('medicine-name').value = medicine.name;
        document.getElementById('medicine-generic-name').value = medicine.generic_name || '';
        document.getElementById('medicine-category-input').value = medicine.category;
        document.getElementById('medicine-sales-status').value = medicine.sales_status || 'その他';
        document.getElementById('medicine-discontinuation-date').value = medicine.discontinuation_date || '';
        document.getElementById('medicine-alternative').value = medicine.alternative_medicine || '';
        document.getElementById('medicine-supply-info').value = medicine.supply_info || '';
        document.getElementById('medicine-notes').value = medicine.notes || '';
        document.getElementById('medicine-is-favorite').checked = medicine.is_favorite || false;
        currentEditingMedicineId = medicine.id;
    } else {
        title.textContent = '薬剤情報登録';
        form.reset();
        currentEditingMedicineId = null;
    }
    
    modal.classList.add('active');
}

function closeMedicineModal() {
    document.getElementById('medicine-modal').classList.remove('active');
    document.getElementById('medicine-form').reset();
    currentEditingMedicineId = null;
}

function saveMedicine() {
    const data = {
        name: document.getElementById('medicine-name').value,
        generic_name: document.getElementById('medicine-generic-name').value,
        category: document.getElementById('medicine-category-input').value,
        sales_status: document.getElementById('medicine-sales-status').value,
        discontinuation_date: document.getElementById('medicine-discontinuation-date').value,
        alternative_medicine: document.getElementById('medicine-alternative').value,
        supply_info: document.getElementById('medicine-supply-info').value,
        notes: document.getElementById('medicine-notes').value,
        is_favorite: document.getElementById('medicine-is-favorite').checked
    };
    
    try {
        if (currentEditingMedicineId) {
            DataStorage.update('medicines', currentEditingMedicineId, data);
        } else {
            DataStorage.create('medicines', data);
        }
        
        closeMedicineModal();
        loadMedicines();
        updateDashboard();
        showToast('薬剤情報を保存しました', 'success');
    } catch (error) {
        console.error('薬剤情報の保存に失敗しました:', error);
        showToast('保存に失敗しました。もう一度お試しください。', 'error');
    }
}

function showMedicineDetail(id) {
    const medicine = DataStorage.getById('medicines', id);
    if (!medicine) {
        console.error('薬剤情報が見つかりません:', id);
        return;
    }
    
    document.getElementById('medicine-detail-name').textContent = medicine.name;
    document.getElementById('medicine-detail-generic-name').textContent = medicine.generic_name || '-';
    document.getElementById('medicine-detail-category').textContent = medicine.category;
    
    // 販売状態の表示
    const statusBadge = document.getElementById('medicine-detail-sales-status');
    const statusClass = medicine.sales_status === '販売中止' ? 'badge-priority-緊急' : 
                       medicine.sales_status === '出荷調整中' ? 'badge-priority-重要' : 
                       medicine.sales_status === '新規採用' ? 'badge-priority-通常' : 
                       'badge-category';
    statusBadge.className = `badge ${statusClass}`;
    statusBadge.textContent = medicine.sales_status || 'その他';
    
    // 販売中止日の表示
    const discontinuationRow = document.getElementById('medicine-detail-discontinuation-row');
    if (medicine.discontinuation_date) {
        document.getElementById('medicine-detail-discontinuation-date').textContent = medicine.discontinuation_date;
        discontinuationRow.style.display = 'grid';
    } else {
        discontinuationRow.style.display = 'none';
    }
    
    // 代替薬品の表示
    const alternativeRow = document.getElementById('medicine-detail-alternative-row');
    if (medicine.alternative_medicine) {
        document.getElementById('medicine-detail-alternative').textContent = medicine.alternative_medicine;
        alternativeRow.style.display = 'grid';
    } else {
        alternativeRow.style.display = 'none';
    }
    
    // 出荷調整情報の表示
    const supplySection = document.getElementById('medicine-detail-supply-section');
    if (medicine.supply_info) {
        document.getElementById('medicine-detail-supply-info').textContent = medicine.supply_info;
        supplySection.style.display = 'block';
    } else {
        supplySection.style.display = 'none';
    }
    
    // 備考の表示
    const notesSection = document.getElementById('medicine-detail-notes-section');
    if (medicine.notes) {
        document.getElementById('medicine-detail-notes').textContent = medicine.notes;
        notesSection.style.display = 'block';
    } else {
        notesSection.style.display = 'none';
    }
    
    currentMedicineDetailId = id;
    document.getElementById('medicine-detail-modal').classList.add('active');
}

function closeMedicineDetailModal() {
    document.getElementById('medicine-detail-modal').classList.remove('active');
    currentMedicineDetailId = null;
}

function editMedicineFromDetail() {
    const medicine = DataStorage.getById('medicines', currentMedicineDetailId);
    closeMedicineDetailModal();
    if (medicine) {
        openMedicineModal(medicine);
    }
}

function editMedicineById(id) {
    const medicine = DataStorage.getById('medicines', id);
    if (medicine) {
        openMedicineModal(medicine);
    } else {
        console.error('薬剤情報が見つかりません:', id);
    }
}

// deleteMedicine は medicine-panel.js の window.deleteMedicine に統合済み

// ========== 従業員管理機能 ==========

function initEmployeeSection() {
    // 従業員登録ボタン
    document.getElementById('add-employee-btn').addEventListener('click', () => {
        openEmployeeModal();
    });
    
    // フォーム送信
    document.getElementById('employee-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveEmployee();
    });
}

// 在籍/全てフィルター
window.setEmployeeFilter = function(filter) {
    currentEmployeeFilter = filter;
    document.getElementById('btnEmployeeActive').classList.toggle('active', filter === 'active');
    document.getElementById('btnEmployeeAll').classList.toggle('active', filter === 'all');
    renderEmployeeList();
};

function loadEmployees() {
    try {
        let employees = DataStorage.getAll('employees');
        employees.sort((a, b) => (a.furigana || '').localeCompare(b.furigana || '', 'ja'));
        employeesList = employees;
        renderEmployeeList();
    } catch (error) {
        console.error('従業員情報の読み込みに失敗しました:', error);
        employeesList = [];
        renderEmployeeList();
    }
}

window.renderEmployeeList = function() {
    const searchQuery = (document.getElementById('employee-search-input').value || '').toLowerCase();
    const positionFilter = document.getElementById('employee-position-filter').value;
    
    let filtered = [...employeesList];
    
    // 在籍/全てフィルター
    if (currentEmployeeFilter === 'active') {
        filtered = filtered.filter(e => e.status === '在籍');
    }
    
    // 役職フィルター
    if (positionFilter) {
        filtered = filtered.filter(e => e.position === positionFilter);
    }
    
    // 検索フィルター
    if (searchQuery) {
        filtered = filtered.filter(e => 
            (e.name || '').toLowerCase().includes(searchQuery) ||
            (e.furigana || '').toLowerCase().includes(searchQuery)
        );
    }
    
    // サマリー更新
    updateEmployeeSummary(filtered.length, employeesList.length);
    
    // テーブル描画
    displayEmployeeTable(filtered);
};

function updateEmployeeSummary(displayed, total) {
    const container = document.getElementById('employee-summary');
    const activeCount = employeesList.filter(e => e.status === '在籍').length;
    const leaveCount = employeesList.filter(e => e.status === '休職').length;
    const retiredCount = employeesList.filter(e => e.status === '退職').length;
    
    container.innerHTML = `
        <div class="summary-item">
            <span>全 <span class="summary-count">${total}</span> 名中</span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-item">
            <span>在籍: <span class="summary-count">${activeCount}</span></span>
        </div>
        ${leaveCount > 0 ? `
        <div class="summary-divider"></div>
        <div class="summary-item">
            <span>休職: <span class="summary-count">${leaveCount}</span></span>
        </div>` : ''}
        ${retiredCount > 0 ? `
        <div class="summary-divider"></div>
        <div class="summary-item">
            <span>退職: <span class="summary-count">${retiredCount}</span></span>
        </div>` : ''}
        <div class="summary-divider"></div>
        <div class="summary-item">
            <span>表示: <span class="summary-count">${displayed}</span> 名</span>
        </div>
    `;
}

function displayEmployeeTable(employees) {
    const container = document.getElementById('employeeListBody');
    
    if (employees.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <i class="fas fa-users"></i>
                <p>従業員が見つかりません</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = employees.map(emp => {
        const statusClass = emp.status === '在籍' ? 'emp-status-active' : 
                           emp.status === '休職' ? 'emp-status-leave' : 
                           'emp-status-retired';
        const rowClass = emp.status === '休職' ? 'is-leave' : 
                        emp.status === '退職' ? 'is-retired' : '';
        
        const phoneIcon = emp.phone ? 
            `<a href="tel:${escapeHtml(emp.phone)}" class="contact-icon" title="${escapeHtml(emp.phone)}"><i class="fas fa-phone"></i></a>` :
            `<span class="contact-icon disabled"><i class="fas fa-phone"></i></span>`;
        const emailIcon = emp.email ? 
            `<a href="mailto:${escapeHtml(emp.email)}" class="contact-icon" title="${escapeHtml(emp.email)}"><i class="fas fa-envelope"></i></a>` :
            `<span class="contact-icon disabled"><i class="fas fa-envelope"></i></span>`;
        
        return `
            <div class="list-row employee-grid-layout ${rowClass}">
                <div class="col-employee-name">
                    <div>${escapeHtml(emp.name)}</div>
                    <div class="employee-furigana">${escapeHtml(emp.furigana || '')}</div>
                </div>
                <div>${escapeHtml(emp.position)}</div>
                <div>${escapeHtml(emp.employment_type)}</div>
                <div><span class="emp-status ${statusClass}">${emp.status}</span></div>
                <div class="contact-icons">${phoneIcon}${emailIcon}</div>
                <div>${escapeHtml(emp.hire_date || '—')}</div>
                <div class="action-cell">
                    <button class="icon-btn" onclick="viewEmployeeDetail('${emp.id}')" title="詳細">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="icon-btn btn-edit" onclick="editEmployee('${emp.id}')" title="編集">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="icon-btn btn-delete" onclick="deleteEmployee('${emp.id}')" title="削除">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function openEmployeeModal(employee = null) {
    const modal = document.getElementById('employee-modal');
    const form = document.getElementById('employee-form');
    const title = document.getElementById('employee-modal-title');
    
    if (employee) {
        title.textContent = '従業員情報編集';
        document.getElementById('employee-id').value = employee.id;
        document.getElementById('employee-name').value = employee.name;
        document.getElementById('employee-furigana').value = employee.furigana;
        document.getElementById('employee-position').value = employee.position;
        document.getElementById('employee-employment-type').value = employee.employment_type;
        document.getElementById('employee-phone').value = employee.phone || '';
        document.getElementById('employee-email').value = employee.email || '';
        document.getElementById('employee-hire-date').value = employee.hire_date || '';
        document.getElementById('employee-qualifications').value = employee.qualifications || '';
        document.getElementById('employee-status').value = employee.status;
        document.getElementById('employee-notes').value = employee.notes || '';
        currentEditingEmployeeId = employee.id;
    } else {
        title.textContent = '従業員登録';
        form.reset();
        document.getElementById('employee-status').value = '在籍';
        currentEditingEmployeeId = null;
    }
    
    modal.classList.add('active');
}

function closeEmployeeModal() {
    document.getElementById('employee-modal').classList.remove('active');
    document.getElementById('employee-form').reset();
    currentEditingEmployeeId = null;
}

function saveEmployee() {
    const data = {
        name: document.getElementById('employee-name').value,
        furigana: document.getElementById('employee-furigana').value,
        position: document.getElementById('employee-position').value,
        employment_type: document.getElementById('employee-employment-type').value,
        phone: document.getElementById('employee-phone').value,
        email: document.getElementById('employee-email').value,
        hire_date: document.getElementById('employee-hire-date').value,
        qualifications: document.getElementById('employee-qualifications').value,
        status: document.getElementById('employee-status').value,
        notes: document.getElementById('employee-notes').value
    };
    
    try {
        if (currentEditingEmployeeId) {
            DataStorage.update('employees', currentEditingEmployeeId, data);
        } else {
            DataStorage.create('employees', data);
        }
        
        closeEmployeeModal();
        loadEmployees();
        updateDashboard();
        showToast('従業員情報を保存しました', 'success');
    } catch (error) {
        console.error('従業員情報の保存に失敗しました:', error);
        showToast('保存に失敗しました。もう一度お試しください。', 'error');
    }
}

function editEmployee(id) {
    const employee = DataStorage.getById('employees', id);
    if (employee) {
        openEmployeeModal(employee);
    } else {
        console.error('従業員情報が見つかりません:', id);
    }
}

async function deleteEmployee(id) {
    const confirmed = await showConfirmDialog('従業員情報の削除', 'この従業員情報を削除してもよろしいですか？\nこの操作は取り消せません。');
    if (!confirmed) return;
    
    try {
        DataStorage.delete('employees', id);
        loadEmployees();
        updateDashboard();
        showToast('従業員情報を削除しました', 'success');
    } catch (error) {
        console.error('従業員情報の削除に失敗しました:', error);
        showToast('削除に失敗しました。もう一度お試しください。', 'error');
    }
}

// 従業員詳細モーダル
window.viewEmployeeDetail = function(id) {
    const emp = DataStorage.getById('employees', id);
    if (!emp) return;
    
    document.getElementById('emp-detail-name').textContent = emp.name;
    document.getElementById('emp-detail-furigana').textContent = emp.furigana || '—';
    document.getElementById('emp-detail-position').textContent = emp.position;
    document.getElementById('emp-detail-employment-type').textContent = emp.employment_type;
    document.getElementById('emp-detail-status').textContent = emp.status;
    document.getElementById('emp-detail-hire-date').textContent = emp.hire_date || '—';
    document.getElementById('emp-detail-phone').textContent = emp.phone || '—';
    document.getElementById('emp-detail-email').textContent = emp.email || '—';
    
    // 資格情報
    const qualSection = document.getElementById('emp-detail-qualifications-section');
    if (emp.qualifications) {
        qualSection.style.display = 'block';
        document.getElementById('emp-detail-qualifications').textContent = emp.qualifications;
    } else {
        qualSection.style.display = 'none';
    }
    
    // 備考
    const notesSection = document.getElementById('emp-detail-notes-section');
    if (emp.notes) {
        notesSection.style.display = 'block';
        document.getElementById('emp-detail-notes').textContent = emp.notes;
    } else {
        notesSection.style.display = 'none';
    }
    
    // 今月のシフトを取得
    const shiftsSection = document.getElementById('emp-detail-shifts-section');
    const shiftsContainer = document.getElementById('emp-detail-shifts');
    try {
        const allShifts = DataStorage.getAll('shifts');
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();
        
        const empShifts = allShifts.filter(s => {
            if (s.staff_name !== emp.name) return false;
            const d = new Date(s.date);
            return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
        }).sort((a, b) => new Date(a.date) - new Date(b.date));
        
        if (empShifts.length > 0) {
            shiftsSection.style.display = 'block';
            shiftsContainer.innerHTML = `<div class="emp-shift-list">${empShifts.map(s => {
                const d = new Date(s.date);
                const dayStr = (d.getMonth() + 1) + '/' + d.getDate();
                return `<span class="emp-shift-tag"><span class="shift-date">${dayStr}</span> ${escapeHtml(s.shift_type)} ${escapeHtml(s.start_time || '')}-${escapeHtml(s.end_time || '')}</span>`;
            }).join('')}</div>`;
        } else {
            shiftsSection.style.display = 'block';
            shiftsContainer.innerHTML = '<p style="color: var(--text-tertiary); font-size: var(--font-size-sm);">今月のシフトは登録されていません</p>';
        }
    } catch (e) {
        shiftsSection.style.display = 'none';
    }
    
    // 編集ボタン
    document.getElementById('emp-detail-edit-btn').onclick = () => {
        closeEmployeeDetailModal();
        editEmployee(id);
    };
    
    document.getElementById('employee-detail-modal').classList.add('active');
};

window.closeEmployeeDetailModal = function() {
    document.getElementById('employee-detail-modal').classList.remove('active');
};

// ========== ユーティリティ関数 ==========

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
}

function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return escapeHtml(text);
    return escapeHtml(text.substring(0, maxLength)) + '...';
}

// モーダルの背景クリックで閉じる
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// ==========================================
// AIチャット機能
// ==========================================

let chatHistory = [];

// グローバルスコープで定義（HTMLから呼び出せるように）
window.openAPIKeyModal = function() {
    const apiKey = localStorage.getItem('gemini_api_key') || '';
    const newApiKey = prompt(
        'Gemini APIキーを入力してください：\n\n' +
        '1. https://aistudio.google.com/app/apikey にアクセス\n' +
        '2. 「Create API key」をクリック\n' +
        '3. 生成されたAPIキーをコピーして貼り付け\n\n' +
        '※APIキーはブラウザのローカルストレージに保存されます',
        apiKey
    );
    
    if (newApiKey) {
        localStorage.setItem('gemini_api_key', newApiKey.trim());
        showToast('APIキーが保存されました', 'success');
        
        // 設定ボタンを削除
        const setupButton = document.querySelector('.welcome-message .btn-primary');
        if (setupButton && setupButton.textContent.includes('APIキー')) {
            setupButton.remove();
        }
        
        // API設定状態を表示
        updateAPIKeyStatus();
    }
};

function updateAPIKeyStatus() {
    const apiKey = localStorage.getItem('gemini_api_key');
    const apiKeyBtn = document.getElementById('api-key-btn');
    
    if (apiKeyBtn) {
        if (apiKey) {
            apiKeyBtn.innerHTML = '<i class="fas fa-key"></i> APIキー設定済み';
            apiKeyBtn.style.background = 'linear-gradient(135deg, var(--color-accent) 0%, #00b085 100%)';
            apiKeyBtn.style.color = 'white';
            apiKeyBtn.style.borderColor = 'var(--color-accent)';
        } else {
            apiKeyBtn.innerHTML = '<i class="fas fa-key"></i> APIキー設定';
        }
    }
}

function initAIChatSection() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-chat-btn');
    const clearBtn = document.getElementById('clear-chat-btn');
    
    // APIキーの確認と設定
    checkAndPromptForAPIKey();
    updateAPIKeyStatus();
    
    // 入力フィールドの監視
    chatInput.addEventListener('input', () => {
        sendBtn.disabled = !chatInput.value.trim();
        autoResizeTextarea(chatInput);
    });
    
    // Enterキーで送信（Shift+Enterで改行）
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) {
                sendMessage();
            }
        }
    });
    
    // 送信ボタン
    sendBtn.addEventListener('click', sendMessage);
    
    // 履歴クリアボタン
    clearBtn.addEventListener('click', clearChatHistory);
    
    // クイックアクションボタン
    document.querySelectorAll('.quick-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const message = btn.dataset.message;
            chatInput.value = message;
            sendBtn.disabled = false;
            sendMessage();
        });
    });
}

function checkAndPromptForAPIKey() {
    const apiKey = localStorage.getItem('gemini_api_key');
    
    if (!apiKey) {
        setTimeout(() => {
            const welcomeMessage = document.querySelector('.welcome-message');
            if (welcomeMessage) {
                const messageContent = welcomeMessage.querySelector('.message-content');
                
                if (!messageContent.querySelector('.setup-api-key-btn')) {
                    const setupButton = document.createElement('button');
                    setupButton.className = 'btn btn-primary setup-api-key-btn';
                    setupButton.style.marginTop = '1rem';
                    setupButton.innerHTML = '<i class="fas fa-key"></i> Gemini APIキーを今すぐ設定';
                    setupButton.onclick = window.openAPIKeyModal;
                    messageContent.appendChild(setupButton);
                }
            }
        }, 100);
    }
}

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

async function sendMessage() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-chat-btn');
    const message = chatInput.value.trim();
    
    if (!message) return;
    
    // ユーザーメッセージを表示
    addMessageToChat('user', message);
    chatHistory.push({ role: 'user', content: message });
    
    // 入力をクリア
    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendBtn.disabled = true;
    
    // タイピングインジケーター表示
    showTypingIndicator();
    
    try {
        // AIレスポンスを取得
        const response = await getAIResponse(message);
        
        // タイピングインジケーターを削除
        removeTypingIndicator();
        
        // AIレスポンスを表示
        addMessageToChat('ai', response);
        chatHistory.push({ role: 'assistant', content: response });
        
    } catch (error) {
        console.error('AI応答エラー:', error);
        removeTypingIndicator();
        addMessageToChat('ai', '申し訳ございません。エラーが発生しました。もう一度お試しください。');
    }
}

async function getAIResponse(userMessage) {
    // 薬局データのコンテキストを構築
    const context = buildContextFromData(userMessage);
    
    // Gemini APIを使用してAI応答を生成
    try {
        return await callGeminiAPI(userMessage, context);
    } catch (error) {
        console.error('Gemini API呼び出しエラー:', error);
        // フォールバック: デモ応答を使用
        return generateDemoResponse(userMessage, context);
    }
}

async function callGeminiAPI(userMessage, context) {
    // Gemini APIキーの確認（ローカルストレージから取得）
    const apiKey = localStorage.getItem('gemini_api_key');
    
    if (!apiKey) {
        throw new Error('Gemini APIキーが設定されていません。');
    }
    
    // コンテキスト情報を整形
    const contextInfo = buildContextString(context);
    
    // システムプロンプト
    const systemPrompt = `あなたは緑ヶ丘調剤薬局の業務アシスタントAIです。
薬局スタッフの質問に対して、データベースの情報を基に正確で役立つ回答を提供してください。

【利用可能なデータ】
${contextInfo}

【回答のガイドライン】
1. 簡潔で分かりやすく回答してください
2. データベースに基づいた正確な情報を提供してください
3. 必要に応じて箇条書きや表形式を使用してください
4. 医薬品に関する専門的な質問には慎重に回答してください
5. データがない場合は正直にその旨を伝えてください`;

    // Gemini API呼び出し
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: systemPrompt },
                        { text: `\n\nユーザーの質問: ${userMessage}` }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1024,
                topP: 0.8,
                topK: 40
            }
        })
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Gemini API Error: ${errorData.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    // レスポンスからテキストを抽出
    if (data.candidates && data.candidates.length > 0) {
        const candidate = data.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
            return candidate.content.parts[0].text;
        }
    }
    
    throw new Error('Gemini APIから有効な応答が得られませんでした。');
}

function buildContextString(context) {
    let contextStr = '';
    
    // 薬剤情報
    if (context.medicines.length > 0) {
        contextStr += '\n【薬剤情報】\n';
        context.medicines.forEach(med => {
            contextStr += `- ${med.name}`;
            if (med.generic_name) contextStr += ` (${med.generic_name})`;
            contextStr += ` - ${med.category} - ${med.sales_status}`;
            if (med.alternative_medicine) contextStr += ` [代替: ${med.alternative_medicine}]`;
            contextStr += '\n';
        });
    }
    
    // シフト情報
    if (context.shifts.length > 0) {
        contextStr += '\n【シフト情報】\n';
        const shiftsByStaff = {};
        context.shifts.forEach(shift => {
            if (!shiftsByStaff[shift.staff_name]) {
                shiftsByStaff[shift.staff_name] = [];
            }
            shiftsByStaff[shift.staff_name].push(shift);
        });
        
        Object.entries(shiftsByStaff).forEach(([staff, shifts]) => {
            contextStr += `- ${staff}: ${shifts.length}件のシフト\n`;
        });
    }
    
    // お知らせ情報
    if (context.announcements.length > 0) {
        contextStr += '\n【最近のお知らせ】\n';
        context.announcements.slice(0, 5).forEach(ann => {
            contextStr += `- [${ann.priority}] ${ann.title}\n`;
        });
    }
    
    // 従業員情報
    if (context.employees.length > 0) {
        contextStr += '\n【従業員情報】\n';
        const activeEmployees = context.employees.filter(e => e.status === '在籍');
        contextStr += `- 在籍スタッフ: ${activeEmployees.length}名\n`;
        
        const positions = {};
        activeEmployees.forEach(emp => {
            positions[emp.position] = (positions[emp.position] || 0) + 1;
        });
        
        Object.entries(positions).forEach(([position, count]) => {
            contextStr += `  - ${position}: ${count}名\n`;
        });
    }
    
    if (contextStr === '') {
        contextStr = '現在、関連するデータは見つかりませんでした。';
    }
    
    return contextStr;
}

function buildContextFromData(userMessage) {
    // localStorageから直接データを取得（非同期fetch不要）
    return {
        medicines: DataStorage.getAll('medicines'),
        shifts: DataStorage.getAll('shifts'),
        announcements: DataStorage.getAll('announcements'),
        employees: DataStorage.getAll('employees')
    };
}

function generateDemoResponse(userMessage, context) {
    // 販売中止薬剤の質問
    if (userMessage.includes('販売中止')) {
        const discontinued = context.medicines.filter(m => m.sales_status === '販売中止');
        if (discontinued.length > 0) {
            let response = `販売中止となっている薬剤は以下の${discontinued.length}件です：\n\n`;
            discontinued.forEach(med => {
                response += `• **${med.name}**\n`;
                if (med.discontinuation_date) response += `  - 販売中止日: ${med.discontinuation_date}\n`;
                if (med.alternative_medicine) response += `  - 代替薬品: ${med.alternative_medicine}\n`;
                response += '\n';
            });
            return response;
        }
        return '現在、販売中止となっている薬剤はありません。';
    }
    
    // 出荷調整の質問
    if (userMessage.includes('出荷調整')) {
        const supplyIssues = context.medicines.filter(m => m.sales_status === '出荷調整中');
        if (supplyIssues.length > 0) {
            let response = `出荷調整中の薬剤は以下の${supplyIssues.length}件です：\n\n`;
            supplyIssues.forEach(med => {
                response += `• **${med.name}**\n`;
                if (med.supply_info) response += `  ${med.supply_info}\n`;
                response += '\n';
            });
            return response;
        }
        return '現在、出荷調整中の薬剤はありません。';
    }
    
    // よく使う薬剤の質問
    if (userMessage.includes('よく使う')) {
        const favorites = context.medicines.filter(m => m.is_favorite);
        if (favorites.length > 0) {
            let response = `よく使う薬剤として登録されているのは以下の${favorites.length}件です：\n\n`;
            favorites.forEach(med => {
                response += `• ${med.name}`;
                if (med.generic_name) response += ` (${med.generic_name})`;
                response += ` - ${med.category}\n`;
            });
            return response;
        }
        return 'よく使う薬剤はまだ登録されていません。';
    }
    
    // シフトの質問
    if (userMessage.includes('シフト') || userMessage.includes('勤務')) {
        const today = new Date();
        const currentMonthShifts = context.shifts.filter(shift => {
            const shiftDate = new Date(shift.date);
            return shiftDate.getMonth() === today.getMonth() && 
                   shiftDate.getFullYear() === today.getFullYear();
        });
        
        if (currentMonthShifts.length > 0) {
            return `今月は${currentMonthShifts.length}件のシフトが登録されています。詳細はシフト管理ページでご確認いただけます。`;
        }
        return '今月のシフトはまだ登録されていません。';
    }
    
    // お知らせの質問
    if (userMessage.includes('お知らせ')) {
        const recentAnnouncements = context.announcements.slice(0, 3);
        if (recentAnnouncements.length > 0) {
            let response = '最近のお知らせ：\n\n';
            recentAnnouncements.forEach(ann => {
                response += `• **${ann.title}**\n`;
                response += `  ${ann.content.substring(0, 50)}...\n\n`;
            });
            return response;
        }
        return 'お知らせはまだ投稿されていません。';
    }
    
    // 従業員の質問
    if (userMessage.includes('従業員') || userMessage.includes('スタッフ')) {
        const activeEmployees = context.employees.filter(e => e.status === '在籍');
        if (activeEmployees.length > 0) {
            return `現在、${activeEmployees.length}名のスタッフが在籍しています。役職別の内訳は従業員管理ページでご確認いただけます。`;
        }
        return '従業員情報が登録されていません。';
    }
    
    // デフォルト応答
    return `ご質問ありがとうございます。以下のような質問にお答えできます：\n\n• 販売中止になった薬剤について\n• 出荷調整中の薬剤について\n• よく使う薬剤の一覧\n• 今月のシフト情報\n• 最近のお知らせ\n• 従業員情報\n\nお気軽にお尋ねください。`;
}

function addMessageToChat(role, content) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}-message`;
    
    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${role}`;
    avatar.innerHTML = role === 'ai' ? '<i class="fas fa-robot"></i>' : '<i class="fas fa-user"></i>';
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    // マークダウン風の簡易フォーマット
    const formattedContent = content
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
    
    bubble.innerHTML = formattedContent;
    
    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    bubble.appendChild(time);
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);
    chatMessages.appendChild(messageDiv);
    
    // スクロールを最下部へ
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTypingIndicator() {
    const chatMessages = document.getElementById('chat-messages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.id = 'typing-indicator';
    
    typingDiv.innerHTML = `
        <div class="message-avatar ai">
            <i class="fas fa-robot"></i>
        </div>
        <div class="message-bubble">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
    `;
    
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

async function clearChatHistory() {
    const confirmed = await showConfirmDialog('チャット履歴の削除', 'チャット履歴を全て削除しますか？', '削除する');
    if (!confirmed) return;
    
    const chatMessages = document.getElementById('chat-messages');
    // ウェルカムメッセージ以外を削除
    const messages = chatMessages.querySelectorAll('.chat-message, .typing-indicator');
    messages.forEach(msg => msg.remove());
    
    chatHistory = [];
    
    // 入力フィールドをクリア
    const chatInput = document.getElementById('chat-input');
    chatInput.value = '';
    chatInput.style.height = 'auto';
    document.getElementById('send-chat-btn').disabled = true;
    
    showToast('チャット履歴を削除しました', 'success');
}

// 薬剤情報管理機能は medicine-panel.js に実装されています
