/* ===== UI 渲染 ===== */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

/* 预算进度状态：返回 {pct, cls, remainText} */
function budgetStatus(used, budget) {
  const pct = budget > 0 ? Math.min(used / budget, 1) : 0;
  const cls = budget > 0 && used > budget ? 'over' : (budget > 0 && used / budget > 0.8 ? 'warn' : '');
  let remainText;
  if (budget <= 0) remainText = '';
  else if (used > budget) remainText = `已超支 ${fmtMoney(used - budget)}`;
  else remainText = `剩余 ${fmtMoney(budget - used)}（可用 ${Math.round((1 - used / budget) * 100)}%）`;
  return { pct: budget > 0 ? pct : 0, cls, remainText };
}

/* ---------- 明细页 ---------- */
function renderLedger(cats, txs, month) {
  const sum = monthSummary(txs, month);
  document.getElementById('sum-expense').textContent = fmtMoney(sum.expense);
  document.getElementById('sum-income').textContent = fmtMoney(sum.income);
  document.getElementById('sum-balance').textContent = fmtMoney(sum.balance);
  document.getElementById('sum-balance').style.color = sum.balance < 0 ? 'var(--danger)' : '';

  // 迷你预算条
  const budgetEl = document.getElementById('budget-mini');
  getTotalBudget(month).then((b) => {
    if (b && b.amount > 0) {
      budgetEl.hidden = false;
      const st = budgetStatus(sum.expense, b.amount);
      document.getElementById('budget-mini-progress').textContent = `${Math.round(st.pct * 100)}% · ${fmtMoney(b.amount)}`;
      const fill = document.getElementById('budget-mini-fill');
      fill.style.width = `${st.pct * 100}%`;
      fill.className = 'progress-fill' + (st.cls ? ' ' + st.cls : '');
    } else {
      budgetEl.hidden = true;
    }
  });

  // 流水
  const monthTxs = txs.filter((t) => monthStr(t.date) === month)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  const list = document.getElementById('tx-list');
  const empty = document.getElementById('tx-empty');
  empty.classList.toggle('hidden', monthTxs.length > 0);
  list.innerHTML = '';

  if (!monthTxs.length) return;

  const byDay = new Map();
  for (const t of monthTxs) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }

  const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a));
  for (const day of days) {
    const items = byDay.get(day);
    const ds = daySummary(txs, day);
    const dayDiv = document.createElement('div');
    dayDiv.className = 'tx-day';

    const head = document.createElement('div');
    head.className = 'tx-day-head';
    head.innerHTML = `<span>${esc(fmtDayLabel(day))}</span>
      <span class="tx-day-sum">
        ${ds.expense ? `<span class="expense">-${fmtMoneyNoCur(ds.expense)}</span>` : ''}
        ${ds.expense && ds.income ? ' · ' : ''}
        ${ds.income ? `<span class="income">+${fmtMoneyNoCur(ds.income)}</span>` : ''}
      </span>`;
    dayDiv.appendChild(head);

    for (const t of items) {
      const icon = getCategoryIcon(cats, t.type, t.category);
      const item = document.createElement('div');
      item.className = 'tx-item';
      item.dataset.id = t.id;
      item.innerHTML = `
        <div class="tx-icon">${icon}</div>
        <div class="tx-info">
          <div class="tx-cat">${esc(t.category)}</div>
          ${t.note ? `<div class="tx-note">${esc(t.note)}</div>` : ''}
        </div>
        <div class="tx-amount ${t.type}">${t.type === 'expense' ? '-' : '+'}${fmtMoneyNoCur(t.amount)}</div>`;
      dayDiv.appendChild(item);
    }
    list.appendChild(dayDiv);
  }
}

