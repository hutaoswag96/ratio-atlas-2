'use strict';

const plotInset = { right: 13, bottom: 26 };
const pointFormat = new Intl.NumberFormat('zh-CN', {
 minimumFractionDigits: 2, maximumFractionDigits: 2
});
const chartViews = [
 { plot: 'plot', tip: 'plot-tip', selection: 'ratio-selection', top: 43, index: false },
 { plot: 'index-plot', tip: 'index-tip', selection: 'index-selection', top: 15, index: true }
];

let trendRange, markedDay, dragSelection;
let trendQuotes, trendDates, trendBands, tradeWeeks;
let trendDaily, planDaily, dailyWindow, hoverDay = null;
let activePreset = 0, activeCalendarYear = '';

function keepBetween(value, low, high) {
 return Math.max(low, Math.min(high, value));
}

function setTrendRange(first, last, options = {}) {
 trendRange = { first, last };
 markedDay = keepBetween(options.mark ?? last, first, last);
 activePreset = options.preset ?? null;
 activeCalendarYear = options.year ?? '';
 hoverDay = null;
 for (const view of chartViews) $(view.tip).hidden = true;
 syncTrendControls();
 renderTrendCharts();
}

function chooseRecent(months) {
 const last = trendDates.length - 1;
 if (!months) { setTrendRange(0, last, { preset: 0 }); return; }
 const today = new Date(trendDates[last]);
 const target = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth()-months, 1));
 const monthEnd = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth()+1, 0));
 target.setUTCDate(Math.min(today.getUTCDate(), monthEnd.getUTCDate()));
 const first = trendDates.findIndex(day=>day>=target.toISOString().slice(0,10));
 setTrendRange(first, last, { preset: months });
}

function chooseYear(year) {
 const first = trendDates.findIndex(day=>day.startsWith(year));
 const last = trendDates.findLastIndex(day=>day.startsWith(year));
 if (first !== -1) setTrendRange(first, last, { year });
}

function syncTrendControls() {
 const { first, last } = trendRange;
 const count = last - first + 1;
 $('chart-from').value = trendDates[first];
 $('chart-to').value = trendDates[last];
 $('chart-year').value = activeCalendarYear;
 $('chart-range-status').textContent = '显示 ' + trendDates[first] + ' 至 ' + trendDates[last] + ' · ' + count + ' 个交易日';
 for (const button of $('ranges').querySelectorAll('button')) {
  button.setAttribute('aria-pressed', Number(button.dataset.n) === activePreset);
 }
 $('zoom-in').disabled = count <= 2;
 $('zoom-out').disabled = count === trendDates.length;
 $('pan-back').disabled = first === 0;
 $('pan-forward').disabled = last === trendDates.length - 1;
 const cursor = $('cursor');
 cursor.min = first;
 cursor.max = last;
 cursor.disabled = first === last;
 cursor.value = markedDay;
}

function refreshTrendCharts() {
 trendDaily = strategyDailySeries(rows,dailyTotalReturns,model,START);
 tradeWeeks = new Map(model.trades.map(trade=>[rows[trade.i][0],trade.i]));
 refreshTrendQuotes(true);
}

function refreshTrendQuotes(force=false) {
 const quotes = dailyChartQuotes();
 if (!force && quotes.length===trendQuotes.length && quotes.every((row,i)=>
  row.every((v,j)=>v===trendQuotes[i][j]))) return;
 const previousDates = trendDates;
 const latestWasSelected = trendRange && markedDay===trendRange.last;
 const from = trendRange && previousDates[trendRange.first];
 const to = trendRange && previousDates[trendRange.last];
 const marked = trendRange && previousDates[markedDay];
 trendQuotes = quotes;
 trendDates = quotes.map(row=>row[0]);
 const years = [...new Set(trendDates.map(day=>day.slice(0,4)))].reverse();
 trendBands = new Map();
 for (let i=START;i<=end;i++) {
  const year=rows[i][0].slice(0,4);
  if (!trendBands.has(year)) trendBands.set(year,bars[i]);
 }
 for (const year of years) {
  if (trendBands.has(year)) continue;
  const history = rows.filter(row=>row[0]<year+'-01-01').map(row=>row[1]/row[2]).sort((a,b)=>a-b);
  trendBands.set(year,{low:quantile(history,.2),high:quantile(history,.8)});
 }
 $('chart-year').replaceChildren(new Option('选择年份', ''), ...years.map(year => new Option(year + ' 年', year)));
 for (const input of [$('chart-from'), $('chart-to')]) {
  input.min = trendDates[0];
  input.max = trendDates.at(-1);
 }
 if (activePreset !== null) chooseRecent(activePreset);
 else if (activeCalendarYear) chooseYear(activeCalendarYear);
 else {
  const first = Math.max(0,trendDates.findIndex(day=>day>=from));
  const last = Math.max(first,trendDates.findLastIndex(day=>day<=to));
  setTrendRange(first,last,{mark:latestWasSelected?last:trendDates.indexOf(marked)});
 }
}

