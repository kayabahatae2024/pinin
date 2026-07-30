/**
 * 見込み利益ダッシュボード ロジック
 * ------------------------------------------------------------
 * 1. GAS_URL に、デプロイした Apps Script の Web App URL を設定してください。
 *    （DashboardApi.gs をデプロイした後に発行される「.../exec」で終わるURL）
 */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbweiGy31MIM98D3rB_qpq28SUubjOBSPzrtpf9S33Tcyejjt2U0tCvIdIGn6S_gMHL8/exec';

const STORAGE_KEY = 'dashboard_records_v1';

let allRecords = [];      // GASから取得した全レコード
let filteredRecords = []; // フィルタ後のレコード（NG除外チェックの影響を受ける）

let activeTab = 'date';

// ---------- タブ定義 ----------
// columns: グループを識別するための表示列（groupKeys に対応する値を先頭から表示）
// groupKeys: このキーの組み合わせでレコードをグループ化する
const METRIC_COLUMNS_BASE = [
  { key: 'bp', label: 'BP', type: 'num' },
  { key: 'sales', label: '見込み利益合計', type: 'currency' },
  { key: 'avg', label: '見込み利益平均', type: 'currency' },
  { key: 'seiyaku', label: '成約数', type: 'num' },
  { key: 'seiyakuRate', label: '成約率', type: 'percent' },
];

const KAISAI_COLUMN = { key: 'kaisai', label: '開催回数', type: 'num' };

// タブごとの指標列を組み立てる（開催回数は店舗系タブのみ表示）
function getMetricColumns(tabDef) {
  if (!tabDef.showKaisai) return METRIC_COLUMNS_BASE;
  const cols = [...METRIC_COLUMNS_BASE];
  cols.splice(1, 0, KAISAI_COLUMN); // BPの右隣に挿入
  return cols;
}

const TAB_DEFS = {
  date: {
    label: '日付別',
    groupKeys: ['date'],
    columns: [{ key: 'date', label: '日付', type: 'text' }],
  },
  week: {
    label: '週別',
    groupKeys: ['week'],
    columns: [{ key: 'week', label: '週', type: 'text' }],
  },
  chukai: {
    label: '仲介別',
    groupKeys: ['chukai'],
    columns: [{ key: 'chukai', label: '仲介', type: 'text' }],
  },
  brand: {
    label: '屋号別',
    groupKeys: ['brand'],
    columns: [{ key: 'brand', label: '屋号', type: 'text' }],
  },
  shop: {
    label: '店舗別',
    groupKeys: ['shop', 'brand'],
    showKaisai: true, // 開催回数（週の重複を除いたカウント）を表示
    columns: [
      { key: 'chihou', label: '地方', type: 'region' },
      { key: 'pref', label: '都道府県', type: 'text' },
      { key: 'brand', label: '屋号', type: 'text' },
      { key: 'shop', label: '店舗名', type: 'text' },
    ],
  },
  chihou: {
    label: '地方別',
    groupKeys: ['chihou'],
    columns: [{ key: 'chihou', label: '地方', type: 'region' }],
  },
  pref: {
    label: '都道府県別',
    groupKeys: ['pref'],
    columns: [
      { key: 'chihou', label: '地方', type: 'region' },
      { key: 'pref', label: '都道府県', type: 'text' },
    ],
  },
  ng: {
    label: 'NG店舗一覧',
    groupKeys: ['shop', 'brand'],
    isNgOnly: true, // このタブだけは「NG店舗を除外する」チェックを無視し、NGの店舗のみを表示
    showKaisai: true,
    columns: [
      { key: 'chihou', label: '地方', type: 'region' },
      { key: 'pref', label: '都道府県', type: 'text' },
      { key: 'brand', label: '屋号', type: 'text' },
      { key: 'shop', label: '店舗名', type: 'text' },
    ],
  },
};

// タブごとのソート状態を保持
const sortState = {};
Object.keys(TAB_DEFS).forEach(id => { sortState[id] = { key: 'sales', dir: 'desc' }; });

