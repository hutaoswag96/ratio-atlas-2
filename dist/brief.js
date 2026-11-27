'use strict';
const $=id=>document.getElementById(id), f=n=>n.toFixed(3), fmt=n=>Math.round(n).toLocaleString('zh-CN'), pct=n=>(100*n).toFixed(2)+'%';
function get(key,alt){try{return JSON.parse(localStorage.getItem('rotation2:'+key))??alt}catch{return alt}}
function save(key,v){try{localStorage.setItem('rotation2:'+key,JSON.stringify(v));return true}catch{return false}}
const shanghai=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const isoDay=n=>new Date(n).toISOString().slice(0,10);
const shiftDay=(day,n)=>isoDay(Date.parse(day+'T00:00:00Z')+n*DAY);
const weekDeadline=day=>Date.parse(shiftDay(day,7)+'T15:00:00+08:00');
const SWAP_STATES=['none','half','cleared','pending'];
function signalPending(){return rows?Date.now()>=weekDeadline(rows[end][0]):false;}
function renderDataStatus(){
 if(!rows)return;
 const asof=rows[end][0],from=shiftDay(asof,3),to=shiftDay(asof,7),pending=signalPending();
 const box=$('data-status');if(!box)return;
 box.dataset.tone=pending?'pending':'ready';
 $('status-pill').textContent=pending?'待补录':'可使用';
 $('status-text').textContent=pending?
  '周线停在 '+asof+' · '+from+' 至 '+to+' 已收盘，本周数据尚未补录，判断仍沿用 '+asof
  :'周线 '+asof+' 已收盘 · 本周期指令适用于 '+from+' 至 '+to;
}
function evidenceItems({watch,touch,r,avg,low,high,side,count,lastBuyDay}){
 const items=[];
 if(watch===null){
  items.push({label:'入区',ok:false,detail:'比值 '+f(r)+' 在 '+f(low)+' 与 '+f(high)+' 两线之间'});
 }else{
  const tb=bars[touch];
  items.push({label:'入区',ok:true,detail:rows[touch][0]+' 周收盘 · 比值 '+f(tb.r)+' '+(watch===0?'≤ 红利线 ':'≥ 创业板线 ')+f(watch===0?tb.low:tb.high)+' · 观察'+ASSETS[watch]});
 }
 const weeks=watch===null?null:end-touch+1;
 const watchValid=watch!==null&&weeks<=13;
 const confirmed=watchValid&&(watch===0?r>avg:r<avg);
 if(watch===null)items.push({label:'转强确认',ok:false,detail:'未入区，13 周均值条件不启用'});
 else if(weeks>13)items.push({label:'转强确认',ok:false,detail:'观察期已满 13 周，需要重新入区'});
 else items.push({label:'转强确认',ok:confirmed,detail:'比值 '+f(r)+' 需'+(watch===0?'高于':'低于')+' 13 周均值 '+f(avg)+' · 观察期第 '+weeks+'/13 周'});
 if(side===null||!count)items.push({label:'买入间隔',ok:false,detail:'首笔无需等待 28 天；仍须先入区并完成转强确认'});
 else if(count>=5)items.push({label:'买入间隔',ok:true,detail:'本轮五笔已买完，接下来只等对侧换仓'});
 else{
  const days=lastBuyDay?Math.floor(elapsed(rows[end][0],lastBuyDay)):null;
  items.push({label:'买入间隔',ok:days!==null&&days>=28,detail:days===null?'请填写上次买入日':'上次买入 '+lastBuyDay+' · 已过 '+days+'/28 天'});
 }
 if(side===null){
  const detail=watch===null?'空仓；当前比值未进入观察区，没有建仓方向':!watchValid?'空仓；观察期已超过 13 周，需重新入区':confirmed?'空仓；'+ASSETS[watch]+'首笔条件已满足，按执行单安排建仓':'空仓；正在观察'+ASSETS[watch]+'，等待 13 周均线转强确认';
  items.push({label:'建仓',ok:watchValid&&confirmed,detail});
 }
 else{
  const other=1-side;
  items.push({label:'换边',ok:watch===other&&confirmed,detail:'当前持有 '+ASSETS[side]+' · 需对侧入区，并在 13 周内完成转强确认'+(watch===other?'（当前观察'+ASSETS[other]+'）':'')});
 }
 return items;
}
function renderEvidence(title,items){
 const box=$('plan-evidence');if(!box)return;
 if(!items?.length){box.replaceChildren();return;}
 box.innerHTML='<div class="evidence-head"><h4>'+title+'</h4><span>逐项核对下单条件；未满足时不会触发操作</span></div><ol class="evidence">'+
  items.map(item=>'<li class="'+(item.ok?'ok':'no')+'"><b>'+item.label+'</b><span>'+item.detail+'</span></li>').join('')+'</ol>';
}
const cachedDailyPrices=get('daily-price-series',[]);
if(Array.isArray(cachedDailyPrices))liveDailyPrices=mergeDailyCloses([],cachedDailyPrices);
let extra=get('rows',[]),rows,bars,model,end;
function validRow(r){return Array.isArray(r)&&r.length===3&&/^\d{4}-\d\d-\d\d$/.test(r[0])&&r.slice(1).every(n=>Number.isFinite(n)&&n>0);}
if(!Array.isArray(extra))extra=[];
extra=extra.filter(validRow).filter(r=>r[0]>weeklyData.at(-1)[0]);
function refresh(){
 rows=[...weeklyData,...extra];bars=market(rows);end=rows.length-1;model=simulate(rows,bars,START);
 const m=bars[end];$('asof').textContent=rows[end][0];$('weekly-ratio').textContent=rows[end][0]+' · 比值 '+f(m.r);$('lo').textContent='红利线 '+f(m.low);$('hi').textContent='创业板线 '+f(m.high);
 const span=m.high-m.low;$('pointer').style.left=Math.max(0,Math.min(99,20+60*(m.r-m.low)/span))+'%';
 $('average').textContent='13 周均值 '+f(m.avg)+'　·　'+(m.zone===null?'两线之间':ASSETS[m.zone]+'观察区');
 const selected=$('start').value||get('start',rows[end][0]);
 refreshStartPicker(selected);
 save('start',$('start').value);
 $('undo').disabled=!extra.length;renderDataStatus();refreshTrendCharts();plan();history();showDailyClose();
}
function refreshStartPicker(preferred) {
 const dates=rows.slice(START).map(row=>row[0]);
 const selected=dates.includes(preferred)?preferred:dates.at(-1);
 const years=[...new Set(dates.map(date=>date.slice(0,4)))].reverse();
 $('start-year').replaceChildren(...years.map(year=>new Option(year+' 年',year)));
 selectStartWeek(selected);
}
function selectStartWeek(date) {
 const year=date.slice(0,4), month=date.slice(0,7);
 const dates=rows.slice(START).map(row=>row[0]).filter(day=>day.startsWith(year));
 const months=[...new Set(dates.map(day=>day.slice(0,7)))].reverse();
 $('start-year').value=year;
 $('start-month').replaceChildren(...months.map(key=>new Option(Number(key.slice(5))+' 月',key)));
 $('start-month').value=month;
 $('start').replaceChildren(...dates.filter(day=>day.startsWith(month)).reverse().map(day=>new Option(day,day)));
 $('start').value=date;
}
function saleName(t){return t.part===1?'卖清':'卖一半';}
function plan(){
 const start=rows.findIndex(r=>r[0]===$('start').value),capital=Number($('capital').value),body=$('planBody');
 const actual=$('basis').value==='actual', held=$('holding').value;
 const setup=[actual?'实际持仓核对':'按起点模拟', actual?(held===''?'现金':ASSETS[Number(held)]):rows[start][0]];
 if(capital>=1&&capital<=1e11)setup.push('¥'+planMoney.format(capital));
 $('plan-setup-summary').textContent=setup.join(' · ');
 if(!(capital>=1&&capital<=1e11)){clearPlanPerformance();body.textContent='请输入 1 至 1000 亿元之间的初始资金。';$('plan-evidence').replaceChildren();$('headline').dataset.tone='warning';$('headline').textContent='请核对初始资金';$('reason').textContent='有效金额用于计算每一笔。';return;}
 if(actual){clearPlanPerformance();actualPlan(start,capital);renderProjection();return;}
 const p=simulate(rows,bars,start,capital),q=p.orders,action=q[0],stale=signalPending();
 const known=p.watch!==null&&end-p.touch<13,asset=p.side===null?'现金':ASSETS[p.side],round=p.rounds.at(-1);
 const title=action?.kind==='sell'?(q.length===2?'下一步：卖清旧仓':'下一步：卖出一半'):action?'买入'+ASSETS[action.asset]+'第 '+(p.count+1)+' 笔':p.side!==null?'继续持有'+asset:known?'等待转强确认':'空仓等待';
 let why=action?.kind==='sell'?(q.length===2?'第一笔卖出已完成。下方按成交顺序列出剩余步骤。':'另一边已经确认转强。下周收盘卖出旧仓的一半。'):action?'下一共同交易周收盘，计划投入 '+fmt(p.budget/5)+' 元。':p.side===null?(known?'已经进入观察窗口，等待比值满足 13 周均线条件。':'从所选起点观察，尚无有效建仓信号，保留现金。'):p.count===5?'本轮五笔已到位，等待另一侧入区并确认转强。':'等上一笔成交满 28 天，在首个周收盘检查加仓条件。';
 $('signalLabel').textContent=(stale?'周线待补录':'最新周线判断')+'　/　'+(start===end?'本周空仓起步':'按 '+rows[start][0]+' 起步');
 const tone=title.includes('卖')||title.includes('赎回')?'warning':title.includes('买入')||title.includes('申购')||title.includes('准备第')?'buy':'neutral';
 $('headline').dataset.tone=stale?'warning':tone;
 $('headline').textContent=title;
 $('reason').innerHTML=(stale?'<b class="stale-warn">本周周线未补录，先补录再下单</b>　':'')+why;
 const stage=action?.kind==='sell'?(action.part===1?2:1):0;
 const steps=Array.from({length:5},(_,j)=>{
  const lot=round?.lots[j], day=lot?rows[lot.i][0]:'';
  const date=day?'<time datetime="'+day+'" aria-label="'+day+'"><span class="step-date-full">'+day+'</span><span class="step-date-short">'+day.slice(5)+'</span></time>':stage?'':'20%';
  return '<div class="step '+(lot?'done':'')+'"><small>第 '+(j+1)+' 笔</small><b>'+
   (lot?'已买入':stage?'已停止':'待买')+'</b><small>'+date+'</small></div>';
 }).join('');
 body.innerHTML='<h3>'+(stale?'截至 '+rows[end][0]+' · ':'')+title+'</h3><p>'+why+'</p>'+
  '<div class="steps" '+(round?'':'hidden')+'>'+steps+'</div>'+
  (round?'<p class="meta">模拟持仓 '+asset+' · 本轮每笔预算约 '+fmt(p.budget/5)+' 元</p>':'');
 const nextBuy=action?.kind==='buy'?{asset:action.asset,budget:p.budget/5}:null;
 renderExecution(body,p.side,stage,nextBuy);
 const m=bars[end];
 renderEvidence('判断依据 · 按起点模拟',evidenceItems({watch:p.watch,touch:p.touch,r:m.r,avg:m.avg,low:m.low,high:m.high,side:p.side,count:p.count,lastBuyDay:p.lastBuy===null?null:rows[p.lastBuy][0]}));
 renderPlanPerformance(p,start,capital);
 renderProjection();
 save('capital',capital);save('start',$('start').value);
}
function renderProjection(){
 const panel=$('projection');
 const priceData=dailyChartQuotes();
 if(priceData.length<61||!bars[end]){panel.innerHTML='';return;}
 const latest=priceData.at(-1),ratio=latest[1]/latest[2],bar=bars[end];
 const holding=$('basis').value==='actual'?
  ($('holding').value===''?null:Number($('holding').value)):model.side;
 const nextAsset=holding===null?null:1-holding;
 const side=nextAsset??(Math.abs(ratio-bar.low)<=Math.abs(bar.high-ratio)?0:1);
 const boundary=side===0?bar.low:bar.high;
 const dailyMoves=priceData.slice(-61).map((row,i,window)=>i===0?null:
  Math.abs(Math.log(row[1]/row[2])-Math.log(window[i-1][1]/window[i-1][2]))).filter(Number.isFinite);
 const dailyMove=dailyMoves.reduce((sum,value)=>sum+value,0)/dailyMoves.length;
 const touch=Math.abs(Math.log(boundary/ratio));
 const confirmation=Math.abs(Math.log(bar.avg/boundary));
 const lowerDistance=ratio<=bar.low?0:1-bar.low/ratio;
 const upperDistance=ratio>=bar.high?0:bar.high/ratio-1;
 const sessions=Math.max(0,Math.ceil((touch+confirmation)/dailyMove));
 const lowDays=Math.max(1,Math.floor(sessions*.65)),highDays=Math.max(lowDays,Math.ceil(sessions*1.6));
 const daysText=sessions===0?'观察线已触及':`约 ${lowDays}–${highDays} 个交易日`;
 const weeksText=sessions===0?'等待周收盘确认':`约 ${Math.max(1,Math.ceil(lowDays/5))}–${Math.max(1,Math.ceil(highDays/5))} 周`;
 const moveText=value=>value===0?'已触及':pct(value);
 const confirmationText=side===0?'触线后，比值还需周线收复 13 周均线确认红利':'触线后，比值还需周线回落至 13 周均线下确认创业板';
 const nextText=nextAsset===null?'距离较近的首次建仓候选':`下一次换仓候选：${ASSETS[nextAsset]}`;
 panel.innerHTML='<div class="projection-head"><h3>情景推演</h3><span>参考估算 · 不构成交易信号</span></div>'+
  '<p>按 '+latest[0]+' 日收盘比值 '+f(ratio)+' 推演，'+nextText+'。</p>'+
  '<div class="projection-values"><div><span>到红利观察线 '+f(bar.low)+'</span><strong>'+(lowerDistance===0?'已触及':`比值下降 ${moveText(lowerDistance)}`)+'</strong></div>'+
  '<div><span>到创业板观察线 '+f(bar.high)+'</span><strong>'+(upperDistance===0?'已触及':`比值上升 ${moveText(upperDistance)}`)+'</strong></div>'+
  '<div><span>候选换仓的粗略时间</span><strong>'+daysText+' · '+weeksText+'</strong></div></div>'+
  '<p class="projection-note">'+confirmationText+'。</p>'+
  '<details class="projection-how"><summary>估算口径</summary><p>粗略时间按近 60 个交易日比值平均绝对波动折算，假设波动延续；观察线按当前年度固定，实际路径可能更快、更慢，也可能始终不到。日线只供观察，实际买卖仍以周线确认和场外基金受理为准。</p></details>';
}
function actualPlan(start,capital){
 const raw=$('holding').value,asset=raw===''?null:Number(raw),filled=asset===null?0:Number($('filled').value);
 const last=$('lastFill').value,m=bars[end],day=rows[end][0];
 const state=asset===null?'none':(SWAP_STATES.includes($('sold').value)?$('sold').value:'none');
 const target=asset===null?null:1-asset;
 $('position-fields').hidden = asset===null;
 for(const id of ['filled','lastFill','sold'])$(id).disabled=asset===null;
 let touch=end;
 while(touch>=Math.max(start,end-12)&&bars[touch].zone===null)touch--;
 const watch=touch>=Math.max(start,end-12)?bars[touch].zone:null;
 const confirmed=watch!==null&&(watch===0?m.r>m.avg:m.r<m.avg);
 const retreated=state!=='none'&&!confirmed;
 let title,note,nextBuy=null;
 if(asset===null){
  title=confirmed?'准备申购'+ASSETS[watch]:'空仓等待';
  note=confirmed?'下一交易周按平台受理时间申购第一份，预算约 '+fmt(capital/5)+' 元。':'从所选起点观察，本周未同时满足入区和转强条件。';
  if(confirmed)nextBuy={asset:watch,budget:capital/5};
 }else if(state==='half'){
  title='下一步：赎回剩余'+ASSETS[asset]+'份额';
  note='已赎回一半，第一笔卖单完成。下一步提交剩余份额的赎回，款项到账前这笔钱仍在途。';
 }else if(state==='cleared'){
  title='下一步：申购'+ASSETS[target]+'第一笔';
  note='旧仓已全部赎回，不论款项是否到账，本轮都需要完成申购，预算约 '+fmt(capital/5)+' 元。'+
   (retreated?'比值已退回两线之间，但旧仓已经卖出，这笔申购仍按计划完成，避免长期空仓。':'')+
   '成交后把持仓改为'+ASSETS[target]+'、笔数改为 1，换仓进度重置。';
  nextBuy={asset:target,budget:capital/5};
 }else if(state==='pending'){
  title='等待份额确认';
  note='申购已提交，还没确认份额。确认后把持仓切换为'+ASSETS[target]+'、已买笔数改为 1、换仓进度改回「旧仓未动」。';
 }else if(confirmed&&watch!==asset){
  title='赎回'+ASSETS[asset]+'的一半';
  note='对侧已入区并确认转强。先处理旧仓，按下方顺序执行。';
 }else if(filled===5){title='继续持有'+ASSETS[asset];note='本轮五笔已买完，等待对侧确认。';}
 else if(!last||last>day){title='补全最近买入日';note='请填写不晚于数据截止日的实际成交日期，用来判断是否已满 28 天。';}
 else if(elapsed(day,last)>=28){title='准备第 '+(filled+1)+' 笔';note='距离上次买入已满 28 天。若此前没有待成交指令，可在下一交易周按平台受理时间申购'+ASSETS[asset]+'约 '+fmt(capital/5)+' 元。';nextBuy={asset,budget:capital/5};}
 else{title='等待加仓间隔';note='距离上次成交 '+elapsed(day,last)+' 天，满 28 天后的首个周收盘再次检查。';}
 const stage=state==='half'||state==='cleared'||state==='pending'?2:state==='none'&&asset!==null&&confirmed&&watch!==asset?1:0;
 const stale=signalPending();
 $('signalLabel').textContent='实际持仓核对 · '+(asset===null?'现金':ASSETS[asset]);
 const tone=title.includes('卖')||title.includes('赎回')?'warning':title.includes('买入')||title.includes('申购')||title.includes('准备第')?'buy':'neutral';
 $('headline').dataset.tone=stale?'warning':tone;
 $('headline').textContent=title;
 $('reason').innerHTML=(stale?'<b class="stale-warn">本周周线未补录，先补录再下单</b>　':'')+note;
 $('planBody').innerHTML='<h3>'+(stale?'截至 '+day+' · ':'')+title+'</h3><p>'+note+'</p>'+
  (state!=='none'&&asset!==null?swapTracker(state):'')+
  '<div class="steps" '+(asset===null?'hidden':'')+'>'+Array.from({length:5},(_,j)=>'<div class="step '+(j<filled?'done':'')+'"><small>第 '+(j+1)+' 笔</small><b>'+(j<filled?'已买入':stage?'已停止':'待买')+'</b><small>'+(j<filled||!stage?'20%':'')+'</small></div>').join('')+'</div>';
 renderExecution($('planBody'),asset,stage,nextBuy,true,state);
 renderEvidence('判断依据 · 实际持仓',evidenceItems({watch,touch,r:m.r,avg:m.avg,low:m.low,high:m.high,side:asset,count:filled,lastBuyDay:last||null}));
 save('actual',{raw,filled,last,state,capital,day});save('start',$('start').value);
}
function swapTracker(state){
 const steps=['赎回一半','卖清剩余','申购第一笔'],done=SWAP_STATES.indexOf(state);
 return '<ol class="swap-track">'+steps.map((name,i)=>'<li class="'+(i<done?'done':i===done?'now':'')+'"><span>'+(i<done?'✓':i+1)+'</span><b>'+name+'</b></li>').join('')+'</ol>';
}
function mode(){
 const actual=$('basis').value==='actual';
 $('actualFields').hidden=!actual;$('fundLabel').textContent=actual?'本轮起始资金（元）':'初始资金（元）';
 $('planHelp').textContent=actual?'按最新周收盘核对操作。赎回进度会一直保留，补录新一周也不会清空。设置仅存于本浏览器。':'从所选周空仓起步模拟。设置仅存于本浏览器。';
 $('capital').value=actual?(get('actual',{}).capital||10000):get('capital',10000);
 save('basis',$('basis').value);plan();
}
function changeClass(value){return value>0?'up':value<0?'down':'';}
function history(){
 const years=elapsed(rows[end][0],rows[START][0])/365.25,ann=(model.nav.at(-1)/10000)**(1/years)-1;
 const dailyRisk=calculateDrawdowns(trendDaily.nav,trendDaily.dates);
 $('stats').innerHTML='<div class="stats"><div><span>历史年化</span><strong class="'+changeClass(ann)+'">'+pct(ann)+'</strong></div><div><span>最大日度回撤</span><strong class="lot-risk">'+pct(dailyRisk.depth)+'</strong></div><div><span>期末市值 / 元</span><strong>'+fmt(model.nav.at(-1))+'</strong></div></div><p class="meta">日度回撤截至 '+trendDaily.dates.at(-1)+' · '+drawdownDates(dailyRisk)+'。</p>';

  const orders=model.rounds.map((r,j)=>({r,j})).reverse();
  const saleDate=(i,date)=>i===undefined?'—':'<button type="button" class="sale-date" data-week="'+i+'">'+date+'</button>';
  $('orders').innerHTML=orders.length?orders.map(({r,j})=>{
   const sold=r.end!==undefined;
   const first=rows[r.start][0],lastBuy=rows[r.lots.at(-1).i][0];
   const half=r.sales[0]!==undefined?rows[r.sales[0]][0]:null;
   const clear=sold?rows[r.end][0]:null;
   const lots=r.lots.map((l,slot)=>{
    const {risk,useDaily,float}=lotHistory(r,l);
    return '<tr><td>'+rows[l.i][0]+'</td><td>'+fmt(l.cost)+'</td><td class="'+changeClass(l.ret)+'">'+pct(l.ret)+'</td>'+
     '<td class="lot-float-cell">'+pct(float.depth)+'</td>'+
     '<td><button type="button" class="risk-button" data-risk-round="'+j+'" data-risk-lot="'+slot+
     '" aria-expanded="false" aria-controls="history-lot-'+j+'">'+pct(risk.depth)+(useDaily?'':'（周线）')+'</button></td></tr>';
   }).join('');
   const timeline='<div class="order-timeline">'+
    '<span><em>首笔买入</em><b>'+first+'</b></span>'+
    '<span><em>最后一笔</em><b>'+lastBuy+'</b></span>'+
    '<span><em>卖一半</em><b>'+saleDate(r.sales[0],half)+'</b></span>'+
    '<span><em>卖清</em><b>'+saleDate(r.end,clear)+'</b></span></div>';
   const rh=roundHistory(model,START,j);
   return '<details class="order" data-asset="'+r.asset+'" data-round="'+j+'"><summary>'+
    '<span class="order-main"><b>第 '+(j+1)+' 轮 · '+ASSETS[r.asset]+'</b>'+
    '<span class="order-state '+(sold?'done':'holding')+'">'+(sold?'已卖出':'持有中')+'</span>'+
    '<em>'+first.slice(0,7)+(sold?' → '+clear.slice(0,7):' 起 · 按 '+rows[end][0]+' 估值')+'</em>'+
    '<em class="order-risk">最大回撤 <b>'+pct(rh.risk.depth)+'</b> · 最大浮亏 <b>'+pct(rh.float.depth)+'</b></em></span>'+
    '<strong class="order-ret '+changeClass(r.ret)+'">'+(r.ret>0?'+':'')+pct(r.ret)+'</strong></summary>'+
    '<div class="order-body">'+
    '<div class="round-chart" data-round="'+j+'"></div>'+timeline+
    '<div class="rows"><table><thead><tr><th>买入周</th><th>投入<span class="th-extra">（元）</span></th><th><span class="th-extra">该笔</span>收益</th><th title="买入后持仓市值相对买入本金的最大跌幅，与高点无关">最大浮亏</th><th><span class="th-extra">高点</span>回撤</th></tr></thead><tbody>'+lots+'</tbody></table></div>'+
    '<div id="history-lot-'+j+'" class="history-lot-detail" hidden></div></div></details>';
  }).join(''):'尚无模拟订单。';
  filterSales();
  floatSummary();
  roundCharts();
}
function roundCharts(){
 for(const card of $('orders').querySelectorAll('.order')){
  card.addEventListener('toggle',()=>{
   if(!card.open)return;
   const box=card.querySelector('.round-chart');
   if(!box||box.childElementCount)return;
   renderRoundChart(box,model,START,Number(card.dataset.round));
  });
 }
}
function floatSummary(){
 const box=$('float-summary');if(!box)return;
 const every=[];
 model.rounds.forEach((r,j)=>r.lots.forEach((l,s)=>every.push({h:lotHistory(r,l),j,s})));
 if(!every.length){box.textContent='';return;}
 const worst=every.reduce((a,b)=>b.h.float.depth<a.h.float.depth?b:a);
 const week=every.reduce((a,b)=>b.h.float.week.depth<a.h.float.week.depth?b:a);
 const rounds=model.rounds.map((r,j)=>({h:roundHistory(model,START,j),j}));
 const worstRound=rounds.reduce((a,b)=>b.h.risk.depth<a.h.risk.depth?b:a);
 const worstRoundFloat=rounds.reduce((a,b)=>b.h.float.depth<a.h.float.depth?b:a);
 const label=item=>'第 '+(item.j+1)+' 轮第 '+(item.s+1)+' 笔'+(item.h.float.date?' · '+item.h.float.date:'');
 box.innerHTML='<b>两套风险口径</b>：最大浮亏以买入本金为基准，最大回撤以持有期最高点为基准——先涨 100% 再跌 20%，最大浮亏仍是 0，最大回撤才是 −20%。'+
  '逐笔 '+every.length+' 笔，最大浮亏 <strong>'+pct(worst.h.float.depth)+'</strong>（'+label(worst)+'）；'+
  '买入后 5 个交易日最大浮亏 <strong>'+pct(week.h.float.week.depth)+'</strong>（第 '+(week.j+1)+' 轮第 '+(week.s+1)+' 笔）。'+
  '<br>按轮看账户：账户最大回撤 <strong>'+pct(worstRound.h.risk.depth)+'</strong>（第 '+(worstRound.j+1)+' 轮，'+worstRound.h.risk.peak+' 高点 → '+worstRound.h.risk.trough+' 谷底）；'+
  '账户最大浮亏 <strong>'+pct(worstRoundFloat.h.float.depth)+'</strong>（第 '+(worstRoundFloat.j+1)+' 轮，'+worstRoundFloat.h.float.date+' 账户最低）。';
}
$('orders').onclick=e=>{
 const risk=e.target.closest('button[data-risk-lot]');
 if(risk){
  const roundIndex=Number(risk.dataset.riskRound), slot=Number(risk.dataset.riskLot);
  const panel=$('history-lot-'+roundIndex), round=model.rounds[roundIndex], lot=round.lots[slot];
  const open=risk.getAttribute('aria-expanded')!=='true';
  for(const other of risk.closest('details').querySelectorAll('.risk-button'))other.setAttribute('aria-expanded','false');
  panel.hidden=!open;
  if(!open)return;
  risk.setAttribute('aria-expanded','true');
  renderLotChart(panel,round,lot);
  panel.insertAdjacentHTML('afterbegin','<h4>第 '+(slot+1)+' 笔 · '+rows[lot.i][0]+'</h4>');
  panel.scrollIntoView({block:'nearest'});
  return;
 }
 const button=e.target.closest('button[data-week]');if(!button)return;
 for(const cell of $('orders').querySelectorAll('.sale-date'))cell.classList.toggle('selected',cell===button);
 const i=+button.dataset.week;
 showTradeWeek(i);$('chart').scrollIntoView({block:'start'});
 $('cursor').focus({preventScroll:true});
};
function filterSales(){
 const filter=$('asset-filter').value;
 for(const card of $('orders').querySelectorAll('.order'))card.hidden=filter!==''&&card.dataset.asset!==filter;
}
$('asset-filter').onchange=filterSales;
$('start-year').onchange=()=>{
 const year=$('start-year').value, preferred=year+$('start').value.slice(4,7);
 const available=rows.slice(START).filter(row=>row[0].startsWith(year));
 const match=available.filter(row=>row[0].startsWith(preferred)).at(-1);
 selectStartWeek((match??available.at(-1))[0]);
 plan();
};
$('start-month').onchange=()=>{
 const month=$('start-month').value;
 selectStartWeek(rows.findLast(row=>row[0].startsWith(month))[0]);
 plan();
};
$('start').onchange=plan;$('capital').value=get('capital',10000);$('capital').oninput=plan;
function monday(s){const n=new Date(s+'T00:00:00Z');return +n-(n.getUTCDay()+6)%7*DAY;}
$('append').onsubmit=e=>{
 e.preventDefault();const day=$('newDay').value,prior=rows[end][0],r=[day,...[0,1].map(j=>Number($('p'+j).value))];
 const delta=(monday(day)-monday(prior))/DAY,weekday=new Date(day).getUTCDay(),china=new Date(Date.now()+8*3600000);
 const friday=monday(day)+4*DAY+15*3600000;
 if(!validRow(r)||!weekday||weekday===6||delta<7||delta>14||day>shanghai()||+china<friday){$('notice').textContent='请填写紧接上一条记录的已结束交易周及两个正数点位。整周休市可跳过一周。';return;}
 extra.push(r);const stored=save('rows',extra);refresh();e.target.reset();$('notice').textContent=stored?'已补录，判断与历史记录已重新计算。':'本次页面已更新，浏览器未允许保存。';
};
$('undo').onclick=()=>{extra.pop();save('rows',extra);refresh();$('notice').textContent='已撤回最后一次补录。';};
const actual=get('actual',{});$('holding').value=actual.raw??'';$('filled').value=actual.filled||1;$('lastFill').value=actual.last||'';
$('sold').value=SWAP_STATES.includes(actual.state)?actual.state:(actual.half?'half':'none');
$('basis').value=get('basis','model');$('basis').onchange=mode;
for(const id of ['holding','filled','lastFill','sold'])$(id).onchange=()=>{if(id==='holding')$('sold').value='none';$('sold').value=SWAP_STATES.includes($('sold').value)?$('sold').value:($('sold').value==='1'?'half':'none');plan();};
if($('basis').value==='actual')$('capital').value=actual.capital||10000;
setupTrendCharts();renderFundList();refresh();mode();
refreshDailyClose();
addEventListener('focus', refreshDailyClose);
setInterval(refreshDailyClose, 10 * 60 * 1000);