function moveTrendWindow(direction) {
 const { first, last } = trendRange;
 const distance = last - first;
 const next = keepBetween(first + direction * Math.max(1, Math.round((distance + 1) / 2)), 0, trendDates.length - 1 - distance);
 setTrendRange(next, next + distance, { mark: markedDay + next - first });
}

function zoomTrendWindow(inward) {
 const { first, last } = trendRange;
 const count = last - first + 1;
 const size = inward ? Math.max(2, Math.floor(count * .65)) : Math.min(trendDates.length, Math.ceil(count / .65));
 const anchor = hoverDay ?? markedDay;
 const position = count > 1 ? (anchor - first) / (count - 1) : .5;
 const next = keepBetween(Math.round(anchor - (size - 1) * position), 0, trendDates.length - size);
 setTrendRange(next, next + size - 1, { mark: anchor });
}

function showTradeWeek(week) {
 const day = trendDates.indexOf(rows[week][0]);
 const { first, last } = trendRange;
 if (day < first || day > last) {
  const distance = last - first;
  const start = keepBetween(day - Math.floor(distance / 2), 0, trendDates.length - 1 - distance);
  setTrendRange(start, start + distance, { mark: day });
 } else selectTrendDay(day);
}

function makePlot(view) {
 const el = $(view.plot);
 const { first, last } = trendRange;
 const width = el.clientWidth, height = el.clientHeight;
 const left = parseFloat(getComputedStyle(el).getPropertyValue('--chart-axis-width'));
 const right = width - plotInset.right, base = height - plotInset.bottom;
 const times = trendDates.slice(first,last+1).map(Date.parse);
 const duration = times.at(-1) - times[0];
 const xTime = time => left + (right-left)*(duration?(time-times[0])/duration:.5);
 const x = i => xTime(times[i-first]);
 return { el, width, height, left, right, base, x, xTime, times, duration };
}

function normalizedPoint(day, column) {
 return 100 * trendQuotes[day][column] / trendQuotes[trendRange.first][column];
}

function ratioAt(day) {
 return trendQuotes[day][1]/trendQuotes[day][2];
}

function bandAt(day) {
 return trendBands.get(trendDates[day].slice(0,4));
}

function yAxis(values) {
 const low = Math.min(...values), high = Math.max(...values);
 const rough = (high - low || Math.max(Math.abs(high) * .04, .01)) / 4;
 const scale = 10 ** Math.floor(Math.log10(rough));
 const step = ([1, 2, 2.5, 5, 10].find(n => n * scale >= rough) || 10) * scale;
 const min = Math.floor(low / step + 1e-9) * step - step * .22;
 const max = Math.ceil(high / step - 1e-9) * step + step * .22;
 const ticks = [];
 for (let n = Math.ceil(min / step); n <= Math.floor(max / step); n++) ticks.push(n * step);
 const digits = Math.min(6, Math.max(0, 1 - Math.floor(Math.log10(step))));
 return { min, max, ticks, digits };
}

