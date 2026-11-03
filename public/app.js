const $ = (id) => document.getElementById(id);
let run = null, activeTicket = null, busy = false;
const text = (tag, value, cls) => { const e=document.createElement(tag); e.textContent=value; if(cls)e.className=cls; return e; };
async function api(path, body) {
  const res=await fetch(path, body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json(); if(!res.ok)throw new Error(data.error||'Request failed'); return data;
}
async function action(fn) {
  if(busy)return; busy=true; $('error').hidden=true;
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try { await fn(); } catch(e) { $('error').textContent=e.message; $('error').hidden=false; }
  finally { busy=false; document.querySelectorAll('button').forEach(b=>b.disabled=false); }
}
async function history() {
  const {runs}=await api('/api/runs'); $('history').replaceChildren();
  if(!runs.length)$('history').append(text('p','No workflows yet.'));
  runs.forEach(r=>{const b=text('button',r.id.slice(0,8),r.id===run?.id?'selected':'');b.append(text('small',r.state+' · '+new Date(r.created).toLocaleDateString()));b.onclick=()=>action(async()=>{run=await api('/api/runs/'+r.id);render();await history();});$('history').append(b);});
}
function render() {
  $('intake').hidden=!!run; $('workflow').hidden=!run; if(!run)return;
  $('run-name').textContent='Dispatch / '+run.id.slice(0,8); $('run-state').textContent=run.state+' · revision '+run.revision;
  const stages=['imported','analyzed','reviewed','completed'], position=stages.indexOf(run.state);
  stages.forEach((s,i)=>$('step-'+s).className=i<position?'done':i===position?'current':'');
  const cases=run.data.cases;
  $('count').textContent=run.data.tickets.length; $('attention').textContent=cases.length?cases.filter(c=>c.priority!=='low').length:'—';
  $('reviewed').textContent=cases.filter(c=>c.decision).length+'/'+run.data.tickets.length; $('records').textContent=run.artifacts.length;
  $('instruction').textContent=run.state==='imported'?'Validate the shipment snapshot against every ticket using explicit rules.':run.state==='completed'?'Handoff saved. Reopening this workflow does not create duplicate records.':run.state==='reviewed'?'Every ticket has a decision. Create records for approved cases; held cases remain in the evidence.':'Inspect each proposed action and leave a review note. Nothing proceeds without a decision.';
  $('analyze').hidden=run.state!=='imported'; $('execute').hidden=run.state!=='reviewed';
  $('cases').replaceChildren();
  cases.forEach(c=>{const card=text('article','', 'case'),left=text('div',''),meta=text('div','', 'ticket-meta');meta.append(text('span',c.ticket_id),text('span',c.priority,'badge '+c.priority));left.append(meta,text('h3',c.action),text('p',c.customer+' · '+c.order_id+' · '+c.rule));const right=text('div','','case-actions'),button=text('button',run.state==='completed'?'View evidence':c.decision?'Review again':'Review','secondary');button.onclick=()=>openReview(c);right.append(button,text('small',c.decision?c.decision==='approve'?'Approved':'Held':'Decision needed'));card.append(left,right);$('cases').append(card);});
  $('source-hash').textContent=run.data.source_sha256; $('events').replaceChildren();
  run.data.events.forEach(e=>{const item=text('li','');item.append(text('strong',e.event),text('small',new Date(e.at).toLocaleString()),text('div',e.detail));$('events').append(item);});
  $('handoff').hidden=run.state!=='completed'; $('handoff-summary').textContent=`${run.artifacts.length} internal records created. ${cases.filter(c=>c.decision==='hold').length} cases held. Reply drafts remain unsent; no carrier requests were made.`;
  $('json-export').href='/api/runs/'+run.id+'/export.json'; $('csv-export').href='/api/runs/'+run.id+'/export.csv';
}
function openReview(c) {
  activeTicket=c.ticket_id; $('case-title').textContent=c.ticket_id+' · '+c.action; $('case-reason').textContent=c.reason;
  $('case-shipment').textContent=c.shipment?Object.entries(c.shipment).map(([k,v])=>k+': '+v).join('\n'):'No matching shipment found in this snapshot.';
  $('case-draft').textContent=c.draft; $('decision').value=c.decision||'approve'; $('note').value=c.note; $('review-error').textContent='';
  $('decision').disabled=$('note').disabled=run.state==='completed'; $('review-form').querySelector('button[type="submit"]').hidden=run.state==='completed'; $('review-dialog').showModal();
}
$('close-dialog').onclick=()=>$('review-dialog').close();
$('new').onclick=()=>{run=null;render();action(history);};
$('sample').onclick=()=>action(async()=>{const [a,b]=await Promise.all(['/fixtures/tickets.csv','/fixtures/shipments.csv'].map(p=>fetch(p).then(r=>r.text())));$('tickets').value=a;$('shipments').value=b;});
$('import').onclick=()=>action(async()=>{run=await api('/api/runs',{tickets_csv:$('tickets').value,shipments_csv:$('shipments').value});render();await history();});
$('analyze').onclick=()=>action(async()=>{run=await api('/api/runs/'+run.id+'/analyze',{revision:run.revision});render();await history();});
$('execute').onclick=()=>action(async()=>{run=await api('/api/runs/'+run.id+'/execute',{revision:run.revision});render();await history();});
$('review-form').onsubmit=async(e)=>{e.preventDefault();if(busy)return;busy=true;const submit=e.target.querySelector('[type="submit"]');submit.disabled=true;try{run=await api('/api/runs/'+run.id+'/review',{revision:run.revision,ticket_id:activeTicket,decision:$('decision').value,note:$('note').value});$('review-dialog').close();render();await history();}catch(err){$('review-error').textContent=err.message;}finally{busy=false;submit.disabled=false;}};
action(history);
