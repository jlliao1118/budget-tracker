/* ============================================================
   我的記帳本 — 前端主程式
   ============================================================ */

// ── 分類定義 ──────────────────────────────────────────────
const CATEGORIES = {
  支出: [
    { name: '餐飲', icon: '🍽️', color: '#FF6B6B' },
    { name: '交通', icon: '🚇', color: '#4ECDC4' },
    { name: '購物', icon: '🛍️', color: '#45B7D1' },
    { name: '娛樂', icon: '🎮', color: '#96CEB4' },
    { name: '醫療', icon: '💊', color: '#FECA57' },
    { name: '住居', icon: '🏠', color: '#FF9FF3' },
    { name: '教育', icon: '📚', color: '#54A0FF' },
    { name: '其他', icon: '📦', color: '#A29BFE' },
  ],
  收入: [
    { name: '薪資', icon: '💰', color: '#00B894' },
    { name: '獎金', icon: '🎁', color: '#00CEC9' },
    { name: '兼職', icon: '💼', color: '#FDCB6E' },
    { name: '投資', icon: '📈', color: '#6C5CE7' },
    { name: '其他', icon: '💵', color: '#55EFC4' },
  ],
};

const CHART_COLORS = [
  '#FF6B6B','#4ECDC4','#45B7D1','#96CEB4',
  '#FECA57','#FF9FF3','#54A0FF','#A29BFE',
  '#00B894','#00CEC9','#FDCB6E','#6C5CE7',
];

// ── 應用狀態 ──────────────────────────────────────────────
const state = {
  gasUrl:        localStorage.getItem('gasUrl') || '',
  records:       [],
  currentMonth:  todayYM(),
  recFilter:     'all',
  addType:       '支出',
  addCategory:   '',
  charts:        { category: null, trend: null },
  loading:       false,
};

// ── 工具函式 ──────────────────────────────────────────────
function todayYM() {
  return new Date().toISOString().substring(0, 7);
}
function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatYM(ym) {
  const [y, m] = ym.split('-');
  return `${y} 年 ${parseInt(m)} 月`;
}
function fmtMoney(n) {
  return '$' + Math.abs(n).toLocaleString('zh-TW');
}
function addMonths(ym, delta) {
  const d = new Date(ym + '-01');
  d.setMonth(d.getMonth() + delta);
  return d.toISOString().substring(0, 7);
}
function getCatInfo(type, name) {
  const list = CATEGORIES[type] || CATEGORIES['支出'];
  return list.find(c => c.name === name) || { name, icon: '📦', color: '#A29BFE' };
}

// ── Toast ─────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

// ── API ───────────────────────────────────────────────────
async function apiGet(action, params = {}) {
  if (!state.gasUrl) throw new Error('請先在設定頁填入 GAS 網址');
  const url = new URL(state.gasUrl);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadAllRecords() {
  state.loading = true;
  try {
    const data = await apiGet('getRecords');
    if (data.success) {
      state.records = data.records;
    } else {
      throw new Error(data.error || '載入失敗');
    }
  } finally {
    state.loading = false;
  }
}

async function saveRecord(rec) {
  return apiGet('addRecord', rec);
}

async function deleteRecordById(id) {
  return apiGet('deleteRecord', { id });
}

// ── 導航 ──────────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard: '總覽',
  records:   '記錄',
  add:       '新增記錄',
  settings:  '設定',
};

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');
  document.getElementById('page-title').textContent = PAGE_TITLES[page];

  if (page === 'dashboard') renderDashboard();
  if (page === 'records')   renderRecords();
  if (page === 'add')       resetAddForm();
}

// ── 儀表板 ────────────────────────────────────────────────
function getMonthRecords(ym) {
  return state.records.filter(r => String(r.date).startsWith(ym));
}

function renderDashboard() {
  const ym = state.currentMonth;
  document.getElementById('dash-month-display').textContent = formatYM(ym);

  const recs = getMonthRecords(ym);
  let income = 0, expense = 0;
  recs.forEach(r => {
    if (r.type === '收入') income  += +r.amount;
    else                   expense += +r.amount;
  });

  document.getElementById('balance-amount').textContent = fmtMoney(income - expense);
  document.getElementById('income-amount').textContent  = fmtMoney(income);
  document.getElementById('expense-amount').textContent = fmtMoney(expense);

  renderCategoryChart(recs);
  renderTrendChart();
}