function renderTrendCharts() {
 const { first, last } = trendRange;
 const indices = Array.from({ length: last - first + 1 }, (_, j) => first + j);
 for (const view of chartViews) {
  const p = makePlot(view);
  const series = view.index ? [
   { values: indices.map(i => normalizedPoint(i, 1)), color: 'var(--up)' },
   { values: indices.map(i => normalizedPoint(i, 2)), color: 'var(--blue)', dashed: true }
  ] : [
   { values: indices.map(i => bandAt(i).low), color: 'var(--low-line)', step: true, dashed: true },
   { values: indices.map(i => bandAt(i).high), color: 'var(--high-line)', step: true, dashed: true },
   { values: indices.map(i => ratioAt(i)), color: 'var(--ratio-ink)' }
  ];
  const axis = yAxis(series.flatMap(line => line.values));
  const y = value => p.base - (p.base - view.top) * (value - axis.min) / (axis.max - axis.min);
  view.geometry = p;
  view.y = y;
  let svg = axis.ticks.map(value =>
   '<path d="M'+p.left+' '+y(value)+'H'+p.right+'" stroke="var(--grid)"/>'+
   '<text x="'+(p.left-7)+'" y="'+(y(value)+4)+'" text-anchor="end">'+Number(value.toFixed(axis.digits))+'</text>'
  ).join('');
  for (const line of series) {
   const d = line.values.map((value,j) => j && line.step ?
    'H'+p.x(first+j)+'V'+y(value) : (j ? 'L' : 'M')+p.x(first+j)+' '+y(value)).join(' ');
   svg += '<path d="'+d+'" stroke="'+line.color+'" fill="none" stroke-width="'+(line.step?1:1.7)+'"'+
    (line.dashed?' stroke-dasharray="5 3"':'')+'/>';
  }
  if (indices.length===1) {
   for (const line of series.filter(entry=>!entry.step)) {
    svg += '<circle cx="'+p.x(first)+'" cy="'+y(line.values[0])+'" r="3" fill="'+line.color+'"/>';
   }
  }
  if (!view.index) svg += tradeMarkers(p, y, first, last);
  svg += trendAxisLabels(p);
  p.el.setAttribute('viewBox', '0 0 '+p.width+' '+p.height);
  p.el.innerHTML = '<g font-family="Inter, Arial, sans-serif" font-size="12" fill="var(--muted)">'+svg+
   '</g><g class="week-marker" pointer-events="none"><line stroke="var(--subtle)" stroke-dasharray="3 3"/>'+
   (view.index?'<circle r="3.8"/><circle r="3.8"/>':'<rect class="ratio-diamond" x="-4" y="-4" width="8" height="8"/>')+'</g>';
 }
 renderLinkedReturns();
 updateTrendReadouts(hoverDay ?? markedDay);
}

function trendAxisLabels(p) {
 const {first,last} = trendRange, count = last-first+1;
 const tickCount = Math.min(count,Math.max(2,Math.floor((p.right-p.left)/88)+1));
 let labels = '';
 for (let n=0; n<tickCount; n++) {
  const day = tickCount===1?first:Math.round(first+(last-first)*n/(tickCount-1));
  const anchor = tickCount===1?'middle':n===0?'start':n===tickCount-1?'end':'middle';
  const label = p.duration>200*DAY?trendDates[day].slice(0,7):trendDates[day].slice(5);
  labels += `<path d="M${p.x(day)} ${p.base}v4" stroke="var(--subtle)"/><text x="${p.x(day)}" y="${p.height-5}" text-anchor="${anchor}">${label}</text>`;
 }
 return labels;
}

function setPlanPerformanceScope(data) {
 planDaily=data;
 const scope=$('performance-scope');
 scope.options[1].disabled=!data;
 if(!data&&scope.value==='plan')scope.value='full';
 if(trendRange){
  renderLinkedReturns();
  updateLinkedReadout(hoverDay ?? markedDay);
 }
}

