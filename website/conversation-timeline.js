/* Local illustrative dialogue only. No network or model calls. */
(function(root){
 const turns=[
  {topic:'travel',question:'周末去杭州玩两天，想轻松一点。',answer:'周六沿西湖散步，周日逛街巷、喝咖啡。每天只留一个重点，不赶路。'},
  {topic:'release',question:'先换件事，发布新版本前要检查什么？',answer:'核对更新说明，验证关键流程，再检查安装文档和反馈入口。旅行计划仍保留在原话题。'},
  {topic:'travel',question:'回到杭州旅行，第二天改成看展吧。',answer:'接回两天的杭州慢游：周六西湖散步不变，周日看展、喝咖啡，仍然少赶路。'}
 ];
 let total=700;
 turns.forEach(t=>{t.start=total;t.send=t.start+t.question.length*75+650;t.stream=t.send+1100;t.end=t.stream+t.answer.length*65;t.next=t.end+4200;total=t.next;});
 total+=1100;
 function frame(time,reduce=false){
  const elapsed=reduce?total-1200:time%total;
  let active=-1,phase='ready',input='',status='在下方输入，开始一个话题';
  const messages=[];
  turns.forEach((t,i)=>{
   if(elapsed<t.start)return;
   active=i;
   if(elapsed<t.send){phase='typing';input=t.question.slice(0,Math.min(t.question.length,Math.floor((elapsed-t.start)/75)));status='正在输入…';return;}
   messages.push({id:i+'u',kind:'user',text:t.question});input='';
   if(elapsed<t.stream){phase='thinking';status=i===2?'恢复旅行上下文 · 两天 / 杭州 / 慢节奏':'正在整理'+(i===1?'发布检查':'旅行计划')+'…';return;}
   const count=Math.min(t.answer.length,Math.floor((elapsed-t.stream)/65));
   messages.push({id:i+'a',kind:'assistant',text:t.answer.slice(0,count),streaming:count<t.answer.length});
   phase=count<t.answer.length?'streaming':'reading';status=i===2?'已接回旅行 · 保留原来的两天计划':i===1?'版本发布 · 旅行上下文已保留':'周末旅行 · 已记住两天与慢节奏';
  });
  const sent=active>=0&&elapsed>=turns[active].send;
  const current=active<0?'':sent?turns[active].topic:active===0?'':turns[active-1].topic;
  return {elapsed,active,phase,input,status,messages,current,travel:elapsed>=turns[0].send,release:elapsed>=turns[1].send,restored:elapsed>=turns[2].send};
 }
 function clock(){let elapsed=0,last=0,running=false;return{sample(now){if(running)elapsed+=Math.max(0,now-last);last=now;return elapsed;},setRunning(value,now){this.sample(now);running=value;},get elapsed(){return elapsed;},get running(){return running;}};}
 const api={turns,total,frame,clock};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TheOneTimeline=api;
})(typeof window==='undefined'?this:window);
