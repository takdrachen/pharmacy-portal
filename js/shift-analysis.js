// ========== シフト分析モジュール ==========

let shiftTypeChart = null;
let dailyStaffChart = null;

// 初期化
function initShiftAnalysis() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const monthInput = document.getElementById('analysis-month');
    if (monthInput) {
        monthInput.value = `${y}-${m}`;
    }
}

// メイン実行
function runShiftAnalysis() {
    const monthInput = document.getElementById('analysis-month');
    if (!monthInput || !monthInput.value) return;

    const [year, month] = monthInput.value.split('-').map(Number);
    const allShifts = DataStorage.getAll('shifts');

    // 対象月のシフトのみ絞り込む
    const shifts = allShifts.filter(shift => {
        const d = new Date(shift.date);
        return d.getFullYear() === year && (d.getMonth() + 1) === month;
    });

    const summary = calcSummary(shifts);
    const distribution = calcShiftTypeDistribution(shifts);
    const daily = calcDailyStaffing(shifts, year, month);
    const staffStats = calcStaffStats(shifts);

    renderSummaryCards(summary);
    renderShiftTypeChart(distribution);
    renderDailyStaffChart(daily, year, month);
    renderStaffTable(staffStats);
}

// ---- 集計ロジック ----

function calcSummary(shifts) {
    const totalShifts = shifts.length;
    const staffSet = new Set(shifts.map(s => s.staff_name));
    const totalStaff = staffSet.size;
    let totalMinutes = 0;
    shifts.forEach(s => {
        totalMinutes += calcWorkMinutes(s.start_time, s.end_time);
    });
    const totalHours = (totalMinutes / 60).toFixed(1);
    return { totalShifts, totalStaff, totalHours };
}

function calcShiftTypeDistribution(shifts) {
    const dist = {};
    shifts.forEach(s => {
        const t = s.shift_type || 'その他';
        dist[t] = (dist[t] || 0) + 1;
    });
    return dist;
}

function calcDailyStaffing(shifts, year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const daily = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, count: 0 }));
    shifts.forEach(s => {
        const d = new Date(s.date);
        const day = d.getDate();
        if (day >= 1 && day <= daysInMonth) {
            daily[day - 1].count++;
        }
    });
    return daily;
}

function calcStaffStats(shifts) {
    const statsMap = {};
    shifts.forEach(s => {
        const name = s.staff_name || '不明';
        if (!statsMap[name]) {
            statsMap[name] = { name, total: 0, types: {}, minutes: 0 };
        }
        statsMap[name].total++;
        const t = s.shift_type || 'その他';
        statsMap[name].types[t] = (statsMap[name].types[t] || 0) + 1;
        statsMap[name].minutes += calcWorkMinutes(s.start_time, s.end_time);
    });
    return Object.values(statsMap).sort((a, b) => b.total - a.total);
}

function calcWorkMinutes(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    return end > start ? end - start : 0;
}

// ---- 描画ロジック ----

function renderSummaryCards(summary) {
    const el = document.getElementById('analysis-summary-total');
    const el2 = document.getElementById('analysis-summary-staff');
    const el3 = document.getElementById('analysis-summary-hours');
    if (el) el.textContent = summary.totalShifts;
    if (el2) el2.textContent = summary.totalStaff;
    if (el3) el3.textContent = summary.totalHours + ' h';
}

function renderShiftTypeChart(distribution) {
    const canvas = document.getElementById('shift-type-chart');
    if (!canvas) return;

    const labels = Object.keys(distribution);
    const data = Object.values(distribution);
    const colorMap = {
        '早番': '#1565c0',
        '日勤': '#2e7d32',
        '遅番': '#e65100',
        '夜勤': '#7b1fa2',
        '全日': '#00695c',
        '休み': '#9e9e9e',
    };
    const backgroundColors = labels.map(l => colorMap[l] || '#c62828');

    if (shiftTypeChart) {
        shiftTypeChart.destroy();
        shiftTypeChart = null;
    }

    if (labels.length === 0) {
        canvas.parentElement.innerHTML = '<div class="analysis-empty"><i class="fas fa-chart-pie"></i><p>データがありません</p></div>';
        return;
    }

    shiftTypeChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: backgroundColors,
                borderWidth: 2,
                borderColor: '#ffffff',
            }],
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { family: "'Noto Sans JP', sans-serif", size: 12 },
                        padding: 12,
                        usePointStyle: true,
                    },
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.parsed} 件 (${Math.round(ctx.parsed / ctx.dataset.data.reduce((a, b) => a + b, 0) * 100)}%)`,
                    },
                },
            },
        },
    });
}

function renderDailyStaffChart(daily, year, month) {
    const canvas = document.getElementById('daily-staff-chart');
    if (!canvas) return;

    const labels = daily.map(d => `${d.day}日`);
    const data = daily.map(d => d.count);

    if (dailyStaffChart) {
        dailyStaffChart.destroy();
        dailyStaffChart = null;
    }

    dailyStaffChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: '出勤人数',
                data,
                backgroundColor: 'rgba(0, 200, 150, 0.7)',
                borderColor: 'rgba(0, 200, 150, 1)',
                borderWidth: 1,
                borderRadius: 4,
            }],
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: ctx => `${year}年${month}月${ctx[0].label}`,
                        label: ctx => ` 出勤: ${ctx.parsed.y} 人`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: {
                        font: { family: "'Noto Sans JP', sans-serif", size: 10 },
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 15,
                    },
                    grid: { display: false },
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        font: { family: "'Noto Sans JP', sans-serif", size: 11 },
                    },
                    grid: { color: 'rgba(0,0,0,0.05)' },
                },
            },
        },
    });
}

function renderStaffTable(staffStats) {
    const tbody = document.getElementById('staff-analysis-tbody');
    if (!tbody) return;

    if (staffStats.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center; padding: 2rem; color: var(--text-tertiary);">
                    <i class="fas fa-calendar-times" style="margin-right:0.5em;"></i>この月のシフトデータがありません
                </td>
            </tr>`;
        return;
    }

    const shiftOrder = ['早番', '日勤', '遅番', '夜勤', '全日', '休み'];
    const colorMap = {
        '早番': { bg: '#e3f2fd', color: '#1565c0' },
        '日勤': { bg: '#e8f5e9', color: '#2e7d32' },
        '遅番': { bg: '#fff3e0', color: '#e65100' },
        '夜勤': { bg: '#f3e5f5', color: '#7b1fa2' },
        '全日': { bg: '#e0f2f1', color: '#00695c' },
        '休み': { bg: '#f5f5f5', color: '#9e9e9e' },
    };

    tbody.innerHTML = staffStats.map(stat => {
        const hours = (stat.minutes / 60).toFixed(1);

        const chips = shiftOrder
            .filter(t => stat.types[t])
            .concat(Object.keys(stat.types).filter(t => !shiftOrder.includes(t)))
            .map(t => {
                const c = colorMap[t] || { bg: '#fce4ec', color: '#c62828' };
                return `<span class="shift-type-chip" style="background:${c.bg};color:${c.color};">${escapeHtml(t)}: ${stat.types[t]}</span>`;
            }).join('');

        return `
            <tr>
                <td>${escapeHtml(stat.name)}</td>
                <td class="td-center"><strong>${stat.total}</strong></td>
                <td><div class="shift-type-chips">${chips}</div></td>
                <td class="td-right">${hours} h</td>
            </tr>`;
    }).join('');
}