const REGION_COLORS = ['#2F49D1', '#0E8F73', '#C2650B', '#B23A9C', '#0E8FBF', '#B2861F', '#7A5CD6', '#D14F6B'];

// ---------- DOM refs ----------
const els = {
  syncBtn: document.getElementById('syncBtn'),
  updatedAt: document.getElementById('updatedAt'),
  errorBanner: document.getElementById('errorBanner'),

  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  weekSelect: document.getElementById('weekSelect'),
  chukaiSelect: document.getElementById('chukaiSelect'),
  brandInput: document.getElementById('brandInput'),
  shopInput: document.getElementById('shopInput'),
  chihouInput: document.getElementById('chihouInput'),
  prefInput: document.getElementById('prefInput'),
  excludeNg: document.getElementById('excludeNg'),
  resetBtn: document.getElementById('resetBtn'),

  brandList: document.getElementById('brandList'),
  shopList: document.getElementById('shopList'),
  chihouList: document.getElementById('chihouList'),
  prefList: document.getElementById('prefList'),

  kpiSales: document.getElementById('kpiSales'),
  kpiAvgSales: document.getElementById('kpiAvgSales'),
  kpiBp: document.getElementById('kpiBp'),
  kpiSeiyaku: document.getElementById('kpiSeiyaku'),
  kpiSeiyakuRate: document.getElementById('kpiSeiyakuRate'),
  kpiCount: document.getElementById('kpiCount'),

  tabs: document.querySelectorAll('.tab'),
  tableHead: document.getElementById('tableHead'),
  tableBody: document.getElementById('tableBody'),
  tableEmpty: document.getElementById('tableEmpty'),
};

// ---------- Init ----------
init();

function init() {
  loadFromCache();
  bindEvents();
}

function bindEvents() {
  els.syncBtn.addEventListener('click', syncFromSheet);
  els.resetBtn.addEventListener('click', resetFilters);

  [els.dateFrom, els.dateTo, els.weekSelect, els.chukaiSelect].forEach(el =>
    el.addEventListener('change', applyFilters)
  );
  [els.brandInput, els.shopInput, els.chihouInput, els.prefInput].forEach(el =>
    el.addEventListener('input', debounce(applyFilters, 200))
  );
  els.excludeNg.addEventListener('change', applyFilters);

  els.tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
}

// ---------- Data sync ----------

function loadFromCache() {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (!cached) return;
    const parsed = JSON.parse(cached);
    allRecords = parsed.records || [];
    setUpdatedLabel(parsed.updatedAt);
    afterDataLoaded();
  } catch (err) {
    console.warn('キャッシュの読み込みに失敗しました', err);
  }
}

async function syncFromSheet() {
  if (!GAS_URL || GAS_URL.includes('ここに')) {
    showError('GAS_URL が未設定です。app.js の GAS_URL に、デプロイしたApps ScriptのURLを貼り付けてください。');
    return;
  }
  setLoading(true);
  hideError();
  try {
    const res = await fetch(GAS_URL, { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    allRecords = data.records || [];

    // ブラウザの保存容量を超える場合があるため、保存失敗は無視して処理を続行する
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ records: allRecords, updatedAt: data.updatedAt }));
    } catch (storageErr) {
      console.warn('データ量が多いためブラウザへの保存はスキップしました（表示には影響ありません）', storageErr);
    }

    setUpdatedLabel(data.updatedAt);
    afterDataLoaded();
  } catch (err) {
    console.error(err);
    showError('データの取得に失敗しました。GASのデプロイ設定（アクセス権限「全員」）とURLをご確認ください。 詳細: ' + err.message);
  } finally {
    setLoading(false);
  }
}

function afterDataLoaded() {
  populateFilterOptions();
  applyFilters();
}

function setLoading(isLoading) {
  els.syncBtn.disabled = isLoading;
  els.syncBtn.querySelector('.btn__spinner').hidden = !isLoading;
  els.syncBtn.querySelector('.btn__label').textContent = isLoading ? '取得中…' : '最新データを取得';
}

