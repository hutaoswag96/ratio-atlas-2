'use strict';

const TRACKED_FUNDS = [
 [
  {a:'012643',c:'012644',target:'515080',name:'招商中证红利ETF联接',source:'https://www.cmfunds.cn/web/fundnoticedetail/225360/index.html'},
  {a:'009051',c:'009052',target:'515180',name:'易方达中证红利ETF联接',source:'https://www.efunds.com.cn/fund/009052_org.shtml'},
  {a:'021099',c:'021100',target:'515890',name:'博时中证红利ETF发起式联接',source:'https://www.bosera.com/fund/021099.html'},
  {a:'161907',c:'015558',target:'159581',name:'万家中证红利ETF联接',source:'https://www.wjasset.com/products/index/015558/index.html'},
  {a:'021399',c:'021400',target:'159589',name:'广发中证红利ETF发起式联接',source:'https://www.gffunds.com.cn/funds/?fromSearch=1&fundcode=021399'}
 ],
 [
  {a:'110026',c:'004744',target:'159915',name:'易方达创业板ETF联接',source:'https://www.efunds.com.cn/Mobile/fund/004744.shtml'},
  {a:'001592',c:'001593',target:'159977',name:'天弘创业板ETF联接',source:'https://www.bankofchina.com/sdbapp/fundsdocs/202508/t20250818_25459488.html'},
  {a:'002656',c:'004343',target:'159948',name:'南方创业板ETF联接',source:'https://www.nffund.com/main/files/2025/08/29/741911494683.pdf'},
  {a:'003765',c:'003766',target:'159952',name:'广发创业板ETF发起式联接',source:'https://www.gffunds.com.cn/funds/?fundcode=003765'},
  {a:'006248',c:'006249',target:'159957',name:'华夏创业板ETF联接',source:'https://www.chinaamc.com/fund/006248/index.shtml'}
 ]
];

function renderFundList() {
 $('fund-list').innerHTML = TRACKED_FUNDS.map((funds, i) => `
  <section class="fund-group" id="fund-${i}">
   <h3>${ASSETS[i]} <code>${funds[0].target==='515080'?'H00922':'399606'}</code></h3>
   ${funds.map(fund=>`<article class="fund-row">
    <div><h4>${fund.name}</h4><p>目标 ETF <code>${fund.target}</code></p></div>
    <div class="fund-code"><span>A 类</span><strong>${fund.a}</strong><span>C 类</span><strong>${fund.c}</strong></div>
    <a href="${fund.source}" target="_blank" rel="noopener noreferrer">基金资料</a>
   </article>`).join('')}
  </section>`).join('');
}

function renderExecution(container, held, stage, nextBuy, actual=false, state='none') {
 const orders = [];
 const buy = actual ? '申购' : '买入';
 const sell = actual ? '赎回' : '卖出';
 const clear = actual ? '赎回全部剩余份额' : '卖清剩余的全部份额';
 const nextWeek = actual ? '下一交易周，按平台受理时间提交' : '下一交易周收盘';
 if (state === 'half') {
  orders.push({ kind:'sell', asset:held, time:'尽快，按平台受理时间提交', size:clear });
  orders.push({ kind:'buy', asset:1-held, time:'确认全部赎回、款项可用后', size:'用本策略资金的 20% '+buy+'第一笔' });
 } else if (state === 'cleared') {
  orders.push({ kind:'buy', asset:1-held, time:'款项到账后，按平台受理时间提交', size:'用本策略资金的 20% '+buy+'第一笔' });
 } else if (state === 'pending') {
  // 申购已提交，等待份额确认，没有新的待执行动作
 } else if (stage) {
  const clearingTime = stage === 1 ? (actual?'再下一交易周':'再下一交易周收盘') : nextWeek;
  if (stage === 1) orders.push({ kind:'sell', asset:held, time:nextWeek, size:sell+'当前持有份额的 50%' });
  orders.push({ kind:'sell', asset:held, time:clearingTime, size:clear });
  orders.push({
   kind:'buy', asset:1-held,
   time:actual?'确认全部赎回且款项可用后':'同一交易日，模拟旧仓卖清后',
   size:'用本策略资金的 20% '+buy+'第一笔'
  });
 } else if (nextBuy) {
  orders.push({ kind:'buy', asset:nextBuy.asset, time:nextWeek, size:'参考预算 ¥'+fmt(nextBuy.budget) });
 }
 if (!orders.length) {
  if (state === 'pending') {
   container.insertAdjacentHTML('beforeend','<p class="settle-note">申购已提交，等销售平台确认份额和成交净值。确认后把持仓切换为新资产、已买笔数改为 1，换仓进度改回「旧仓未动」。</p>');
   return;
  }
  if (held !== null) {
   const other = 1-held;
   const threshold = other === 1 ? '进入高位观察区，观察期内比值低于 13 周均值' : '进入低位观察区，观察期内比值高于 13 周均值';
   container.insertAdjacentHTML('beforeend', '<p class="hold-trigger">换仓条件 · '+ASSETS[other]+threshold+'。</p>');
  }
  return;
 }
 const list = orders.map(order => {
  const selling = order.kind === 'sell', fund = TRACKED_FUNDS[order.asset][0];
  const title = selling ? sell+'当前持有的'+ASSETS[order.asset]+'基金' : buy+fund.name;
  const fundLabel = selling ? '<span>基金代码以账户持仓为准</span>' :
   '<a href="#fund-'+order.asset+'">A 类 <code>'+fund.a+'</code> · C 类 <code>'+fund.c+'</code></a>';
  return `<li class="order-row ${order.kind}">
   <span class="order-time">${order.time}</span>
   <div><strong>${title}</strong><p>${order.size}</p></div>
   <div class="order-fund">${fundLabel}</div>
  </li>`;
 }).join('');
 const settlement = actual?'以销售平台显示的申请受理、净值确认和到账时间为准。':'场外实际换仓时，等旧基金赎回款可用后再申购新基金。';
 const note = (stage || state !== 'none') ? '<p class="meta">'+settlement+'</p><h4 class="old-positions">旧仓建仓记录</h4>' : '';
 container.querySelector('.steps').insertAdjacentHTML('beforebegin', '<section class="execution-orders"><h4>操作顺序</h4><ol>'+list+'</ol>'+note+'</section>');
}
