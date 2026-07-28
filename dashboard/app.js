/**
 * 売上ダッシュボード ロジック
 * ------------------------------------------------------------
 * 1. GAS_URL に、デプロイした Apps Script の Web App URL を設定してください。
 *    （Code.gs をデプロイした後に発行される「.../exec」で終わるURL）
 */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbweiGy31MIM98D3rB_qpq28SUubjOBSPzrtpf9S33Tcyejjt2U0tCvIdIGn6S_gMHL8/exec'; // 例: https://script.google.com/macros/s/xxxx/exec

const STORAGE_KEY = 'dashboard_records_v1';
const PAGE_SIZE = 50;

let allRecords = [];      // GASから取得した全レコード
let filteredRecords = []; // フィルタ後のレコード

let groupSort = { key: 'sales', dir: 'desc' };
let rawSort = { key: 'sales', dir: 'desc' };
let rawPage = 1;

const REGION_COLORS = ['#2F49D1', '#0E8F73', '#C2650B', '#B23A9C', '#0E8FBF', '#B2861F', '#7A5CD6', '#D14F6B'];

// ---------- DOM refs ----------
const els = {
  syncBtn: document.getElementById('syncBtn'),
  updatedAt: document.getElementById('updatedAt'),
  errorBanner: document.getElementById('errorBanner'),

  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
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
  kpiBp: document.getElementById('kpiBp'),
  kpiSeiyaku: document.getElementById('kpiSeiyaku'),
  kpiSeiyakuRate: document.getElementById('kpiSeiyakuRate'),
  kpiCount: document.getElementById('kpiCount'),

  groupTbody: document.getElementById('groupTbody'),
  groupEmpty: document.getElementById('groupEmpty'),
  rawTbody: document.getElementById('rawTbody'),
  rawEmpty: document.getElementById('rawEmpty'),

  groupPanel: document.getElementById('groupPanel'),
  rawPanel: document.getElementById('rawPanel'),
  tabs: document.querySelectorAll('.tab'),

  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  pageInfo: document.getElementById('pageInfo'),
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

  [els.dateFrom, els.dateTo, els.chukaiSelect].forEach(el =>
    el.addEventListener('change', applyFilters)
  );
  [els.brandInput, els.shopInput, els.chihouInput, els.prefInput].forEach(el =>
    el.addEventListener('input', debounce(applyFilters, 200))
  );
  els.excludeNg.addEventListener('change', applyFilters);

  document.querySelectorAll('#groupTable thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => onSortClick(th, 'group'));
  });
  document.querySelectorAll('#rawTable thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => onSortClick(th, 'raw'));
  });

  els.tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

  els.prevPage.addEventListener('click', () => { rawPage--; renderRawTable(); });
  els.nextPage.addEventListener('click', () => { rawPage++; renderRawTable(); });
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
  if (GAS_URL.includes('ここに')) {
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
}

function fillDatalist(listEl, values) {
  listEl.innerHTML = values.map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
}

// ---------- Filtering ----------

function applyFilters() {
  const from = els.dateFrom.value;       // yyyy-mm-dd or ''
  const to = els.dateTo.value;
  const chukai = els.chukaiSelect.value.trim();
  const brand = els.brandInput.value.trim();
  const shop = els.shopInput.value.trim();
  const chihou = els.chihouInput.value.trim();
  const pref = els.prefInput.value.trim();
  const excludeNg = els.excludeNg.checked;

  filteredRecords = allRecords.filter(r => {
    if (from && (!r.date || r.date < from)) return false;
    if (to && (!r.date || r.date > to)) return false;
    if (chukai && r.chukai !== chukai) return false;
    if (brand && !containsText(r.brand, brand)) return false;
    if (shop && !containsText(r.shop, shop)) return false;
    if (chihou && !containsText(r.chihou, chihou)) return false;
    if (pref && !containsText(r.pref, pref)) return false;
    if (excludeNg && isNgShop(r.ngShop)) return false;
    return true;
  });

  rawPage = 1;
  renderKpis();
  renderGroupTable();
  renderRawTable();
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
  els.chukaiSelect.value = '';
  els.brandInput.value = '';
  els.shopInput.value = '';
  els.chihouInput.value = '';
  els.prefInput.value = '';
  els.excludeNg.checked = false;
  applyFilters();
}

// ---------- KPI ----------