function renderCategoryChart(recs) {
  const byCategory = {};
  recs.filter(r => r.type === '支出').forEach(r => {
    byCategory[r.category] = (byCategory[r.category] || 0) + +r.amount;
  });

  const labels  = Object.keys(byCategory);
  const values  = Object.values(byCategory);
  const colors  = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  const ctx = document.getElementById('category-chart').getContext('2d');
  if (state.charts.category) state.charts.category.destroy();

  if (values.length === 0) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    document.getElementById('category-legend').innerHTML =
      '<p style="color:var(--text-2);font-size:13px;grid-column:span 2;text-align:center">本月無支出記錄</p>';
    return;
  }

  state.charts.category = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      cutout: '65%',
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ` ${ctx.label}: ${fmtMoney(ctx.raw)}` }
      }},
      animation: { duration: 400 },
    },
  });

  const total = values.reduce((a, b) => a + b, 0);
  const legend = document.getElementById('category-legend');
  legend.innerHTML = labels.map((lbl, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i]}"></div>
      <span class="legend-label">${lbl}</span>
      <span class="legend-value">${Math.round(values[i]/total*100)}%</span>
    </div>
  `).join('');
}

function renderTrendChart() {
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(addMonths(state.currentMonth, -i));

  const incomeData  = months.map(m => {
    let s = 0;
    getMonthRecords(m).forEach(r => { if (r.type === '收入') s += +r.amount; });
    return s;
  });
  const expenseData = months.map(m => {
    let s = 0;
    getMonthRecords(m).forEach(r => { if (r.type !== '收入') s += +r.amount; });
    return s;
  });
  const labels = months.map(m => {
    const [, mo] = m.split('-');
    return parseInt(mo) + '月';
  });

  const ctx = document.getElementById('trend-chart').getContext('2d');
  if (state.charts.trend) state.charts.trend.destroy();

  state.charts.trend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '收入', data: incomeData,  backgroundColor: 'rgba(16,185,129,.7)', borderRadius: 4 },
        { label: '支出', data: expenseData, backgroundColor: 'rgba(239,68,68,.7)',  borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => Number.isInteger(v) ? '$' + (v >= 1000 ? (v/1000).toFixed(0)+'k' : v) : '',
            stepSize: 1,
          },
        },
        x: { grid: { display: false } },
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } } },
      animation: { duration: 400 },
    },
  });
}

// ── 記錄頁 ────────────────────────────────────────────────
function renderRecords() {
  const ym = state.currentMonth;
  document.getElementById('rec-month-display').textContent = formatYM(ym);

  let recs = getMonthRecords(ym);
  if (state.recFilter !== 'all') recs = recs.filter(r => r.type === state.recFilter);

  // Summary bar
  let inc = 0, exp = 0;
  recs.forEach(r => { if (r.type === '收入') inc += +r.amount; else exp += +r.amount; });
  document.getElementById('rec-summary-income').textContent  = '收入 ' + fmtMoney(inc);
  document.getElementById('rec-summary-expense').textContent = '支出 ' + fmtMoney(exp);

  const list = document.getElementById('records-list');

  if (state.loading) {
    list.innerHTML = '<div class="loading-spinner"></div>';
    return;
  }
  if (recs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        本月暫無${state.recFilter === 'all' ? '' : state.recFilter}記錄
      </div>`;
    return;
  }

  // Group by date
  const grouped = {};
  recs.forEach(r => {
    const d = String(r.date);
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(r);
  });
  const sortedDates = Object.keys(grouped).sort((a,b) => b.localeCompare(a));

  list.innerHTML = sortedDates.map(date => {
    const dayRecs = grouped[date];
    const dayTotal = dayRecs.reduce((s, r) => s + (r.type === '支出' ? -+r.amount : +r.amount), 0);
    const d = new Date(date + 'T00:00:00');
    const weekday = ['日','一','二','三','四','五','六'][d.getDay()];
    const dateLabel = date.replace(/^\d{4}-/, '').replace('-', '/') + ` (${weekday})`;

    const items = dayRecs.map(r => buildRecordItem(r)).join('');
    return `
      <div class="date-group">
        <div class="date-group-header">
          <span>${dateLabel}</span>
          <span class="date-group-total ${dayTotal >= 0 ? 'income-color' : 'expense-color'}">
            ${dayTotal >= 0 ? '+' : ''}${fmtMoney(dayTotal)}
          </span>
        </div>
        ${items}
      </div>`;
  }).join('');

  // Bind delete buttons
  list.querySelectorAll('.record-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      if (!confirm('確定刪除此記錄？')) return;
      try {
        await deleteRecordById(id);
        state.records = state.records.filter(r => String(r.id) !== String(id));
        renderRecords();
        showToast('已刪除', 'success');
      } catch (err) {
        showToast('刪除失敗：' + err.message, 'error');
      }
    });
  });

  // Tap to toggle delete
  list.querySelectorAll('.record-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.record-delete-btn')) return;
      const wasOpen = item.classList.contains('swiped');
      list.querySelectorAll('.record-item.swiped').forEach(i => i.classList.remove('swiped'));
      if (!wasOpen) item.classList.add('swiped');
    });
  });
}

