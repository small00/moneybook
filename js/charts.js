/* ===== SVG 图表（零依赖） ===== */

const NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#64748b'];

function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

/* 紧凑金额：12345 → 1.2万，8600 → 8600 */
function compactMoney(n) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

/* ---------- 环形饼图 ----------
 * data: [{value, label}]，颜色自动取调色板
 */
function drawDonut(svg, data) {
  svg.innerHTML = '';
  const C = 2 * Math.PI * 80; // r = 80
  const total = data.reduce((s, d) => s + d.value, 0);

  if (total <= 0) {
    el('circle', { cx: 100, cy: 100, r: 80, fill: 'none', stroke: 'var(--border)', 'stroke-width': 26 }, svg);
    return;
  }

  let offset = 0;
  data.forEach((d, i) => {
    const frac = d.value / total;
    const len = Math.max(frac * C - 3, 0.5); // 段间留 3 单位缝隙
    el('circle', {
      cx: 100, cy: 100, r: 80, fill: 'none',
      stroke: PALETTE[i % PALETTE.length],
      'stroke-width': 26,
      'stroke-dasharray': `${len} ${C - len}`,
      'stroke-dashoffset': -offset,
      'stroke-linecap': 'butt'
    }, svg);
    offset += frac * C;
  });
}

/* ---------- 柱状图（近 N 月收支对比） ----------
 * data: [{month, expense, income}]
 */
function drawBars(container, data) {
  container.innerHTML = '';
  const W = 340, H = 210;
  const topPad = 34;     // 顶部：图例 + 数值标签空间
  const bottomPad = 26;  // 月份标签
  const chartH = H - topPad - bottomPad;
  const groupW = W / data.length;
  const maxVal = Math.max(1, ...data.flatMap((d) => [d.expense, d.income]));
  const niceMax = niceCeil(maxVal);
  const y = (v) => topPad + chartH * (1 - v / niceMax);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' }, container);

  // 渐变定义
  const defs = el('defs', {}, svg);
  el('linearGradient', { id: 'g-exp', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#fca5a5' }, defs);
  el('stop', { offset: '100%', 'stop-color': '#dc2626' }, defs);
  el('linearGradient', { id: 'g-inc', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#6ee7b7' }, defs);
  el('stop', { offset: '100%', 'stop-color': '#059669' }, defs);

  // 网格线 + Y 轴标签
  for (let i = 0; i <= 2; i++) {
    const v = niceMax * i / 2;
    const yy = y(v);
    el('line', {
      x1: 6, y1: yy, x2: W - 6, y2: yy,
      stroke: 'var(--border)', 'stroke-width': 1,
      'stroke-dasharray': i === 0 ? '0' : '3 4'
    }, svg);
    if (i > 0) {
      const t = el('text', { x: 4, y: yy + 3, 'font-size': 9, fill: 'var(--muted)', 'text-anchor': 'end' }, svg);
      t.textContent = compactMoney(v);
    }
  }

  // 图例（右上角）
  el('rect', { x: W - 112, y: 8, width: 8, height: 8, rx: 2, fill: '#dc2626' }, svg);
  el('text', { x: W - 100, y: 16, 'font-size': 10, fill: 'var(--muted)' }, svg).textContent = '支出';
  el('rect', { x: W - 56, y: 8, width: 8, height: 8, rx: 2, fill: '#059669' }, svg);
  el('text', { x: W - 44, y: 16, 'font-size': 10, fill: 'var(--muted)' }, svg).textContent = '收入';

  // 柱子 + 数值标签 + 月份标签
  const barW = Math.min(16, groupW * 0.28);
  data.forEach((d, i) => {
    const cx = i * groupW + groupW / 2;

    if (d.expense > 0) {
      const h = Math.max(chartH * d.expense / niceMax, 3);
      el('rect', {
        x: cx - barW - 1.5, y: y(d.expense), width: barW, height: h,
        rx: 4, fill: 'url(#g-exp)'
      }, svg);
      const t = el('text', {
        x: cx - barW - 1.5 + barW / 2, y: y(d.expense) - 5,
        'font-size': 9, fill: 'var(--muted)', 'text-anchor': 'middle'
      }, svg);
      t.textContent = compactMoney(d.expense);
    }

    if (d.income > 0) {
      const h = Math.max(chartH * d.income / niceMax, 3);
      el('rect', {
        x: cx + 1.5, y: y(d.income), width: barW, height: h,
        rx: 4, fill: 'url(#g-inc)'
      }, svg);
      const t = el('text', {
        x: cx + 1.5 + barW / 2, y: y(d.income) - 5,
        'font-size': 9, fill: 'var(--muted)', 'text-anchor': 'middle'
      }, svg);
      t.textContent = compactMoney(d.income);
    }

    const label = d.month.slice(5) + '月';
    const text = el('text', {
      x: cx, y: H - 6, 'font-size': 10, 'text-anchor': 'middle',
      fill: i === data.length - 1 ? 'var(--primary)' : 'var(--muted)',
      'font-weight': i === data.length - 1 ? 700 : 500
    }, svg);
    text.textContent = label;
  });
}

/* 向上取整到 1/2/5 × 10^k */
function niceCeil(v) {
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  let nf;
  if (f <= 1) nf = 1;
  else if (f <= 2) nf = 2;
  else if (f <= 5) nf = 5;
  else nf = 10;
  return nf * base;
}
