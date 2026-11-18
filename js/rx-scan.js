// ========================================
// 処方箋・お薬手帳 読取（薬品名抽出）
// 写真 → Gemini API（画像入力）→ 薬品名リスト → コピー
// ========================================

(function () {
    const MODEL_STORAGE_KEY = 'rx_scan_model';
    const DEFAULT_MODEL = 'gemini-2.5-flash';
    const MAX_IMAGE_EDGE = 2000; // 長辺の最大px（送信サイズ削減のため縮小）
    const JPEG_QUALITY = 0.9;

    let images = [];   // { id, dataUrl, base64, mimeType }
    let results = [];  // { name, checked }

    function $(id) { return document.getElementById(id); }

    function toast(message, type) {
        if (typeof showToast === 'function') showToast(message, type);
        else alert(message);
    }

    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    function getModel() {
        return (localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_MODEL).trim();
    }

    // ---------- 画像読み込み・縮小 ----------
    function loadImageFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('この画像形式は読み込めません（HEICの場合はJPEGで撮影・保存してください）'));
                img.onload = () => {
                    let { width, height } = img;
                    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
                    resolve({
                        id: Date.now() + Math.random(),
                        dataUrl,
                        base64: dataUrl.split(',')[1],
                        mimeType: 'image/jpeg'
                    });
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function addFiles(fileList) {
        const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
        if (files.length === 0) return;
        for (const file of files) {
            try {
                images.push(await loadImageFile(file));
            } catch (e) {
                toast(e.message, 'error');
            }
        }
        renderImages();
    }

    function renderImages() {
        const wrap = $('rx-image-list');
        const empty = $('rx-drop-empty');
        const runBtn = $('rx-run-btn');
        wrap.innerHTML = images.map(img => `
            <div class="rx-thumb" data-id="${img.id}">
                <img src="${img.dataUrl}" alt="読取画像">
                <button class="rx-thumb-remove" title="削除" data-remove="${img.id}">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
        empty.style.display = images.length ? 'none' : '';
        runBtn.disabled = images.length === 0;
        $('rx-clear-images-btn').style.display = images.length ? '' : 'none';
    }

    // ---------- Gemini 呼び出し ----------
    const PROMPT = `あなたは日本の調剤薬局で使う文字読み取りツールです。
添付画像は処方箋、またはお薬手帳（薬剤情報提供書・調剤明細を含む）の写真です。
画像に印字・記載されている「医薬品名」だけを抜き出してください。

ルール:
- 画像に書かれている表記をそのまま転記する（例: 「アムロジピン錠5mg「サワイ」」「【般】アムロジピン錠5mg」）。規格・剤形・屋号・【般】などの記号も書かれている通りに含める。
- 用法・用量・日数・数量・患者名・医療機関名・医師名・日付・薬局名・保険情報などは出力しない。
- 推測で補完しない。判読できない文字は「?」に置き換える。画像にない薬品名を作らない。
- 同じ薬品が複数回（別の日付など）出てきた場合は、1回だけ出力する。
- 記載順に並べる。
- 医薬品が見つからない場合は空配列を返す。

出力は次のJSONのみ:
{"medicines": ["薬品名1", "薬品名2"]}`;

    async function callGeminiVision() {
        const apiKey = localStorage.getItem('gemini_api_key');
        if (!apiKey) {
            throw new Error('Gemini APIキーが未設定です。「APIキー設定」から設定してください。');
        }
        const model = getModel();
        const parts = [{ text: PROMPT }];
        images.forEach(img => parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } }));

        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    generationConfig: {
                        temperature: 0,
                        responseMimeType: 'application/json'
                    }
                })
            }
        );

        if (!res.ok) {
            let msg = res.statusText;
            try {
                const err = await res.json();
                msg = err.error?.message || msg;
            } catch (_) { /* noop */ }
            throw new Error(`Gemini APIエラー（${res.status}）: ${msg}`);
        }

        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts || [])
            .map(p => p.text || '')
            .join('')
            .trim();
        if (!text) {
            const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || '不明';
            throw new Error(`応答が空でした（理由: ${reason}）`);
        }
        return parseMedicines(text);
    }

    function parseMedicines(text) {
        let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        let list;
        try {
            const obj = JSON.parse(cleaned);
            list = Array.isArray(obj) ? obj : obj.medicines;
        } catch (_) {
            // JSONでなければ1行1薬品として扱う
            list = cleaned.split(/\r?\n/);
        }
        if (!Array.isArray(list)) list = [];
        const seen = new Set();
        return list
            .map(s => String(s || '').replace(/^[\s・\-*\d.)）]+/, '').trim())
            .filter(s => s && !seen.has(s) && seen.add(s));
    }

    async function runScan() {
        if (images.length === 0) return;
        const btn = $('rx-run-btn');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 読み取り中...';
        try {
            const names = await callGeminiVision();
            results = names.map(name => ({ name, checked: true }));
            renderResults();
            if (names.length === 0) toast('薬品名が見つかりませんでした', 'warning');
            else toast(`${names.length}件の薬品名を抽出しました`, 'success');
        } catch (e) {
            console.error(e);
            toast(e.message, 'error');
        } finally {
            btn.innerHTML = original;
            btn.disabled = images.length === 0;
        }
    }

    // ---------- 結果表示・コピー ----------
    function renderResults() {
        const panel = $('rx-result-panel');
        const list = $('rx-result-list');
        panel.style.display = '';
        $('rx-result-count').textContent = `${results.length}件`;

        if (results.length === 0) {
            list.innerHTML = '<li class="rx-result-empty">薬品名は抽出されませんでした。画像を確認して再度お試しください。</li>';
        } else {
            list.innerHTML = results.map((r, i) => `
                <li class="rx-result-item">
                    <input type="checkbox" data-check="${i}" ${r.checked ? 'checked' : ''} aria-label="コピー対象">
                    <input type="text" class="rx-result-input" data-edit="${i}" value="${esc(r.name)}">
                    <button class="rx-icon-btn" data-copy="${i}" title="この薬品名をコピー"><i class="fas fa-copy"></i></button>
                    <button class="rx-icon-btn rx-icon-danger" data-delete="${i}" title="削除"><i class="fas fa-trash"></i></button>
                </li>
            `).join('');
        }
        updateOutput();
    }

    function getSeparator() {
        const sel = $('rx-separator').value;
        return sel === 'comma' ? '、' : sel === 'tab' ? '\t' : '\n';
    }

    function updateOutput() {
        const text = results.filter(r => r.checked && r.name.trim()).map(r => r.name.trim()).join(getSeparator());
        $('rx-output').value = text;
    }

    async function copyText(text) {
        if (!text) {
            toast('コピーする内容がありません', 'warning');
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
        } catch (_) {
            // HTTP環境や古いブラウザ向けフォールバック
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        toast('コピーしました', 'success');
    }

    // ---------- 初期化 ----------
    function init() {
        if (!$('rx-scan-section')) return;

        const fileInput = $('rx-file-input');
        const cameraInput = $('rx-camera-input');
        const drop = $('rx-dropzone');

        $('rx-camera-btn').addEventListener('click', () => cameraInput.click());
        $('rx-file-btn').addEventListener('click', () => fileInput.click());
        [fileInput, cameraInput].forEach(input => input.addEventListener('change', async e => {
            await addFiles(e.target.files);
            e.target.value = '';
        }));

        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
            e.preventDefault();
            drop.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
            e.preventDefault();
            drop.classList.remove('dragover');
        }));
        drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));

        // クリップボードから画像を貼り付け（このセクション表示中のみ）
        document.addEventListener('paste', e => {
            if (!$('rx-scan-section').classList.contains('active')) return;
            const files = Array.from(e.clipboardData?.items || [])
                .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
                .map(it => it.getAsFile());
            if (files.length) {
                e.preventDefault();
                addFiles(files);
            }
        });

        $('rx-image-list').addEventListener('click', e => {
            const btn = e.target.closest('[data-remove]');
            if (!btn) return;
            images = images.filter(img => String(img.id) !== btn.dataset.remove);
            renderImages();
        });

        $('rx-clear-images-btn').addEventListener('click', () => {
            images = [];
            renderImages();
        });

        $('rx-run-btn').addEventListener('click', runScan);

        const list = $('rx-result-list');
        list.addEventListener('change', e => {
            const i = e.target.dataset.check;
            if (i !== undefined) {
                results[i].checked = e.target.checked;
                updateOutput();
            }
        });
        list.addEventListener('input', e => {
            const i = e.target.dataset.edit;
            if (i !== undefined) {
                results[i].name = e.target.value;
                updateOutput();
            }
        });
        list.addEventListener('click', e => {
            const copyBtn = e.target.closest('[data-copy]');
            if (copyBtn) {
                copyText(results[copyBtn.dataset.copy].name.trim());
                return;
            }
            const delBtn = e.target.closest('[data-delete]');
            if (delBtn) {
                results.splice(Number(delBtn.dataset.delete), 1);
                renderResults();
            }
        });

        $('rx-add-row-btn').addEventListener('click', () => {
            results.push({ name: '', checked: true });
            renderResults();
            const inputs = list.querySelectorAll('.rx-result-input');
            inputs[inputs.length - 1]?.focus();
        });
        $('rx-select-all').addEventListener('change', e => {
            results.forEach(r => { r.checked = e.target.checked; });
            renderResults();
        });
        $('rx-separator').addEventListener('change', updateOutput);
        $('rx-copy-all-btn').addEventListener('click', () => copyText($('rx-output').value));

        $('rx-model-btn').addEventListener('click', () => {
            const value = prompt(
                '画像読取に使う Gemini のモデル名を入力してください。\n' +
                '（空欄でOKすると既定値に戻ります）\n\n既定値: ' + DEFAULT_MODEL,
                getModel()
            );
            if (value === null) return;
            if (value.trim()) localStorage.setItem(MODEL_STORAGE_KEY, value.trim());
            else localStorage.removeItem(MODEL_STORAGE_KEY);
            $('rx-model-name').textContent = getModel();
            toast(`モデルを ${getModel()} に設定しました`, 'success');
        });
        $('rx-model-name').textContent = getModel();

        renderImages();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