function setUpdatedLabel(iso) {
  if (!iso) { els.updatedAt.textContent = '未取得'; return; }
  const d = new Date(iso);
  els.updatedAt.textContent = '最終更新: ' + d.toLocaleString('ja-JP');
}

function showError(msg) {
  els.errorBanner.textContent = msg;
  els.errorBanner.hidden = false;
}
function hideError() { els.errorBanner.hidden = true; }

// ---------- Filter options ----------

function populateFilterOptions() {
  const unique = (key) => [...new Set(allRecords.map(r => r[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'ja'));

  fillDatalist(els.brandList, unique('brand'));
  fillDatalist(els.shopList, unique('shop'));
  fillDatalist(els.chihouList, unique('chihou'));
  fillDatalist(els.prefList, unique('pref'));

  const chukaiValues = unique('chukai');
  els.chukaiSelect.innerHTML = '<option value="">すべて</option>' +
    chukaiValues.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');

  const weekValues = unique('week');
  els.weekSelect.innerHTML = '<option value="">すべて</option>' +
    weekValues.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
}

function fillDatalist(listEl, values) {
  listEl.innerHTML = values.map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
}

// ---------- Filtering ----------

/**
 * @param {boolean} ignoreExcludeNg trueの場合「NG店舗を除外する」チェックを無視する（NG店舗一覧タブ用）
 */
function getBaseFiltered(ignoreExcludeNg) {
  const from = els.dateFrom.value;
  const to = els.dateTo.value;
  const week = els.weekSelect.value.trim();
  const chukai = els.chukaiSelect.value.trim();
  const brand = els.brandInput.value.trim();
  const shop = els.shopInput.value.trim();
  const chihou = els.chihouInput.value.trim();
  const pref = els.prefInput.value.trim();
  const excludeNg = !ignoreExcludeNg && els.excludeNg.checked;

  return allRecords.filter(r => {
    if (from && (!r.date || r.date < from)) return false;
    if (to && (!r.date || r.date > to)) return false;
    if (week && r.week !== week) return false;
    if (chukai && r.chukai !== chukai) return false;
    if (brand && !containsText(r.brand, brand)) return false;
    if (shop && !containsText(r.shop, shop)) return false;
    if (chihou && !containsText(r.chihou, chihou)) return false;
    if (pref && !containsText(r.pref, pref)) return false;
    if (excludeNg && isNgShop(r.ngShop)) return false;
    return true;
  });
}

function containsText(value, query) {
  return String(value || '').toLowerCase().includes(query.toLowerCase());
}

function isNgShop(val) {
  if (val === true) return true;
  const s = String(val || '').trim();
  return s === 'NG' || s === 'ng' || s === '1' || s === 'TRUE' || s === '対象';
}

function resetFilters() {
  els.dateFrom.value = '';
  els.dateTo.value = '';
  els.weekSelect.value = '';
  els.chukaiSelect.value = '';
  els.brandInput.value = '';
  els.shopInput.value = '';
  els.chihouInput.value = '';
  els.prefInput.value = '';
  els.excludeNg.checked = false;
  applyFilters();
}

function applyFilters() {
  filteredRecords = getBaseFiltered(false);
  renderKpis();
  renderTable();
}

// ---------- KPI ----------

function renderKpis() {
  const totalSales = filteredRecords.reduce((sum, r) => sum + (r.sales || 0), 0);
  const bp = filteredRecords.length;
  const seiyaku = filteredRecords.filter(r => r.seiyaku).length;
  const rate = bp > 0 ? (seiyaku / bp * 100) : 0;
  const avgSales = bp > 0 ? totalSales / bp : 0;

  els.kpiSales.textContent = formatCurrency(totalSales);
  els.kpiAvgSales.textContent = formatCurrency(avgSales);
  els.kpiBp.textContent = bp.toLocaleString('ja-JP');
  els.kpiSeiyaku.textContent = seiyaku.toLocaleString('ja-JP');
  els.kpiSeiyakuRate.textContent = bp > 0 ? `成約率 ${rate.toFixed(1)}%` : '成約率 —';
  els.kpiCount.textContent = bp.toLocaleString('ja-JP');
}

// ---------- グループ集計 ----------

function buildGroups(records, tabDef) {
  const map = new Map();
  for (const r of records) {
    const key = tabDef.groupKeys.map(k => r[k]).join('__');
    if (!map.has(key)) {
      const labelFields = {};
      tabDef.columns.forEach(col => { labelFields[col.key] = r[col.key]; });
      map.set(key, { ...labelFields, sales: 0, bp: 0, seiyaku: 0, weekSet: new Set() });
    }
    const g = map.get(key);
    g.sales += r.sales || 0;
    g.bp += 1;
    if (r.seiyaku) g.seiyaku += 1;
    if (r.week) g.weekSet.add(r.week); // 週の重複を除いてカウント（開催回数用）
  }
  return [...map.values()].map(g => ({
    ...g,
    avg: g.bp > 0 ? g.sales / g.bp : 0,
    seiyakuRate: g.bp > 0 ? (g.seiyaku / g.bp * 100) : 0,
    kaisai: g.weekSet.size,
  }));
}

// ---------- テーブル描画（タブ共通） ----------

function renderTable() {
  const tabDef = TAB_DEFS[activeTab];
  const sourceRecords = tabDef.isNgOnly
    ? getBaseFiltered(true).filter(r => isNgShop(r.ngShop))
    : filteredRecords;

  const groups = buildGroups(sourceRecords, tabDef);
  const allColumns = [...tabDef.columns, ...getMetricColumns(tabDef)];
  const state = sortState[activeTab];
  sortRows(groups, state);

  // ヘッダー描画
  els.tableHead.innerHTML = '<tr>' + allColumns.map(col => {
    const isSortable = col.type !== 'region' || true; // 全列ソート可能
    const sortedClass = state.key === col.key ? (state.dir === 'desc' ? 'is-sorted-desc' : 'is-sorted-asc') : '';
    return `<th data-key="${col.key}" class="is-sortable ${sortedClass}">${escapeHtml(col.label)}</th>`;
  }).join('') + '</tr>';

  els.tableHead.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => onSortClick(th.dataset.key));
  });

  // ボディ描画
  els.tableBody.innerHTML = groups.map(g => {
    return '<tr>' + allColumns.map(col => renderCell(col, g)).join('') + '</tr>';
  }).join('');

  els.tableEmpty.hidden = groups.length > 0;
}

