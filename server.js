// =============================================
// server.js - 便利店收银系统后端服务
// =============================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = 3000;
// 数据目录：Docker 生产环境用 /app/data，本地开发用项目根目录
const DATA_DIR = process.env.NODE_ENV === 'production'
  ? '/app/data'
  : __dirname;
const BASE_DIR = DATA_DIR; // 证书也存这里
const DB_FILE  = path.join(DATA_DIR, 'store.db');

let db;

async function initDB() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    category TEXT DEFAULT '其他',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total REAL NOT NULL,
    paid REAL NOT NULL,
    change_amt REAL NOT NULL,
    items TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    sort_order INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  // 初始化默认分类
  const catCount = db.exec('SELECT COUNT(*) FROM categories')[0].values[0][0];
  if (catCount === 0) {
    ['饮料','零食','方便食品','日用品','其他'].forEach((name, i) => {
      db.run('INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?,?)', [name, i]);
    });
  }

  // 初始化默认设置
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('cashier_title', '便利店收银前台')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('last_backup', '')`);


  const count = db.exec('SELECT COUNT(*) FROM products')[0].values[0][0];
  if (count === 0) {
    const samples = [
      ['6901028001467','农夫山泉 550ml',2.00,100,'饮料'],
      ['6902890348003','可口可乐 330ml',3.50,80,'饮料'],
      ['6954767401051','三只松鼠 坚果礼包',29.90,30,'零食'],
      ['6920459900004','康师傅 红烧牛肉面',4.50,50,'方便食品'],
      ['6925303721546','旺旺雪饼 54g',3.00,60,'零食'],
      ['6940069100027','乐事薯片 原味 75g',6.50,40,'零食'],
      ['6901668001015','百岁山矿泉水 380ml',2.50,120,'饮料'],
      ['4902430733038','麒麟午后奶茶',5.50,35,'饮料'],
      ['6911988010048','卫龙辣条 大面筋',2.00,80,'零食'],
      ['6924742400241','王老吉凉茶 310ml',4.00,60,'饮料'],
    ];
    samples.forEach(([b,n,p,s,c]) => db.run(
      'INSERT INTO products (barcode,name,price,stock,category) VALUES (?,?,?,?,?)',[b,n,p,s,c]
    ));
    saveDB();
    console.log('✅ 示例商品数据已初始化');
  }
}

function saveDB() {
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function queryAll(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => Object.fromEntries(columns.map((c,i) => [c, row[i]])));
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

// ---- 中间件 ----
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// =============================================
// API 路由
// =============================================

// 根据条码查询
app.get('/api/product/:barcode', (req, res) => {
  const product = queryOne('SELECT * FROM products WHERE barcode = ?', [req.params.barcode]);
  if (!product) return res.status(404).json({ error: '商品不存在' });
  res.json(product);
});

// 商品列表（支持搜索 + 分类筛选）
app.get('/api/products', (req, res) => {
  const { q, category } = req.query;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR barcode LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (category && category !== '全部') { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY id DESC';
  res.json(queryAll(sql, params));
});

// 按名称模糊搜索（收银台用，返回最多10条）
app.get('/api/products/search', (req, res) => {
  const { q } = req.query;
  if (!q || q.trim() === '') return res.json([]);
  const results = queryAll(
    'SELECT * FROM products WHERE name LIKE ? OR barcode LIKE ? ORDER BY name LIMIT 10',
    [`%${q}%`, `%${q}%`]
  );
  res.json(results);
});

// 新增商品
app.post('/api/products', (req, res) => {
  const { barcode, name, price, stock, category } = req.body;
  if (!barcode || !name || price == null) return res.status(400).json({ error: '条码、名称、价格为必填项' });
  try {
    db.run('INSERT INTO products (barcode,name,price,stock,category) VALUES (?,?,?,?,?)',
      [barcode, name, parseFloat(price), parseInt(stock)||0, category||'其他']);
    const newId = queryOne('SELECT last_insert_rowid() as id').id;
    saveDB();
    res.json({ success: true, id: newId });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: '条码已存在' });
    res.status(500).json({ error: e.message });
  }
});

// 更新商品
// 全量商品（供离线缓存用，返回精简字段）—— 必须在 /:id 之前注册
app.get('/api/products/all', (req, res) => {
  const products = queryAll('SELECT id,barcode,name,price,stock,category FROM products ORDER BY id ASC');
  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const product = queryOne('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!product) return res.status(404).json({ error: '商品不存在' });
  res.json(product);
});

app.put('/api/products/:id', (req, res) => {
  const { barcode, name, price, stock, category } = req.body;
  try {
    db.run('UPDATE products SET barcode=?,name=?,price=?,stock=?,category=? WHERE id=?',
      [barcode, name, parseFloat(price), parseInt(stock)||0, category||'其他', req.params.id]);
    saveDB();
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: '条码已被其他商品使用' });
    res.status(500).json({ error: e.message });
  }
});

// 删除商品
app.delete('/api/products/:id', (req, res) => {
  db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
  saveDB();
  res.json({ success: true });
});

// 结算
app.post('/api/checkout', (req, res) => {
  const { items, total, paid } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: '购物车为空' });
  const change = parseFloat(paid) - parseFloat(total);
  if (change < 0) return res.status(400).json({ error: '付款金额不足' });
  try {
    // 直接扣减库存，允许负数（跳过无码商品 id=null）
    for (const item of items) {
      if (!item.id) continue;
      db.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
    }
    db.run('INSERT INTO transactions (total,paid,change_amt,items) VALUES (?,?,?,?)',
      [parseFloat(total), parseFloat(paid), change, JSON.stringify(items)]);
    const txId = queryOne('SELECT last_insert_rowid() as id').id;
    saveDB();
    res.json({ success: true, transactionId: txId, change: change.toFixed(2) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 交易记录

// [POST] 批量删除商品
app.post('/api/products/batch-delete', (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: '未选择商品' });
  try {
    ids.forEach(id => db.run('DELETE FROM products WHERE id = ?', [id]));
    saveDB();
    res.json({ success: true, count: ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// [POST] 批量设置库存
app.post('/api/products/batch-stock', (req, res) => {
  const { ids, stock } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: '未选择商品' });
  try {
    ids.forEach(id => db.run('UPDATE products SET stock = ? WHERE id = ?', [parseInt(stock)||0, id]));
    saveDB();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// [POST] 批量设置价格
app.post('/api/products/batch-price', (req, res) => {
  const { ids, price } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: '未选择商品' });
  if (!price || parseFloat(price) <= 0) return res.status(400).json({ error: '请输入有效价格' });
  try {
    ids.forEach(id => db.run('UPDATE products SET price = ? WHERE id = ?', [parseFloat(price), id]));
    saveDB();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/transactions', (req, res) => {
  const records = queryAll('SELECT * FROM transactions ORDER BY id DESC LIMIT 200');
  res.json(records.map(r => ({ ...r, change: r.change_amt })));
});

// 批量删除交易记录
app.post('/api/transactions/batch-delete', (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: '未选择记录' });
  try {
    ids.forEach(id => db.run('DELETE FROM transactions WHERE id = ?', [id]));
    saveDB();
    res.json({ success: true, count: ids.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 清理 N 天前的交易记录
app.post('/api/transactions/clean', (req, res) => {
  const days = parseInt(req.body.days) || 30;
  try {
    const before = queryAll(`SELECT id FROM transactions WHERE created_at < datetime('now','-${days} days','localtime')`);
    if (!before.length) { saveDB(); return res.json({ success: true, count: 0 }); }
    db.run(`DELETE FROM transactions WHERE created_at < datetime('now','-${days} days','localtime')`);
    saveDB();
    res.json({ success: true, count: before.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 统计
app.get('/api/stats', (req, res) => {
  const totalProducts = queryOne('SELECT COUNT(*) as c FROM products').c;
  const today = new Date().toISOString().slice(0, 10);
  const todayRows = queryAll('SELECT total FROM transactions WHERE created_at LIKE ?', [`${today}%`]);
  const todaySales = todayRows.reduce((s,r) => s + r.total, 0);
  const lowStock = queryOne('SELECT COUNT(*) as c FROM products WHERE stock < 10').c;
  res.json({ totalProducts, todaySales: todaySales.toFixed(2), todayOrders: todayRows.length, lowStock });
});

// ---- 导出 CSV ----
app.get('/api/products/export', (req, res) => {
  const products = queryAll('SELECT * FROM products ORDER BY id ASC');
  const header = 'id,barcode,name,price,stock,category,created_at';
  const rows = products.map(p =>
    [p.id, `"${p.barcode}"`, `"${p.name}"`, p.price, p.stock, `"${p.category}"`, `"${p.created_at}"`].join(',')
  );
  const csv = '\uFEFF' + [header, ...rows].join('\n'); // BOM for Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="products_${Date.now()}.csv"`);
  res.send(csv);
});