function renderLinkedReturns() {
 const plot = makePlot({plot:'linked-return-plot'});
 const start = trendDates[trendRange.first], endDate = trendDates[trendRange.last];
 const usePlan = $('performance-scope').value==='plan' && planDaily;
 const portfolio = usePlan?planDaily:trendDaily;
 const {dates:allDates,nav:allNav} = portfolio;
 const first = allDates.findIndex(day=>day>=start), last = allDates.findLastIndex(day=>day<=endDate);
 const period = $('linked-return-period'), worst=$('linked-worst-draw'), scrub=$('linked-day');
 const context=$('linked-return-context');
 context.textContent=(usePlan?'执行单模拟 · 从 '+rows[planDaily.start][0]+' 以 ¥'+planMoney.format(planDaily.capital)+' 起步':'完整策略 · 从 1 万元起步')+
  '。收益以所选区间首个可估值日为基准，回撤从区间内高点计算。';
 dailyWindow = null;
 plot.el.setAttribute('viewBox', '0 0 '+plot.width+' '+plot.height);
 const labels = trendAxisLabels(plot);
 if (first===-1 || last<first) {
  plot.el.innerHTML = '<g font-size="12" fill="var(--muted)">'+labels+'</g>';
  period.textContent = '—';
  worst.textContent = '—';
  $('linked-draw-dates').textContent = '当前账户没有覆盖所选区间的日度估值。';
  $('linked-return-readout').textContent = '日度数据截至 '+allDates.at(-1);
  scrub.disabled=true;
  return;
 }
 const dates = allDates.slice(first,last+1);
 const times = dates.map(date=>Date.parse(date));
 const nav = allNav.slice(first,last+1);
 const gains = nav.map(value=>100*(value/nav[0]-1));
 const risk = calculateDrawdowns(nav,dates);
 const draw = risk.draws.map(value=>100*value);
 const x = i => plot.xTime(times[i]);
 const upperBottom = Math.floor(plot.base*.57), lowerTop=upperBottom+27;
 const parts = [
  {values:gains, top:15, bottom:upperBottom, color:'var(--account-ink)', limit:5},
  {values:draw, top:lowerTop, bottom:plot.base, color:'var(--amber)', limit:3}
 ];
 let svg='';
 const scales=parts.map(({values,top,bottom,color,limit})=>{
  const axis=yAxis([0,...values]);
  const y=value=>bottom-(bottom-top)*(value-axis.min)/(axis.max-axis.min);
  const levels=[...new Set([...axis.ticks,0])].sort((a,b)=>a-b);
  const sparse=levels.filter((v,i)=>v===0||i===0||i===levels.length-1||levels.length<=limit);
  const grid=sparse.map(value=>{
   const yy=y(value);
   return `<path d="M${plot.left} ${yy}H${plot.right}" stroke="${value===0?'var(--subtle)':'var(--grid)'}"/>
    <text x="${plot.left-7}" y="${yy+4}" text-anchor="end">${Number(value.toFixed(2))}%</text>`;
  }).join('');
  const data=values.map((value,i)=>(i?'L':'M')+x(i).toFixed(2)+' '+y(value).toFixed(2)).join(' ');
  svg+=grid+`<path d="${data}" fill="none" stroke="${color}" stroke-width="1.8"/>`;
  return y;
 });
 if(risk.depth<0){
  const mark=dates.indexOf(risk.trough);
  svg+=`<circle cx="${x(mark)}" cy="${scales[1](draw[mark])}" r="4" fill="var(--amber)" stroke="var(--surface)"><title>最大回撤 ${risk.trough} · ${pct(risk.depth)}</title></circle>`;
 }
 plot.el.innerHTML = `<g font-family="Inter, Arial, sans-serif" font-size="12" fill="var(--muted)">${svg}${labels}</g>
  <g class="linked-return-marker" pointer-events="none"><line y1="15" y2="${plot.base}" stroke="var(--subtle)" stroke-dasharray="3 3"/>
   <circle r="4" fill="var(--account-ink)" stroke="var(--surface)" stroke-width="1"/>
   <circle r="4" fill="var(--amber)" stroke="var(--surface)" stroke-width="1"/></g>`;
 dailyWindow = {plot,first,dates,times,nav,gains,draw,scales,x,allNav};
 period.textContent=signedRate(gains.at(-1)/100);
 worst.textContent=pct(risk.depth);
 const coverage = dates[0]===start&&dates.at(-1)===endDate?'':'实际估值 '+dates[0]+' 至 '+dates.at(-1)+'。';
 $('linked-draw-dates').textContent=coverage+drawdownDates(risk)+'。';
 scrub.min=0;
 scrub.max=dates.length-1;
 scrub.disabled=dates.length===1;
}

