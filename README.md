# 公交刷卡票价核验台（FastAPI + SQLite + 原生前端）

录入站点分区、票价矩阵、换乘抵扣额、每日封顶额及刷卡记录，系统按卡号配对进出站、
按运营日与换乘规则计算票价，并在数据异常时给出**可定位**的错误且**不生成部分账单**。
另支持**规则试算对比**：输入一组不保存的草案参数，对同一批记录分别按当前配置与草案
计费，逐程与整批对比金额变化。

- 后端：FastAPI（Python 3.11）
- 数据库：SQLite（标准库 `sqlite3`，金额以**整数分**存储）
- 前端：原生 HTML / CSS / JavaScript，无框架、无构建步骤
- 部署：Dockerfile + docker-compose，数据持久化到命名卷

## 快速开始

```bash
docker compose up -d --build
# 启动后访问
open http://localhost:8000
```

停止与清理：

```bash
docker compose down          # 停止（保留数据卷）
docker compose down -v       # 停止并删除数据
```

本地裸机运行（不使用 Docker）：

```bash
pip install -r requirements.txt
DB_PATH=./bus.db uvicorn app.main:app --host 0.0.0.0 --port 8000
# http://localhost:8000 ，交互式 API 文档在 /docs
```

## 业务规则

1. **进出站配对**：刷卡记录按卡号分组、时间升序排列，必须从进站开始且进出成对。
   - 一条进站没有后续出站 → `MISSING_EXIT`（缺失出站）
   - 起始是出站，或出站前没有进站 → `MISSING_ENTRY`（缺失进站）
2. **运营日归属**：行程按**进站时刻**归属运营日，默认以 **04:00** 为分界。
   例如 `2026-09-19 03:20` 的进站属于 `2026-09-18` 运营日。分界时刻可在页面配置。
3. **换乘抵扣**：同一卡号「前次出站 → 下次进站」间隔 **≤ 90 分钟**（可配置）时，
   先抵扣换乘优惠额（默认 1 元，跨运营日的 90 分钟内换乘同样适用）。
   - 抵扣额不超过该程基础票价，最小为 0。
4. **当日封顶**：抵扣之后再按「卡号 + 运营日」应用封顶（默认 10 元/日）。
   - 实扣 = max(0, min(基础票价 − 换乘抵扣, 封顶额 − 当日已累计))
   - 累计额按实扣逐程累加；封顶后后续行程实扣 0。
5. **原子核验**：只要存在任何记录级错误（缺失出站/进站、时间逆序、重复刷卡、
   未知站点、票价矩阵缺项），整批核验失败，**不写入任何账单**（无部分账单）。
   旧账单同时清空，避免过期数据被误读。
6. **重复刷卡 / 时间逆序**：
   - 同卡两条记录时刻完全相同 → `DUPLICATE_SWIPE`（重复刷卡）
   - 同卡出站早于进站、或排序后存在逆序 → `TIME_REVERSED`（时间逆序）
   - 错误信息同时给出卡号、时刻、站点与**原始文本行号**。

账单字段：卡号、卡内序号、运营日、进站/出站时刻、进出站点与分区、
**基础票价、优惠额、优惠来源说明、实扣额、当日累计额（/封顶额）**。

7. **规则试算对比**：在「2. 规则试算对比」区填入一组**不会保存**的草案参数
   （换乘时限、抵扣额、每日封顶、运营日分界），调用试算接口对**当前已保存的同一批
   刷卡记录**分别按当前配置与草案配置计费。
   - 试算与正式核验**完全复用同一套解析、配对与计价规则**，不修改任何配置、
     不写入或清空账单（纯只读）。
   - 任一方案存在错误时（草案参数非法 `CONFIG_BAD`，或数据错误如缺出站、未知站点、
     缺票价等），接口返回 422，`current` / `draft` 两个分块各自携带该方案的
     **原有定位错误**（错误码、行号、卡号、时刻、站点与 `/api/verify` 一致）。
   - 两边均成功时，按**卡号 + 卡内序号**对齐行程，逐程展示运营日（发生归属变化时
     高亮）、当前/草案优惠、当前/草案实扣及差额，并给出每张卡与全批次的实扣、
     优惠合计及差额。差额口径统一为「草案 − 当前」：实扣差额为正表示多付（红），
     为负表示少付（绿）。

## 录入格式