// ---- 导入 CSV ----
app.post('/api/products/import', (req, res) => {
  const { rows } = req.body; // [{barcode,name,price,stock,category}]
  if (!rows || !rows.length) return res.status(400).json({ error: '无数据' });
  let inserted = 0, updated = 0, errors = [];
  rows.forEach((row, idx) => {
    const { barcode, name, price, stock, category } = row;
    if (!barcode || !name || price == null) { errors.push(`第${idx+2}行：缺少必填字段`); return; }
    const existing = queryOne('SELECT id FROM products WHERE barcode = ?', [barcode]);
    try {
      if (existing) {
        db.run('UPDATE products SET name=?,price=?,stock=?,category=? WHERE barcode=?',
          [name, parseFloat(price)||0, parseInt(stock)||0, category||'其他', barcode]);
        updated++;
      } else {
        db.run('INSERT INTO products (barcode,name,price,stock,category) VALUES (?,?,?,?,?)',
          [barcode, name, parseFloat(price)||0, parseInt(stock)||0, category||'其他']);
        inserted++;
      }
    } catch(e) { errors.push(`第${idx+2}行：${e.message}`); }
  });
  saveDB();
  res.json({ success: true, inserted, updated, errors });
});


// =============================================
// 分类管理 API
// =============================================
app.get('/api/categories', (req, res) => {
  const cats = queryAll('SELECT c.*, COUNT(p.id) as product_count FROM categories c LEFT JOIN products p ON p.category = c.name GROUP BY c.id ORDER BY c.sort_order, c.id');
  res.json(cats);
});