function signedRate(rate) {
 return (rate>0?'+':'')+pct(rate);
}

function updateLinkedReadout(index) {
 const day = trendDates[index];
 if (!dailyWindow) return;
 const {dates,nav,gains,draw,scales,x,first,plot,allNav} = dailyWindow;
 const i = dates.indexOf(day), marker = plot.el.querySelector('.linked-return-marker');
 marker.toggleAttribute('hidden',i<0);
 const readout = $('linked-return-readout');
 if (i<0) { readout.textContent = day+' 暂无日度估值。'; return; }
 marker.setAttribute('transform','translate('+x(i)+' 0)');
 const dots=marker.querySelectorAll('circle');
 dots[0].setAttribute('cy',scales[0](gains[i]));
 dots[1].setAttribute('cy',scales[1](draw[i]));
 $('linked-day').value=i;
 const prev = allNav[first+i-1];
 const dayChange = prev===undefined?'':'<span>当日 <b>'+signedRate(nav[i]/prev-1)+'</b></span>';
 readout.innerHTML = '<time datetime="'+day+'">'+day+'</time>'+dayChange+
  '<span>区间累计 <b>'+signedRate(gains[i]/100)+'</b></span><span>账户 <b>¥'+planMoney.format(nav[i])+'</b></span>'+
  '<span>回撤 <b>'+pct(draw[i]/100)+'</b></span>';
}

function bindLinkedReturns() {
 const plot = $('linked-return-plot');
 function chooseDay(day,commit) {
  const index = trendDates.indexOf(day);
  if (index<0) return;
  if (commit) selectTrendDay(index);
  else {
   hoverDay = index;
   updateTrendReadouts(index);
  }
 }
 function pointDay(e) {
  const {plot:p,times,dates} = dailyWindow;
  return dates[closestTimeIndex(times,timeAtPointer(p,e))];
 }
 plot.onpointermove = e=>{if(dailyWindow&&e.pointerType!=='touch')chooseDay(pointDay(e),false);};
 plot.onpointerup = e=>{if(dailyWindow)chooseDay(pointDay(e),true);};
 plot.onpointerleave = ()=>{
  hoverDay = null;
  updateTrendReadouts(markedDay);
 };
 $('linked-day').oninput = e=>{if(dailyWindow)chooseDay(dailyWindow.dates[Number(e.target.value)],true);};
 $('performance-scope').onchange = ()=>{
  renderLinkedReturns();
  updateLinkedReadout(hoverDay ?? markedDay);
 };
 document.addEventListener('click', e=>{
  const link=e.target.closest('a[data-performance]');
  if(!link)return;
  const plan=link.dataset.performance==='plan'&&planDaily;
  $('performance-scope').value=plan?'plan':'full';
  if(plan)setTrendRange(trendDates.indexOf(rows[planDaily.start][0]),trendDates.length-1);
  else if(link.dataset.performance==='all')chooseRecent(0);
  else {
   renderLinkedReturns();
   updateLinkedReadout(hoverDay ?? markedDay);
  }
 });
}

function tradeMarkers(plot, y, first, last) {
 let svg = '';
 for (const trade of model.trades) {
  const date = rows[trade.i][0];
  if (date < trendDates[first] || date > trendDates[last]) continue;
  const day = trendDates.indexOf(date), cx = plot.x(day), cy = y(ratioAt(day));
  if (trade.kind === 'buy') {
   svg += '<circle data-day="'+day+'" cx="'+cx+'" cy="'+cy+'" r="3.7" fill="'+
    (trade.asset?'var(--blue)':'var(--up)')+'" stroke="var(--surface)" stroke-width="1"/>';
   continue;
  }
  const full = trade.part === 1, tip = full ? 30 : 15;
  svg += '<g data-day="'+day+'"><title>'+date+' '+ASSETS[trade.asset]+' '+saleName(trade)+
   '</title><path d="M'+cx+' '+(cy-4)+'V'+tip+'" stroke="var(--amber)" stroke-opacity=".47" stroke-dasharray="2 3"/><path d="M'+(cx-4.8)+' '+(tip-8)+
   'h9.6l-4.8 8Z" stroke="var(--amber)" stroke-width="1.5" fill="'+(full?'var(--amber)':'var(--surface)')+'"/></g>';
 }
 return svg;
}

