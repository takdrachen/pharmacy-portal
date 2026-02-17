// ダッシュボードカスタマイズ機能

const DASHBOARD_WIDGETS = {
    'today-shifts': { name: '今日のシフト', icon: 'fas fa-calendar-day', defaultColumn: 'left', defaultOrder: 0 },
    'recent-medicines': { name: 'お気に入り薬剤', icon: 'fas fa-star', defaultColumn: 'left', defaultOrder: 1 },
    'recent-announcements': { name: '最新のお知らせ', icon: 'fas fa-bullhorn', defaultColumn: 'right', defaultOrder: 0 },
    'quick-access': { name: 'クイックアクセス', icon: 'fas fa-bolt', defaultColumn: 'right', defaultOrder: 1 }
};

const STORAGE_KEY = 'dashboard_layout';

// レイアウト設定の読み込み
function getDashboardLayout() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch (e) {
        console.error('レイアウト設定の読み込みに失敗:', e);
    }
    return getDefaultLayout();
}

// デフォルトレイアウト
function getDefaultLayout() {
    return {
        left: [
            { id: 'today-shifts', visible: true },
            { id: 'recent-medicines', visible: true }
        ],
        right: [
            { id: 'recent-announcements', visible: true },
            { id: 'quick-access', visible: true }
        ]
    };
}

// レイアウト設定の保存
function saveDashboardLayout(layout) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch (e) {
        console.error('レイアウト設定の保存に失敗:', e);
    }
}

// カスタマイズパネルの表示/非表示
window.toggleDashboardCustomize = function() {
    const panel = document.getElementById('dashboardCustomizePanel');
    const btn = document.getElementById('dashboardCustomizeBtn');
    const isVisible = panel.style.display !== 'none';
    
    if (isVisible) {
        panel.style.display = 'none';
        btn.classList.remove('active');
        // ドラッグハンドルを非表示
        document.querySelectorAll('.drag-handle').forEach(h => h.style.display = 'none');
    } else {
        panel.style.display = '';
        btn.classList.add('active');
        renderCustomizePanel();
        // ドラッグハンドルを表示
        document.querySelectorAll('.drag-handle').forEach(h => h.style.display = '');
    }
};

// カスタマイズパネルのレンダリング
function renderCustomizePanel() {
    const layout = getDashboardLayout();
    const listEl = document.getElementById('customizeWidgetList');
    
    // 全ウィジェットのリストを作成（左→右の順）
    const allWidgets = [];
    ['left', 'right'].forEach(col => {
        layout[col].forEach(w => {
            allWidgets.push({ ...w, column: col });
        });
    });
    
    listEl.innerHTML = `
        <div class="customize-columns">
            <div class="customize-column">
                <div class="customize-column-title">左カラム</div>
                <div class="customize-drop-zone" id="customizeLeft" data-column="left">
                    ${layout.left.map(w => renderWidgetItem(w)).join('')}
                </div>
            </div>
            <div class="customize-column">
                <div class="customize-column-title">右カラム</div>
                <div class="customize-drop-zone" id="customizeRight" data-column="right">
                    ${layout.right.map(w => renderWidgetItem(w)).join('')}
                </div>
            </div>
        </div>
    `;
    
    // ドラッグ&ドロップのイベント設定
    initCustomizeDragDrop();
}

function renderWidgetItem(widget) {
    const info = DASHBOARD_WIDGETS[widget.id];
    if (!info) return '';
    return `
        <div class="customize-widget-item ${widget.visible ? '' : 'is-hidden'}" 
             data-widget-id="${widget.id}" draggable="true">
            <span class="customize-drag-handle"><i class="fas fa-grip-vertical"></i></span>
            <i class="${info.icon} customize-widget-icon"></i>
            <span class="customize-widget-name">${info.name}</span>
            <label class="customize-toggle">
                <input type="checkbox" ${widget.visible ? 'checked' : ''} 
                       onchange="toggleWidgetVisibility('${widget.id}', this.checked)">
                <span class="toggle-slider"></span>
            </label>
        </div>
    `;
}

// ウィジェットの表示/非表示切替
window.toggleWidgetVisibility = function(widgetId, visible) {
    const layout = getDashboardLayout();
    
    ['left', 'right'].forEach(col => {
        layout[col].forEach(w => {
            if (w.id === widgetId) {
                w.visible = visible;
            }
        });
    });
    
    saveDashboardLayout(layout);
    applyDashboardLayout();
    
    // カスタマイズパネルのアイテムのクラスを更新
    const item = document.querySelector(`.customize-widget-item[data-widget-id="${widgetId}"]`);
    if (item) {
        item.classList.toggle('is-hidden', !visible);
    }
};

// カスタマイズパネル内のドラッグ&ドロップ
function initCustomizeDragDrop() {
    const dropZones = document.querySelectorAll('.customize-drop-zone');
    
    dropZones.forEach(zone => {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const afterElement = getDragAfterElement(zone, e.clientY);
            const dragging = document.querySelector('.customize-widget-item.dragging');
            if (dragging) {
                if (afterElement == null) {
                    zone.appendChild(dragging);
                } else {
                    zone.insertBefore(dragging, afterElement);
                }
            }
        });
        
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            saveLayoutFromCustomizePanel();
            applyDashboardLayout();
        });
    });
    
    const items = document.querySelectorAll('.customize-widget-item');
    items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            saveLayoutFromCustomizePanel();
            applyDashboardLayout();
        });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.customize-widget-item:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// カスタマイズパネルの状態からレイアウトを保存
