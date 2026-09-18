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
    modalYear: 0         // 月份选择弹窗当前年份
  };

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
    state.addCategory = state.cats.find((c) => c.type === 'expense' && c.name === '餐饮')
      ? '餐饮' : state.cats.find((c) => c.type === 'expense').name;
    bindEvents();
    switchPage('ledger');
    updateHeader();
    registerSW();
    setupChromeOffset();
  }

  /* iOS 键盘/Safari 工具栏补偿：
   * 底部固定元素（导航/记账按钮/toast/弹窗）按被占用的底部高度动态避让；
   * 键盘弹出时把打开的底部弹窗滚到底部，保证"保存"按钮可见可点 */
  function setupChromeOffset() {
    if (!window.visualViewport) return;
    const vv = window.visualViewport;
    const apply = () => {
      const h = window.innerHeight - vv.height;
      document.documentElement.style.setProperty('--chrome-h', Math.max(h, 0) + 'px');
      if (h > 120) {
        const open = document.querySelector('.sheet-mask:not([hidden]) .sheet');
        if (open && open.scrollHeight > open.clientHeight) {
          open.scrollTop = open.scrollHeight;
        }
      }
    };
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    apply();
  }

  /* ---------- 刷新当前页 ---------- */
  async function refresh() {
    state.txs = await getAllTx();
    if (state.page === 'ledger') renderLedger(state.cats, state.txs, state.month);
    else if (state.page === 'stats') {
      renderStats(state.cats, state.txs, state.month, state.statType);
      if (state.catDetail) {
        renderCatDetail(state.cats, state.txs, state.month, state.catDetail.type, state.catDetail.category);
      }
    }
    else if (state.page === 'budget') renderBudget(state.cats, state.txs, state.month);
    else renderSettings(state.cats);
    renderCloudStatus();
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
    $('btn-date').addEventListener('click', openDateModal);
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
      $('btn-date').textContent = fmtDateCN(state.addDate);
      closeDateModal();
    });
    $('btn-date-cancel').addEventListener('click', closeDateModal);

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

    // 金额输入过滤
    $('input-amount').addEventListener('input', (e) => {
      let v = e.target.value.replace(/[^\d.]/g, '');
      const dot = v.indexOf('.');
      if (dot !== -1) {
        v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
        if (v.slice(dot + 1).length > 2) v = v.slice(0, dot + 3);
      }
      e.target.value = v;
    });

    // 保存
    $('btn-save').addEventListener('click', saveTx);

    // 流水操作
    $('tx-list').addEventListener('click', (e) => {
      const item = e.target.closest('.tx-item');
      if (!item) return;
      openTxModal(item.dataset.id);
    });
    $('btn-tx-delete').addEventListener('click', async () => {
      const id = $('modal-tx').dataset.id;
      if (!id) return;
      await deleteTx(id);
      closeTxModal();
      toast('已删除');
      scheduleAutoBackup();
      refresh();
    });
    $('btn-tx-edit').addEventListener('click', () => {
      const id = $('modal-tx').dataset.id;
      closeTxModal();
      openAddModal(id);
    });
    $('btn-tx-close').addEventListener('click', closeTxModal);
    $('modal-tx').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeTxModal(); });

    // 预算
    $('btn-edit-total-budget').addEventListener('click', () => openBudgetModal('total'));
    $('btn-add-cat-budget').addEventListener('click', () => openBudgetModal(null));
    $('cat-budget-list').addEventListener('click', async (e) => {
      const del = e.target.closest('.cat-budget-del');
      if (!del) return;
      await deleteCategoryBudget(state.month, del.dataset.cat);
      toast('已删除');
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
        renderSettings(state.cats);
        return;
      }
      const del = e.target.closest('.cat-chip-del');
      if (del) {
        await deleteCategory(del.dataset.id, del.dataset.type);
        state.cats = await initCategories();
        toast('已删除');
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
    $('cloud-auto').addEventListener('change', () => {
      localStorage.setItem('mbCloudAuto', $('cloud-auto').checked ? '1' : '0');
      toast($('cloud-auto').checked ? '已开启自动备份' : '已关闭自动备份');
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
    // 分类明细弹窗内条目 → 编辑/删除
    $('cat-detail-list').addEventListener('click', (e) => {
      const item = e.target.closest('.tx-item');
      if (!item) return;
      openTxModal(item.dataset.id);
    });
    $('btn-close-cat-detail').addEventListener('click', closeCatDetail);
    $('modal-cat-detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeCatDetail(); });

    // 键盘 Enter 保存
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeAddModal(); closeTxModal(); closeBudgetModal(); closeCatModal(); closeMonthModal(); closeDateModal(); closeCatDetail(); }
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

    for (let m = 1; m <= 12; m++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'month-cell'
        + (selYear === state.modalYear && selMonth === m ? ' active' : '')
        + (curYear === state.modalYear && curMonth === m ? ' is-now' : '');
      btn.dataset.month = String(m);
      btn.textContent = m + '月';
      grid.appendChild(btn);
    }
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

  /* 重建一列滚轮，并滚到选中项（首尾留白保证所有项都能滚到中间） */
  function buildWheel(wheelEl, items, selectedValue) {
    wheelEl.innerHTML = '<div class="wheel-indicator"></div>';
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
    $('input-amount').value = amount;
    $('input-note').value = note;
    state.addDate = t ? t.date : todayStr();
    $('btn-date').textContent = fmtDateCN(state.addDate);

    $('modal-add').hidden = false;
    setTimeout(() => $('input-amount').focus(), 220);
  }

  function closeAddModal() {
    $('modal-add').hidden = true;
    state.editingId = null;
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
    const amount = parseFloat($('input-amount').value);
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
    refresh();
  }

  /* ---------- 流水操作弹窗 ---------- */
  function openTxModal(id) {
    if (!$('modal-cat-detail').hidden) $('modal-tx').style.zIndex = '120';
    $('modal-tx').dataset.id = id;
    $('modal-tx').hidden = false;
  }
  function closeTxModal() {
    $('modal-tx').hidden = true;
    delete $('modal-tx').dataset.id;
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
      token: (document.getElementById('cloud-token').value || localStorage.getItem('mbCloudToken') || '').trim(),
      repo: (document.getElementById('cloud-repo').value || localStorage.getItem('mbCloudRepo') || 'small00/moneybook-backup').trim(),
      auto: document.getElementById('cloud-auto').checked
    };
  }

  function renderCloudStatus() {
    const t = document.getElementById('cloud-token');
    const r = document.getElementById('cloud-repo');
    const a = document.getElementById('cloud-auto');
    if (t && !t.value) t.value = localStorage.getItem('mbCloudToken') || '';
    if (r && !r.value) r.value = localStorage.getItem('mbCloudRepo') || 'small00/moneybook-backup';
    if (a) a.checked = localStorage.getItem('mbCloudAuto') === '1';
    const el = document.getElementById('cloud-status');
    if (!el) return;
    const last = localStorage.getItem('mbCloudLast');
    el.className = 'settings-desc';
    el.textContent = last ? '上次备份：' + new Date(last).toLocaleString('zh-CN') : '还没有备份过，点「立即备份」开始。';
  }

  async function cloudBackup() {
    const cfg = getCloudCfg();
    if (!cfg.token) { toast('请先填写 GitHub Token'); return; }
    localStorage.setItem('mbCloudToken', cfg.token);
    localStorage.setItem('mbCloudRepo', cfg.repo);
    localStorage.setItem('mbCloudAuto', cfg.auto ? '1' : '0');
    try {
      const data = await exportBackup();
      const content = strToBase64(JSON.stringify(data));
      const existing = await cloudRequest('/repos/' + cfg.repo + '/contents/' + CLOUD_FILE, 'GET', cfg.token);
      const body = { message: 'backup ' + new Date().toLocaleString('zh-CN'), content };
      if (existing && existing.sha) body.sha = existing.sha;
      await cloudRequest('/repos/' + cfg.repo + '/contents/' + CLOUD_FILE, 'PUT', cfg.token, body);
      localStorage.setItem('mbCloudLast', new Date().toISOString());
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
      refresh();
    } catch (err) {
      toast('恢复失败：' + err.message);
    }
  }

  /* 自动备份：开启后每次记账/修改/删除后防抖 4 秒静默备份 */
  let _autoBackupTimer = null;
  function scheduleAutoBackup() {
    if (localStorage.getItem('mbCloudAuto') !== '1') return;
    if (!localStorage.getItem('mbCloudToken')) return;
    clearTimeout(_autoBackupTimer);
    _autoBackupTimer = setTimeout(async () => {
      try {
        const token = localStorage.getItem('mbCloudToken');
        const repo = localStorage.getItem('mbCloudRepo') || 'small00/moneybook-backup';
        const data = await exportBackup();
        const content = strToBase64(JSON.stringify(data));
        const existing = await cloudRequest('/repos/' + repo + '/contents/' + CLOUD_FILE, 'GET', token);
        const body = { message: 'auto backup', content };
        if (existing && existing.sha) body.sha = existing.sha;
        await cloudRequest('/repos/' + repo + '/contents/' + CLOUD_FILE, 'PUT', token, body);
        localStorage.setItem('mbCloudLast', new Date().toISOString());
      } catch (e) { /* 静默失败，下次记账再试 */ }
    }, 4000);
  }

  /* ---------- Service Worker ---------- */
  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
