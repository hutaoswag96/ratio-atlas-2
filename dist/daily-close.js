'use strict';

let liveDailyPrices = [], dailyError = false, dailyPending = false;

function mergeDailyCloses(existing, incoming) {
 const byDay = new Map();
 for (const row of [...existing,...incoming]) {
  if (!Array.isArray(row) || !/^\d{4}-\d{2}-\d{2}$/.test(row[0])) continue;
  if (row.slice(1).length !== 2 || !row.slice(1).every(value=>Number.isFinite(value)&&value>0)) continue;
  byDay.set(row[0],row);
 }
 return [...byDay.values()].sort((a,b)=>a[0].localeCompare(b[0]));
}

function dailyChartQuotes() {
 const weeklyCloses = rows.slice(START).map(([date,red,growth])=>[date,red,growth]);
 return mergeDailyCloses(mergeDailyCloses(dailyPriceSnapshot,liveDailyPrices),weeklyCloses);
}

function dailyZone(ratio, band) {
 if (ratio<=band.low) return 0;
 if (ratio>=band.high) return 1;
 return null;
}

function drawQuoteSparkline(prices) {
 const values = prices.map(([,red,growth])=>red/growth);
 const min=Math.min(...values), max=Math.max(...values), span=max-min;
 const points=values.map((value,i)=>[5+158*i/Math.max(values.length-1,1),span?5+36*(max-value)/span:24]);
 const line=points.map(([x,y],i)=>(i?'L':'M')+x+' '+y).join(' ');
 const [x,y]=points.at(-1);
 $('quote-sparkline').innerHTML='<path class="spark-fill" d="'+line+'L'+x+' 47H5Z"/>'+
  '<path class="spark-line" d="'+line+'"/><circle class="spark-tip" cx="'+x+'" cy="'+y+'" r="3.5"/>';
 $('quote-sparkline-period').textContent='近 '+prices.length+' 个交易日';
}

function showDailyClose() {
 const weekly = rows[end], latest = trendQuotes.at(-1);
 const [date,red,growth] = latest;
 const ratio = red/growth, change = $('daily-ratio-change');
 $('daily-asof').textContent = date;
 $('ratio').textContent = f(ratio);
 change.className = '';
 if (trendQuotes.length>1) {
  const [,previousRed,previousGrowth] = trendQuotes.at(-2);
  const delta = ratio/(previousRed/previousGrowth)-1;
  change.textContent = '较前一交易日 '+signedRate(delta);
  change.className = changeClass(delta);
 } else change.textContent = '收盘于 '+date;
 drawQuoteSparkline(trendQuotes.slice(-20));
 const side = dailyZone(ratio, trendBands.get(date.slice(0,4)));
 const observation = $('daily-observation');
 observation.querySelector('strong').textContent = side===null?'两线之间':ASSETS[side]+'观察区';
 const touch = trendQuotes.findLast(([day,a,b]) =>
  day>weekly[0] && dailyZone(a/b,trendBands.get(day.slice(0,4)))!==null);
 const context = observation.querySelector('span');
 if (touch) {
  const [day,a,b] = touch;
  const touchedSide = dailyZone(a/b,trendBands.get(day.slice(0,4)));
  context.textContent = side===null?'周线后曾入区 · '+day+' '+ASSETS[touchedSide]+' · 已退回区间':
   '最近触线 '+day+' · 等待周收盘确认';
 } else context.textContent = '买卖按周收盘确认';
 $('daily-detail').textContent = date+' 收盘 · 红利全收益 '+pointFormat.format(red)+' · 创业板全收益 '+pointFormat.format(growth)+
  ' · 比值 '+f(ratio)+(dailyError?'。行情源暂不可用，显示最近已获取的收盘。':'。');
 if (typeof renderDataStatus === 'function') renderDataStatus();
}

async function dailySeries(symbol, first, last) {
 const params = new URLSearchParams({ param: [symbol,'day',first,last,325,''].join(',') });
 const response = await fetch('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?'+params,
  { signal: AbortSignal.timeout(8000), credentials: 'omit', cache: 'no-store' });
 if (!response.ok) throw new Error('Daily close unavailable');
 const payload = await response.json();
 const series = payload?.data?.[symbol]?.day;
 if (payload.code !== 0 || !Array.isArray(series)) throw new Error('Daily series unavailable');
 return new Map(series.filter(bar => /^\d{4}-\d{2}-\d{2}$/.test(bar[0]) && bar[0]>=first && bar[0]<=last)
  .map(bar => [bar[0], Number(bar[2])]).filter(([, close]) => Number.isFinite(close) && close > 0));
}

// 2.0：全收益指数没有公开的实时行情接口，日线随数据脚本更新，页面不再联网拉取。
async function refreshDailyClose() {
 dailyError = false;
 refreshTrendQuotes();
 renderProjection();
 showDailyClose();
}
