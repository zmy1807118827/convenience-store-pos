<div align="center">

# 🏪 便利店收银系统

**一个轻量、开箱即用的本地收银管理系统**

![Node.js](https://img.shields.io/badge/Node.js-20+-green)
![Express](https://img.shields.io/badge/Express-4.x-blue)
![SQLite](https://img.shields.io/badge/SQLite-sql.js-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

</div>

---

## ✨ 功能特性

**收银前台**
- 📷 条码扫描 / 商品名称模糊搜索自动匹配商品
- 🏷️ 无码商品快速录入（空格键触发）
- ➕ 扫描未知条码时自动调用云端 API 查询并录入商品
- 💰 实收金额找零计算；输入框为空时按 Enter 直接触发结算
- 🧾 结算后生成小票，Enter 键快速完成下一单
- 📱 支持手机扫码枪模式，连接手机后实时推送条码到收银台
- 🌤 顶部显示实时天气（城市/天气/温度）
- 🎨 支持深色 / 浅色 / 跟随系统三种主题
- 📡 **离线模式**：断网后自动切换本地 IndexedDB 查询商品，结算暂存本地，网络恢复后自动同步

**管理后台**
- 📦 商品增删改查，支持批量删除 / 批量设价 / 批量设库存
- 🏷️ 分类管理：动态添加/删除分类，显示各分类商品数量
- 📂 商品数据 CSV 导入 / 导出（兼容 Excel GBK 编码）
- 📊 今日销售额、订单数、低库存预警
- 🧾 交易记录查询，支持勾选删除、一键清理30天前记录
- ⚙️ 系统设置：店铺名称、收银台主题、数据备份与恢复

**手机扫码（scanner.html）**
- 💰 **收银模式**：连续扫码，实时推送条码到电脑收银台
- 📦 **商品录入模式**：扫码后自动查询云端商品信息，确认后写入数据库；若商品已存在则提示并允许覆盖
- 纯浏览器实现，无需安装 App，基于 ZXing 条码识别库

---

## 🚀 部署方式

### 方式一：本地直接运行（开发 / 个人使用）

**前置要求：** 安装 [Node.js](https://nodejs.org) v18 或以上版本

```bash
git clone https://github.com/zmy1807118827/convenience-store-pos.git
cd convenience-store-pos
npm install
npm start
```

启动后访问：

| 页面 | 地址 |
|------|------|
| 系统主页 | http://localhost:3000 |
| 收银前台 | http://localhost:3000/cashier.html |
| 管理后台 | http://localhost:3000/admin.html |
| 手机扫码（HTTPS）| https://局域网IP:3001/scanner.html |

---

### 方式二：Docker 部署（服务器 / 生产环境）

**前置要求：** 安装 [Docker](https://www.docker.com)

```bash
git clone https://github.com/zmy1807118827/convenience-store-pos.git
cd convenience-store-pos
docker compose up -d --build
```

**防火墙需开放端口：**

| 端口 | 用途 |
|------|------|
| 3008 | HTTP，电脑访问收银台 / 管理后台 |
| 3009 | HTTPS，手机扫码 + 离线缓存专用 |

**常用命令：**

```bash
docker compose ps          # 查看状态
docker compose logs -f     # 查看日志
docker compose down        # 停止
docker compose up -d --build  # 更新重建
```

---

## 🔐 HTTPS 证书配置

HTTPS 用于手机扫码摄像头权限。支持两种方式：

**方式一：自签名证书（默认，自动生成）**
启动时自动生成，手机首次访问需点击"高级 → 继续前往"接受证书。

**方式二：正式证书（推荐，Let's Encrypt 免费）**

```bash
# 申请证书（以阿里云 DNS 为例）
export Ali_Key='你的AccessKey_ID'
export Ali_Secret='你的AccessKey_Secret'
acme.sh --issue --dns dns_ali -d 你的域名 --home /etc/acme

# 复制证书到 ssl 目录
mkdir -p ssl
cp /etc/acme/你的域名_ecc/fullchain.cer ssl/你的域名.pem
cp /etc/acme/你的域名_ecc/你的域名.key ssl/你的域名.key
```

在 `docker-compose.yml` 里配置证书路径：

```yaml
volumes:
  - ./ssl:/app/ssl:ro
environment:
  - SSL_CERT=/app/ssl/你的域名.pem
  - SSL_KEY=/app/ssl/你的域名.key
```

---

## 📱 手机扫码使用说明

1. 电脑打开收银前台，点击顶部 **📱 连接手机** 按钮
2. 手机扫描二维码（地址固定为 `https://域名:3009/scanner.html`）
3. 选择模式：**收银模式** 或 **商品录入模式**

---

## 📁 项目结构

```
convenience-store-pos/
├── server.js              # 后端服务（Express + sql.js + WebSocket）
├── package.json
├── Dockerfile
├── docker-compose.yml
└── public/
    ├── index.html         # 导航主页
    ├── cashier.html       # 收银前台
    ├── admin.html         # 管理后台
    ├── scanner.html       # 手机扫码页
    └── sw.js              # Service Worker（离线缓存）
```

---

## 🔧 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/product/:barcode` | 按条码查询商品 |
| GET/POST/PUT/DELETE | `/api/products` | 商品 CRUD |
| GET/POST/DELETE | `/api/categories` | 分类管理 |
| GET/POST | `/api/settings` | 系统设置 |
| POST | `/api/checkout` | 结算 |
| GET | `/api/transactions` | 交易记录 |
| POST | `/api/sync-offline` | 离线订单同步 |
| GET | `/api/backup/download` | 下载备份 |
| POST | `/api/backup/restore` | 恢复备份 |
| WS | `/ws?role=cashier&room=xxx` | 收银台 WebSocket |
| WS | `/ws?role=scanner&room=xxx` | 手机扫码 WebSocket |

---

## 🛠️ 技术栈

- **后端**：Node.js + Express + ws（WebSocket）
- **数据库**：SQLite（sql.js，无需编译）
- **前端**：原生 HTML + CSS + JavaScript
- **离线**：Service Worker + IndexedDB
- **条码识别**：ZXing-js
- **部署**：Docker + Docker Compose

---

## 📄 License

MIT License