app.post('/api/categories', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '分类名称不能为空' });
  try {
    db.run('INSERT INTO categories (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM categories))', [name.trim()]);
    saveDB();
    res.json({ success: true });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: '分类已存在' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/categories/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const count = queryOne('SELECT COUNT(*) as c FROM products WHERE category = ?', [name]).c;
  if (count > 0) return res.status(400).json({ error: `该分类下还有 ${count} 个商品，请先移除商品或更改商品分类` });
  db.run('DELETE FROM categories WHERE name = ?', [name]);
  saveDB();
  res.json({ success: true });
});

// =============================================
// 系统设置 API
// =============================================
app.get('/api/settings', (req, res) => {
  const rows = queryAll('SELECT key, value FROM settings');
  const obj = {};
  rows.forEach(r => obj[r.key] = r.value);
  res.json(obj);
});

app.post('/api/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: '缺少 key' });
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, value ?? '']);
  saveDB();
  res.json({ success: true });
});

// =============================================
// 数据备份 API
// =============================================
app.get('/api/backup/download', (req, res) => {
  // 更新最后备份时间
  const now = new Date().toLocaleString('zh-CN');
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['last_backup', now]);
  saveDB();
  const dbBuf = Buffer.from(db.export());
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="store_backup_${Date.now()}.db"`);
  res.send(dbBuf);
});

app.post('/api/backup/restore', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
  try {
    const buf = req.body;
    if (!buf || buf.length < 100) return res.status(400).json({ error: '文件无效' });
    // 验证是否为合法 SQLite 文件（前16字节为 "SQLite format 3\0"）
    const header = buf.slice(0, 16).toString('utf8');
    if (!header.startsWith('SQLite format 3')) return res.status(400).json({ error: '不是有效的 SQLite 数据库文件' });
    // 写入磁盘
    fs.writeFileSync(DB_FILE, buf);
    // 重新加载内存数据库
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    db = new SQL.Database(buf);
    res.json({ success: true, msg: '数据库已恢复，请刷新页面' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 二维码生成（纯 Node.js，无需第三方库，输出 SVG） ----
// 基于 QR Code 标准的简化实现，使用 qrcode npm 包
app.get('/api/qrcode', async (req, res) => {
  const text = req.query.text || '';
  try {
    const QRCode = require('qrcode');
    const svg = await QRCode.toString(text, {
      type: 'svg',
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch(e) {
    res.status(500).send('QR生成失败: ' + e.message);
  }
});

// ---- 离线订单同步接口 ----
// 批量提交离线期间产生的订单，返回每笔的服务端 ID
app.post('/api/sync-offline', (req, res) => {
  const { orders } = req.body;
  if (!orders || !orders.length) return res.json({ results: [] });
  const results = [];
  for (const order of orders) {
    try {
      const { items, total, paid, localId } = order;
      const change = parseFloat(paid) - parseFloat(total);
      for (const item of items) {
        if (!item.id) continue;
        db.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
      }
      db.run('INSERT INTO transactions (total,paid,change_amt,items) VALUES (?,?,?,?)',
        [parseFloat(total), parseFloat(paid), change, JSON.stringify(items)]);
      const txId = queryOne('SELECT last_insert_rowid() as id').id;
      results.push({ localId, txId, success: true });
    } catch(e) {
      results.push({ localId: order.localId, success: false, error: e.message });
    }
  }
  saveDB();
  res.json({ results });
});

// ---- 天气代理（服务端缓存1小时，避免前端跨域）----
let weatherCache = null;
let weatherCacheTime = 0;

app.get('/api/weather', async (req, res) => {
  const now = Date.now();
  if (weatherCache && now - weatherCacheTime < 60 * 60 * 1000) {
    return res.json(weatherCache);
  }
  try {
    const url = 'https://api.seniverse.com/v3/weather/now.json?key=S9uUPub7Tng9Ekcbm&location=ip&language=zh-Hans&unit=c';
    const response = await fetch(url);
    const data = await response.json();
    weatherCache = data;
    weatherCacheTime = now;
    res.json(data);
  } catch(e) {
    if (weatherCache) return res.json(weatherCache); // 失败时返回旧缓存
    res.status(502).json({ error: '天气获取失败' });
  }
});

// ---- 条码信息查询代理（避免前端跨域） ----
app.get('/api/barcode-lookup/:barcode', async (req, res) => {
  const { barcode } = req.params;
  try {
    const url = `https://apione.apibyte.cn/api/barcode?barcode=${encodeURIComponent(barcode)}`;
    const response = await fetch(url, {
      headers: { 'X-Api-Key': 'Shanhai-4sXunhfwEkvV77lCZ3absEcmWs0clflssaOXbiTuoKx7ac45' }
    });
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ code: 502, msg: '外部API请求失败', data: { found: false } });
  }
});