function saveLayoutFromCustomizePanel() {
    const leftZone = document.getElementById('customizeLeft');
    const rightZone = document.getElementById('customizeRight');
    
    if (!leftZone || !rightZone) return;
    
    const layout = { left: [], right: [] };
    
    leftZone.querySelectorAll('.customize-widget-item').forEach(item => {
        const id = item.dataset.widgetId;
        const checkbox = item.querySelector('input[type="checkbox"]');
        layout.left.push({ id, visible: checkbox ? checkbox.checked : true });
    });
    
    rightZone.querySelectorAll('.customize-widget-item').forEach(item => {
        const id = item.dataset.widgetId;
        const checkbox = item.querySelector('input[type="checkbox"]');
        layout.right.push({ id, visible: checkbox ? checkbox.checked : true });
    });
    
    saveDashboardLayout(layout);
}

// レイアウトをDOMに適用
function applyDashboardLayout() {
    const layout = getDashboardLayout();
    const leftCol = document.getElementById('dashboardColLeft');
    const rightCol = document.getElementById('dashboardColRight');
    
    if (!leftCol || !rightCol) return;
    
    // 全ウィジェットカードを一時的に取得
    const allCards = {};
    document.querySelectorAll('.dashboard-card[data-widget-id]').forEach(card => {
        allCards[card.dataset.widgetId] = card;
    });
    
    // 左カラムを再構築
    layout.left.forEach(w => {
        const card = allCards[w.id];
        if (card) {
            card.style.display = w.visible ? '' : 'none';
            leftCol.appendChild(card);
        }
    });
    
    // 右カラムを再構築
    layout.right.forEach(w => {
        const card = allCards[w.id];
        if (card) {
            card.style.display = w.visible ? '' : 'none';
            rightCol.appendChild(card);
        }
    });
}

// デフォルトに戻す
window.resetDashboardLayout = function() {
    const defaultLayout = getDefaultLayout();
    saveDashboardLayout(defaultLayout);
    applyDashboardLayout();
    renderCustomizePanel();
    if (typeof showToast === 'function') {
        showToast('ダッシュボードをデフォルトに戻しました', 'success');
    }
};

// ダッシュボードカードのドラッグ&ドロップ（直接操作）
function initDashboardDragDrop() {
    const cards = document.querySelectorAll('.dashboard-card[data-widget-id]');
    const columns = document.querySelectorAll('.dashboard-column');
    
    cards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            // ドラッグハンドルが表示されている場合のみ
            if (card.querySelector('.drag-handle').style.display === 'none') {
                e.preventDefault();
                return;
            }
            card.classList.add('card-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.widgetId);
        });
        
        card.addEventListener('dragend', () => {
            card.classList.remove('card-dragging');
            document.querySelectorAll('.dashboard-column').forEach(col => {
                col.classList.remove('column-drag-over');
            });
            // レイアウトを保存
            saveLayoutFromDOM();
        });
    });
    
    columns.forEach(col => {
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            col.classList.add('column-drag-over');
            
            const afterElement = getDragAfterElementCard(col, e.clientY);
            const dragging = document.querySelector('.card-dragging');
            if (dragging) {
                if (afterElement == null) {
                    col.appendChild(dragging);
                } else {
                    col.insertBefore(dragging, afterElement);
                }
            }
        });
        
        col.addEventListener('dragleave', () => {
            col.classList.remove('column-drag-over');
        });
        
        col.addEventListener('drop', (e) => {
            e.preventDefault();
            col.classList.remove('column-drag-over');
            saveLayoutFromDOM();
            // カスタマイズパネルが開いていれば更新
            const panel = document.getElementById('dashboardCustomizePanel');
            if (panel && panel.style.display !== 'none') {
                renderCustomizePanel();
            }
        });
    });
}

function getDragAfterElementCard(container, y) {
    const draggableElements = [...container.querySelectorAll('.dashboard-card[data-widget-id]:not(.card-dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// DOMの状態からレイアウトを保存
function saveLayoutFromDOM() {
    const leftCol = document.getElementById('dashboardColLeft');
    const rightCol = document.getElementById('dashboardColRight');
    
    if (!leftCol || !rightCol) return;
    
    const layout = { left: [], right: [] };
    
    leftCol.querySelectorAll('.dashboard-card[data-widget-id]').forEach(card => {
        layout.left.push({
            id: card.dataset.widgetId,
            visible: card.style.display !== 'none'
        });
    });
    
    rightCol.querySelectorAll('.dashboard-card[data-widget-id]').forEach(card => {
        layout.right.push({
            id: card.dataset.widgetId,
            visible: card.style.display !== 'none'
        });
    });
    
    saveDashboardLayout(layout);
}

// 初期化
document.addEventListener('DOMContentLoaded', function() {
    // ドラッグハンドルを初期状態で非表示
    document.querySelectorAll('.drag-handle').forEach(h => h.style.display = 'none');
    
    // 保存されたレイアウトを適用
    applyDashboardLayout();
    
    // ドラッグ&ドロップの初期化
    initDashboardDragDrop();
});
