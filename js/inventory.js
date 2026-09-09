/**
 * 在庫表（ミザル停止時間帯用）
 *
 * ミザルの「採用品一覧設定CSV」を読み込み、ブラウザ内（localStorage）に保存して
 * 検索・絞り込みできるようにする単独ページ用スクリプト。
 * データは端末内にのみ保存され、外部へは送信しない。
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'inventory_csv_data_v1';
    const PREFS_KEY = 'inventory_prefs_v1';
    const LOCAL_CSV_PATH = 'data/MedAdoptlist.csv'; // 任意配置（Git管理外）。あれば初回に自動読込
    const STALE_DAYS = 7;            // データ取込からこの日数を超えたら警告
    const LOW_STOCK_THRESHOLD = 10;  // 「残りわずか」の判定値

    const VIEW_TITLES = { table: '在庫一覧', card: 'カード表示', shelf: '棚別表示' };

    // 単一ファイル版（デスクトップ用）では、ビルド時にCSVを埋め込む。
    // ポータル版では未定義になり、CSV読込かdata/MedAdoptlist.csvから読む。
    const EMBEDDED = (typeof window !== 'undefined' && window.INVENTORY_EMBEDDED) || null;

    // ========== 状態 ==========
    let items = [];       // 全品目
    let meta = null;      // { importedAt, fileName }
    let filtered = [];    // 絞り込み結果
    let viewMode = 'table';

    const state = {
        keyword: '',
        use: '',
        stock: '',
        ge: '',
        shelf: '',
        wholesaler: '',
        maker: '',
        attrs: [],
        flags: [],
        sort: 'name'
    };

    const $ = id => document.getElementById(id);

    // ========== 文字列ユーティリティ ==========

    /**
     * 検索用に文字列を正規化する。
     * 全角英数→半角、半角カナ→全角カナ（NFKC）、ひらがな→カタカナ、
     * 小文字化、空白・記号除去を行い、表記ゆれを吸収する。
     */
    function normalize(str) {
        if (!str) return '';
        let s = String(str).normalize('NFKC').toLowerCase();
        // ひらがな → カタカナ
        s = s.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
        // 空白・区切り記号を除去
        s = s.replace(/[\s　・･,，、.．\-ー－‐/／()（）「」【】]/g, '');
        return s;
    }

    /**
     * 正規化済みの検索対象に検索語が含まれるか判定する。
     * 「ムコダイン500」のように日本語と英数字が続けて入力された場合は、
     * 語を日本語部分と英数字部分に分け、その順序で出現するかどうかで判定する
     * （商品名が「ムコダイン錠５００ｍｇ」のように間に文字が入るため）。
     */
    function matchWord(haystack, word) {
        if (haystack.indexOf(word) !== -1) return true;
        // 日本語と英数字が混在する語のみ分割対象とする（棚番「C-6」等を誤って広げないため）
        if (!/[0-9a-z]/.test(word) || !/[^0-9a-z]/.test(word)) return false;
        const parts = word.match(/[0-9a-z]+|[^0-9a-z]+/g) || [];
        if (parts.length < 2) return false;
        let pos = 0;
        for (let i = 0; i < parts.length; i++) {
            const found = haystack.indexOf(parts[i], pos);
            if (found === -1) return false;
            pos = found + parts[i].length;
        }
        return true;
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toNumber(str) {
        if (str === null || str === undefined) return null;
        const s = String(str).normalize('NFKC').replace(/,/g, '').trim();
        if (s === '') return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }

    function formatNumber(n, digits) {
        if (n === null || n === undefined) return '—';
        return n.toLocaleString('ja-JP', {
            minimumFractionDigits: digits || 0,
            maximumFractionDigits: digits === undefined ? 0 : digits
        });
    }

    function formatDateTime(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '不明';
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function daysSince(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        return Math.floor((Date.now() - d.getTime()) / 86400000);
    }

    // ========== CSV解析 ==========

    /** RFC4180準拠のCSVパーサー（引用符・改行入りフィールドに対応） */
    function parseCsv(text) {
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM除去

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') { field += '"'; i++; }
                    else { inQuotes = false; }
                } else {
                    field += ch;
                }
                continue;
            }
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { row.push(field); field = ''; }
            else if (ch === '\r') { /* 次の\nで処理 */ }
            else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else { field += ch; }
        }
        if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
        return rows;
    }

    /** 文字コードを判定してデコードする（UTF-8 / Shift-JIS） */
    function decodeBuffer(buffer) {
        const bytes = new Uint8Array(buffer);
        if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
            return new TextDecoder('utf-8').decode(buffer);
        }
        try {
            // 厳密モードでUTF-8として解釈できればUTF-8
            return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch (e) {
            // 失敗したらShift-JIS（ミザルの標準出力）
            return new TextDecoder('shift_jis').decode(buffer);
        }
    }

    /**
     * CSVテキストを品目配列に変換する。
     * 先頭数行のタイトル行を読み飛ばし、「商品名」を含む行をヘッダーとして扱う。
     */
    function buildItems(text) {
        const rows = parseCsv(text);
        let headerIndex = -1;
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
            if (rows[i].indexOf('商品名') !== -1 && rows[i].indexOf('在庫数') !== -1) {
                headerIndex = i;
                break;
            }
        }
        if (headerIndex === -1) {
            throw new Error('「商品名」「在庫数」の列が見つかりません。ミザルの採用品一覧設定CSVを選択してください。');
        }

        const header = rows[headerIndex].map(h => h.trim());
        const col = {};
        header.forEach((h, i) => { if (!(h in col)) col[h] = i; });

        const list = [];
        for (let i = headerIndex + 1; i < rows.length; i++) {
            const r = rows[i];
            const get = name => {
                const idx = col[name];
                return (idx === undefined || r[idx] === undefined) ? '' : String(r[idx]).trim();
            };
            const name = get('商品名');
            if (!name) continue; // 空行スキップ

            const shelf1 = get('棚名称');
            const shelf2 = get('第２棚名称');
            const shelves = [];
            (shelf1 + ',' + shelf2).split(',').forEach(s => {
                const v = s.trim();
                if (v && shelves.indexOf(v) === -1) shelves.push(v);
            });

            const attrRaw = get('属性');
            const attrs = attrRaw && attrRaw !== '無し'
                ? attrRaw.split(/[、,]/).map(s => s.trim()).filter(Boolean)
                : [];

            const item = {
                name: name,
                drugName: get('薬品名'),
                genericName: get('一般名'),
                spec: get('規格'),
                maker: get('メーカー名'),
                use: get('使用'),
                ge: get('後発'),
                jan: get('コード'),
                wholesaler: get('帳合先'),
                costPrice: toNumber(get('帳合価格')),
                packPrice: toNumber(get('包装薬価')),
                unitPrice: toNumber(get('単位薬価')),
                packQty: toNumber(get('入数')),
                adoptDate: get('採用日'),
                transitionDate: get('経過措置'),
                discontinueDate: get('販売中止'),
                gtinSale: get('販売GTINコード'),
                gtinDispense: get('調剤GTINコード'),
                priceRevDate: get('薬価改定日'),
                oldPackPrice: toNumber(get('旧包装薬価')),
                newPackPrice: toNumber(get('新包装薬価')),
                receCode: get('レセプト電算コード'),
                yj: get('YJコード'),
                stock: toNumber(get('在庫数')),
                stockUnit: get('棚卸単位'),
                shelf1: shelf1,
                shelf2: shelf2,
                note: get('第３棚名称'),
                supply: get('供給確保'),
                managed: get('管理') === '1',
                attrRaw: attrRaw,
                attrs: attrs,
                shelves: shelves
            };

            item.search = normalize([
                item.name, item.drugName, item.genericName, item.spec, item.maker,
                item.wholesaler, item.yj, item.jan, item.gtinSale, item.gtinDispense,
                item.receCode, item.shelf1, item.shelf2, item.note, item.attrRaw, item.use
            ].join(' '));

            list.push(item);
        }

        if (list.length === 0) {
            throw new Error('品目データが1件も読み取れませんでした。ファイルの内容を確認してください。');
        }
        return list;
    }

    // ========== 保存・読込 ==========

    function saveData(text, fileName) {
        const payload = {
            version: 1,
            importedAt: new Date().toISOString(),
            fileName: fileName || '',
            csv: text
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {
            console.warn('在庫データの保存に失敗しました', e);
            showToast('データ量が大きく、ブラウザに保存できませんでした。今回の表示のみ有効です。', 'warning');
        }
        return payload;
    }

    function loadSavedData() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const payload = JSON.parse(raw);
            if (!payload || !payload.csv) return null;
            return payload;
        } catch (e) {
            console.warn('保存済み在庫データの読込に失敗しました', e);
            return null;
        }
    }

    function savePrefs() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({
                viewMode: viewMode,
                sort: state.sort,
                sidebarCollapsed: $('sidebar').classList.contains('collapsed'),
                filterCollapsed: $('filterPanel').classList.contains('collapsed')
            }));
        } catch (e) { /* 保存できなくても動作に影響しない */ }
    }

    function loadPrefs() {
        let saved = null;
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            if (raw) saved = JSON.parse(raw);
        } catch (e) { /* 既定値のまま */ }

        if (saved) {
            if (saved.viewMode && VIEW_TITLES[saved.viewMode]) viewMode = saved.viewMode;
            if (saved.sort) state.sort = saved.sort;
            if (saved.sidebarCollapsed) $('sidebar').classList.add('collapsed');
        }

        // 絞り込みパネルは、保存された指定が無ければ画面幅で決める
        // （スマートフォンでは畳んでおき、「絞り込み」ボタンで開く）
        const hasFilterPref = saved && typeof saved.filterCollapsed === 'boolean';
        const collapseFilter = hasFilterPref
            ? saved.filterCollapsed
            : window.matchMedia('(max-width: 1200px)').matches;
        $('filterPanel').classList.toggle('collapsed', collapseFilter);
    }

    // ========== 絞り込み ==========

    function stockCategory(item) {
        if (item.stock === null || item.stock <= 0) return 'zero';
        if (item.stock <= LOW_STOCK_THRESHOLD) return 'low';
        return 'in';
    }

    function matchFlags(item) {
        return state.flags.every(flag => {
            switch (flag) {
                case 'managed': return item.managed;
                case 'transition': return !!item.transitionDate;
                case 'discontinued': return !!item.discontinueDate;
                case 'note': return !!item.note;
                case 'supply': return !!item.supply;
                default: return true;
            }
        });
    }

    function applyFilters() {
        // 単語単位のAND検索（入力を空白で分割し、それぞれ正規化して部分一致）
        const words = state.keyword
            ? state.keyword.split(/[\s　]+/).map(normalize).filter(Boolean)
            : [];

        filtered = items.filter(item => {
            if (words.length && !words.every(w => matchWord(item.search, w))) return false;
            if (state.use && item.use !== state.use) return false;
            if (state.stock && stockCategory(item) !== state.stock) return false;
            if (state.ge === 'ge' && item.ge !== 'GE') return false;
            if (state.ge === 'brand' && item.ge === 'GE') return false;
            if (state.shelf && item.shelves.indexOf(state.shelf) === -1) return false;
            if (state.wholesaler && item.wholesaler !== state.wholesaler) return false;
            if (state.maker && item.maker !== state.maker) return false;
            if (state.attrs.length && !state.attrs.every(a => item.attrs.indexOf(a) !== -1)) return false;
            if (state.flags.length && !matchFlags(item)) return false;
            return true;
        });

        sortItems(filtered);
    }

    /** 棚番を自然順で比較する（A-2 < A-10 のように扱う） */
    function shelfKey(label) {
        const m = String(label).match(/^([^\d]*)(\d*)/);
        return [m[1], parseInt(m[2] || '0', 10)];
    }

    function compareShelfLabel(a, b) {
        const ka = shelfKey(a), kb = shelfKey(b);
        if (ka[0] !== kb[0]) return ka[0].localeCompare(kb[0], 'ja');
        return ka[1] - kb[1];
    }

    function sortItems(list) {
        const byName = (a, b) => a.name.localeCompare(b.name, 'ja');
        switch (state.sort) {
            case 'shelf':
                list.sort((a, b) => compareShelfLabel(a.shelves[0] || '￿', b.shelves[0] || '￿') || byName(a, b));
                break;
            case 'stockDesc':
                list.sort((a, b) => (b.stock === null ? -1 : b.stock) - (a.stock === null ? -1 : a.stock) || byName(a, b));
                break;
            case 'stockAsc':
                list.sort((a, b) => (a.stock === null ? -1 : a.stock) - (b.stock === null ? -1 : b.stock) || byName(a, b));
                break;
            case 'adoptDesc':
                list.sort((a, b) => (b.adoptDate || '').localeCompare(a.adoptDate || '') || byName(a, b));
                break;
            case 'priceDesc':
                list.sort((a, b) => (b.unitPrice || 0) - (a.unitPrice || 0) || byName(a, b));
                break;
            default:
                list.sort(byName);
        }
    }

    function activeFilterCount() {
        let n = 0;
        ['use', 'stock', 'ge', 'shelf', 'wholesaler', 'maker'].forEach(k => { if (state[k]) n++; });
        n += state.attrs.length + state.flags.length;
        return n;
    }

    // ========== 描画 ==========

    function badgeHtml(item) {
        const badges = [];
        if (item.ge === 'GE') badges.push('<span class="badge badge-ge">GE</span>');
        if (item.managed) badges.push('<span class="badge badge-managed" title="ミザルの管理欄が1の品目">管理</span>');
        if (item.transitionDate) badges.push(`<span class="badge badge-warn" title="経過措置 ${escapeHtml(item.transitionDate)}">経過措置</span>`);
        if (item.discontinueDate) badges.push(`<span class="badge badge-danger" title="販売中止 ${escapeHtml(item.discontinueDate)}">販売中止</span>`);
        if (item.note) badges.push(`<span class="badge badge-note" title="第３棚名称: ${escapeHtml(item.note)}">${escapeHtml(item.note)}</span>`);
        if (item.supply) badges.push(`<span class="badge badge-supply" title="供給確保">${escapeHtml(item.supply)}</span>`);
        return badges.join('');
    }

    function stockHtml(item) {
        const cat = stockCategory(item);
        const cls = cat === 'zero' ? 'stock-zero' : (cat === 'low' ? 'stock-low' : 'stock-ok');
        const value = item.stock === null ? '未設定' : formatNumber(item.stock);
        return `<span class="stock ${cls}">${value}</span>`;
    }

    function shelfHtml(item) {
        if (!item.shelves.length) return '<span class="muted">—</span>';
        return item.shelves.map(s => `<span class="shelf-tag">${escapeHtml(s)}</span>`).join('');
    }

    function renderTable(list) {
        const rows = list.map(item => `
            <tr data-index="${item._i}">
                <td class="col-name">
                    <div class="item-name">${escapeHtml(item.name)}</div>
                    <div class="item-sub">${escapeHtml(item.spec)}</div>
                    <div class="badges">${badgeHtml(item)}</div>
                </td>
                <td class="col-generic">${escapeHtml(item.genericName) || '<span class="muted">—</span>'}</td>
                <td class="col-maker">${escapeHtml(item.maker)}</td>
                <td class="col-stock">
                    ${stockHtml(item)}
                    <div class="item-sub">${escapeHtml(item.stockUnit)}</div>
                </td>
                <td class="col-shelf">${shelfHtml(item)}</td>
                <td class="col-use">${escapeHtml(item.use) || '<span class="muted">—</span>'}</td>
                <td class="col-wholesaler">${escapeHtml(item.wholesaler) || '<span class="muted">—</span>'}</td>
                <td class="col-price">${item.unitPrice === null ? '<span class="muted">—</span>' : formatNumber(item.unitPrice, 2)}</td>
            </tr>`).join('');

        return `
            <div class="table-wrap">
                <table class="inv-table inv-table-fixed">
                    <thead>
                        <tr>
                            <th class="col-name">商品名 / 規格</th>
                            <th class="col-generic">一般名</th>
                            <th class="col-maker">メーカー</th>
                            <th class="col-stock">在庫数</th>
                            <th class="col-shelf">棚</th>
                            <th class="col-use">使用</th>
                            <th class="col-wholesaler">帳合先</th>
                            <th class="col-price">単位薬価</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    function renderCards(list) {
        const cards = list.map(item => `
            <button class="item-card" data-index="${item._i}">
                <div class="card-head">
                    <span class="card-name">${escapeHtml(item.name)}</span>
                    <span>${shelfHtml(item)}</span>
                </div>
                <div class="card-spec">${escapeHtml(item.spec)}</div>
                <div class="card-body">
                    <div class="card-stock">
                        ${stockHtml(item)}
                        <span class="card-unit">${escapeHtml(item.stockUnit)}</span>
                    </div>
                    <div class="card-meta">
                        <span>${escapeHtml(item.maker)}</span>
                        <span>${escapeHtml(item.wholesaler)}</span>
                    </div>
                </div>
                <div class="badges">${badgeHtml(item)}</div>
            </button>`).join('');
        return `<div class="card-grid">${cards}</div>`;
    }

    function renderShelfGroups(list) {
        const groups = new Map();
        list.forEach(item => {
            const keys = item.shelves.length ? item.shelves : ['（棚未設定）'];
            keys.forEach(k => {
                if (!groups.has(k)) groups.set(k, []);
                groups.get(k).push(item);
            });
        });
        const keys = Array.from(groups.keys()).sort((a, b) => {
            if (a === '（棚未設定）') return 1;
            if (b === '（棚未設定）') return -1;
            return compareShelfLabel(a, b);
        });

        return keys.map(key => {
            const rows = groups.get(key).map(item => `
                <tr data-index="${item._i}">
                    <td class="col-name">
                        <div class="item-name">${escapeHtml(item.name)}</div>
                        <div class="item-sub">${escapeHtml(item.spec)}</div>
                    </td>
                    <td class="col-stock">${stockHtml(item)}<div class="item-sub">${escapeHtml(item.stockUnit)}</div></td>
                    <td class="col-maker">${escapeHtml(item.maker)}</td>
                </tr>`).join('');
            return `
                <section class="shelf-group">
                    <h3 class="shelf-group-title">${escapeHtml(key)}<span class="shelf-group-count">${groups.get(key).length}件</span></h3>
                    <div class="table-wrap">
                        <table class="inv-table">
                            <thead><tr><th class="col-name">商品名 / 規格</th><th class="col-stock">在庫数</th><th class="col-maker">メーカー</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </section>`;
        }).join('');
    }

    function renderStats() {
        const total = items.length;
        const shown = filtered.length;
        let zero = 0, low = 0, amount = 0;
        filtered.forEach(item => {
            const cat = stockCategory(item);
            if (cat === 'zero') zero++;
            else if (cat === 'low') low++;
            if (item.stock !== null && item.unitPrice !== null) amount += item.stock * item.unitPrice;
        });

        $('statsArea').innerHTML =
            `<span class="stat-chip main"><strong>${formatNumber(shown)}</strong> 件 / 全${formatNumber(total)}件</span>` +
            `<span class="stat-chip danger">在庫0・未設定 <strong>${formatNumber(zero)}</strong></span>` +
            `<span class="stat-chip warn">残りわずか <strong>${formatNumber(low)}</strong></span>` +
            `<span class="stat-chip">在庫金額（薬価） <strong>${formatNumber(Math.round(amount))}</strong> 円</span>`;
    }

    function render() {
        applyFilters();
        renderStats();

        const area = $('resultArea');
        if (filtered.length === 0) {
            area.innerHTML = `
                <div class="no-result">
                    <strong>該当する品目がありません</strong>
                    検索語や絞り込み条件を変えてお試しください。
                </div>`;
        } else if (viewMode === 'card') {
            area.innerHTML = renderCards(filtered);
        } else if (viewMode === 'shelf') {
            area.innerHTML = renderShelfGroups(filtered);
        } else {
            area.innerHTML = renderTable(filtered);
        }

        const count = activeFilterCount();
        const badge = $('filterCount');
        badge.textContent = String(count);
        badge.hidden = count === 0;
        $('searchClear').hidden = !state.keyword;
    }

    // ========== 詳細モーダル ==========

    const DETAIL_FIELDS = [
        ['商品名', it => it.name],
        ['薬品名', it => it.drugName],
        ['規格', it => it.spec],
        ['一般名', it => it.genericName],
        ['メーカー名', it => it.maker],
        ['使用', it => it.use],
        ['後発', it => it.ge],
        ['属性', it => it.attrRaw],
        ['在庫数', it => (it.stock === null ? '未設定' : formatNumber(it.stock)) + (it.stockUnit ? '（' + it.stockUnit + '）' : '')],
        ['棚名称', it => it.shelf1],
        ['第２棚名称', it => it.shelf2],
        ['第３棚名称', it => it.note],
        ['帳合先', it => it.wholesaler],
        ['入数', it => formatNumber(it.packQty)],
        ['包装薬価', it => it.packPrice === null ? '' : formatNumber(it.packPrice) + '円'],
        ['単位薬価', it => it.unitPrice === null ? '' : formatNumber(it.unitPrice, 2) + '円'],
        ['薬価改定日', it => it.priceRevDate],
        ['新包装薬価', it => it.newPackPrice === null ? '' : formatNumber(it.newPackPrice) + '円'],
        ['旧包装薬価', it => it.oldPackPrice === null ? '' : formatNumber(it.oldPackPrice) + '円'],
        ['採用日', it => it.adoptDate],
        ['経過措置', it => it.transitionDate],
        ['販売中止', it => it.discontinueDate],
        ['供給確保', it => it.supply],
        ['管理', it => it.managed ? '管理品（管理=1）' : ''],
        ['YJコード', it => it.yj],
        ['レセプト電算コード', it => it.receCode],
        ['コード（JAN）', it => it.jan],
        ['販売GTINコード', it => it.gtinSale],
        ['調剤GTINコード', it => it.gtinDispense]
    ];

    function openDetail(index) {
        const item = items[index];
        if (!item) return;
        $('detailTitle').textContent = item.name;
        const rows = DETAIL_FIELDS.map(([label, fn]) => {
            const value = fn(item);
            if (value === '' || value === null || value === undefined) return '';
            return `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
        }).join('');
        $('detailBody').innerHTML = `<dl class="detail-list">${rows}</dl>`;
        $('detailModal').hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeDetail() {
        $('detailModal').hidden = true;
        document.body.style.overflow = '';
    }

    // ========== CSV出力 ==========

    function exportCsv() {
        const header = ['商品名', '規格', '一般名', 'メーカー名', '使用', '後発', '在庫数', '棚卸単位',
            '棚名称', '第２棚名称', '第３棚名称', '帳合先', '単位薬価', '包装薬価', '入数',
            '採用日', '経過措置', '販売中止', '属性', 'YJコード', 'コード'];
        const esc = v => {
            const s = (v === null || v === undefined) ? '' : String(v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const lines = [header.join(',')];
        filtered.forEach(it => {
            lines.push([it.name, it.spec, it.genericName, it.maker, it.use, it.ge,
                it.stock === null ? '' : it.stock, it.stockUnit, it.shelf1, it.shelf2, it.note,
                it.wholesaler, it.unitPrice, it.packPrice, it.packQty, it.adoptDate,
                it.transitionDate, it.discontinueDate, it.attrRaw, it.yj, it.jan].map(esc).join(','));
        });
        // Excelで文字化けしないようUTF-8 BOM付きで出力
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const now = new Date();
        const p = n => String(n).padStart(2, '0');
        a.href = url;
        // ファイル名は半角英数字にする（日本語名だと拡張子が落ちるブラウザがあるため）
        a.download = `zaiko_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`${formatNumber(filtered.length)}件をCSVに出力しました`, 'success');
    }

    // ========== 通知 ==========

    function showToast(message, type) {
        const container = $('toastContainer');
        const el = document.createElement('div');
        el.className = 'toast ' + (type || 'info');
        el.textContent = message;
        container.appendChild(el);
        // 次フレームでクラスを付けてトランジションさせる
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        }, 4000);
    }

    // ========== フィルターUIの生成 ==========

    function uniqueSorted(values) {
        return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja'));
    }

    function fillSelect(id, values, allLabel) {
        const sel = $(id);
        sel.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
            values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    }

    function buildFilterOptions() {
        // 使用区分。件数の多い区分から並べる
        const useCount = new Map();
        items.forEach(i => { if (i.use) useCount.set(i.use, (useCount.get(i.use) || 0) + 1); });
        const uses = Array.from(useCount.entries()).sort((a, b) => b[1] - a[1]);
        $('quickUse').innerHTML =
            `<button class="chip-btn active" data-use="">すべて<span class="chip-count">${items.length}</span></button>` +
            uses.map(([u, n]) =>
                `<button class="chip-btn" data-use="${escapeHtml(u)}">${escapeHtml(u)}<span class="chip-count">${n}</span></button>`
            ).join('');

        // 棚（棚名称・第２棚名称を分解した個別の棚番）
        const shelfSet = new Set();
        items.forEach(i => i.shelves.forEach(s => shelfSet.add(s)));
        fillSelect('shelfFilter', Array.from(shelfSet).sort(compareShelfLabel), 'すべて');
        fillSelect('wholesalerFilter', uniqueSorted(items.map(i => i.wholesaler)), 'すべて');
        fillSelect('makerFilter', uniqueSorted(items.map(i => i.maker)), 'すべて');

        // 属性（CSVの値をそのままチップ化）
        const attrCount = new Map();
        items.forEach(i => i.attrs.forEach(a => attrCount.set(a, (attrCount.get(a) || 0) + 1)));
        const attrs = Array.from(attrCount.keys()).sort((a, b) => a.localeCompare(b, 'ja'));
        $('attrChips').innerHTML = attrs.map(a =>
            `<label class="chip"><input type="checkbox" data-attr="${escapeHtml(a)}"><span>${escapeHtml(a)}<span class="chip-count">${attrCount.get(a)}</span></span></label>`
        ).join('');

        $('sortSelect').value = state.sort;
    }

    // ========== データ適用 ==========

    function applyData(payload) {
        const list = buildItems(payload.csv);
        list.forEach((it, i) => { it._i = i; });
        items = list;
        meta = {
            importedAt: payload.importedAt,
            fileName: payload.fileName,
            source: payload.source === 'embedded' ? 'embedded' : 'imported'
        };

        $('emptyState').hidden = true;
        $('appState').hidden = false;

        buildFilterOptions();
        updateDataStatus();
        updateViewButtons();
        render();
    }

    function updateDataStatus() {
        const badge = $('dataStatus');
        const text = $('dataStatusText');
        if (!meta) {
            badge.className = 'sync-badge disconnected';
            text.textContent = 'データ未読込';
            badge.title = 'ミザルの採用品一覧CSVを読み込んでください';
            return;
        }
        const days = daysSince(meta.importedAt);
        const stale = days !== null && days >= STALE_DAYS;
        const when = formatDateTime(meta.importedAt);
        const ago = days === null ? '' : (days === 0 ? '本日' : days + '日前');
        const embedded = meta.source === 'embedded';

        badge.className = 'sync-badge ' + (stale ? 'stale' : 'connected');
        text.textContent = (embedded ? '元データ' : '取込') + (ago ? ` ${ago}` : '');
        badge.title = embedded
            ? `このファイルに収録されているデータ（${when} 取込）`
            : `読み込んだCSV: ${when}`;

        // 読み込んだCSVを使っているときだけ、収録データに戻せるようにする
        const resetBtn = $('resetDataBtn');
        if (resetBtn) resetBtn.hidden = !(EMBEDDED && !embedded);

        const alertEl = $('staleAlert');
        if (stale) {
            $('staleAlertText').textContent =
                `${embedded ? 'このファイルのデータは' : '在庫データを取り込んでから'}${days}日${embedded ? '前のものです' : '経過しています'}（${when} 取込）。ミザルから採用品一覧CSVを再出力して読み込み直してください。`;
            alertEl.hidden = false;
        } else {
            alertEl.hidden = true;
        }
    }

    function updateViewButtons() {
        document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewMode);
        });
        $('contentTitle').textContent = VIEW_TITLES[viewMode] || '在庫一覧';
    }

    function handleFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = decodeBuffer(reader.result);
                const payload = saveData(text, file.name);
                applyData(payload);
                showToast(`${formatNumber(items.length)}件の品目を読み込みました`, 'success');
            } catch (e) {
                console.error(e);
                showToast(e.message || 'CSVの読み込みに失敗しました', 'error');
            }
        };
        reader.onerror = () => showToast('ファイルの読み込みに失敗しました', 'error');
        reader.readAsArrayBuffer(file);
    }

    /** data/MedAdoptlist.csv が置かれていれば初回のみ自動で読み込む */
    function tryLoadLocalCsv() {
        // file:// で開いた場合はfetchできないので試みない
        if (location.protocol === 'file:') return Promise.resolve(false);
        return fetch(LOCAL_CSV_PATH, { cache: 'no-store' })
            .then(res => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('not found'))))
            .then(buf => {
                const text = decodeBuffer(buf);
                const payload = saveData(text, LOCAL_CSV_PATH);
                applyData(payload);
                return true;
            })
            .catch(() => false);
    }

    // ========== イベント ==========

    function debounce(fn, wait) {
        let timer = null;
        return function () {
            clearTimeout(timer);
            const args = arguments;
            timer = setTimeout(() => fn.apply(null, args), wait);
        };
    }

    function bindEvents() {
        const fileInput = $('csvFileInput');
        const openPicker = () => fileInput.click();
        $('importBtn').addEventListener('click', openPicker);
        $('navImport').addEventListener('click', openPicker);
        $('emptyImportBtn').addEventListener('click', openPicker);
        fileInput.addEventListener('change', e => {
            handleFile(e.target.files[0]);
            e.target.value = '';
        });

        // ドラッグ＆ドロップ
        const dropZone = $('dropZone');
        ['dragenter', 'dragover'].forEach(ev => {
            document.addEventListener(ev, e => {
                if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') === -1) return;
                e.preventDefault();
                if (dropZone) dropZone.classList.add('dragover');
            });
        });
        document.addEventListener('dragleave', e => {
            if (dropZone && e.target === dropZone) dropZone.classList.remove('dragover');
        });
        document.addEventListener('drop', e => {
            if (e.dataTransfer && e.dataTransfer.files.length) {
                e.preventDefault();
                if (dropZone) dropZone.classList.remove('dragover');
                handleFile(e.dataTransfer.files[0]);
            }
        });

        // サイドバー折りたたみ
        $('sidebarToggle').addEventListener('click', () => {
            $('sidebar').classList.toggle('collapsed');
            savePrefs();
        });

        // 絞り込みパネル折りたたみ
        const toggleFilterPanel = () => {
            $('filterPanel').classList.toggle('collapsed');
            savePrefs();
        };
        $('filterToggle').addEventListener('click', toggleFilterPanel);
        $('filterMobileBtn').addEventListener('click', toggleFilterPanel);

        // 検索
        const searchInput = $('searchInput');
        searchInput.addEventListener('input', debounce(e => {
            state.keyword = e.target.value;
            render();
        }, 150));
        $('searchClear').addEventListener('click', () => {
            searchInput.value = '';
            state.keyword = '';
            searchInput.focus();
            render();
        });

        // 使用区分
        $('quickUse').addEventListener('click', e => {
            const btn = e.target.closest('.chip-btn');
            if (!btn) return;
            state.use = btn.dataset.use;
            $('quickUse').querySelectorAll('.chip-btn').forEach(b => b.classList.toggle('active', b === btn));
            render();
        });

        // セレクト各種
        const selectMap = {
            stockFilter: 'stock', geFilter: 'ge', shelfFilter: 'shelf',
            wholesalerFilter: 'wholesaler', makerFilter: 'maker', sortSelect: 'sort'
        };
        Object.keys(selectMap).forEach(id => {
            $(id).addEventListener('change', e => {
                state[selectMap[id]] = e.target.value;
                if (id === 'sortSelect') savePrefs();
                render();
            });
        });

        // 属性チップ
        $('attrChips').addEventListener('change', () => {
            state.attrs = Array.from(document.querySelectorAll('#attrChips input:checked')).map(i => i.dataset.attr);
            render();
        });

        // 注意フラグ
        $('flagChips').addEventListener('change', () => {
            state.flags = Array.from(document.querySelectorAll('#flagChips input:checked')).map(i => i.dataset.flag);
            render();
        });

        // 条件リセット
        $('resetFilterBtn').addEventListener('click', () => {
            state.use = ''; state.stock = ''; state.ge = ''; state.shelf = '';
            state.wholesaler = ''; state.maker = ''; state.attrs = []; state.flags = [];
            ['stockFilter', 'geFilter', 'shelfFilter', 'wholesalerFilter', 'makerFilter'].forEach(id => {
                $(id).value = '';
            });
            document.querySelectorAll('#attrChips input, #flagChips input').forEach(i => { i.checked = false; });
            $('quickUse').querySelectorAll('.chip-btn').forEach(b => b.classList.toggle('active', b.dataset.use === ''));
            render();
        });

        // 表示切替
        document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                viewMode = btn.dataset.view;
                updateViewButtons();
                savePrefs();
                render();
            });
        });

        // 収録データに戻す
        const resetDataBtn = $('resetDataBtn');
        if (resetDataBtn) resetDataBtn.addEventListener('click', resetToEmbedded);

        // 出力・印刷
        $('exportBtn').addEventListener('click', exportCsv);
        $('printBtn').addEventListener('click', () => window.print());

        // 明細を開く
        $('resultArea').addEventListener('click', e => {
            const target = e.target.closest('[data-index]');
            if (!target) return;
            openDetail(Number(target.dataset.index));
        });

        // モーダル
        $('detailModal').addEventListener('click', e => {
            if (e.target.closest('[data-close]') || e.target === $('detailModal')) closeDetail();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeDetail();
            // 「/」で検索欄にフォーカス
            if (e.key === '/' && document.activeElement !== searchInput && !$('appState').hidden) {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
        });
    }

    // ========== 起動 ==========

    /** データの適用を試し、成功すればtrueを返す */
    function tryApply(payload, errorMessage) {
        try {
            applyData(payload);
            $('searchInput').focus();
            return true;
        } catch (e) {
            console.error(e);
            showToast(errorMessage + 'CSVを読み込み直してください。', 'error');
            return false;
        }
    }

    /** 読み込んだCSVを破棄し、ファイル収録のデータに戻す */
    function resetToEmbedded() {
        if (!EMBEDDED) return;
        if (!window.confirm('読み込んだCSVを破棄して、このファイルに収録されているデータに戻します。よろしいですか？')) return;
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) { /* 消せなくても収録データの表示は行う */ }
        if (tryApply({
            csv: EMBEDDED.csv,
            importedAt: EMBEDDED.importedAt,
            fileName: EMBEDDED.fileName || '',
            source: 'embedded'
        }, 'このファイルに収録されているデータを読み込めませんでした。')) {
            showToast('収録されているデータに戻しました', 'success');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        loadPrefs();
        updateViewButtons();
        bindEvents();

        // 読み込んだCSV（localStorage）→ ファイル収録のデータ → data/MedAdoptlist.csv の順に試す
        const saved = loadSavedData();
        if (saved && tryApply(saved, '保存されていたデータを読み込めませんでした。')) return;
        if (EMBEDDED && tryApply({
            csv: EMBEDDED.csv,
            importedAt: EMBEDDED.importedAt,
            fileName: EMBEDDED.fileName || '',
            source: 'embedded'
        }, 'このファイルに収録されているデータを読み込めませんでした。')) return;

        tryLoadLocalCsv().then(loaded => {
            if (!loaded) {
                $('emptyState').hidden = false;
            } else {
                $('searchInput').focus();
            }
        });
    });
})();