页面上每个区块都是「每行一条」的纯文本，分隔符支持逗号、制表符、分号、空白与全角逗号；
空行与 `#` 开头的注释行会被忽略。

| 区块 | 每行格式 | 示例 |
|---|---|---|
| 站点分区 | `站点名, 分区号` | `科技园, 1` |
| 票价矩阵 | `起始分区, 到达分区, 票价` | `1, 2, 3.00`（按方向精确匹配） |
| 刷卡记录 | `卡号, 时刻, 站点, 进/出` | `A001, 2026-09-18 08:00:00, 科技园, 进` |

- 刷卡方向：`IN` / `进` / `进站` 或 `OUT` / `出` / `出站`。
- 时刻格式：`YYYY-MM-DD HH:MM[:SS]`、`YYYY/MM/DD HH:MM`、`YYYY-MM-DDTHH:MM:SS`、
  或月日格式 `MM-DD HH:MM`（自动补当前年份）。
- 站点名与分区、矩阵项均不可重复定义；刷卡记录中的重复刷卡是业务校验，
  在「运行核验」时报告。

### 内置演示数据

点击页面右上角 **「载入演示数据」**，会写入 3 个站点、3×3 票价矩阵与两张卡的记录：

- 卡 A 在同一运营日内 4 次出行：演示换乘抵扣（间隔 ≤90 分钟）与当日封顶（累计到 10 元）；
- 卡 B 在 `03:20` 进站：演示 04:00 运营日归属。

可故意制造以下错误观察定位效果（核验后整批不出账单）：