function renderKpis() {
  const totalSales = filteredRecords.reduce((sum, r) => sum + (r.sales || 0), 0);
  const bp = filteredRecords.length;
  const seiyaku = filteredRecords.filter(r => r.seiyaku).length;
  const rate = bp > 0 ? (seiyaku / bp * 100) : 0;

  els.kpiSales.textContent = '¥' + Math.round(totalSales).toLocaleString('ja-JP');
  els.kpiBp.textContent = bp.toLocaleString('ja-JP');
  els.kpiSeiyaku.textContent = seiyaku.toLocaleString('ja-JP');
  els.kpiSeiyakuRate.textContent = bp > 0 ? `成約率 ${rate.toFixed(1)}%` : '成約率 —';
  els.kpiCount.textContent = bp.toLocaleString('ja-JP');
}

// ---------- 店舗別集計テーブル ----------

function buildGroups() {
  const map = new Map();
  for (const r of filteredRecords) {
    const key = r.shop + '__' + r.brand;
    if (!map.has(key)) {
      map.set(key, {
        shop: r.shop, brand: r.brand, pref: r.pref, chihou: r.chihou,
        sales: 0, bp: 0, seiyaku: 0
      });
    }
    const g = map.get(key);
    g.sales += r.sales || 0;
    g.bp += 1;
    if (r.seiyaku) g.seiyaku += 1;
  }
  return [...map.values()];
}

function renderGroupTable() {
  const groups = buildGroups();
  sortRows(groups, groupSort);

  els.groupTbody.innerHTML = groups.map(g => `
    <tr>
      <td class="region-cell" style="--region-color:${regionColor(g.chihou)}">${escapeHtml(g.chihou || '—')}</td>
      <td>${escapeHtml(g.pref || '—')}</td>
      <td>${escapeHtml(g.brand || '—')}</td>
      <td>${escapeHtml(g.shop || '—')}</td>
      <td class="num">¥${Math.round(g.sales).toLocaleString('ja-JP')}</td>
      <td class="num">${g.bp.toLocaleString('ja-JP')}</td>
      <td class="num">${g.seiyaku.toLocaleString('ja-JP')}</td>
    </tr>
  `).join('');

  els.groupEmpty.hidden = groups.length > 0;
}

// ---------- 明細データテーブル ----------

function renderRawTable() {
  const rows = [...filteredRecords];
  sortRows(rows, rawSort);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  rawPage = Math.min(Math.max(1, rawPage), totalPages);
  const start = (rawPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  els.rawTbody.innerHTML = pageRows.map(r => `
    <tr>
      <td>${escapeHtml(r.date || '—')}</td>
      <td class="region-cell" style="--region-color:${regionColor(r.chihou)}">${escapeHtml(r.chihou || '—')}</td>
      <td>${escapeHtml(r.pref || '—')}</td>
      <td>${escapeHtml(r.brand || '—')}</td>
      <td>${escapeHtml(r.shop || '—')}</td>
      <td>${escapeHtml(r.chukai || '—')}</td>
      <td class="num">¥${Math.round(r.sales).toLocaleString('ja-JP')}</td>
      <td>${r.seiyaku ? '<span class="tag-seiyaku">成約</span>' : '<span class="tag-seiyaku tag-seiyaku--off">未成約</span>'}</td>
    </tr>
  `).join('');

  els.rawEmpty.hidden = rows.length > 0;
  els.pageInfo.textContent = `${rawPage} / ${totalPages} ページ（全 ${rows.length.toLocaleString('ja-JP')} 件）`;
  els.prevPage.disabled = rawPage <= 1;
  els.nextPage.disabled = rawPage >= totalPages;
}

// ---------- Sorting ----------

function sortRows(rows, sortState) {
  const { key, dir } = sortState;
  const mult = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const va = a[key], vb = b[key];
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
    if (typeof va === 'boolean' && typeof vb === 'boolean') return ((va === vb) ? 0 : va ? 1 : -1) * mult;
    return String(va || '').localeCompare(String(vb || ''), 'ja') * mult;
  });
}

function onSortClick(th, tableType) {
  const key = th.dataset.sort;
  const state = tableType === 'group' ? groupSort : rawSort;
  const tableId = tableType === 'group' ? '#groupTable' : '#rawTable';

  if (state.key === key) {
    state.dir = state.dir === 'desc' ? 'asc' : 'desc';
  } else {
    state.key = key;
    state.dir = 'desc';
  }

  document.querySelectorAll(`${tableId} thead th`).forEach(el => {
    el.classList.remove('is-sorted-desc', 'is-sorted-asc');
  });
  th.classList.add(state.dir === 'desc' ? 'is-sorted-desc' : 'is-sorted-asc');

  if (tableType === 'group') renderGroupTable(); else renderRawTable();
}

// ---------- Tabs ----------

function switchTab(tabName) {
  els.tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === tabName));
  els.groupPanel.hidden = tabName !== 'group';
  els.rawPanel.hidden = tabName !== 'raw';
}

// ---------- Utils ----------

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
