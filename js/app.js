/* ===== 主逻辑 ===== */
(function () {
  'use strict';

  const state = {
    cats: [],
    txs: [],
    month: currentMonth(),
    page: 'ledger',
    statType: 'expense',
    editingId: null,     // 正在编辑的流水 id
    addType: 'expense',  // 记账弹窗当前类型
    addCategory: '餐饮', // 记账弹窗当前分类
    addDate: todayStr(), // 记账弹窗当前日期
    catExpanded: false,  // 记账弹窗分类是否展开
    catDetail: null,     // 统计页正在查看的分类明细 {type, category}
    modalYear: 0,        // 月份选择弹窗当前年份
    search: '',          // 明细页搜索关键词（跨月搜索）
    ledgerLimit: 80,     // 明细页当前渲染条数（长列表分段加载）
    npAcc: '',           // 键盘：已确定的数值（左操作数 / 中间结果）
    npOp: null,          // 键盘：当前运算符 '+' | '-'
    npCur: '',           // 键盘：正在输入的数字
    cloud: { token: '', repo: 'small00/moneybook-backup', auto: false, last: null }
  };

  /* 数据变更标记：写操作后置位 → 下次 refresh 才重读 IndexedDB；
     每页记录上次渲染的特征，特征未变就跳过重建（切页不再整页重画、不闪） */
  let _dataDirty = true;
  const _pageKeys = {};

  const $ = (id) => document.getElementById(id);

  /* ---------- Toast ---------- */
  let _toastTimer = null;
  function toast(msg) {
    let t = $('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    state.cats = await initCategories();
    state.txs = await getAllTx();
    _dataDirty = false;
    // 打开时落在最近有记录的月份：当前月还没有记录时不再让用户看到空白页
    state.month = pickInitialMonth(state.txs);
    state.addCategory = state.cats.find((c) => c.type === 'expense' && c.name === '餐饮')
      ? '餐饮' : state.cats.find((c) => c.type === 'expense').name;

    // 加载云配置（IndexedDB）；旧版 localStorage 里的配置迁移过来
    const saved = await getSetting('cloud');
    if (saved) state.cloud = Object.assign(state.cloud, saved);
    const legacyToken = localStorage.getItem('mbCloudToken');
    const legacyRepo = localStorage.getItem('mbCloudRepo');
    const legacyAuto = localStorage.getItem('mbCloudAuto');
    const legacyLast = localStorage.getItem('mbCloudLast');
    if (legacyToken || legacyRepo || legacyAuto || legacyLast) {
      if (legacyToken && !state.cloud.token) state.cloud.token = legacyToken;
      if (legacyRepo && !saved) state.cloud.repo = legacyRepo;
      if (legacyAuto && !saved) state.cloud.auto = legacyAuto === '1';
      if (legacyLast && !state.cloud.last) state.cloud.last = legacyLast;
      await saveCloudCfg();
      ['mbCloudToken', 'mbCloudRepo', 'mbCloudAuto', 'mbCloudLast'].forEach((k) => localStorage.removeItem(k));
    }

    bindEvents();
    switchPage('ledger');
    updateHeader();
    registerSW();
    setupChromeOffset();
    setupSheetDrag();
  }

  /* iOS 键盘/Safari 工具栏补偿：
   * 底部固定元素（导航/记账按钮/toast/弹窗）按被占用的底部高度动态避让。
   * 金额键盘已固定在记账弹窗底部，因此不再需要把弹窗内容滚到底去找保存键 */
  function setupChromeOffset() {
    if (!window.visualViewport) return;
    const vv = window.visualViewport;
    const apply = () => {
      const h = window.innerHeight - vv.height;
      document.documentElement.style.setProperty('--chrome-h', Math.max(h, 0) + 'px');
    };
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    apply();
  }

  /* ---------- 刷新当前页 ---------- */
  /* 写操作后调用：标记数据已变，并让所有页面下次访问时重建 */
  function invalidate() {
    _dataDirty = true;
    Object.keys(_pageKeys).forEach((k) => delete _pageKeys[k]);
  }

  /* 每页的渲染特征：相同就不重建 DOM（切页只切换可见性） */
  function pageKey(page) {
    const n = state.txs.length;
    if (page === 'ledger') return [state.month, state.search, state.ledgerLimit, n].join('|');
    if (page === 'stats') return [state.month, state.statType, state.catDetail ? state.catDetail.category : '', n].join('|');
    if (page === 'budget') return [state.month, n].join('|');
    return [state.cats.length, n].join('|');
  }

  async function refresh(opts) {
    const o = opts || {};
    if (_dataDirty) {
      state.txs = await getAllTx();
      _dataDirty = false;
    }

    // 分类明细弹窗独立于当前页，需要跟着数据一起刷新
    if (state.catDetail && !o.skipCatDetail) {
      renderCatDetail(state.cats, state.txs, state.month, state.catDetail.type, state.catDetail.category);
    }

    const page = state.page;
    const key = pageKey(page);
    if (!o.force && _pageKeys[page] === key) { renderCloudStatus(); return; }
    _pageKeys[page] = key;

    if (page === 'ledger') renderLedger(state.cats, state.txs, state.month, state.search, state.ledgerLimit);
    else if (page === 'stats') renderStats(state.cats, state.txs, state.month, state.statType);
    else if (page === 'budget') renderBudget(state.cats, state.txs, state.month);
    else renderSettings(state.cats);
    renderCloudStatus();
  }

  /* 启动时落在最近有记录的月份：当前月还没有任何记录时，直接跳到有数据的那一个月 */
  function pickInitialMonth(txs) {
    const cur = currentMonth();
    if (!txs.length) return cur;
    if (txs.some((t) => monthStr(t.date) === cur)) return cur;
    const months = txs.map((t) => monthStr(t.date)).filter(Boolean).sort();
    return months.length ? months[months.length - 1] : cur;
  }

  function updateHeader() {
    $('month-label').textContent = fmtMonth(state.month) + ' ▾';
    const showSwitch = state.page !== 'settings';
    $('month-switch').classList.toggle('hidden', !showSwitch);
    const titles = { ledger: '明细', stats: '统计', budget: '预算', settings: '设置' };
    $('header-title').textContent = titles[state.page];
  }

  function switchPage(page) {
    state.page = page;
    document.querySelectorAll('.page').forEach((el) => el.classList.add('hidden'));
    $('page-' + page).classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });
    updateHeader();
    refresh();
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    // Tab 切换
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchPage(btn.dataset.page));
    });

    // 明细页搜索（跨全部月份，180ms 防抖）
    let searchTimer = null;
    const applySearch = () => {
      const val = $('input-search').value.trim();
      $('btn-search-clear').hidden = !val;
      state.search = val;
      state.ledgerLimit = 80;
      delete _pageKeys.ledger;
      if (state.page !== 'ledger') switchPage('ledger');
      else refresh({ force: true });
    };
    $('input-search').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applySearch, 180);
    });
    $('input-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('input-search').blur(); }
    });
    $('btn-search-clear').addEventListener('click', () => {
      $('input-search').value = '';
      $('btn-search-clear').hidden = true;
      state.search = '';
      state.ledgerLimit = 80;
      delete _pageKeys.ledger;
      refresh({ force: true });
    });

    // 明细长列表：一次多渲染 120 条
    $('tx-list').addEventListener('click', (e) => {
      if (!e.target.closest('#btn-load-more')) return;
      state.ledgerLimit += 120;
      delete _pageKeys.ledger;
      refresh({ force: true });
    });

    // 月份切换
    $('month-prev').addEventListener('click', () => shiftMonth(-1));
    $('month-next').addEventListener('click', () => shiftMonth(1));
    $('month-today').addEventListener('click', () => {
      state.month = currentMonth();
      updateHeader();
      refresh();
    });

    // 月份选择弹窗（点月份标签弹出）
    $('month-label').addEventListener('click', openMonthModal);
    $('btn-close-month').addEventListener('click', closeMonthModal);
    $('modal-month').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeMonthModal(); });
    $('month-year-prev').addEventListener('click', () => { state.modalYear--; renderMonthModal(); });
    $('month-year-next').addEventListener('click', () => { state.modalYear++; renderMonthModal(); });
    $('month-grid').addEventListener('click', (e) => {
      const cell = e.target.closest('.month-cell');
      if (!cell) return;
      state.month = `${state.modalYear}-${pad2(Number(cell.dataset.month))}`;
      closeMonthModal();
      updateHeader();
      refresh();
    });
    $('btn-month-today').addEventListener('click', () => {
      state.month = currentMonth();
      closeMonthModal();
      updateHeader();
      refresh();
    });

    // 日期选择弹窗（记账弹窗内点日期弹出，滚轮选择）
    // 日期行整行都能点开滚轮（不必非点右边那个箭头）；
    // 但点在具体某个日期上时不算 —— 那是直接选那天
    $('date-row').addEventListener('click', (e) => {
      if (e.target.closest('.date-chip')) return;
      openDateModal();
    });
    $('btn-close-date').addEventListener('click', closeDateModal);
    $('modal-date').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDateModal(); });
    watchWheel($('wheel-year'), rebuildDayWheel);
    watchWheel($('wheel-month'), rebuildDayWheel);
    $('btn-date-ok').addEventListener('click', () => {
      const y = Number(readWheel($('wheel-year')));
      const m = Number(readWheel($('wheel-month')));
      const d = Number(readWheel($('wheel-day')));
      if (!y || !m || !d) { toast('请选择日期'); return; }
      state.addDate = `${y}-${pad2(m)}-${pad2(d)}`;
      updateDateQuick();
      closeDateModal();
    });
    $('btn-date-cancel').addEventListener('click', closeDateModal);

    // 日期快捷条：点哪个 chip 就记哪天（前几天在左、今天在右）
    $('date-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.date-chip');
      if (!chip) return;
      state.addDate = chip.dataset.date;
      updateDateQuick();
    });

    // 备注：回车即收起系统键盘
    $('input-note').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('input-note').blur(); }
    });

    // 记账
    $('fab').addEventListener('click', () => openAddModal());
    $('btn-close-add').addEventListener('click', closeAddModal);
    $('modal-add').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAddModal(); });

    // 类型切换
    $('type-expense').addEventListener('click', () => setAddType('expense'));
    $('type-income').addEventListener('click', () => setAddType('income'));

    // 分类选择（事件委托）
    $('cat-picker').addEventListener('click', (e) => {
      const more = e.target.closest('.cat-more-btn');
      if (more) {
        state.catExpanded = !state.catExpanded;
        renderCatPicker(state.cats, state.addType, state.addCategory, state.catExpanded);
        return;
      }
      const cell = e.target.closest('.cat-cell');
      if (!cell) return;
      document.querySelectorAll('.cat-cell').forEach((c) => c.classList.remove('active'));
      cell.classList.remove('cat-cell-hidden'); // 已展开时才可能点到隐藏项，兜底
      cell.classList.add('active');
      state.addCategory = cell.dataset.name;
    });

    // 内置金额键盘（数字键 + 今天/＋/－/完成）
    $('numpad').addEventListener('click', (e) => {
      if (e.target.closest('#btn-np-save')) { saveTx(); return; }
      if (e.target.closest('#np-today')) { npToday(); return; }
      const op = e.target.closest('.np-fn[data-op]');
      if (op) { npOperator(op.dataset.op); return; }
      const key = e.target.closest('.np-key');
      if (key) npInput(key.dataset.k);
    });

    // 流水行操作：点一下直接进编辑，左滑露出删除（委托到 document，明细页与分类明细共用）
    document.addEventListener('click', onTxRowClick);
    setupTxSwipe();

    // 预算
    $('btn-edit-total-budget').addEventListener('click', () => openBudgetModal('total'));
    $('btn-add-cat-budget').addEventListener('click', () => openBudgetModal(null));
    $('cat-budget-list').addEventListener('click', async (e) => {
      const del = e.target.closest('.cat-budget-del');
      if (!del) return;
      await deleteCategoryBudget(state.month, del.dataset.cat);
      toast('已删除');
      invalidate();
      refresh();
    });
    $('btn-close-budget').addEventListener('click', closeBudgetModal);
    $('modal-budget').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeBudgetModal(); });
    $('btn-save-budget').addEventListener('click', saveBudget);

    // 设置：分类管理
    $('btn-add-cat-expense').addEventListener('click', () => openCatModal('expense'));
    $('btn-add-cat-income').addEventListener('click', () => openCatModal('income'));
    $('page-settings').addEventListener('click', async (e) => {
      const move = e.target.closest('.chip-move');
      if (move) {
        await moveCategory(move.dataset.id, Number(move.dataset.dir));
        state.cats = await initCategories();
        invalidate();
        renderSettings(state.cats);
        return;
      }
      const del = e.target.closest('.cat-chip-del');
      if (del) {
        await deleteCategory(del.dataset.id, del.dataset.type);
        state.cats = await initCategories();
        toast('已删除');
        invalidate();
        renderSettings(state.cats);
        return;
      }
    });

    // 设置：备份
    $('btn-export').addEventListener('click', doExport);
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', doImport);

    // 设置：云备份（GitHub）
    $('btn-cloud-backup').addEventListener('click', cloudBackup);
    $('btn-cloud-restore').addEventListener('click', cloudRestore);
    $('cloud-auto').addEventListener('change', async () => {
      state.cloud.auto = $('cloud-auto').checked;
      await saveCloudCfg();
      toast(state.cloud.auto ? '已开启自动备份' : '已关闭自动备份');
    });

    // 分类添加弹窗
    $('btn-cat-save').addEventListener('click', saveNewCategory);
    $('btn-close-cat').addEventListener('click', closeCatModal);
    $('modal-cat').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeCatModal(); });
    $('cat-emoji-picker').addEventListener('click', (e) => {
      const cell = e.target.closest('.emoji-cell');
      if (!cell) return;
      document.querySelectorAll('.emoji-cell').forEach((c) => c.classList.remove('active'));
      cell.classList.add('active');
    });

    // 统计类型切换
    $('stat-type-expense').addEventListener('click', () => setStatType('expense'));
    $('stat-type-income').addEventListener('click', () => setStatType('income'));

    // 分类排行 → 查看该分类当月明细
    $('rank-list').addEventListener('click', (e) => {
      const row = e.target.closest('.rank-row');
      if (!row) return;
      openCatDetail(row.dataset.cat);
    });
    $('btn-close-cat-detail').addEventListener('click', closeCatDetail);
    $('modal-cat-detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeCatDetail(); });

    // 新版本就绪 → 立即更新
    $('btn-update').addEventListener('click', () => window.location.reload());

    // 键盘 Enter 保存
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeAddModal(); closeBudgetModal(); closeCatModal(); closeMonthModal(); closeDateModal(); closeCatDetail(); }
    });
  }

  function shiftMonth(delta) {
    const [y, m] = state.month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    state.month = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    updateHeader();
    refresh();
  }

  /* ---------- 月份选择弹窗 ---------- */
  function openMonthModal() {
    state.modalYear = parseInt(state.month.split('-')[0], 10);
    renderMonthModal();
    $('modal-month').hidden = false;
  }

  function closeMonthModal() {
    $('modal-month').hidden = true;
  }

  function renderMonthModal() {
    $('month-year-label').textContent = state.modalYear + '年';
    const grid = $('month-grid');
    grid.innerHTML = '';
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const [selYear, selMonth] = state.month.split('-').map(Number);
    // 有记录的月份加粗标记，点几个月就能找回来，不用一个个翻
    const hasData = new Set(state.txs.map((t) => monthStr(t.date)));

    for (let m = 1; m <= 12; m++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'month-cell'
        + (selYear === state.modalYear && selMonth === m ? ' active' : '')
        + (curYear === state.modalYear && curMonth === m ? ' is-now' : '')
        + (hasData.has(`${state.modalYear}-${pad2(m)}`) ? ' has-data' : '');
      btn.dataset.month = String(m);
      btn.textContent = m + '月';
      grid.appendChild(btn);
    }
  }

  /* ---------- 内置金额键盘 ---------- */
  /* 支持连续计算：12 ＋ 5 → 按「完成」存 17。
     npAcc 是已确定的数值（左操作数/中间结果），npOp 是运算符，npCur 是正在输的数字。
     显示规则：有运算符时显示完整算式，否则只显示 npCur。 */
  function updateAmountDisplay() {
    const input = $('input-amount');
    const text = state.npOp ? state.npAcc + state.npOp + state.npCur : state.npCur;
    input.value = text;
    // 算式变长时缩小字号，避免数字被挤出输入框
    input.style.fontSize = text.length > 13 ? '22px' : text.length > 9 ? '27px' : '';
    document.querySelectorAll('.np-fn[data-op]').forEach((b) => {
      b.classList.toggle('on', !!state.npOp && b.dataset.op === state.npOp);
    });
  }

  function npCalc(a, op, b) {
    const x = parseFloat(a);
    const y = parseFloat(b);
    if (isNaN(x) || isNaN(y)) return '';
    return String(round2(op === '+' ? x + y : x - y));
  }

  // 当前算式的结果（按「完成」时用它保存）
  function npResult() {
    if (state.npOp && state.npCur !== '') return npCalc(state.npAcc, state.npOp, state.npCur);
    return state.npCur || state.npAcc || '';
  }

  function npInput(key) {
    const v = state.npCur;
    if (key === 'del') {
      if (v !== '') {
        state.npCur = v.slice(0, -1);
      } else if (state.npOp) {
        // 右操作数还空着 → 撤销运算符，回到刚才那个数
        state.npCur = state.npAcc;
        state.npAcc = '';
        state.npOp = null;
      }
    } else if (key === '.') {
      if (!v.includes('.')) state.npCur = (v === '' ? '0' : v) + '.';
    } else if (key >= '0' && key <= '9') {
      if (v.includes('.')) {
        if (v.split('.')[1].length >= 2) return;        // 小数最多两位
        state.npCur = v + key;
      } else if (v === '0') {
        state.npCur = key;                              // 避免出现 05
      } else if (v.replace('.', '').length >= 8) {
        return;                                         // 最多 8 位整数
      } else {
        state.npCur = v + key;
      }
    }
    updateAmountDisplay();
  }

  /* ＋ / －：先把上一段算出来，再把新的运算符挂起来 */
  function npOperator(op) {
    if (state.npCur === '') {
      if (state.npOp) state.npOp = op;                  // 还没输右操作数 → 只换运算符
      updateAmountDisplay();
      return;
    }
    state.npAcc = state.npOp ? npCalc(state.npAcc, state.npOp, state.npCur) : state.npCur;
    if (state.npAcc === '') { updateAmountDisplay(); return; }
    state.npCur = '';
    state.npOp = op;
    updateAmountDisplay();
  }

  function npReset() {
    state.npAcc = '';
    state.npOp = null;
    state.npCur = '';
    updateAmountDisplay();
  }

  /* 键盘右侧的「今天」：一键把日期拨回今天 */
  function npToday() {
    state.addDate = todayStr();
    updateDateQuick();
  }

  /* 日期加减天数：shiftDate('2026-10-01', -2) → '2026-09-29' */
  function shiftDate(dateStr, delta) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + delta);
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }

  /* 渲染日期快捷条：左边是前几天、右边是今天，点哪个就记哪天。
     若用滚轮选了不在最近 3 天里的日期，把它补进条里并高亮，
     免得看不出当前到底选的是哪一天 */
  function updateDateQuick() {
    const today = todayStr();
    const days = [2, 1, 0].map((i) => shiftDate(today, -i));   // 前天 · 昨天 · 今天
    if (!days.includes(state.addDate)) {
      if (state.addDate > today) days.push(state.addDate);
      else days.unshift(state.addDate);
    }
    $('date-chips').innerHTML = days.map((d) => {
      // 今天那个既标「今天」也写明几月几号 —— 光写「今天」看不出是几号
      const label = d === today ? `今天 ${fmtMonthDay(d)}` : fmtMonthDay(d);
      const on = d === state.addDate ? ' on' : '';
      return `<button type="button" class="date-chip${on}" data-date="${d}">${label}</button>`;
    }).join('');
  }

  /* ---------- 日期选择弹窗（三列滚轮） ---------- */
  const WHEEL_ITEM_H = 44;

  function openDateModal() {
    $('modal-date').hidden = false;   // 先显示再渲染，保证滚动位置生效
    renderDateWheels();
  }

  function closeDateModal() {
    $('modal-date').hidden = true;
  }

  /* 重建一列滚轮，并滚到选中项（首尾留白保证所有项都能滚到中间）
     选中条 / 渐隐遮罩由外层 .wheel-col 负责，这里只填选项 */
  function buildWheel(wheelEl, items, selectedValue) {
    wheelEl.innerHTML = '';
    const padTop = document.createElement('div');
    padTop.className = 'wheel-spacer';
    wheelEl.appendChild(padTop);
    items.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'wheel-item' + (String(it.value) === String(selectedValue) ? ' selected' : '');
      div.dataset.value = it.value;
      div.textContent = it.label;
      wheelEl.appendChild(div);
    });
    const padBottom = document.createElement('div');
    padBottom.className = 'wheel-spacer';
    wheelEl.appendChild(padBottom);

    const idx = Math.max(items.findIndex((it) => String(it.value) === String(selectedValue)), 0);
    requestAnimationFrame(() => {
      wheelEl.scrollTop = idx * WHEEL_ITEM_H;
    });
  }

  function renderDateWheels() {
    const now = new Date();
    const curYear = now.getFullYear();
    const [y, m, d] = state.addDate.split('-').map(Number);

    const years = [];
    for (let yy = curYear - 8; yy <= curYear + 1; yy++) years.push({ value: yy, label: yy + '年' });
    buildWheel($('wheel-year'), years, y);

    const months = [];
    for (let mm = 1; mm <= 12; mm++) months.push({ value: mm, label: mm + '月' });
    buildWheel($('wheel-month'), months, m);

    buildDayWheel(y, m, d);
  }

  /* 日列：按 年/月 重建（2 月 28/29、小月 30 天） */
  function buildDayWheel(y, m, keepDay) {
    const days = new Date(y, m, 0).getDate();
    const cur = Math.min(keepDay || 1, days);
    const items = [];
    for (let dd = 1; dd <= days; dd++) items.push({ value: dd, label: dd + '日' });
    buildWheel($('wheel-day'), items, cur);
  }

  /* 年/月变化后重建日列（保持当前选中的日） */
  function rebuildDayWheel() {
    const y = Number(readWheel($('wheel-year')));
    const m = Number(readWheel($('wheel-month')));
    const d = Number(readWheel($('wheel-day'))) || 1;
    if (y && m) buildDayWheel(y, m, d);
  }

  /* 读取某列当前选中值（按滚动位置吸附），并同步高亮 */
  function readWheel(wheelEl) {
    const items = wheelEl.querySelectorAll('.wheel-item');
    if (!items.length) return null;
    const idx = Math.min(Math.max(Math.round(wheelEl.scrollTop / WHEEL_ITEM_H), 0), items.length - 1);
    items.forEach((it, i) => it.classList.toggle('selected', i === idx));
    return items[idx].dataset.value;
  }

  /* 监听滚轮：滚动停止 120ms 后回调；点击选项直接跳转 */
  function watchWheel(wheelEl, onChange) {
    let timer = null;
    wheelEl.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const v = readWheel(wheelEl);
        if (v !== null) onChange(Number(v));
      }, 120);
    }, { passive: true });

    wheelEl.addEventListener('click', (e) => {
      const item = e.target.closest('.wheel-item');
      if (!item) return;
      const items = wheelEl.querySelectorAll('.wheel-item');
      const idx = [...items].indexOf(item);
      wheelEl.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: 'smooth' });
    });
  }

  /* ---------- 记账弹窗 ---------- */
  function openAddModal(id) {
    // 若分类明细弹窗开着，记账弹窗显示在其上层
    if (!$('modal-cat-detail').hidden) $('modal-add').style.zIndex = '120';
    state.editingId = id || null;
    $('add-title').textContent = id ? '编辑记录' : '记一笔';

    let t = null;
    if (id) {
      t = state.txs.find((x) => x.id === id);
    }
    const type = t ? t.type : state.addType;
    const cat = t ? t.category : state.addCategory;
    const note = t ? t.note : '';
    const amount = t ? String(t.amount) : '';

    state.addCategory = cat;  // 编辑时同步选中分类，避免保存时被旧值覆盖
    // 选中分类在折叠区（两行以外）时自动展开，保证用户能看到选中状态
    const catList = state.cats.filter((c) => c.type === type);
    const catIdx = catList.findIndex((c) => c.name === cat);
    if (catIdx >= 10) state.catExpanded = true;
    setAddType(type, cat);
    // 金额输入状态复位（编辑记录时把原金额放进 npCur）
    state.npAcc = '';
    state.npOp = null;
    state.npCur = amount;
    updateAmountDisplay();
    $('input-note').value = note;
    state.addDate = t ? t.date : todayStr();
    updateDateQuick();

    $('modal-add').hidden = false;
    // 弹窗一打开让内容区回到顶部（金额/分类最常用）
    const body = $('add-body');
    if (body) body.scrollTop = 0;
  }

  function closeAddModal() {
    $('modal-add').hidden = true;
    state.editingId = null;
    state.npAcc = '';
    state.npOp = null;
    state.npCur = '';
  }

  function setAddType(type, keepCat) {
    state.addType = type;
    $('type-expense').classList.toggle('active', type === 'expense');
    $('type-income').classList.toggle('active', type === 'income');
    if (!keepCat) {
      const first = state.cats.find((c) => c.type === type);
      state.addCategory = first ? first.name : '';
      state.catExpanded = false;
    }
    renderCatPicker(state.cats, type, state.addCategory, state.catExpanded);
  }

  async function saveTx() {
    // 连续计算：把算式算成最终金额
    const amount = parseFloat(npResult());
    if (state.npOp && amount < 0) {
      toast('算出来是负数，改一下吧');
      return;
    }
    if (!amount || amount <= 0) {
      toast('请输入金额');
      return;
    }
    const note = $('input-note').value.trim();
    const date = state.addDate;

    if (state.editingId) {
      await updateTx(state.editingId, {
        type: state.addType,
        amount,
        category: state.addCategory,
        note,
        date
      });
      toast('已保存');
    } else {
      await addTx({ type: state.addType, amount, category: state.addCategory, note, date });
      toast('已记一笔');
    }
    closeAddModal();
    scheduleAutoBackup();
    invalidate();
    refresh();
  }

  /* ---------- 流水行：点一下进编辑 / 左滑删除 ---------- */
  const SWIPE_W = 76;
  let swallowRowClick = false;

  function closeAllSwipes(except) {
    document.querySelectorAll('.tx-row.open').forEach((r) => {
      if (r !== except) r.classList.remove('open');
    });
  }

  function onTxRowClick(e) {
    // 左滑露出后的「删除」优先，不受滑动吞点击影响
    const del = e.target.closest('.tx-del');
    if (del) {
      swallowRowClick = false;
      deleteTxRow(del.closest('.tx-row'));
      return;
    }
    if (swallowRowClick) { swallowRowClick = false; return; }
    const row = e.target.closest('.tx-row');
    if (!row) { closeAllSwipes(); return; }
    // 有行处于滑动展开状态时，这一次点击只用来收起（iOS 惯例）
    if (document.querySelector('.tx-row.open')) { closeAllSwipes(); return; }
    openAddModal(row.dataset.id);
  }

  async function deleteTxRow(row) {
    if (!row) return;
    const id = row.dataset.id;
    if (!id) return;
    await deleteTx(id);
    toast('已删除');
    scheduleAutoBackup();
    invalidate();
    refresh();
  }

  function setupTxSwipe() {
    let row = null;
    let item = null;
    let startX = 0;
    let startY = 0;
    let base = 0;
    let axis = null;

    const clear = () => {
      if (item) item.style.transform = '';
      if (row) row.classList.remove('dragging');
      row = null; item = null; axis = null;
    };

    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.tx-del')) return;
      const r = e.target.closest('.tx-row');
      if (!r) return;
      row = r;
      item = r.querySelector('.tx-item');
      startX = e.clientX;
      startY = e.clientY;
      base = r.classList.contains('open') ? -SWIPE_W : 0;
      axis = null;
    }, { passive: true });

    document.addEventListener('pointermove', (e) => {
      if (!row) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      if (!axis) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        if (axis === 'y') { row = null; item = null; return; }   // 纵向滚动交给浏览器
        row.classList.add('dragging');
        closeAllSwipes(row);
      }
      const t = Math.max(-SWIPE_W, Math.min(0, base + mx));
      item.style.transform = `translateX(${t}px)`;
    });

    document.addEventListener('pointerup', (e) => {
      if (!row || axis !== 'x') { clear(); return; }
      const r = row;
      const el = item;
      const shouldOpen = base + (e.clientX - startX) < -SWIPE_W / 2;
      // 先定目标态再清 inline 位移，避免回弹后再滑出的抖动
      closeAllSwipes(r);
      if (shouldOpen) r.classList.add('open'); else r.classList.remove('open');
      r.classList.remove('dragging');
      el.style.transform = '';
      row = null; item = null; axis = null;
      // 吞掉紧随其后的合成 click，避免刚滑开就被收起
      swallowRowClick = true;
      setTimeout(() => { swallowRowClick = false; }, 350);
    });

    document.addEventListener('pointercancel', clear);
  }

  /* ---------- 预算弹窗 ---------- */
  async function openBudgetModal(editCat) {
    await renderBudgetModal(state.month, editCat);
    $('modal-budget').hidden = false;
  }
  function closeBudgetModal() {
    $('modal-budget').hidden = true;
  }
  async function saveBudget() {
    const amount = parseFloat($('budget-input').value);
    if (!amount || amount <= 0) {
      toast('请输入金额');
      return;
    }
    const kind = $('btn-save-budget').dataset.kind;
    if (kind === 'total') {
      await setTotalBudget(state.month, amount);
      toast('总预算已保存');
    } else if (kind === 'cat') {
      await setCategoryBudget(state.month, $('btn-save-budget').dataset.cat, amount);
      toast('分类预算已保存');
    } else if (kind === 'newcat') {
      const cat = $('budget-cat-select').value;
      await setCategoryBudget(state.month, cat, amount);
      toast('分类预算已添加');
    }
    closeBudgetModal();
    invalidate();
    refresh();
  }

  /* ---------- 统计类型 ---------- */
  function setStatType(type) {
    state.statType = type;
    $('stat-type-expense').classList.toggle('active', type === 'expense');
    $('stat-type-income').classList.toggle('active', type === 'income');
    renderStats(state.cats, state.txs, state.month, type);
  }

  /* ---------- 分类明细弹窗 ---------- */
  function openCatDetail(category) {
    state.catDetail = { type: state.statType, category };
    renderCatDetail(state.cats, state.txs, state.month, state.catDetail.type, state.catDetail.category);
    $('modal-cat-detail').hidden = false;
  }

  function closeCatDetail() {
    $('modal-cat-detail').hidden = true;
    state.catDetail = null;
  }

  /* ---------- 分类管理弹窗 ---------- */
  const EMOJI_CHOICES = ['🍜', '🚌', '🛒', '🏠', '🎮', '💊', '📚', '🎁', '✈️', '☕', '🍺', '🐱', '🧸', '💄', '🏋️', '📱', '💡', '🛠️', '🚗', '🎵', '📷', '🎓', '💍', '🧧', '💼', '📈', '💪', '其他'];

  function openCatModal(type) {
    $('cat-modal-type').value = type;
    $('cat-modal-title').textContent = type === 'expense' ? '添加支出分类' : '添加收入分类';
    $('input-cat-name').value = '';
    $('input-cat-name').focus();
    const box = $('cat-emoji-picker');
    box.innerHTML = '';
    EMOJI_CHOICES.forEach((em) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-cell' + (em === '其他' ? ' active' : '');
      btn.dataset.emoji = em;
      btn.textContent = em;
      box.appendChild(btn);
    });
    $('modal-cat').hidden = false;
  }
  function closeCatModal() {
    $('modal-cat').hidden = true;
  }
  async function saveNewCategory() {
    const name = $('input-cat-name').value.trim();
    const type = $('cat-modal-type').value;
    if (!name) { toast('请输入分类名称'); return; }
    const icon = $('cat-emoji-picker').querySelector('.emoji-cell.active').dataset.emoji;
    const dup = state.cats.some((c) => c.type === type && c.name === name);
    if (dup) { toast('分类已存在'); return; }
    await addCategory(type, name, icon);
    state.cats = await initCategories();
    closeCatModal();
    toast('已添加');
    invalidate();
    renderSettings(state.cats);
    if (state.addType === type) renderCatPicker(state.cats, type, state.addCategory, state.catExpanded);
  }

  /* ---------- 备份 ---------- */
  async function doExport() {
    const data = await exportBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `记账本备份-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('已导出备份文件');
  }

  async function doImport(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importBackup(data);
      state.cats = await initCategories();
      state.txs = await getAllTx();
      toast('备份已导入');
      scheduleAutoBackup();
      invalidate();
      refresh();
    } catch (err) {
      toast('导入失败：文件格式不正确');
    }
  }

  /* ---------- GitHub 云备份 ---------- */
  const CLOUD_FILE = 'moneybook-backup.json';

  function strToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  function base64ToStr(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function cloudRequest(path, method, token, body) {
    const opts = {
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch('https://api.github.com' + path, opts);
    if (res.status === 404) return null;
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); msg = j.message || msg; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }

  function getCloudCfg() {
    return {
      token: (document.getElementById('cloud-token').value || state.cloud.token || '').trim(),
      repo: (document.getElementById('cloud-repo').value || state.cloud.repo || 'small00/moneybook-backup').trim(),
      auto: document.getElementById('cloud-auto').checked
    };
  }

  /* 云配置写入 IndexedDB（与记账数据同库，浏览器清数据/换机只要恢复数据即一并恢复） */
  async function saveCloudCfg() {
    await setSetting('cloud', state.cloud);
  }

  function renderCloudStatus() {
    const t = document.getElementById('cloud-token');
    const r = document.getElementById('cloud-repo');
    const a = document.getElementById('cloud-auto');
    if (t && !t.value) t.value = state.cloud.token || '';
    if (r && !r.value) r.value = state.cloud.repo || 'small00/moneybook-backup';
    if (a) a.checked = !!state.cloud.auto;
    const el = document.getElementById('cloud-status');
    if (!el) return;
    const last = state.cloud.last;
    el.className = 'settings-desc';
    el.textContent = last ? '上次备份：' + new Date(last).toLocaleString('zh-CN') : '还没有备份过，点「立即备份」开始。';
  }

  async function cloudBackup() {
    const cfg = getCloudCfg();
    if (!cfg.token) { toast('请先填写 GitHub Token'); return; }
    state.cloud.token = cfg.token;
    state.cloud.repo = cfg.repo;
    state.cloud.auto = cfg.auto;
    await saveCloudCfg();
    try {
      const data = await exportBackup();
      const content = strToBase64(JSON.stringify(data));
      const existing = await cloudRequest('/repos/' + cfg.repo + '/contents/' + CLOUD_FILE, 'GET', cfg.token);
      const body = { message: 'backup ' + new Date().toLocaleString('zh-CN'), content };
      if (existing && existing.sha) body.sha = existing.sha;
      await cloudRequest('/repos/' + cfg.repo + '/contents/' + CLOUD_FILE, 'PUT', cfg.token, body);
      state.cloud.last = new Date().toISOString();
      await saveCloudCfg();
      toast('云端备份成功');
      renderCloudStatus();
    } catch (err) {
      toast('备份失败：' + err.message);
    }
  }

  async function cloudRestore() {
    const cfg = getCloudCfg();
    if (!cfg.token) { toast('请先填写 GitHub Token'); return; }
    if (!window.confirm('从云端恢复会用备份覆盖当前所有数据，确定继续？')) return;
    try {
      const existing = await cloudRequest('/repos/' + cfg.repo + '/contents/' + CLOUD_FILE, 'GET', cfg.token);
      if (!existing) { toast('云端还没有备份'); return; }
      const data = JSON.parse(base64ToStr(existing.content));
      await importBackup(data);
      state.cats = await initCategories();
      state.txs = await getAllTx();
      toast('已从云端恢复');
      invalidate();
      refresh();
    } catch (err) {
      toast('恢复失败：' + err.message);
    }
  }

  /* 自动备份：开启后每次记账/修改/删除后防抖 4 秒静默备份 */
  let _autoBackupTimer = null;
  function scheduleAutoBackup() {
    if (!state.cloud.auto || !state.cloud.token) return;
    clearTimeout(_autoBackupTimer);
    _autoBackupTimer = setTimeout(async () => {
      try {
        const token = state.cloud.token;
        const repo = state.cloud.repo || 'small00/moneybook-backup';
        const data = await exportBackup();
        const content = strToBase64(JSON.stringify(data));
        const existing = await cloudRequest('/repos/' + repo + '/contents/' + CLOUD_FILE, 'GET', token);
        const body = { message: 'auto backup', content };
        if (existing && existing.sha) body.sha = existing.sha;
        await cloudRequest('/repos/' + repo + '/contents/' + CLOUD_FILE, 'PUT', token, body);
        state.cloud.last = new Date().toISOString();
        await saveCloudCfg();
      } catch (e) { /* 静默失败，下次记账再试 */ }
    }, 4000);
  }

  /* ---------- 弹窗下拉关闭手势（iOS 原生 sheet 行为） ----------
   * 内容滚到顶部后继续下拉，弹窗跟随手指移动，松手超过阈值关闭，否则回弹 */
  const MODAL_CLOSE_MAP = {
    'modal-add': closeAddModal,
    'modal-budget': closeBudgetModal,
    'modal-cat': closeCatModal,
    'modal-month': closeMonthModal,
    'modal-date': closeDateModal,
    'modal-cat-detail': closeCatDetail
  };

  function setupSheetDrag() {
    document.querySelectorAll('.sheet').forEach((sheet) => {
      const mask = sheet.closest('.sheet-mask');
      if (!mask) return;
      // 记账弹窗的滚动容器是内层 .sheet-body（金额键盘固定在弹窗底部，sheet 自身不滚动）
      const scroller = sheet.querySelector('.sheet-body') || sheet;
      let startY = 0;
      let dragging = false;
      let follow = false;

      sheet.addEventListener('touchstart', (e) => {
        // 触摸点在「除滚动容器外」的可滚动子元素内（如日期滚轮）→ 禁用手势，
        // 避免滚动滚轮被误判成下拉关闭
        let t = e.target;
        while (t && t !== sheet) {
          if (t !== scroller && t.scrollHeight > t.clientHeight + 1) return;
          t = t.parentElement;
        }
        startY = e.touches[0].clientY;
        dragging = true;
        follow = false;
      }, { passive: true });

      sheet.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        const dy = e.touches[0].clientY - startY;
        // 内容滚到顶 且 向下拉 → 启动下拉关闭
        if (scroller.scrollTop <= 0 && dy > 0) {
          if (!follow) {
            follow = true;
            sheet.style.transition = 'none';
          }
          e.preventDefault();
          const y = Math.min(dy * 0.5, 300);
          sheet.style.transform = `translateY(${y}px)`;
          mask.style.background = `rgba(0,0,0,${Math.max(0.45 - y / 900, 0.05)})`;
        }
      }, { passive: false });

      sheet.addEventListener('touchend', (e) => {
        if (!dragging) return;
        dragging = false;
        if (!follow) return;
        const dy = (e.changedTouches[0].clientY - startY) * 0.5;
        const closeFn = MODAL_CLOSE_MAP[mask.id];
        if (dy > 80) {
          sheet.style.transition = 'transform .22s ease';
          sheet.style.transform = 'translateY(110%)';
          mask.style.background = 'rgba(0,0,0,0)';
          setTimeout(() => {
            if (closeFn) closeFn();
            sheet.style.transform = '';
            sheet.style.transition = '';
            mask.style.background = '';
          }, 200);
        } else {
          sheet.style.transition = 'transform .25s ease';
          sheet.style.transform = '';
          sheet.style.transition = '';
          mask.style.background = '';
        }
      }, { passive: true });
    });
  }

  /* ---------- Service Worker ---------- */
  function registerSW() {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    // sw.js 里 install 时直接 skipWaiting，新 SW 不会停在 waiting 状态，
    // 所以用 controllerchange 判断「新版本已接管页面」：只有本来就有旧 SW 时才提示，
    // 首次安装（页面还没有 controller）不打扰用户。
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) showUpdateBar();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  function showUpdateBar() {
    const bar = $('update-bar');
    if (bar) bar.hidden = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
