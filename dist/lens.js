'use strict';
const StyleLens = (() => {
  const lookback = 156;
  const week = 7 * 86400000;
  const labels = ['红利观察区','中间区','创业板观察区'];
  function quantile(sorted, p) {
    const x = (sorted.length - 1) * p, i = Math.floor(x);
    return sorted[i] + (sorted[Math.ceil(x)] - sorted[i]) * (x - i);
  }
  function build(data) {
    const ratios = data.map(([,a,b]) => a/b);
    return data.map(([date, a, b, totalA, totalB],i) => {
      const r = ratios[i];
      const row = {date, time:Date.parse(date), a,b,totalA,totalB,r,zone:null};
      if (i < lookback) return row;
      const prior = ratios.slice(i-lookback,i).sort((a,b)=>a-b);
      row.low = quantile(prior,.2); row.high = quantile(prior,.8);
      row.rank = prior.filter(x=>x<=r).length / lookback;
      row.zone = r<=row.low ? 0 : r>=row.high ? 2 : 1;
      return row;
    });
  }
  // Count only first entry into each zone, without overlapping holding periods within that zone.
  function cases(rows, asOf, weeks) {
    const groups=[[],[],[]], lastExit=[-1,-1,-1];
    for(let i=lookback+1;i<asOf;i++){
      const row=rows[i], z=row.zone;
      if(z===rows[i-1].zone || i<=lastExit[z])continue;
      const entry=i+1, until=rows[entry].time+weeks*week;
      let exit=entry;
      while(exit<=asOf && rows[exit].time<until)exit++;
      if(exit>asOf)break;
      const a=rows[exit].totalA/rows[entry].totalA-1, b=rows[exit].totalB/rows[entry].totalB-1;
      groups[z].push({i,entry,exit,a,b,spread:a-b});
      lastExit[z]=exit;
    }
    return groups;
  }
  function summary(samples,side){
    if(!samples.length)return null;
    const spreads=samples.map(e=>side==='b'?-e.spread:e.spread).sort((a,b)=>a-b);
    const wins=spreads.filter(x=>x>0).length;
    return {n:samples.length,wins,median:quantile(spreads,.5),worst:spreads[0]};
  }
  function decision(rows,i,samples) {
    const row=rows[i], z=row.zone;
    if(z===1)return {title:'维持原配置',caption:'本周无需轮换',reason:'红利与创业板的比值落在近三年常见范围内，当前价格位置给出的倾斜理由有限。',action:'已有仓位照原比例持有；准备从现金建仓，可等观察线触发后再评估。',allocation:50};
    const name=z===0?'红利':'创业板', direction=z===0?1:-1;
    const stat=summary(samples,z===0?'a':'b');
    const turning=(row.r/rows[i-4].r-1)*direction>0;
    const supported=stat&&stat.n>=5&&stat.wins/stat.n>.5&&stat.median>0;
    const ready=turning&&supported;
    return {title:ready?'小幅偏向'+name:'观察'+name,caption:ready?'满足倾斜条件':'暂缓调整',reason:ready?'比值位于观察区，近四周相对表现转强；过去同区间的半年结果也偏向这一侧。':
      !turning?name+'处在相对弱势一侧，近四周相对表现仍未转强。先等下一份周报确认。':'近四周相对表现已经转强，历史样本的数量或结果仍不足以支持倾斜。',
      action:ready?'若已计划同时持有两项资产，可用专项资金试算一次 5 个百分点的倾斜。后续同类信号维持该目标。':'保留既有比例。本周先记录观察，不追加风格仓位。',allocation:ready?(z===0?55:45):50};
  }
  return {build,cases,summary,decision,lookback,labels,quantile};
})();
