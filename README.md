# 红创比 2.0

中证红利全收益 `H00922` ÷ 创业板全收益 `399606` 的单边五笔轮动执行台。

- 站点：https://hutaoswag96.github.io/ratio-atlas-2/
- 与 1.0 的区别：两条腿都换成全收益指数，比值含分红；方向仍是「红利 ÷ 创业板」，比值越小红利越便宜。
- `weekly.js`：813 个共同交易周（2011-01-07 起），列为 `[日期, 红利全收益, 创业板全收益]`。
- `daily-returns.js`：同口径日线，`daily-prices.js` 直接引用它，日线比值图与结算共用一条序列。
- 更新：`python3 update_data.py` 补周线（增量，只抓最近 8 周），`python3 update_daily.py` 补日线（增量，只抓最近 10 天）。
- 部署：`main` 存源码，`gh-pages` 存 `dist/` 内容。