/* ---------- 统计页 ---------- */
function renderStats(cats, txs, month, statType) {
  const { rows, total } = categoryStats(txs, month, statType);

  // 环形图
  drawDonut(document.getElementById('donut-chart'), rows.map((r) => ({ value: r.amount, label: r.name })));
  document.getElementById('donut-total').textContent = fmtMoney(total);

  // 图例
  const legend = document.getElementById('donut-legend');
  legend.innerHTML = '';
  if (!rows.length) {
    legend.innerHTML = '<div class="legend-row" style="color:var(--muted)">本月暂无数据</div>';
  }
  rows.slice(0, 6).forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `
      <span class="legend-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <span class="legend-name">${esc(r.name)}</span>
      <span class="legend-val">${fmtMoneyNoCur(r.amount)}</span>
      <span class="legend-pct">${(r.pct * 100).toFixed(1)}%</span>`;
    legend.appendChild(row);
  });

  // 近 6 月趋势
  drawBars(document.getElementById('bar-chart-wrap'), monthTrend(txs, 6));

  // 分类排行
  const rank = document.getElementById('rank-list');
  rank.innerHTML = '';
  if (!rows.length) {
    rank.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:8px">暂无数据</div>';
    return;
  }
  const maxAmount = rows[0].amount || 1;
  rows.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.innerHTML = `
      <div class="rank-icon">${getCategoryIcon(cats, statType, r.name)}</div>
      <div class="rank-name">${esc(r.name)}</div>
      <div class="rank-bar"><div class="rank-bar-fill" style="width:${(r.amount / maxAmount * 100).toFixed(1)}%;background:${PALETTE[i % PALETTE.length]}"></div></div>
      <div class="rank-val">${fmtMoneyNoCur(r.amount)}</div>`;
    rank.appendChild(row);
  });
}

/* ---------- 预算页 ---------- */
async function renderBudget(cats, txs, month) {
  const sum = monthSummary(txs, month);

  const totalB = await getTotalBudget(month);
  const amountEl = document.getElementById('budget-total-amount');
  const usedEl = document.getElementById('budget-total-used');
  const fillEl = document.getElementById('budget-total-fill');
  const remainEl = document.getElementById('budget-total-remain');

  if (totalB && totalB.amount > 0) {
    amountEl.textContent = fmtMoney(totalB.amount);
    usedEl.textContent = `已支出 ${fmtMoney(sum.expense)}`;
    const st = budgetStatus(sum.expense, totalB.amount);
    fillEl.style.width = `${st.pct * 100}%`;
    fillEl.className = 'progress-fill' + (st.cls ? ' ' + st.cls : '');
    remainEl.textContent = st.remainText;
    remainEl.className = 'budget-remain ' + (st.cls || 'ok');
    document.getElementById('btn-edit-total-budget').textContent = '修改';
  } else {
    amountEl.textContent = '未设置';
    usedEl.textContent = `本月已支出 ${fmtMoney(sum.expense)}`;
    fillEl.style.width = '0%';
    fillEl.className = 'progress-fill';
    remainEl.textContent = '设置预算后显示进度';
    remainEl.className = 'budget-remain';
    document.getElementById('btn-edit-total-budget').textContent = '设置';
  }

  // 分类预算
  const catBudgets = await getCategoryBudgets(month);
  const listEl = document.getElementById('cat-budget-list');
  const emptyEl = document.getElementById('cat-budget-empty');
  listEl.innerHTML = '';
  emptyEl.classList.toggle('hidden', catBudgets.length > 0);

  for (const b of catBudgets) {
    const used = txs.filter((t) => monthStr(t.date) === month && t.type === 'expense' && t.category === b.category)
      .reduce((s, t) => s + t.amount, 0);
    const st = budgetStatus(used, b.amount);
    const item = document.createElement('div');
    item.className = 'cat-budget-item';
    item.innerHTML = `
      <div class="cat-budget-row">
        <span class="cat-budget-icon">${getCategoryIcon(cats, 'expense', b.category)}</span>
        <span class="cat-budget-name">${esc(b.category)}</span>
        <span class="cat-budget-nums">${fmtMoneyNoCur(used)} / ${fmtMoneyNoCur(b.amount)}</span>
        <button class="cat-budget-del" data-cat="${esc(b.category)}" aria-label="删除预算">✕</button>
      </div>
      <div class="progress"><div class="progress-fill ${st.cls}" style="width:${st.pct * 100}%"></div></div>`;
    listEl.appendChild(item);
  }
}

