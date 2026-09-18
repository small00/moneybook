/* ===== 业务数据层 + 统计计算 ===== */

const PRESET_CATEGORIES = [
  { type: 'expense', name: '餐饮', icon: '🍜' },
  { type: 'expense', name: '交通', icon: '🚌' },
  { type: 'expense', name: '购物', icon: '🛒' },
  { type: 'expense', name: '居住', icon: '🏠' },
  { type: 'expense', name: '娱乐', icon: '🎮' },
  { type: 'expense', name: '医疗', icon: '💊' },
  { type: 'expense', name: '教育', icon: '📚' },
  { type: 'expense', name: '人情', icon: '🎁' },
  { type: 'expense', name: '旅行', icon: '✈️' },
  { type: 'expense', name: '其他', icon: '📦' },
  { type: 'income', name: '工资', icon: '💼' },
  { type: 'income', name: '奖金', icon: '🧧' },
  { type: 'income', name: '理财', icon: '📈' },
  { type: 'income', name: '兼职', icon: '💪' },
  { type: 'income', name: '红包', icon: '🧧' },
  { type: 'income', name: '其他', icon: '📦' }
];

/* ---------- 工具 ---------- */
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthStr(dateStr) { return dateStr.slice(0, 7); }

function currentMonth() { return monthStr(todayStr()); }

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function fmtMoney(n) {
  return '¥' + (n == null ? 0 : n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoneyNoCur(n) {
  return (n == null ? 0 : n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* 月份标签：2025-01 → 2025年1月 */
function fmtMonth(month) {
  const [y, m] = month.split('-');
  return `${y}年${parseInt(m, 10)}月`;
}

/* 日期显示：今天/昨天/M月d日 */
function fmtDayLabel(dateStr) {
  const today = todayStr();
  if (dateStr === today) return '今天';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yStr = `${y.getFullYear()}-${pad2(y.getMonth() + 1)}-${pad2(y.getDate())}`;
  if (dateStr === yStr) return '昨天';
  const d = new Date(dateStr + 'T00:00:00');
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`;
}

/* 日期显示：2026-09-18 → 2026年9月18日 */
function fmtDateCN(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/* ---------- 分类 ---------- */
async function initCategories() {
  const list = await DB.getAll('categories');
  if (list.length === 0) {
    const seed = PRESET_CATEGORIES.map((c, i) => ({
      id: 'preset-' + i,
      type: c.type,
      name: c.name,
      icon: c.icon,
      custom: false,
      sort: i
    }));
    await DB.bulkPut('categories', seed);
    return seed;
  }
  return list.sort((a, b) => a.sort - b.sort);
}

async function addCategory(type, name, icon) {
  const list = await DB.getAll('categories');
  const maxSort = list.filter((c) => c.type === type).reduce((m, c) => Math.max(m, c.sort), -1);
  const cat = { id: uid(), type, name, icon, custom: true, sort: maxSort + 1 };
  await DB.put('categories', cat);
  return cat;
}

/* 删除自定义分类：同时把该分类的账单改为"其他" */
async function deleteCategory(catId, type) {
  const list = await DB.getAll('categories');
  const cat = list.find((c) => c.id === catId);
  if (!cat || !cat.custom) return;
  const fallback = list.find((c) => c.type === type && c.name === '其他') || list.find((c) => c.type === type);
  const txs = await DB.getAll('transactions');
  const changed = txs.filter((t) => t.category === cat.name && t.type === type);
  for (const t of changed) {
    t.category = fallback ? fallback.name : '其他';
    await DB.put('transactions', t);
  }
  await DB.del('categories', catId);
}

function getCategoryIcon(list, type, name) {
  const c = list.find((x) => x.type === type && x.name === name);
  return c ? c.icon : '📦';
}

/* ---------- 账单 ---------- */
async function addTx({ type, amount, category, note, date }) {
  const tx = {
    id: uid(),
    type,
    amount: round2(Math.abs(Number(amount))),
    category,
    note: (note || '').trim(),
    date,
    createdAt: Date.now()
  };
  await DB.put('transactions', tx);
  return tx;
}

async function updateTx(id, patch) {
  const tx = await DB.get('transactions', id);
  if (!tx) return null;
  if (patch.type !== undefined) tx.type = patch.type;
  if (patch.amount !== undefined) tx.amount = round2(Math.abs(Number(patch.amount)));
  if (patch.category !== undefined) tx.category = patch.category;
  if (patch.note !== undefined) tx.note = (patch.note || '').trim();
  if (patch.date !== undefined) tx.date = patch.date;
  await DB.put('transactions', tx);
  return tx;
}

async function deleteTx(id) {
  await DB.del('transactions', id);
}

async function getAllTx() {
  return DB.getAll('transactions');
}

/* ---------- 预算 ---------- */
const BUDGET_TOTAL_ID = 'total';

async function setTotalBudget(month, amount) {
  const b = { id: BUDGET_TOTAL_ID, month, amount: round2(Math.abs(Number(amount))) };
  await DB.put('budgets', b);
  return b;
}

async function getTotalBudget(month) {
  const b = await DB.get('budgets', BUDGET_TOTAL_ID);
  return b && b.month === month ? b : null;
}

async function setCategoryBudget(month, category, amount) {
  const id = 'cat:' + month + ':' + category;
  const b = { id, month, category, amount: round2(Math.abs(Number(amount))) };
  await DB.put('budgets', b);
  return b;
}

async function getCategoryBudgets(month) {
  const all = await DB.getAll('budgets');
  return all.filter((b) => b.month === month && b.id !== BUDGET_TOTAL_ID);
}

async function deleteCategoryBudget(month, category) {
  await DB.del('budgets', 'cat:' + month + ':' + category);
}

/* ---------- 统计 ---------- */
function monthSummary(txs, month) {
  let expense = 0, income = 0;
  for (const t of txs) {
    if (monthStr(t.date) !== month) continue;
    if (t.type === 'expense') expense = round2(expense + t.amount);
    else income = round2(income + t.amount);
  }
  return { expense, income, balance: round2(income - expense) };
}

function daySummary(txs, day) {
  let expense = 0, income = 0;
  for (const t of txs) {
    if (t.date !== day) continue;
    if (t.type === 'expense') expense = round2(expense + t.amount);
    else income = round2(income + t.amount);
  }
  return { expense, income };
}

/* 分类汇总：返回 [{name, icon, total, pct}]，按金额降序 */
function categoryStats(txs, month, type) {
  const map = new Map();
  let total = 0;
  for (const t of txs) {
    if (monthStr(t.date) !== month || t.type !== type) continue;
    const cur = map.get(t.category) || 0;
    map.set(t.category, round2(cur + t.amount));
    total = round2(total + t.amount);
  }
  const rows = [...map.entries()]
    .map(([name, amount]) => ({ name, amount, pct: total > 0 ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { rows, total };
}

/* 近 n 个月收支趋势（含当月） */
function monthTrend(txs, n = 6) {
  const now = new Date();
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return months.map((month) => {
    const s = monthSummary(txs, month);
    return { month, expense: s.expense, income: s.income };
  });
}

/* 导出/导入备份 */
async function exportBackup() {
  const [transactions, budgets, categories] = await Promise.all([
    DB.getAll('transactions'),
    DB.getAll('budgets'),
    DB.getAll('categories')
  ]);
  return {
    app: 'moneybook',
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions,
    budgets,
    categories
  };
}

async function importBackup(data) {
  if (!data || data.app !== 'moneybook') throw new Error('不是有效的备份文件');
  await Promise.all([
    DB.clear('transactions'),
    DB.clear('budgets'),
    DB.clear('categories')
  ]);
  await DB.bulkPut('transactions', data.transactions || []);
  await DB.bulkPut('budgets', data.budgets || []);
  if (data.categories && data.categories.length) {
    await DB.bulkPut('categories', data.categories);
  } else {
    await initCategories();
  }
}