function tradesAt(day) {
 const week = tradeWeeks.get(trendDates[day]);
 return week===undefined?[]:model.trades.filter(trade=>trade.i===week);
}

function formatIndexPoint(day, column) {
 const value = trendQuotes[day][column], change = normalizedPoint(day, column) / 100 - 1;
 return pointFormat.format(value)+' 点（'+(change>0?'+':'')+pct(change)+'）';
}

function updateTrendReadouts(index) {
 const ratio = ratioAt(index), band = bandAt(index), trades = tradesAt(index);
 const day = trendDates[index], zone = dailyZone(ratio,band);
 const position = zone===null?'两线之间':ASSETS[zone]+'观察区';
 $('readout').innerHTML = '<time datetime="'+day+'">'+day+'</time>'+
  '<span>收盘比值 <b>'+f(ratio)+'</b></span><span>下线 <b>'+f(band.low)+'</b></span><span>上线 <b>'+f(band.high)+
  '</b></span><span>'+position+'</span>';
 const tradeReadout = $('trade-readout');
 tradeReadout.hidden = !trades.length;
 tradeReadout.innerHTML = trades.map(trade => '<li class="'+trade.kind+'"><strong>'+
  (trade.kind==='buy'?'买入':saleName(trade))+'</strong><span>'+ASSETS[trade.asset]+'</span></li>').join('');
 $('index-readout').innerHTML = '<time datetime="'+day+'">'+day+'</time>'+
  '<span><b class="red">红利</b> '+formatIndexPoint(index, 1)+'</span>'+
  '<span><b class="blue">创业板</b> '+formatIndexPoint(index, 2)+'</span>';
 for (const view of chartViews) {
  const p = view.geometry, marker = p.el.querySelector('.week-marker'), x = p.x(index);
  marker.setAttribute('transform', 'translate('+x+' 0)');
  const line = marker.querySelector('line');
  line.setAttribute('y1', view.top);
  line.setAttribute('y2', p.base);
  const diamond = marker.querySelector('.ratio-diamond');
  if (diamond) {
   diamond.setAttribute('transform', 'translate(0 '+view.y(ratio)+') rotate(45)');
   continue;
  }
  const values = [normalizedPoint(index, 1), normalizedPoint(index, 2)];
  const colors = ['var(--up)','var(--blue)'];
  marker.querySelectorAll('circle').forEach((dot, i) => {
   dot.setAttribute('cy', view.y(values[i]));
   dot.setAttribute('fill', colors[i]);
  });
 }
 updateLinkedReadout(index);
}

function selectTrendDay(index) {
 markedDay = index;
 hoverDay = null;
 $('cursor').value = index;
 updateTrendReadouts(index);
}

function dayAtPointer(view, e) {
 const mark = e.target.closest?.('[data-day]');
 if (mark) return Number(mark.dataset.day);
 const p = view.geometry;
 return trendRange.first + closestTimeIndex(p.times,timeAtPointer(p,e));
}

function timeAtPointer(plot,e) {
 const x = e.clientX-plot.el.getBoundingClientRect().left;
 const fraction = keepBetween((x-plot.left)/(plot.right-plot.left),0,1);
 return plot.times[0]+fraction*plot.duration;
}

function closestTimeIndex(times,time) {
 let i=times.findIndex(value=>value>=time);
 if(i<0) i=times.length-1;
 if(i && time-times[i-1]<times[i]-time) i--;
 return i;
}

function showTrendTip(view, e, index) {
 const tip = $(view.tip), band = bandAt(index), day = trendDates[index];
 const lines = view.index ? [day, '红利 '+formatIndexPoint(index, 1), '创业板 '+formatIndexPoint(index, 2)] :
  [day+' · 收盘比值 '+f(ratioAt(index)), '观察线 '+f(band.low)+' / '+f(band.high),
   ...tradesAt(index).map(trade => (trade.kind==='buy'?'模拟买入':'模拟'+saleName(trade))+' '+ASSETS[trade.asset])];
 tip.textContent = lines.join('\n');
 tip.hidden = false;
 const r = $(view.plot).getBoundingClientRect();
 tip.style.left = keepBetween(e.clientX-r.left+12, 0, Math.max(0,r.width-tip.offsetWidth))+'px';
 tip.style.top = keepBetween(e.clientY-r.top+12, 0, Math.max(0,r.height-tip.offsetHeight))+'px';
}