```text
# 删除某卡最后一条出站        -> MISSING_EXIT
# 让同一卡两条记录时刻相同      -> DUPLICATE_SWIPE
# 让出站时刻早于进站时刻        -> TIME_REVERSED
# 录入未定义的站点名           -> UNKNOWN_STATION
# 删除矩阵中的某个分区对       -> MISSING_FARE
```

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config` | 读取规则参数 |
| PUT | `/api/config` | 更新参数（使旧账单失效） |
| GET/PUT | `/api/stations` | 读取 / 整批替换站点分区，PUT body：`{"text": "..."}` |
| GET/PUT | `/api/fares` | 读取 / 整批替换票价矩阵 |
| GET/PUT | `/api/records` | 读取 / 整批替换刷卡记录 |
| POST | `/api/verify` | 执行核验；成功写入账单，失败返回 422 与错误数组 |
| POST | `/api/trial-compare` | 规则试算对比（只读，不改配置/不写账单） |
| GET | `/api/bills` | 读取最近一次成功核验的账单 |
| GET | `/api/health` | 健康检查 |

### `/api/trial-compare` 规则试算对比

请求体为**草案参数**（均必填；数值合法性由核心层校验，非法时返回 422 +
`CONFIG_BAD`，而不是请求体校验错误）：

```json
{
  "transfer_minutes": 120,
  "transfer_discount": 2.00,
  "daily_cap": 15.00,
  "day_split_hour": 5
}
```

两方案均成功时返回 `200`：

```json
{
  "ok": true,
  "current": { "ok": true, "errors": [], "bill_count": 5,
               "config": {"transfer_minutes": 90, "transfer_discount": 1.0,
                          "daily_cap": 10.0, "day_split_hour": 4} },
  "draft":   { "ok": true, "errors": [], "bill_count": 5, "config": { } },
  "rows": [
    {
      "card": "A001", "seq": 2,
      "entry_time": "2026-09-18 09:10:00", "exit_time": "2026-09-18 09:50:00",
      "entry_station": "中心公园", "exit_station": "大学城",
      "from_zone": 2, "to_zone": 3, "base_fare": 3.0,
      "current_operating_day": "2026-09-18", "draft_operating_day": "2026-09-18",
      "day_changed": false,
      "current_discount": 1.0, "draft_discount": 2.0, "discount_diff": 1.0,
      "current_charge": 2.0, "draft_charge": 1.0, "charge_diff": -1.0,
      "draft_discount_source": "换乘优惠（距上次出站 45 分钟，≤120 分钟，抵扣 2.00 元）",
      "current_discount_source": "…"
    }
  ],
  "card_summaries": [
    { "card": "A001", "trip_count": 4,
      "current_charge_total": 10.0, "draft_charge_total": 9.0, "charge_diff": -1.0,
      "current_discount_total": 2.0, "draft_discount_total": 4.0, "discount_diff": 2.0 }
  ],
  "batch_summary": { "trip_count": 5,
    "current_charge_total": 13.0, "draft_charge_total": 12.0, "charge_diff": -1.0,
    "current_discount_total": 2.0, "draft_discount_total": 4.0, "discount_diff": 2.0 }
}
```

任一方案存在错误时返回 HTTP 422，两个分块各自给出该方案的原有定位错误：

```json
{
  "ok": false,
  "current": { "ok": true, "errors": [], "config": { } },
  "draft":   { "ok": false,
               "errors": [ { "code": "CONFIG_BAD",
                             "message": "换乘有效间隔必须为正整数（分钟）" } ],
               "config": { } }
}
```

数据错误时（如某条记录缺失出站）`current.errors` 与 `draft.errors` 都会包含与
`/api/verify` 完全相同的 `MISSING_EXIT` 等定位错误对象（含 `location`）。
试算为只读操作：成功与失败都不会改动 `meta` 中的规则参数，也不会写入或清空
`trip_bill`。

## 页面操作说明（规则试算对比）

1. 先在 3～5 区保存站点分区、票价矩阵与刷卡记录（试算针对**已保存**的数据进行；
   文本框中未保存的内容需先点「保存」）。
2. 在「2. 规则试算对比」区填写草案的四个参数；点击「用已保存参数填入草案」可把
   当前配置复制到草案框，再做局部修改。
3. 点击「🧪 当前配置 vs 草案 试算」：
   - 成功：展示逐程对齐表（运营日变化高亮，差额 = 草案 − 当前）、按卡汇总与
     全批次合计；草案参数不会被保存，账单区（第 6 区）也不受影响。
   - 失败：错误面板分别列出当前 / 草案方案的定位错误；数据错误时建议先修复基础
     数据并重新「运行核验」，再回来试算。

核验失败响应示例（HTTP 422）：

```json
{
  "ok": false,
  "bill_count": 0,
  "errors": [
    {
      "code": "MISSING_EXIT",
      "message": "卡号 A001 进站后缺失出站（2026-09-18 08:00:00 @ 科技园）",
      "location": { "line": 1, "card": "A001", "time": "2026-09-18 08:00:00", "station": "科技园" }
    }
  ]
}
```

错误码一览：`RECORD_BAD_FIELDS` / `RECORD_BAD_TIME` / `RECORD_BAD_ACTION` /
`STATION_BAD_FIELDS` / `STATION_DUPLICATE` / `FARE_BAD_FIELDS` / `FARE_DUPLICATE` /
`UNKNOWN_STATION` / `MISSING_FARE` / `DUPLICATE_SWIPE` / `TIME_REVERSED` /
`MISSING_ENTRY` / `MISSING_EXIT` / `CONFIG_BAD`。

## 目录结构

```text
.
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── README.md
└── app
    ├── __init__.py
    ├── main.py          # FastAPI 路由与静态页挂载
    ├── schemas.py       # 请求模型
    ├── core.py          # 解析 / 校验 / 配对 / 计价（纯标准库）
    ├── db.py            # SQLite 建表、整批替换、账单读写
    └── static
        ├── index.html
        ├── styles.css
        └── app.js
```

## 实现说明

- **金额精度**：业务层以元计算并保留两位小数；落库统一转整数分，避免浮点误差。
- **事务原子性**：整批替换基础数据、核验写账单均在单事务内完成；核验失败时清空
  `trip_bill`，因此任何时刻读到的账单要么是上一次完整成功的结果，要么为空。
  `/api/trial-compare` 全程只执行 SELECT，不调用任何写接口，配置与账单均保持不变。
- **试算复用**：试算接口直接调用核心层 `trial_compare()`，内部对两套配置各执行一次
  `verify()`，再按 `(卡号, 卡内序号)` 对齐账单；因此配对、运营日归属、换乘抵扣与
  封顶规则与正式核验永远一致，不会出现两套口径。
- **数据位置**：容器内 `DB_PATH=/data/bus.db`，compose 用命名卷 `bus-data` 持久化；
  可用环境变量 `DB_PATH` 覆盖路径。
- **无外部前端依赖**：页面由 FastAPI 直接以静态文件提供，无需 npm/CDN，
  离线网络下也可使用。