/* ---------- 设置页 ---------- */
function renderSettings(cats) {
  for (const type of ['expense', 'income']) {
    const box = document.getElementById('cat-list-' + type);
    box.innerHTML = '';
    cats.filter((c) => c.type === type).forEach((c) => {
      const chip = document.createElement('span');
      chip.className = 'cat-chip';
      chip.innerHTML = `
        <button class="chip-move" data-id="${c.id}" data-dir="-1" aria-label="上移">↑</button>
        <span class="cat-chip-icon">${c.icon}</span>${esc(c.name)}
        ${c.custom ? `<button class="cat-chip-del" data-id="${c.id}" data-type="${type}" aria-label="删除${esc(c.name)}">✕</button>` : ''}
        <button class="chip-move" data-id="${c.id}" data-dir="1" aria-label="下移">↓</button>`;
      box.appendChild(chip);
    });
  }
}

/* ---------- 记账弹窗：分类九宫格（超过两行收起） ---------- */
function renderCatPicker(cats, type, selectedName, expanded) {
  const box = document.getElementById('cat-picker');
  box.innerHTML = '';
  const list = cats.filter((c) => c.type === type);
  const folded = list.length > 10 && !expanded;

  list.forEach((c, i) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cat-cell'
      + (c.name === selectedName ? ' active' : '')
      + (folded && i >= 10 ? ' cat-cell-hidden' : '');
    cell.dataset.name = c.name;
    cell.innerHTML = `<span class="cat-cell-icon">${c.icon}</span><span>${esc(c.name)}</span>`;
    box.appendChild(cell);
  });

  if (list.length > 10) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'cat-more-btn' + (!folded ? ' on' : '');
    more.innerHTML = folded ? '▼ 展开更多' : '▲ 收起';
    more.dataset.toggle = '1';
    box.appendChild(more);
  }
}

/* ---------- 分类预算编辑弹窗 ---------- */
async function renderBudgetModal(month, editCat) {
  const body = document.getElementById('budget-modal-body');
  const title = document.getElementById('budget-modal-title');

  if (editCat === 'total') {
    title.textContent = '设置本月总预算';
    const b = await getTotalBudget(month);
    body.innerHTML = `
      <div class="form-row" style="border:none">
        <span class="form-label">金额</span>
        <input id="budget-input" type="text" inputmode="decimal" placeholder="0.00" value="${b ? b.amount : ''}">
      </div>
      <div class="settings-desc" style="margin-top:4px">总预算用于本月整体超支提醒，可按月单独设置。</div>`;
    document.getElementById('btn-save-budget').dataset.kind = 'total';
    return;
  }

  const cats = await initCategories();
  if (editCat) {
    title.textContent = '编辑分类预算';
    const b = (await getCategoryBudgets(month)).find((x) => x.category === editCat);
    body.innerHTML = `
      <div class="form-row" style="border:none">
        <span class="form-label">分类</span>
        <span id="budget-cat-label">${getCategoryIcon(cats, 'expense', editCat)} ${esc(editCat)}</span>
      </div>
      <div class="form-row" style="border:none">
        <span class="form-label">金额</span>
        <input id="budget-input" type="text" inputmode="decimal" placeholder="0.00" value="${b ? b.amount : ''}">
      </div>`;
    document.getElementById('btn-save-budget').dataset.kind = 'cat';
    document.getElementById('btn-save-budget').dataset.cat = editCat;
  } else {
    title.textContent = '添加分类预算';
    const expenseCats = cats.filter((c) => c.type === 'expense');
    body.innerHTML = `
      <div class="form-row" style="border:none">
        <span class="form-label">分类</span>
        <select id="budget-cat-select" style="flex:1;font-size:16px;background:none;border:none;outline:none;color:var(--text)">
          ${expenseCats.map((c) => `<option value="${esc(c.name)}">${c.icon} ${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row" style="border:none">
        <span class="form-label">金额</span>
        <input id="budget-input" type="text" inputmode="decimal" placeholder="0.00">
      </div>`;
    document.getElementById('btn-save-budget').dataset.kind = 'newcat';
  }
}