function buildRecordItem(r) {
  const catInfo = getCatInfo(r.type, r.category);
  const sign     = r.type === '收入' ? '+' : '-';
  const cls      = r.type === '收入' ? 'income-color' : 'expense-color';
  const source   = r.source === 'line' ? ' · LINE' : '';
  return `
    <div class="record-item" data-id="${r.id}">
      <div class="record-cat-icon" style="background:${catInfo.color}22">${catInfo.icon}</div>
      <div class="record-info">
        <div class="record-desc">${r.description || r.category}</div>
        <div class="record-meta">${r.category}${source}</div>
      </div>
      <div class="record-amount ${cls}">${sign}${fmtMoney(r.amount)}</div>
      <button class="record-delete-btn" data-id="${r.id}">🗑</button>
    </div>`;
}

// ── 新增記錄 ──────────────────────────────────────────────
function resetAddForm() {
  state.addType     = '支出';
  state.addCategory = '';
  document.getElementById('input-description').value = '';
  document.getElementById('input-amount').value      = '';
  document.getElementById('input-date').value        = todayDate();

  // Reset type toggle
  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === '支出');
  });
  renderCategoryButtons();
}

function renderCategoryButtons() {
  const grid = document.getElementById('category-grid');
  const cats = CATEGORIES[state.addType] || CATEGORIES['支出'];
  grid.innerHTML = cats.map(c => `
    <button class="cat-btn ${state.addCategory === c.name ? 'selected' : ''}"
            data-cat="${c.name}">
      <span class="cat-icon">${c.icon}</span>
      <span class="cat-name">${c.name}</span>
    </button>
  `).join('');

  grid.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.addCategory = btn.dataset.cat;
      renderCategoryButtons();
    });
  });
}

async function submitRecord() {
  const description = document.getElementById('input-description').value.trim();
  const amount      = parseFloat(document.getElementById('input-amount').value);
  const date        = document.getElementById('input-date').value;

  if (!state.addCategory) { showToast('請選擇分類', 'error'); return; }
  if (!amount || amount <= 0) { showToast('請輸入正確金額', 'error'); return; }
  if (!date) { showToast('請選擇日期', 'error'); return; }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = '記錄中…';

  try {
    const res = await saveRecord({
      type:        state.addType,
      category:    state.addCategory,
      description: description || state.addCategory,
      amount:      amount,
      date:        date,
      source:      'web',
    });

    if (!res.success) throw new Error(res.error || '新增失敗');

    showToast('記錄成功！', 'success');
    // Reload records and go to records page
    await loadAllRecords();
    navigateTo('records');
  } catch (err) {
    showToast('錯誤：' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '記錄';
  }
}

// ── 設定頁 ────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('gas-url').value = state.gasUrl;
}

