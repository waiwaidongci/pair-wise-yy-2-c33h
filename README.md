# 赛鸽血统环号登记站

运行：

```bash
npm start
```

访问 `http://localhost:3024`。支持档案、血统查询、转让和归巢成绩记录。

## 奖金结算台（`/settlement`）

按足环、放飞日和名次生成应发奖金，替代聊天对账：

- **登记赛事奖金**：赛事名称 + 放飞日 + 奖金表（名次 金额），同赛事同放飞日只能登记一次。
- **结算**：按比赛当天有效鸽主生成每笔应收；收款人一经生成即锁定，赛后登记的转让不改收款人。
- **防重**：重复结算不产生新账；成绩更正/取消后自动重算——旧结算留档，已发放的生成待追回。
- **页面**：登记奖金、查看每笔应收、待追回、异常记录和结算留档；成绩在档案页可更正/取消。

业务拆分：

- `src/prizes.js` 奖金判定：比赛日归属回推、应发计算、榜单 diff、追回判定
- `src/store.js` 档案存储：台账读写、旧结算留档、待追回与异常登记
- `server.js` 页面操作：档案页与结算台页面、HTTP 接口

主要接口：

- `POST /api/prize-races` 登记赛事奖金 `{ event, releaseDate, prizes: [{ rank, amount }] }`
- `POST /api/prize-races/:id/settle` 结算/重新结算（幂等）
- `POST /api/prize-races/:id/cancel` 取消赛事
- `POST /api/settlements/:id/pay` 标记已发
- `POST /api/recoveries/:id/resolve` 标记已追回
- `POST /api/pigeons/:ring/races/:index/correct` 更正名次（自动重算）
- `POST /api/pigeons/:ring/races/:index/cancel` 取消成绩（自动重算）
- `GET /api/settlement` 结算台全量台账
