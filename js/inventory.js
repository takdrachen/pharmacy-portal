/**
 * 在庫表（ミザル停止時間帯用）
 *
 * ミザルの「採用品一覧設定CSV」を読み込み、ブラウザ内（localStorage）に保存して
 * 検索・フィルターできるようにする単独ページ用スクリプト。
 * データは端末内にのみ保存され、外部へは送信しない。
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'inventory_csv_data_v1';
    const PREFS_KEY = 'inventory_prefs_v1';
    const LOCAL_CSV_PATH = 'data/MedAdoptlist.csv'; // 任意配置（Git管理外）。あれば初回に自動読込
    const STALE_DAYS = 7;            // データ取込からこの日数を超えたら警告
    const LOW_STOCK_THRESHOLD = 10;  // 「残りわずか」の判定値

    // ========== 状態 ==========
    let items = [];       // 全品目
    let meta = null;      // { importedAt, fileName, rowCount }
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
        // BOM除去
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

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
        // UTF-8 BOM
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
            localStorage.setItem(PREFS_KEY, JSON.stringify({ viewMode: viewMode, sort: state.sort }));
        } catch (e) { /* 保存できなくても動作に影響しない */ }
    }

    function loadPrefs() {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            if (!raw) return;
            const p = JSON.parse(raw);
            if (p.viewMode) viewMode = p.viewMode;
            if (p.sort) state.sort = p.sort;
        } catch (e) { /* 既定値のまま */ }
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
    function compareShelf(a, b) {
        const sa = a.shelves[0] || '￿';
        const sb = b.shelves[0] || '￿';
        const ma = sa.match(/^([^\d]*)(\d*)/);
        const mb = sb.match(/^([^\d]*)(\d*)/);
        if (ma[1] !== mb[1]) return ma[1].localeCompare(mb[1], 'ja');
        return (parseInt(ma[2] || '0', 10)) - (parseInt(mb[2] || '0', 10));
    }

    function sortItems(list) {
        const byName = (a, b) => a.name.localeCompare(b.name, 'ja');
        switch (state.sort) {
            case 'shelf':
                list.sort((a, b) => compareShelf(a, b) || byName(a, b));
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
        if (item.ge === 'GE') badges.push('<span class="inv-badge inv-badge-ge">GE</span>');
        if (item.managed) badges.push('<span class="inv-badge inv-badge-managed" title="ミザルの管理欄が1の品目">管理</span>');
        if (item.transitionDate) badges.push(`<span class="inv-badge inv-badge-warn" title="経過措置 ${escapeHtml(item.transitionDate)}">経過措置</span>`);
        if (item.discontinueDate) badges.push(`<span class="inv-badge inv-badge-danger" title="販売中止 ${escapeHtml(item.discontinueDate)}">販売中止</span>`);
        if (item.note) badges.push(`<span class="inv-badge inv-badge-note" title="第３棚名称: ${escapeHtml(item.note)}">${escapeHtml(item.note)}</span>`);
        if (item.supply) badges.push(`<span class="inv-badge inv-badge-supply" title="供給確保">${escapeHtml(item.supply)}</span>`);
        return badges.join('');
    }

    function stockHtml(item) {
        const cat = stockCategory(item);
        const cls = cat === 'zero' ? 'inv-stock-zero' : (cat === 'low' ? 'inv-stock-low' : 'inv-stock-ok');
        const value = item.stock === null ? '未設定' : formatNumber(item.stock);
        return `<span class="inv-stock ${cls}">${value}</span>`;
    }

    function shelfHtml(item) {
        if (!item.shelves.length) return '<span class="inv-muted">—</span>';
        return item.shelves.map(s => `<span class="inv-shelf">${escapeHtml(s)}</span>`).join('');
    }

    function renderTable(list) {
        const rows = list.map(item => `
            <tr data-index="${item._i}">
                <td class="inv-col-name">
                    <div class="inv-name">${escapeHtml(item.name)}</div>
                    <div class="inv-sub">${escapeHtml(item.spec)}</div>
                    <div class="inv-badges">${badgeHtml(item)}</div>
                </td>
                <td class="inv-col-generic">${escapeHtml(item.genericName) || '<span class="inv-muted">—</span>'}</td>
                <td class="inv-col-maker">${escapeHtml(item.maker)}</td>
                <td class="inv-col-stock">
                    ${stockHtml(item)}
                    <div class="inv-sub">${escapeHtml(item.stockUnit)}</div>
                </td>
                <td class="inv-col-shelf">${shelfHtml(item)}</td>
                <td class="inv-col-use">${escapeHtml(item.use) || '<span class="inv-muted">—</span>'}</td>
                <td class="inv-col-wholesaler">${escapeHtml(item.wholesaler) || '<span class="inv-muted">—</span>'}</td>
                <td class="inv-col-price">${item.unitPrice === null ? '<span class="inv-muted">—</span>' : formatNumber(item.unitPrice, 2)}</td>
            </tr>`).join('');

        return `
            <div class="inv-table-wrap">
                <table class="inv-table">
                    <thead>
                        <tr>
                            <th>商品名 / 規格</th>
                            <th>一般名</th>
                            <th>メーカー</th>
                            <th>在庫数</th>
                            <th>棚</th>
                            <th>使用</th>
                            <th>帳合先</th>
                            <th>単位薬価</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    function renderCards(list) {
        const cards = list.map(item => `
            <button class="inv-card" data-index="${item._i}">
                <div class="inv-card-head">
                    <span class="inv-card-name">${escapeHtml(item.name)}</span>
                    ${shelfHtml(item)}
                </div>
                <div class="inv-card-spec">${escapeHtml(item.spec)}</div>
                <div class="inv-card-body">
                    <div class="inv-card-stock">
                        ${stockHtml(item)}
                        <span class="inv-card-unit">${escapeHtml(item.stockUnit)}</span>
                    </div>
                    <div class="inv-card-meta">
                        <span>${escapeHtml(item.maker)}</span>
                        <span>${escapeHtml(item.wholesaler)}</span>
                    </div>
                </div>
                <div class="inv-badges">${badgeHtml(item)}</div>
            </button>`).join('');
        return `<div class="inv-card-grid">${cards}</div>`;
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
            const ma = a.match(/^([^\d]*)(\d*)/), mb = b.match(/^([^\d]*)(\d*)/);
            if (ma[1] !== mb[1]) return ma[1].localeCompare(mb[1], 'ja');
            return parseInt(ma[2] || '0', 10) - parseInt(mb[2] || '0', 10);
        });

        return keys.map(key => {
            const rows = groups.get(key).map(item => `
                <tr data-index="${item._i}">
                    <td class="inv-col-name">
                        <div class="inv-name">${escapeHtml(item.name)}</div>
                        <div class="inv-sub">${escapeHtml(item.spec)}</div>
                    </td>
                    <td class="inv-col-stock">${stockHtml(item)}<div class="inv-sub">${escapeHtml(item.stockUnit)}</div></td>
                    <td class="inv-col-maker">${escapeHtml(item.maker)}</td>
                </tr>`).join('');
            return `
                <section class="inv-shelf-group">
                    <h3 class="inv-shelf-title"><i class="fas fa-layer-group"></i> ${escapeHtml(key)}<span class="inv-shelf-count">${groups.get(key).length}件</span></h3>
                    <div class="inv-table-wrap">
                        <table class="inv-table inv-table-compact">
                            <thead><tr><th>商品名 / 規格</th><th>在庫数</th><th>メーカー</th></tr></thead>
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

        document.getElementById('statsArea').innerHTML = `
            <span class="inv-stat inv-stat-main"><strong>${formatNumber(shown)}</strong> 件 <span class="inv-muted">/ 全${formatNumber(total)}件</span></span>
            <span class="inv-stat"><i class="fas fa-circle-exclamation"></i> 在庫0・未設定 <strong>${formatNumber(zero)}</strong></span>
            <span class="inv-stat"><i class="fas fa-triangle-exclamation"></i> 残りわずか <strong>${formatNumber(low)}</strong></span>
            <span class="inv-stat"><i class="fas fa-yen-sign"></i> 在庫金額（薬価） <strong>${formatNumber(Math.round(amount))}</strong>円</span>`;
    }

    function render() {
        applyFilters();
        renderStats();

        const area = document.getElementById('resultArea');
        if (filtered.length === 0) {
            area.innerHTML = `
                <div class="inv-no-result">
                    <i class="fas fa-magnifying-glass"></i>
                    <p>該当する品目がありません</p>
                    <p class="inv-muted">検索語や絞り込み条件を変えてお試しください。</p>
                </div>`;
        } else if (viewMode === 'card') {
            area.innerHTML = renderCards(filtered);
        } else if (viewMode === 'shelf') {
            area.innerHTML = renderShelfGroups(filtered);
        } else {
            area.innerHTML = renderTable(filtered);
        }

        const count = activeFilterCount();
        const badge = document.getElementById('filterCount');
        badge.textContent = String(count);
        badge.hidden = count === 0;
        document.getElementById('searchClear').hidden = !state.keyword;
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
        document.getElementById('detailTitle').textContent = item.name;
        const rows = DETAIL_FIELDS.map(([label, fn]) => {
            const value = fn(item);
            if (value === '' || value === null || value === undefined) return '';
            return `<div class="inv-detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
        }).join('');
        document.getElementById('detailBody').innerHTML = `<dl class="inv-detail-list">${rows}</dl>`;
        document.getElementById('detailModal').hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeDetail() {
        document.getElementById('detailModal').hidden = true;
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
    }

    // ========== 通知 ==========

    let toastTimer = null;
    function showToast(message, type) {
        let el = document.getElementById('invToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'invToast';
            el.className = 'inv-toast';
            document.body.appendChild(el);
        }
        el.className = 'inv-toast inv-toast-' + (type || 'info') + ' show';
        el.innerHTML = `<i class="fas fa-${type === 'error' ? 'circle-exclamation' : (type === 'warning' ? 'triangle-exclamation' : 'circle-check')}"></i><span>${escapeHtml(message)}</span>`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.classList.remove('show'); }, 4000);
    }

    // ========== フィルターUIの生成 ==========

    function uniqueSorted(values) {
        return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja'));
    }

    function buildFilterOptions() {
        // 使用区分（クイックフィルタ）。件数の多い区分から並べる
        const useCount = new Map();
        items.forEach(i => { if (i.use) useCount.set(i.use, (useCount.get(i.use) || 0) + 1); });
        const uses = Array.from(useCount.entries()).sort((a, b) => b[1] - a[1]);
        const quick = document.getElementById('quickUse');
        quick.innerHTML = [`<button class="inv-quick active" data-use="">すべて<span class="inv-quick-count">${items.length}</span></button>`]
            .concat(uses.map(([u, n]) =>
                `<button class="inv-quick" data-use="${escapeHtml(u)}">${escapeHtml(u)}<span class="inv-quick-count">${n}</span></button>`
            )).join('');

        // 棚（棚名称・第２棚名称を分解した個別の棚番）
        const shelfSet = new Set();
        items.forEach(i => i.shelves.forEach(s => shelfSet.add(s)));
        const shelves = Array.from(shelfSet).sort((a, b) => {
            const ma = a.match(/^([^\d]*)(\d*)/), mb = b.match(/^([^\d]*)(\d*)/);
            if (ma[1] !== mb[1]) return ma[1].localeCompare(mb[1], 'ja');
            return parseInt(ma[2] || '0', 10) - parseInt(mb[2] || '0', 10);
        });
        fillSelect('shelfFilter', shelves, 'すべて');
        fillSelect('wholesalerFilter', uniqueSorted(items.map(i => i.wholesaler)), 'すべて');
        fillSelect('makerFilter', uniqueSorted(items.map(i => i.maker)), 'すべて');

        // 属性（CSVの値をそのままチップ化）
        const attrSet = new Set();
        items.forEach(i => i.attrs.forEach(a => attrSet.add(a)));
        const attrs = Array.from(attrSet).sort((a, b) => a.localeCompare(b, 'ja'));
        document.getElementById('attrChips').innerHTML = attrs.map(a => {
            const n = items.filter(i => i.attrs.indexOf(a) !== -1).length;
            return `<label class="inv-chip"><input type="checkbox" data-attr="${escapeHtml(a)}"><span>${escapeHtml(a)}<span class="inv-quick-count">${n}</span></span></label>`;
        }).join('');

        document.getElementById('sortSelect').value = state.sort;
    }

    function fillSelect(id, values, allLabel) {
        const sel = document.getElementById(id);
        sel.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
            values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    }

    // ========== データ適用 ==========

    function applyData(payload) {
        const list = buildItems(payload.csv);
        list.forEach((it, i) => { it._i = i; });
        items = list;
        meta = { importedAt: payload.importedAt, fileName: payload.fileName, rowCount: list.length };

        document.getElementById('emptyState').hidden = true;
        document.getElementById('appState').hidden = false;

        buildFilterOptions();
        updateDataStatus();
        updateViewButtons();
        render();
    }

    function updateDataStatus() {
        const el = document.getElementById('dataStatus');
        if (!meta) {
            el.innerHTML = '<i class="fas fa-circle-info"></i><span>データ未読込</span>';
            el.className = 'inv-data-status';
            return;
        }
        const days = daysSince(meta.importedAt);
        const stale = days !== null && days >= STALE_DAYS;
        el.className = 'inv-data-status' + (stale ? ' is-stale' : '');
        el.innerHTML = `<i class="fas fa-${stale ? 'triangle-exclamation' : 'clock'}"></i>` +
            `<span>取込 ${escapeHtml(formatDateTime(meta.importedAt))}` +
            (days !== null ? `（${days === 0 ? '本日' : days + '日前'}）` : '') + `</span>`;

        const alertEl = document.getElementById('staleAlert');
        if (stale) {
            document.getElementById('staleAlertText').textContent =
                `在庫データを取り込んでから${days}日経過しています。ミザルから採用品一覧CSVを再出力して読み込み直してください。`;
            alertEl.hidden = false;
        } else {
            alertEl.hidden = true;
        }
    }

    function updateViewButtons() {
        document.querySelectorAll('.inv-seg-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewMode);
        });
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
        const fileInput = document.getElementById('csvFileInput');
        const openPicker = () => fileInput.click();
        document.getElementById('importBtn').addEventListener('click', openPicker);
        document.getElementById('emptyImportBtn').addEventListener('click', openPicker);
        fileInput.addEventListener('change', e => {
            handleFile(e.target.files[0]);
            e.target.value = '';
        });

        // ドラッグ＆ドロップ
        const dropZone = document.getElementById('dropZone');
        ['dragenter', 'dragover'].forEach(ev => {
            document.addEventListener(ev, e => {
                if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') === -1) return;
                e.preventDefault();
                if (dropZone) dropZone.classList.add('is-dragover');
            });
        });
        ['dragleave', 'drop'].forEach(ev => {
            document.addEventListener(ev, e => {
                if (ev === 'drop') e.preventDefault();
                if (dropZone && (ev === 'drop' || e.target === dropZone)) dropZone.classList.remove('is-dragover');
            });
        });
        document.addEventListener('drop', e => {
            if (e.dataTransfer && e.dataTransfer.files.length) {
                e.preventDefault();
                handleFile(e.dataTransfer.files[0]);
            }
        });

        // 検索
        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', debounce(e => {
            state.keyword = e.target.value;
            render();
        }, 150));
        document.getElementById('searchClear').addEventListener('click', () => {
            searchInput.value = '';
            state.keyword = '';
            searchInput.focus();
            render();
        });

        // 詳細フィルターの開閉
        const filterBtn = document.getElementById('toggleFilterBtn');
        filterBtn.addEventListener('click', () => {
            const panel = document.getElementById('filterPanel');
            panel.hidden = !panel.hidden;
            filterBtn.setAttribute('aria-expanded', String(!panel.hidden));
        });

        // 使用区分クイックフィルタ
        document.getElementById('quickUse').addEventListener('click', e => {
            const btn = e.target.closest('.inv-quick');
            if (!btn) return;
            state.use = btn.dataset.use;
            document.querySelectorAll('.inv-quick').forEach(b => b.classList.toggle('active', b === btn));
            render();
        });

        // セレクト各種
        const selectMap = {
            stockFilter: 'stock', geFilter: 'ge', shelfFilter: 'shelf',
            wholesalerFilter: 'wholesaler', makerFilter: 'maker', sortSelect: 'sort'
        };
        Object.keys(selectMap).forEach(id => {
            document.getElementById(id).addEventListener('change', e => {
                state[selectMap[id]] = e.target.value;
                if (id === 'sortSelect') savePrefs();
                render();
            });
        });

        // 属性チップ
        document.getElementById('attrChips').addEventListener('change', () => {
            state.attrs = Array.from(document.querySelectorAll('#attrChips input:checked')).map(i => i.dataset.attr);
            render();
        });

        // 注意フラグ
        document.getElementById('flagChips').addEventListener('change', () => {
            state.flags = Array.from(document.querySelectorAll('#flagChips input:checked')).map(i => i.dataset.flag);
            render();
        });

        // 条件リセット
        document.getElementById('resetFilterBtn').addEventListener('click', () => {
            state.use = ''; state.stock = ''; state.ge = ''; state.shelf = '';
            state.wholesaler = ''; state.maker = ''; state.attrs = []; state.flags = [];
            ['stockFilter', 'geFilter', 'shelfFilter', 'wholesalerFilter', 'makerFilter'].forEach(id => {
                document.getElementById(id).value = '';
            });
            document.querySelectorAll('#attrChips input, #flagChips input').forEach(i => { i.checked = false; });
            document.querySelectorAll('.inv-quick').forEach(b => b.classList.toggle('active', b.dataset.use === ''));
            render();
        });

        // 表示切替
        document.querySelectorAll('.inv-seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                viewMode = btn.dataset.view;
                updateViewButtons();
                savePrefs();
                render();
            });
        });

        // 出力・印刷
        document.getElementById('exportBtn').addEventListener('click', exportCsv);
        document.getElementById('printBtn').addEventListener('click', () => window.print());

        // 明細を開く
        document.getElementById('resultArea').addEventListener('click', e => {
            const target = e.target.closest('[data-index]');
            if (!target) return;
            openDetail(Number(target.dataset.index));
        });

        // モーダル
        document.getElementById('detailModal').addEventListener('click', e => {
            if (e.target.closest('[data-close]')) closeDetail();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeDetail();
            // 「/」で検索欄にフォーカス
            if (e.key === '/' && document.activeElement !== searchInput && !document.getElementById('appState').hidden) {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
        });
    }

    // ========== 起動 ==========

    document.addEventListener('DOMContentLoaded', () => {
        loadPrefs();
        bindEvents();

        const saved = loadSavedData();
        if (saved) {
            try {
                applyData(saved);
            } catch (e) {
                console.error(e);
                document.getElementById('emptyState').hidden = false;
                showToast('保存されていたデータを読み込めませんでした。CSVを読み込み直してください。', 'error');
            }
            document.getElementById('searchInput').focus();
            return;
        }

        // 保存データが無い場合は data/MedAdoptlist.csv を試し、無ければ案内を表示
        tryLoadLocalCsv().then(loaded => {
            if (!loaded) {
                document.getElementById('emptyState').hidden = false;
            } else {
                document.getElementById('searchInput').focus();
            }
        });
    });
})();
