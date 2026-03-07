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
- 💰 实收金额找零计算（不输入则按应付金额结算）
- 🧾 结算后生成小票
- 📱 支持手机扫码枪模式，连接手机后实时将条码推送到收银台

**管理后台**
- 📦 商品增删改查，支持批量删除 / 批量设价 / 批量设库存
- 📂 商品数据 CSV 导入 / 导出（兼容 Excel GBK 编码）
- 📊 今日销售额、订单数、低库存预警
- 🧾 交易记录查询

**手机扫码（scanner.html）**
- 💰 **收银模式**：连续扫码，实时推送条码到电脑收银台
- 📦 **商品录入模式**：扫码后自动查询云端商品信息，确认后写入数据库；若商品已存在则提示并允许覆盖
- 纯浏览器实现，无需安装 App，基于 ZXing 条码识别库

---

## 🚀 部署方式

### 方式一：本地直接运行（开发 / 个人使用）

**前置要求：** 安装 [Node.js](https://nodejs.org) v18 或以上版本

```bash
# 1. 克隆项目
git clone https://github.com/zmy1807118827/convenience-store-pos.git
cd convenience-store-pos

# 2. 安装依赖（会自动将 zxing.min.js / qrcode.min.js 复制到 public/）
npm install

# 3. 启动
npm start
```

启动成功后访问：

| 页面 | 地址 |
|------|------|
| 系统主页 | http://localhost:3000 |
| 收银前台 | http://localhost:3000/cashier.html |
| 管理后台 | http://localhost:3000/admin.html |
| 手机扫码（HTTPS）| https://局域网IP:3001/scanner.html |

> **手机扫码说明：** 摄像头 API 需要 HTTPS。服务启动时会自动在 `data/` 目录生成自签名证书，手机首次访问时点击"高级 → 继续访问"接受证书即可。

> 数据保存在 `data/store.db`，备份此文件即可保留所有数据。

---

### 方式二：Docker 部署（服务器 / 生产环境）

**前置要求：** 安装 [Docker](https://www.docker.com)

```bash
# 1. 克隆项目
git clone https://github.com/zmy1807118827/convenience-store-pos.git
cd convenience-store-pos

# 2. 构建并启动容器
docker compose up -d --build
```

启动成功后访问：

| 页面 | 地址 |
|------|------|
| 收银前台 | http://服务器IP:3008/cashier.html |
| 管理后台 | http://服务器IP:3008/admin.html |
| 手机扫码（HTTPS）| https://服务器IP:3009/scanner.html |

**防火墙需开放端口：**

| 端口 | 用途 |
|------|------|
| 3008 | HTTP，电脑访问收银台 / 管理后台 |
| 3009 | HTTPS，手机扫码专用 |

**常用管理命令：**

```bash
# 查看运行状态
docker compose ps

# 查看日志
docker compose logs -f

# 停止
docker compose down

# 更新代码后重新构建
docker compose up -d --build
```

> 数据持久化保存在项目目录下的 `data/store.db`，容器重建不会丢失数据。

---

## 📱 手机扫码使用说明

1. 电脑打开收银前台，点击顶部 **📱 连接手机** 按钮
2. 手机连接同一 WiFi，扫描弹出的二维码
3. 手机首次访问 HTTPS 页面时，点击"**高级 → 继续前往**"接受自签名证书
4. 选择模式：
   - **收银模式**：对准商品条码，自动发送到电脑购物车
   - **商品录入模式**：扫码后弹出确认表单，核对后保存到数据库

---

## 📁 项目结构

```
convenience-store-pos/
├── server.js          # 后端服务（Express + sql.js + WebSocket）
├── package.json       # 项目配置
├── Dockerfile         # Docker 镜像构建文件
├── docker-compose.yml # Docker Compose 配置
└── public/
    ├── index.html     # 导航主页
    ├── cashier.html   # 收银前台
    ├── admin.html     # 管理后台
    └── scanner.html   # 手机扫码页
```

---

## 🔧 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/product/:barcode` | 按条码查询单个商品 |
| GET | `/api/products` | 商品列表（支持 ?q= ?category=） |
| GET | `/api/products/:id` | 按 ID 查询商品 |
| POST | `/api/products` | 新增商品 |
| PUT | `/api/products/:id` | 更新商品 |
| DELETE | `/api/products/:id` | 删除商品 |
| POST | `/api/products/batch-delete` | 批量删除 |
| POST | `/api/products/batch-stock` | 批量设置库存 |
| POST | `/api/products/batch-price` | 批量设置价格 |
| POST | `/api/checkout` | 结算下单 |
| GET | `/api/transactions` | 交易记录 |
| GET | `/api/stats` | 统计数据 |
| GET | `/api/barcode-lookup/:barcode` | 条码云端查询（代理） |
| GET | `/api/products/export` | 导出 CSV |
| POST | `/api/products/import` | 导入 CSV |
| WS | `/ws?role=cashier&room=xxx` | 收银台 WebSocket |
| WS | `/ws?role=scanner&room=xxx` | 手机扫码 WebSocket |

---

## 🛠️ 技术栈

- **后端**：Node.js + Express + ws（WebSocket）
- **数据库**：SQLite（通过 sql.js，无需编译，兼容所有 Node 版本）
- **前端**：原生 HTML + CSS + JavaScript
- **条码识别**：ZXing-js（离线可用）
- **部署**：Docker + Docker Compose

---

## 📄 License

MIT License