// ---- 获取本机局域网 IP ----
function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ---- WebSocket 服务 ----
// rooms: { roomId: { cashier: ws | null, scanners: Set<ws> } }
const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) rooms[roomId] = { cashier: null, scanners: new Set() };
  return rooms[roomId];
}

// ---- HTTPS 证书加载 ----
// 优先使用正式证书（Let's Encrypt / acme.sh），回退到自签名证书
function getOrCreateCert() {
  // 正式证书路径（acme.sh 默认路径，支持自定义）
  const ACME_CERT = process.env.SSL_CERT || '';
  const ACME_KEY  = process.env.SSL_KEY  || '';

  if (ACME_CERT && ACME_KEY && fs.existsSync(ACME_CERT) && fs.existsSync(ACME_KEY)) {
    console.log('✅ 已加载正式 SSL 证书：', ACME_CERT);
    return { cert: fs.readFileSync(ACME_CERT), key: fs.readFileSync(ACME_KEY) };
  }

  // 回退：自签名证书
  const certDir  = process.env.NODE_ENV === 'production' ? BASE_DIR : path.join(__dirname, 'data');
  if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });
  const certFile = path.join(certDir, 'cert.pem');
  const keyFile  = path.join(certDir, 'key.pem');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  }
  try {
    const { execSync } = require('child_process');
    const ip = getLocalIP();
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" -days 3650 -nodes` +
      ` -subj "/CN=${ip}" -addext "subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost"`,
      { stdio: 'pipe' }
    );
    console.log('✅ 已自动生成 HTTPS 自签名证书（建议配置正式证书）');
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  } catch(e) {
    console.warn('⚠️  openssl 不可用，HTTPS 服务将跳过：', e.message);
    return null;
  }
}

