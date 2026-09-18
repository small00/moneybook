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
  const W = 340, H = 190, topPad = 18, bottomPad = 26;
  const chartH = H - topPad - bottomPad;
  const groupW = W / data.length;
  const maxVal = Math.max(1, ...data.flatMap((d) => [d.expense, d.income]));
  const niceMax = niceCeil(maxVal);
  const y = (v) => topPad + chartH * (1 - v / niceMax);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' }, container);

  // 网格线 + Y 标签
  for (let i = 0; i <= 2; i++) {
    const v = niceMax * i / 2;
    const yy = y(v);
    el('line', { x1: 6, y1: yy, x2: W - 6, y2: yy, stroke: 'var(--border)', 'stroke-width': 1, 'stroke-dasharray': i === 0 ? '0' : '3 4' }, svg);
    el('text', { x: 2, y: yy + 4, 'font-size': 10, fill: 'var(--muted)' }, svg).textContent = i === 0 ? '' : compactMoney(v);
  }

  const barW = Math.min(14, groupW * 0.26);

  data.forEach((d, i) => {
    const cx = i * groupW + groupW / 2;

    // 支出（红）
    if (d.expense > 0) {
      el('rect', {
        x: cx - barW - 1, y: y(d.expense), width: barW, height: Math.max(chartH * d.expense / niceMax, 1),
        rx: 3, fill: '#ef4444'
      }, svg);
    }
    // 收入（绿）
    if (d.income > 0) {
      el('rect', {
        x: cx + 1, y: y(d.income), width: barW, height: Math.max(chartH * d.income / niceMax, 1),
        rx: 3, fill: '#10b981'
      }, svg);
    }

    // 月份标签（当前月高亮）
    const label = d.month.slice(5) + '月';
    const text = el('text', {
      x: cx, y: H - 8, 'font-size': 10, 'text-anchor': 'middle',
      fill: i === data.length - 1 ? 'var(--primary)' : 'var(--muted)',
      'font-weight': i === data.length - 1 ? 700 : 400
    }, svg);
    text.textContent = label;
  });

  // 图例
  const legend = el('g', { transform: `translate(0, ${topPad - 14})` }, svg);
  el('rect', { x: 0, y: 0, width: 8, height: 8, rx: 2, fill: '#ef4444' }, legend);
  el('text', { x: 12, y: 8, 'font-size': 10, fill: 'var(--muted)' }, legend).textContent = '支出';
  el('rect', { x: 52, y: 0, width: 8, height: 8, rx: 2, fill: '#10b981' }, legend);
  el('text', { x: 64, y: 8, 'font-size': 10, fill: 'var(--muted)' }, legend).textContent = '收入';
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
