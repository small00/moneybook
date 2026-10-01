/* 本地服务器：node server.js
   同时监听两个端口：
     HTTPS 8443 → 手机上用这个（iPhone 只允许 HTTPS 跑 Service Worker，才能离线记账）
     HTTP  8080 → 电脑上用这个；也用来给手机下载根证书（HTTP 不需要先信任证书）
   证书放在仓库外 ../moneybook-certs/（cert.pem / key.pem / rootCA.pem），不会提交到 git。
   node server.js --http   只起 HTTP（没证书时的退路） */
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = __dirname;
const args = process.argv.slice(2);
const httpOnly = args.includes('--http');

const CERT_DIR = path.join(root, '..', 'moneybook-certs');
const certFile = path.join(CERT_DIR, 'cert.pem');
const keyFile = path.join(CERT_DIR, 'key.pem');
const caFile = path.join(CERT_DIR, 'rootCA.pem');
const hasCert = fs.existsSync(certFile) && fs.existsSync(keyFile);

const HTTPS_PORT = 8443;
const HTTP_PORT = 8080;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function handler(req, res) {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { url = req.url; }

  // 给手机下载根证书（iOS 装完这个才能信任 HTTPS，进而离线记账）
  if (url === '/rootCA.crt') {
    fs.readFile(caFile, (err, data) => {
      if (err) { res.writeHead(404); res.end('rootCA.pem not found in ' + CERT_DIR); return; }
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'inline; filename="rootCA.crt"',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
    return;
  }

  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(root, url));
  if (!file.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

function lanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      let score = 0;
      if (/^(WLAN|Wi-?Fi|以太网|Ethernet|en\d|eth\d)/i.test(name)) score += 100;
      if (i.address.startsWith('192.168.')) score += 50;
      else if (i.address.startsWith('10.')) score += 10;
      else if (i.address.startsWith('172.')) score += 5;
      out.push({ name, address: i.address, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

const nets = lanIPs();
const ip = (nets[0] && nets[0].address) || '127.0.0.1';
const ipName = nets[0] ? nets[0].name : '本机';

http.createServer(handler).listen(HTTP_PORT, '0.0.0.0', () => {});

if (!httpOnly && hasCert) {
  https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, handler)
    .listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log('');
      console.log('  ✅ 记账本已启动（家里电脑当服务器）');
      console.log('');
      console.log('  电脑上打开：  https://localhost:' + HTTPS_PORT + '/');
      console.log('  手机上打开：  https://' + ip + ':' + HTTPS_PORT + '/   ← ' + ipName + ' 网卡');
      const others = nets.slice(1).map((n) => n.address).filter((a) => a.startsWith('192.168.') || a.startsWith('10.') || a.startsWith('172.'));
      if (others.length) console.log('     （连不上就换这些试：' + others.join(' / ') + '）');
      console.log('');
      console.log('  ── 手机第一次使用，按顺序做 4 步 ──');
      console.log('  1) iPhone Safari 打开： http://' + ip + ':' + HTTP_PORT + '/rootCA.crt');
      console.log('     弹出「此网站正尝试下载配置描述文件」→ 点「允许」');
      console.log('  2) 设置 → 通用 → VPN与设备管理 → 安装刚才的 mkcert 描述文件');
      console.log('  3) 设置 → 通用 → 关于本机 → 证书信任设置 → 打开 mkcert 那一项');
      console.log('  4) Safari 打开 https://' + ip + ':' + HTTPS_PORT + '/ → 分享 → 添加到主屏幕');
      console.log('');
      console.log('  ⚠️ 这个窗口关掉 = 服务器停止，手机就连不上了。');
      console.log('     电脑休眠也会断，记得把电源计划设成「从不休眠」。');
      console.log('');
    });
} else {
  console.log('');
  console.log('  ⚠️  没找到证书，只启动了 HTTP：http://' + ip + ':' + HTTP_PORT + '/');
  console.log('     证书放在：' + CERT_DIR);
  console.log('     HTTP 下 iPhone 无法离线记账，请在电脑上生成证书后重启。');
  console.log('');
}