async function testConnection() {
  const url = document.getElementById('gas-url').value.trim();
  if (!url) { showToast('請先填入 GAS 網址', 'error'); return; }

  const btn = document.getElementById('test-connection-btn');
  btn.textContent = '測試中…';
  btn.disabled = true;
  try {
    const origUrl = state.gasUrl;
    state.gasUrl = url;
    const data = await apiGet('getRecords');
    state.gasUrl = origUrl;
    if (data.success) {
      showToast(`連線成功！共 ${data.records.length} 筆記錄`, 'success');
    } else {
      throw new Error(data.error || '回應格式錯誤');
    }
  } catch (err) {
    showToast('連線失敗：' + err.message, 'error');
  } finally {
    btn.textContent = '測試連線';
    btn.disabled = false;
  }
}

function exportCSV() {
  if (state.records.length === 0) { showToast('沒有資料可以匯出', 'error'); return; }
  const header = ['ID', '日期', '類型', '分類', '描述', '金額', '來源'];
  const rows = state.records.map(r =>
    [r.id, r.date, r.type, r.category, `"${r.description}"`, r.amount, r.source]
  );
  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `記帳本_${new Date().toISOString().substring(0,10)}.csv`;
  a.click();
}

// ── 無 GAS URL 提示 ───────────────────────────────────────
function maybeShowSetupBanner(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  const existing = c.querySelector('.setup-banner');
  if (state.gasUrl) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;
  const banner = document.createElement('div');
  banner.className = 'setup-banner';
  banner.innerHTML = `
    <div class="setup-banner-icon">⚠️</div>
    <div class="setup-banner-text">
      <strong>尚未設定 GAS 網址</strong>
      請先前往 <span class="setup-banner-link" id="goto-settings-link">設定頁面</span> 填入 Google Apps Script 網址，才能讀取資料。
    </div>`;
  c.insertBefore(banner, c.firstChild);
  banner.querySelector('#goto-settings-link').addEventListener('click', () => navigateTo('settings'));
}

// ── 初始化 ────────────────────────────────────────────────
function init() {
  // 底部導航
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // 儀表板月份導航
  document.getElementById('dash-prev-month').addEventListener('click', () => {
    state.currentMonth = addMonths(state.currentMonth, -1);
    renderDashboard();
  });
  document.getElementById('dash-next-month').addEventListener('click', () => {
    state.currentMonth = addMonths(state.currentMonth, 1);
    renderDashboard();
  });

  // 記錄頁月份導航
  document.getElementById('rec-prev-month').addEventListener('click', () => {
    state.currentMonth = addMonths(state.currentMonth, -1);
    renderRecords();
  });
  document.getElementById('rec-next-month').addEventListener('click', () => {
    state.currentMonth = addMonths(state.currentMonth, 1);
    renderRecords();
  });

  // 記錄頁篩選
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.recFilter = chip.dataset.filter;
      renderRecords();
    });
  });

  // 新增頁：類型切換
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.addType     = btn.dataset.type;
      state.addCategory = '';
      renderCategoryButtons();
    });
  });

  // 新增頁：提交
  document.getElementById('submit-btn').addEventListener('click', submitRecord);

  // 允許 Enter 鍵提交
  ['input-description','input-amount','input-date'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') submitRecord();
    });
  });

  // 設定頁
  document.getElementById('save-settings-btn').addEventListener('click', () => {
    const url = document.getElementById('gas-url').value.trim();
    state.gasUrl = url;
    localStorage.setItem('gasUrl', url);
    showToast('設定已儲存', 'success');
    if (url) loadAllRecords().then(() => { renderDashboard(); renderRecords(); });
  });

  document.getElementById('test-connection-btn').addEventListener('click', testConnection);
  document.getElementById('export-btn').addEventListener('click', exportCSV);
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    try {
      await loadAllRecords();
      renderDashboard();
      renderRecords();
      showToast('已重新載入', 'success');
    } catch (err) {
      showToast('載入失敗：' + err.message, 'error');
    }
  });

  // 初始渲染
  renderSettings();
  resetAddForm();
  renderDashboard();

  // 有 GAS URL 就載入資料
  if (state.gasUrl) {
    loadAllRecords()
      .then(() => { renderDashboard(); renderRecords(); })
      .catch(err => showToast('載入失敗：' + err.message, 'error'));
  } else {
    maybeShowSetupBanner('page-dashboard');
    document.getElementById('records-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔧</div>
        請先在設定頁填入 GAS 網址
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
