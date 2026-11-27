'use strict';
const ASSETS=['中证红利','创业板指'], START=156, FEE=.001, DAY=86400000;
const elapsed=(a,b)=>(Date.parse(a)-Date.parse(b))/DAY;
function quantile(sorted,p){const n=(sorted.length-1)*p,j=Math.floor(n);return sorted[j]+(n-j)*(sorted[Math.min(j+1,sorted.length-1)]-sorted[j]);}
function market(rows){
 const ratios=rows.map(r=>r[1]/r[2]);let year,low,high;
 return rows.map((row,i)=>{
  if(i<START)return null;
  if(row[0].slice(0,4)!==year){
   year=row[0].slice(0,4);const history=ratios.slice(0,i).sort((a,b)=>a-b);
   low=quantile(history,.2);high=quantile(history,.8);
  }
  const r=ratios[i],avg=ratios.slice(i-12,i+1).reduce((a,b)=>a+b)/13;
  return {r,avg,low,high,zone:r<=low?0:r>=high?1:null};
 });
}
function simulate(rows,bars,start,capital=10000){
 let cash=capital,side=null,units=0,budget=cash,regime=null,touch=-100,watch=null,committed=null,lastBuy=null,count=0,orders=[],peak=cash,draw=0;
 const rounds=[],trades=[],nav=[],positions=[];
 for(let i=start;i<rows.length;i++){
  const row=rows[i],m=bars[i];
  for(const order of orders){
   const asset=order.asset,price=row[1+asset];
   if(order.kind==='buy'){
    if(side===null){side=asset;budget=cash;count=0;rounds.push({asset,lots:[],sales:[],start:i});}
    const cost=Math.min(cash,budget/5),qty=cost/(1+FEE)/price;
    cash-=cost;units+=qty;count++;lastBuy=i;rounds.at(-1).lots.push({i,cost,qty,remaining:qty,proceeds:0,fills:[]});
   }else{
    const round=rounds.at(-1);
    for(const lot of round.lots){
     const qty=lot.remaining*order.part, proceeds=qty*price*(1-FEE);
     lot.remaining-=qty;
     lot.proceeds+=proceeds;
     lot.fills.push({i,qty,proceeds});
    }
    round.sales.push(i);cash+=units*order.part*price*(1-FEE);units*=1-order.part;
    if(order.part===1){side=null;round.end=i;count=0;}
   }
   trades.push({...order,i});
  }
  const value=cash+(side===null?0:units*row[1+side]);nav.push(value);positions.push({cash,side,units});peak=Math.max(peak,value);draw=Math.min(draw,value/peak-1);orders=[];
  if(committed!==null){orders=[{kind:'sell',asset:side,part:1},{kind:'buy',asset:committed}];committed=null;continue;}
  if(m.zone!==null){watch=m.zone;touch=i;}
  if(i-touch<13 && (watch===0?m.r>m.avg:m.r<m.avg))regime=watch;
  if(regime===null)continue;
  if(side!==null && side!==regime){orders=[{kind:'sell',asset:side,part:.5}];committed=regime;}
  else if(side===null || (count<5 && elapsed(row[0],rows[lastBuy][0])>=28))orders=[{kind:'buy',asset:regime}];
 }
 for(const round of rounds){
  const mark=rows.at(-1)[1+round.asset];let cost=0,gain=0;
  for(const lot of round.lots){const pnl=lot.proceeds+lot.remaining*mark-lot.cost;lot.ret=pnl/lot.cost;gain+=pnl;cost+=lot.cost;}
  round.ret=gain/cost;
 }
 return {side,regime,orders,watch,touch,lastBuy,count,rounds,trades,nav,positions,draw,budget};
}