// ---- WS 消息处理（HTTP 和 HTTPS 共用）----
function setupWSS(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '');
    const role   = params.get('role');
    const roomId = params.get('room') || 'default';
    const room   = getOrCreateRoom(roomId);

    if (role === 'cashier') {
      room.cashier = ws;
      ws.send(JSON.stringify({ type: 'connected', scanners: room.scanners.size }));
      if (room.scanners.size > 0) {
        ws.send(JSON.stringify({ type: 'scanner_joined', scanners: room.scanners.size }));
      }
      ws.on('close', () => { if (room.cashier === ws) room.cashier = null; });

    } else if (role === 'scanner') {
      room.scanners.add(ws);
      if (room.cashier && room.cashier.readyState === 1) {
        room.cashier.send(JSON.stringify({ type: 'scanner_joined', scanners: room.scanners.size }));
      }
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'barcode' && room.cashier && room.cashier.readyState === 1) {
            room.cashier.send(JSON.stringify({ type: 'barcode', barcode: msg.barcode }));
            ws.send(JSON.stringify({ type: 'ack', barcode: msg.barcode }));
          }
        } catch(e) {}
      });
      ws.on('close', () => {
        room.scanners.delete(ws);
        if (room.cashier && room.cashier.readyState === 1) {
          room.cashier.send(JSON.stringify({ type: 'scanner_left', scanners: room.scanners.size }));
        }
      });
    }
  });
}

// ---- 启动 ----
initDB().then(() => {
  const ip = getLocalIP();
  const HTTP_PORT  = PORT;        // 3000，电脑访问
  const HTTPS_PORT = PORT + 1;    // 3001，手机扫码用

  // HTTP 服务（收银台电脑端）
  const httpServer = http.createServer(app);
  setupWSS(httpServer);
  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log('');
    console.log('🏪 便利店收银系统已启动！');
    console.log('================================');
    console.log(`📌 主页:     http://localhost:${HTTP_PORT}`);
    console.log(`💰 收银前台: http://localhost:${HTTP_PORT}/cashier.html`);
    console.log(`⚙️  管理后台: http://localhost:${HTTP_PORT}/admin.html`);
  });

  // HTTPS 服务（手机扫码专用，摄像头需要安全上下文）
  const sslCreds = getOrCreateCert();
  if (sslCreds) {
    const httpsServer = https.createServer(sslCreds, app);
    setupWSS(httpsServer);
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`📱 手机扫码: https://${ip}:${HTTPS_PORT}/scanner.html`);
      console.log('   ⚠️  手机首次访问需点击"高级"→"继续访问"接受自签名证书');
      console.log('================================');
      console.log('按 Ctrl+C 停止服务');
    });
  } else {
    console.log(`📱 手机扫码: HTTPS 不可用（openssl 未安装）`);
    console.log('================================');
    console.log('按 Ctrl+C 停止服务');
  }

}).catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