function shadeSelection(first, last) {
 for (const view of chartViews) {
  const box = $(view.selection), p = view.geometry;
  box.hidden = first === null;
  if (box.hidden) continue;
  const from = p.x(first), to = p.x(last);
  box.style.left = Math.min(from,to)+'px';
  box.style.width = Math.abs(to-from)+'px';
  box.style.top = view.top+'px';
  box.style.height = p.base-view.top+'px';
 }
}

/* ---------- 触摸手势：双指缩放、单指左右平移 ---------- */
const TOUCH_MIN_DAYS = 2;
let touchGesture = null, rangeFrame = 0, rangePending = null;

function queueTrendRange(first, last) {
 rangePending = [first, last];
 if (rangeFrame) return;
 rangeFrame = requestAnimationFrame(() => {
  rangeFrame = 0;
  if (!rangePending) return;
  const [a, b] = rangePending;
  rangePending = null;
  setTrendRange(a, b, { mark: keepBetween(markedDay, a, b) });
 });
}

function touchStart(view, plot, e) {
 if (!touchGesture || touchGesture.view !== view) {
  touchGesture = { view, pts: new Map(), mode: 'pan', moved: false, vertical: false,
   startX: e.clientX, startY: e.clientY, first: trendRange.first, last: trendRange.last };
 }
 const g = touchGesture;
 g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
 try { plot.setPointerCapture(e.pointerId); } catch {}
 if (g.pts.size === 1) {
  g.mode = 'pan';
  g.first = trendRange.first;
  g.last = trendRange.last;
  g.startX = e.clientX;
  g.startY = e.clientY;
  g.moved = false;
  g.vertical = false;
 } else if (g.pts.size === 2) {
  const [a, b] = [...g.pts.values()];
  const p = view.geometry;
  g.mode = 'pinch';
  g.first = trendRange.first;
  g.last = trendRange.last;
  g.count = g.last - g.first + 1;
  g.distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const mid = (a.x + b.x) / 2 - plot.getBoundingClientRect().left;
  g.fraction = keepBetween((mid - p.left) / Math.max(1, p.right - p.left), 0, 1);
 }
}

function touchMove(view, plot, e) {
 const g = touchGesture;
 if (!g || g.view !== view || !g.pts.has(e.pointerId)) return false;
 g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
 const total = trendDates.length;

 if (g.mode === 'pinch' && g.pts.size >= 2) {
  if (e.cancelable) e.preventDefault();
  const [a, b] = [...g.pts.values()];
  const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const count = keepBetween(Math.round(g.count * g.distance / distance), TOUCH_MIN_DAYS, total);
  const anchor = g.first + g.fraction * (g.count - 1);
  const first = keepBetween(Math.round(anchor - g.fraction * (count - 1)), 0, total - count);
  g.moved = true;
  queueTrendRange(first, first + count - 1);
  return true;
 }

 if (g.mode === 'pan') {
  const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
  if (!g.moved) {
   // 纵向为主时交还给浏览器滚动页面，不拦截
   if (g.vertical || (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 1.4)) { g.vertical = true; return true; }
   if (Math.abs(dx) < 6) return true;
   g.moved = true;
  }
  if (e.cancelable) e.preventDefault();
  const p = view.geometry;
  const count = g.last - g.first + 1;
  const pxPerDay = (p.right - p.left) / Math.max(1, count - 1);
  const first = keepBetween(g.first + Math.round(-dx / pxPerDay), 0, total - count);
  queueTrendRange(first, first + count - 1);
  return true;
 }
 return true;
}

