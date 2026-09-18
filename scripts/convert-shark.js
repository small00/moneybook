/* 鲨鱼记账 CSV → 记账本备份 JSON
 * 用法: node convert-shark.js <csv1> <csv2> <输出.json>
 * 输出与记账本"导出备份"同格式，手机端设置页"导入备份"即可恢复
 */
const fs = require('fs');

const [,, f1, f2, out] = process.argv;

/* ---------- 预设分类（与 js/store.js 保持一致） ---------- */
const PRESET = [
  ['expense', '餐饮', '🍜'], ['expense', '交通', '🚌'], ['expense', '购物', '🛒'],
  ['expense', '居住', '🏠'], ['expense', '娱乐', '🎮'], ['expense', '医疗', '💊'],
  ['expense', '教育', '📚'], ['expense', '人情', '🎁'], ['expense', '旅行', '✈️'],
  ['expense', '其他', '📦'],
  ['income', '工资', '💼'], ['income', '奖金', '🧧'], ['income', '理财', '📈'],
  ['income', '兼职', '💪'], ['income', '红包', '🧧'], ['income', '其他', '📦']
];

/* 鲨鱼分类 → 记账本分类映射（null 表示保留原名建自定义分类） */
const MAP = {
  '餐饮': '餐饮', '购物': '购物', '娱乐': '娱乐', '交通': '交通', '医疗': '医疗',
  '住房': '居住', '学习': '教育', '其它': '其他',
  '工资': '工资'
};
/* 保留原名、自动建自定义分类的（含图标） */
const CUSTOM_ICONS = {
  '烟酒': '🍺', '运动': '🏋️', '汽车': '🚗', '长辈': '🧓', '日用': '🧻', '零食': '🍿', '社交': '🤝'
};

function readRows(path) {
  let text = fs.readFileSync(path).toString('utf16le');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(1).map((l) => l.split('\t'));
}

function parseDateCN(s) {
  const m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${p(+m[2])}-${p(+m[3])}`;
}

/* ---------- 解析合并 ---------- */
const raw = [];
for (const f of [f1, f2]) {
  for (const r of readRows(f)) raw.push({ date: r[0], type: r[1], cat: r[2], amount: parseFloat(r[4]), note: (r[5] || '').trim() });
}

/* 去重（日期+类型+分类+金额+备注 全同） */
const seen = new Set();
const uniq = [];
for (const t of raw) {
  const k = `${t.date}|${t.type}|${t.cat}|${t.amount}|${t.note}`;
  if (seen.has(k)) continue;
  seen.add(k);
  uniq.push(t);
}

/* ---------- 分类集合 ---------- */
const customCats = [];
const catMap = {}; // 原始分类名 → 最终分类名
for (const t of uniq) {
  const mapped = MAP[t.cat];
  if (mapped) { catMap[t.cat] = mapped; continue; }
  if (CUSTOM_ICONS[t.cat]) {
    catMap[t.cat] = t.cat;
    if (!customCats.find((c) => c.name === t.cat)) {
      customCats.push({ name: t.cat, type: t.type === '收入' ? 'income' : 'expense', icon: CUSTOM_ICONS[t.cat] });
    }
  } else {
    // 未预料的分类：保留原名，图标给 📦
    catMap[t.cat] = t.cat;
    if (!customCats.find((c) => c.name === t.cat)) {
      customCats.push({ name: t.cat, type: t.type === '收入' ? 'income' : 'expense', icon: '📦' });
    }
  }
}

/* ---------- 生成数据 ---------- */
const categories = PRESET.map(([type, name, icon], i) => ({
  id: 'preset-' + i, type, name, icon, custom: false, sort: i
}));
customCats.forEach((c, i) => {
  categories.push({
    id: 'import-cat-' + (i + 1), type: c.type, name: c.name, icon: c.icon, custom: true, sort: 100 + i
  });
});

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const transactions = uniq.map((t, i) => {
  const date = parseDateCN(t.date);
  const type = t.type === '收入' ? 'income' : 'expense';
  return {
    id: 'imp-' + String(i + 1).padStart(5, '0'),
    type,
    amount: r2(Math.abs(t.amount)),
    category: catMap[t.cat],
    note: t.note,
    date,
    createdAt: Date.parse(date + 'T12:00:00') + i
  };
}).filter((t) => t.date);

const backup = {
  app: 'moneybook',
  version: 1,
  exportedAt: new Date().toISOString(),
  transactions,
  budgets: [],
  categories
};

fs.writeFileSync(out, JSON.stringify(backup, null, 2), 'utf8');

/* ---------- 输出统计 ---------- */
let sumE = 0, sumI = 0;
for (const t of transactions) {
  if (t.type === 'expense') sumE += t.amount;
  else sumI += t.amount;
}
console.log(`原始记录: ${raw.length}`);
console.log(`去重后: ${uniq.length}  (去重 ${raw.length - uniq.length} 条)`);
console.log(`导出记录: ${transactions.length}`);
console.log(`支出合计: ¥${sumE.toFixed(2)}  收入合计: ¥${sumI.toFixed(2)}`);
console.log(`分类总数: ${categories.length} (预设 ${PRESET.length} + 自定义 ${customCats.length})`);
console.log(`自定义分类: ${customCats.map((c) => c.name).join('、')}`);
console.log(`\n已写入: ${out}`);
