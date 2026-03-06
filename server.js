// =============================================
// server.js - 便利店收银系统后端服务
// =============================================
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
// 优先使用 /app/data 目录（Docker 挂载卷），本地开发时回退到项目根目录
const DB_FILE = process.env.NODE_ENV === 'production'
  ? path.join('/app/data', 'store.db')
  : path.join(__dirname, 'store.db');

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
  const records = queryAll('SELECT * FROM transactions ORDER BY id DESC LIMIT 50');
  res.json(records.map(r => ({ ...r, change: r.change_amt })));
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

// ---- 启动 ----
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('🏪 便利店收银系统已启动！');
    console.log('================================');
    console.log(`📌 主页:     http://localhost:${PORT}`);
    console.log(`💰 收银前台: http://localhost:${PORT}/cashier.html`);
    console.log(`⚙️  管理后台: http://localhost:${PORT}/admin.html`);
    console.log('================================');
    console.log('按 Ctrl+C 停止服务');
  });
}).catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