function touchEnd(view, e, cancelled) {
 const g = touchGesture;

 if (!g || g.view !== view) return false;
 g.pts.delete(e.pointerId);
 try { $(view.plot).releasePointerCapture(e.pointerId); } catch {}
 if (g.pts.size === 1) {
  const rest = [...g.pts.values()][0];
  g.mode = 'pan';
  g.first = trendRange.first;
  g.last = trendRange.last;
  g.startX = rest.x;
  g.startY = rest.y;
  g.moved = true;
  g.vertical = false;
  return true;
 }
 if (g.pts.size === 0) {
  const tap = !cancelled && !g.moved && !g.vertical;
  touchGesture = null;
  if (tap) selectTrendDay(dayAtPointer(view, e));
 }
 return true;
}

function bindTrendPlot(view) {
 const plot = $(view.plot), tip = $(view.tip);
 plot.onpointerdown = e => {
  if (e.pointerType === 'touch') { touchStart(view, plot, e); return; }
  if (e.button !== 0) return;
  const day = dayAtPointer(view, e);
  dragSelection = { day, x: e.clientX, pointer: e.pointerId };
  plot.setPointerCapture(e.pointerId);
 };
 plot.onpointermove = e => {
  if (e.pointerType === 'touch') { touchMove(view, plot, e); return; }
  const day = dayAtPointer(view, e);
  hoverDay = day;
  updateTrendReadouts(day);
  if (dragSelection?.pointer === e.pointerId) {
   tip.hidden = true;
   if (Math.abs(e.clientX-dragSelection.x)>7) shadeSelection(dragSelection.day, day);
  } else showTrendTip(view, e, day);
 };
 plot.onpointerup = e => {
  if (e.pointerType === 'touch') { touchEnd(view, e, false); return; }
  if (dragSelection?.pointer !== e.pointerId) return;
  const a = dragSelection.day, b = dayAtPointer(view, e);
  const zoom = Math.abs(e.clientX - dragSelection.x) > 7 && a !== b;
  dragSelection = null;
  shadeSelection(null);
  if (zoom) setTrendRange(Math.min(a,b), Math.max(a,b));
  else selectTrendDay(a);
 };
 plot.onpointercancel = e => {
  if (e.pointerType === 'touch') { touchEnd(view, e, true); return; }
  dragSelection = null;
  shadeSelection(null);
 };
 plot.onlostpointercapture = () => { dragSelection = null; shadeSelection(null); };
 plot.onpointerleave = () => {
  if (touchGesture?.view === view) return;
  tip.hidden = true;
  hoverDay = null;
  updateTrendReadouts(markedDay);
 };
}

function setupTrendCharts() {
 $('ranges').onclick = e => { if (e.target.matches('button[data-n]')) chooseRecent(Number(e.target.dataset.n)); };
 $('chart-year').onchange = () => { if ($('chart-year').value) chooseYear($('chart-year').value); };
 $('chart-dates').onsubmit = e => {
  e.preventDefault();
  const from = $('chart-from').value, to = $('chart-to').value;
  const first = trendDates.findIndex(day => day >= from);
  const last = trendDates.findLastIndex(day => day <= to);
  if (first === -1 || last < first) {
   $('chart-range-status').textContent = '这段日期内没有日收盘数据，请调整起止日期。';
   return;
  }
  setTrendRange(first, last);
  if (matchMedia('(max-width: 700px)').matches) $('chart-date-panel').open = false;
 };
 $('zoom-in').onclick = () => zoomTrendWindow(true);
 $('zoom-out').onclick = () => zoomTrendWindow(false);
 $('pan-back').onclick = () => moveTrendWindow(-1);
 $('pan-forward').onclick = () => moveTrendWindow(1);
 $('cursor').oninput = () => selectTrendDay(Number($('cursor').value));
 const observer = new ResizeObserver(() => { if (trendRange) renderTrendCharts(); });
 bindLinkedReturns();
 observer.observe($('linked-return-plot'));
 for (const view of chartViews) {
  bindTrendPlot(view);
  observer.observe($(view.plot));
 }
 // iOS：阻止图表上的页面级双指缩放，保留我们自己的手势
 document.addEventListener('gesturestart', e => {
  if (e.target.closest?.('#plot, #index-plot')) e.preventDefault();
 }, { passive: false });
}