function renderCell(col, row) {
  const value = row[col.key];
  switch (col.type) {
    case 'region':
      return `<td class="region-cell" style="--region-color:${regionColor(value)}">${escapeHtml(value || '—')}</td>`;
    case 'currency':
      return `<td class="num">${formatCurrency(value)}</td>`;
    case 'percent':
      return `<td class="num">${(value || 0).toFixed(1)}%</td>`;
    case 'num':
      return `<td class="num">${(value || 0).toLocaleString('ja-JP')}</td>`;
    default:
      return `<td>${escapeHtml(value || '—')}</td>`;
  }
}

function sortRows(rows, state) {
  const { key, dir } = state;
  const mult = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const va = a[key], vb = b[key];
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
    return String(va || '').localeCompare(String(vb || ''), 'ja') * mult;
  });
}

function onSortClick(key) {
  const state = sortState[activeTab];
  if (state.key === key) {
    state.dir = state.dir === 'desc' ? 'asc' : 'desc';
  } else {
    state.key = key;
    state.dir = 'desc';
  }
  renderTable();
}

// ---------- Tabs ----------

function switchTab(tabId) {
  activeTab = tabId;
  els.tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === tabId));
  renderTable();
}

// ---------- Utils ----------

function formatCurrency(num) {
  return '¥' + Math.round(num || 0).toLocaleString('ja-JP');
}

function regionColor(name) {
  if (!name) return 'var(--line-strong)';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return REGION_COLORS[hash % REGION_COLORS.length];
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
