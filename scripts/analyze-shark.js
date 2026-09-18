/* 解析鲨鱼记账 CSV（UTF-16 LE + Tab 分隔），输出统计信息 */
const fs = require('fs');

const FILES = [
  process.argv[2],
  process.argv[3]
];

function readRows(path) {
  const buf = fs.readFileSync(path);
  let text = buf.toString('utf16le');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(1) // 跳表头
    .map((l) => l.split('\t'));
}

const all = [];
for (const f of FILES) {
  const rows = readRows(f);
  console.log(`[${f.split(/[\\/]/).pop()}] 记录数: ${rows.length}`);
  for (const r of rows) {
    all.push({ date: r[0], type: r[1], cat: r[2], account: r[3], amount: r[4], note: r[5] || '' });
  }
}

console.log(`\n合并记录数: ${all.length}`);

// 重复检查（日期+类型+分类+金额+备注 全同）
const key = (t) => `${t.date}|${t.type}|${t.cat}|${t.amount}|${t.note}`;
const seen = new Map();
const dups = [];
for (const t of all) {
  const k = key(t);
  if (seen.has(k)) dups.push({ dup: t, first: seen.get(k) });
  else seen.set(k, t);
}
console.log(`重复记录: ${dups.length}`);
dups.slice(0, 10).forEach((d) => console.log(`  重复: ${JSON.stringify(d.dup)}`));

// 日期范围
const dates = all.map((t) => t.date).sort();
console.log(`日期范围: ${dates[0]} ~ ${dates[dates.length - 1]}`);

// 类别统计
const cats = {};
for (const t of all) {
  const key2 = `${t.type}:${t.cat}`;
  cats[key2] = (cats[key2] || 0) + 1;
}
console.log('\n类别统计（类型:分类 = 笔数）:');
Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k} = ${v}`));

// 金额合计与无效数据
let sumExpense = 0, sumIncome = 0, invalid = 0;
for (const t of all) {
  const n = parseFloat(t.amount);
  if (isNaN(n)) { invalid++; console.log(`  无效金额: ${JSON.stringify(t)}`); continue; }
  if (t.type === '收入') sumIncome += n;
  else if (t.type === '支出') sumExpense += n;
  else { invalid++; console.log(`  未知类型: ${JSON.stringify(t)}`); }
}
console.log(`\n支出合计: ${sumExpense.toFixed(2)}  收入合计: ${sumIncome.toFixed(2)}  无效记录: ${invalid}`);
