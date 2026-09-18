# 记账本（PWA）

一个给自己用的轻量记账应用：**无广告、无收费、无云同步**，数据只存在你自己的设备里。

- 记流水：收入/支出、分类、备注、日期，支持编辑和删除
- 统计报表：月度收支汇总、分类占比环形图、近 6 个月收支柱状图、分类排行
- 预算管理：月度总预算 + 分类预算，超支/接近超支提醒
- 数据备份：导出 JSON 文件 / 导入恢复
- 深色模式：跟随系统自动切换
- 离线可用：断网也能记账（Service Worker 缓存）

## 目录结构

```
moneybook/
├── index.html          # 主页面（单页应用）
├── css/style.css       # 样式（移动优先 + 深色模式）
├── js/
│   ├── db.js           # IndexedDB 封装
│   ├── store.js        # 业务数据层 + 统计计算
│   ├── charts.js       # SVG 图表（零依赖）
│   ├── ui.js           # 页面渲染
│   └── app.js          # 主逻辑 / 事件绑定
├── manifest.webmanifest # PWA 清单
├── sw.js               # Service Worker（离线缓存，network-first）
├── icons/              # 应用图标（SVG + PNG 180/192/512）
└── server.js           # 本地开发服务器（node server.js [port]）
```

## 本地运行

```bash
node server.js 8080
# 打开 http://127.0.0.1:8080/
```

直接双击打开 `index.html` 也能用（Chrome/Edge），但 PWA 安装和离线功能需要走 HTTP 服务器。

## 安装到 iPhone（关键步骤）

> iPhone 的 Safari 是唯一支持"添加到主屏幕"的浏览器。整个过程不需要 Mac、不需要开发者账号、不需要 App Store。

1. **部署到 HTTPS 地址**：PWA 必须通过 HTTPS 访问（iPhone 上无法用 localhost）。
   - 免费方案任选其一（把 `moneybook/` 目录整个上传）：
     - **GitHub Pages**：建一个公开仓库 → Settings → Pages → 选择分支，得到 `https://你的用户名.github.io/仓库名/`
     - **Cloudflare Pages** / **Vercel** / **Netlify**：拖拽上传文件夹，自动生成 HTTPS 地址
   - 或者用自己的服务器 + HTTPS 证书
2. **打开网址**：iPhone 上 Safari 打开部署后的地址
3. **添加到主屏幕**：点 Safari 底部"分享"按钮 → 滚到底部选"添加到主屏幕" → 确认名称"记账本"
4. 之后从主屏幕点图标打开，就是全屏 App 体验（顶部不再有 Safari 地址栏），**首次打开联网缓存后，离线也能记账**

## 数据说明

- 所有数据存在当前浏览器（IndexedDB）里，**不会上传到任何服务器**
- ⚠️ 风险：清除浏览器数据、卸载浏览器、换手机都会丢数据
- 建议：设置页 →「导出备份」定期把 JSON 文件存到微信收藏/网盘/iCloud，换机时「导入备份」恢复
- 切换浏览器 = 不同的数据空间（Safari 里记的和 Chrome 里记的不互通）

## 版本记录

- v1.0（2026-09）：基础记账、统计报表、预算管理、备份导入导出、PWA 离线