const navLinks=[...document.querySelectorAll('nav a')];
function selectNav(hash){
 const active=navLinks.find(link=>link.hash===hash);
 $('active-section').textContent=active?.textContent.trim()||(hash==='#rules'?'交易规则':hash==='#data'?'行情与补录':'策略研究');
 for(const link of navLinks){
  if(link===active)link.setAttribute('aria-current','location');
  else link.removeAttribute('aria-current');
 }
}
function visibleSection(){
 if(window.scrollY<12){selectNav('#top');return;}
 const ids=['plan','chart','history','funds','rules','data'];
 const anchorY=innerHeight*.34;
 const current=ids.findLast(id=>$(id).getBoundingClientRect().top<=anchorY);
 selectNav(current?'#'+current:'#top');
}
addEventListener('scroll',visibleSection,{passive:true});
function openHashTarget(){
 const id=location.hash.slice(1);
 if(id==='data'||id==='funds'||id==='rules')$(id).open=true;
 if(id.startsWith('fund-'))$('funds').open=true;
}
addEventListener('hashchange',()=>{selectNav(location.hash);openHashTarget();});
visibleSection();
openHashTarget();

document.addEventListener('click',e=>{
 const a=e.target.closest('a[href^="#"]');
 if(!a)return;
 const id=a.getAttribute('href').slice(1);
 if(id==='data'||id==='funds'||id==='rules')$(id).open=true;
 else if(id.startsWith('fund-'))$('funds').open=true;
});

const mobileLayout = matchMedia('(max-width: 700px)');
function syncChartDatePanel() {
 $('chart-date-panel').open = !mobileLayout.matches;
}
syncChartDatePanel();
mobileLayout.addEventListener('change', syncChartDatePanel);
