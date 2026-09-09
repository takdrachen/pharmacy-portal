#!/usr/bin/env node
/**
 * 在庫表の単一ファイル版（デスクトップ用）をビルドする。
 *
 * inventory.html / css / js / ロゴ を1つのHTMLにまとめ、
 * ミザルの採用品一覧CSVを埋め込む。外部への通信は行わないため、
 * デスクトップに置いてダブルクリックするだけで、オフラインでも使える。
 *
 * 出力先のフォルダーには、Windows用のランチャー（tools/launcher.bat）と
 * ショートカット用アイコン（img/logo.ico）も一緒に置く。
 * ランチャーはブラウザのタブではなく独立したウィンドウで開くためのもので、
 * HTMLをそのままダブルクリックしても使える。
 *
 *   使い方: node tools/build-standalone.js <CSVファイル> [出力先]
 *   例:     node tools/build-standalone.js ~/MedAdoptlist.csv dist/在庫表.html
 *
 * 出力ファイルは在庫数や帳合価格を含むため、リポジトリにコミットしないこと
 * （dist/ は .gitignore で除外している）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const csvPath = process.argv[2];
const outPath = path.resolve(ROOT, process.argv[3] || 'dist/在庫表.html');

if (!csvPath) {
    console.error('使い方: node tools/build-standalone.js <CSVファイル> [出力先]');
    process.exit(1);
}

/** ミザルのCSVはShift-JIS。UTF-8でなければShift-JISとして読む */
function decodeCsv(buf) {
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        return new TextDecoder('utf-8').decode(buf.subarray(3));
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
        return new TextDecoder('shift_jis').decode(buf);
    }
}

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const csv = decodeCsv(fs.readFileSync(csvPath));
if (csv.indexOf('商品名') === -1 || csv.indexOf('在庫数') === -1) {
    console.error('「商品名」「在庫数」の列が見つかりません。ミザルの採用品一覧設定CSVを指定してください。');
    process.exit(1);
}
const itemCount = csv.split(/\r?\n/).length - 4; // タイトル2行＋見出し1行＋末尾

const css = read('css/inventory.css');
const js = read('js/inventory.js');
const logo = fs.readFileSync(path.join(ROOT, 'img/logo.png')).toString('base64');
const logoUri = 'data:image/png;base64,' + logo;

let html = read('inventory.html');

// 外部フォントの読み込みを削除（オフラインで開くため）
html = html.replace(/[ \t]*<link rel="preconnect"[^>]*>\r?\n/g, '');
html = html.replace(/[ \t]*<link href="https:\/\/fonts\.googleapis\.com[^>]*>\r?\n/g, '');

// ロゴ・ファビコンをデータURIに置換
html = html.replace(/href="img\/logo\.png"/g, `href="${logoUri}"`);
html = html.replace(/src="img\/logo\.png"/g, `src="${logoUri}"`);

// ポータルへ戻るリンクは単一ファイル版では機能しないため削除
html = html.replace(
    /[ \t]*<a class="nav-item" href="index\.html"[\s\S]*?<\/a>\r?\n/,
    ''
);

// CSSを埋め込む
html = html.replace(
    /[ \t]*<link rel="stylesheet" href="css\/inventory\.css">/,
    '<style>\n' + css + '\n</style>'
);

// CSVとアプリ本体を埋め込む
const embedded = {
    csv: csv,
    importedAt: new Date().toISOString(),
    fileName: path.basename(csvPath)
};
const bootstrap =
    '<script>\nwindow.INVENTORY_EMBEDDED = ' + JSON.stringify(embedded) + ';\n</script>\n' +
    '<script>\n' + js + '\n</script>';
html = html.replace(/[ \t]*<script src="js\/inventory\.js"><\/script>/, bootstrap);

// 置換漏れがないか確認する
['css/inventory.css', 'js/inventory.js', 'img/logo.png'].forEach(ref => {
    if (html.indexOf(ref) !== -1) {
        console.error('外部参照が残っています: ' + ref);
        process.exit(1);
    }
});

const outDir = path.dirname(outPath);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');

// Windows用のランチャーとアイコンを添える。
// launcher.bat は日本語を含むためCP932で保存してある。cmd.exeがそのまま読めるよう、
// 文字コードを変換せずバイト列のまま複製する。
const launcherOut = path.join(outDir, '在庫表を開く.bat');
fs.copyFileSync(path.join(ROOT, 'tools/launcher.bat'), launcherOut);
const iconOut = path.join(outDir, '在庫表.ico');
fs.copyFileSync(path.join(ROOT, 'img/logo.ico'), iconOut);

const kb = n => (n / 1024).toFixed(0) + 'KB';
console.log('出力: ' + outPath);
console.log('  品目数（概算）: ' + itemCount);
console.log('  ファイルサイズ: ' + kb(Buffer.byteLength(html, 'utf8')));
console.log('添付: ' + launcherOut);
console.log('      ' + iconOut);
