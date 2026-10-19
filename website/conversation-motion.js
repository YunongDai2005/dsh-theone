/* Persistent conversation surfaces, with incremental messages and local clocks. */
(()=>{
 if(document.documentElement.dataset.conversationReady)return;
 document.documentElement.dataset.conversationReady='true';
 const model=window.TheOneTimeline,preference=matchMedia('(prefers-reduced-motion: reduce)');
 const ledgerMarkup='<div class="context-label">话题上下文 · 示意</div><div class="context-item" data-topic="travel"><span class="context-led">○</span><div><strong>周末旅行</strong><small>等待第一条消息</small></div></div><div class="context-item" data-topic="release"><span class="context-led">○</span><div><strong>版本发布</strong><small>等待切换话题</small></div></div><p class="context-note">在同一个主聊天里继续。<br>每件事，保留自己的上下文。</p>';
 const detail=document.querySelector('.story-detail');
 document.querySelector('.story-steps').outerHTML='<aside class="context-ledger">'+ledgerMarkup+'</aside>';
 document.querySelector('.scene-tabs').outerHTML='<div class="demo-process">输入 → 发送 → 思考 → 流式回复 · 自动演示</div>';
 document.querySelector('.messages').innerHTML='<div class="stream-log" aria-live="off"></div>';
 document.querySelector('.story-conversation').innerHTML='<div class="stream-log" aria-live="off"></div>';
 const composer=document.createElement('div');composer.className='story-composer';composer.innerHTML='<div class="stream-input"></div><span class="stream-send" aria-hidden="true">↑</span>';document.querySelector('.story-bottom').before(composer);
 document.querySelector('#story-counter').textContent='连续对话示意';
 const control=document.createElement('button');control.id='story-pause';control.className='story-pause';control.type='button';detail.after(control);
 const ledger=document.createElement('div');ledger.className='hero-context-ledger';ledger.innerHTML=ledgerMarkup;document.querySelector('.one-entry').after(ledger);
 const status=document.createElement('div');status.className='stream-status';document.querySelector('.messages').before(status);
 const surfaces=[
  {root:document.querySelector('#desktop'),log:document.querySelector('.messages .stream-log'),viewport:document.querySelector('.messages'),input:document.querySelector('#composer-text'),control:document.querySelector('#pause'),status,ledger},
  {root:detail,log:detail.querySelector('.stream-log'),viewport:document.querySelector('.story-conversation'),input:composer.querySelector('.stream-input'),control,status:document.querySelector('#story-context'),ledger:document.querySelector('.context-ledger')}
 ];
 function paint(surface){
  const s=model.frame(surface.clock.elapsed,preference.matches),root=surface.root;
  root.dataset.phase=s.phase;root.dataset.elapsed=String(Math.round(surface.clock.elapsed));root.dataset.turn=String(s.active);root.dataset.running=String(surface.clock.running);
  surface.input.textContent=s.input||'再聊点什么…';surface.input.classList.toggle('is-typing',s.phase==='typing');surface.input.classList.toggle('has-input',!!s.input);
  surface.status.textContent=s.status;
  const ids=new Set(s.messages.map(m=>m.id));
  [...surface.log.children].forEach(e=>{if(!ids.has(e.dataset.message))e.remove();});
  let changed=false;
  s.messages.forEach(m=>{let e=surface.log.querySelector('[data-message="'+m.id+'"]');if(!e){e=document.createElement('div');e.dataset.message=m.id;e.className='stream-message '+m.kind;surface.log.append(e);changed=true;}if(e.textContent!==m.text){e.textContent=m.text;changed=true;}e.classList.toggle('is-streaming',!!m.streaming);});
  if(changed)surface.viewport.scrollTop=surface.viewport.scrollHeight;
  surface.ledger.querySelectorAll('[data-topic]').forEach(e=>{const key=e.dataset.topic,exists=s[key];e.classList.toggle('current',s.current===key);e.classList.toggle('stored',exists);e.querySelector('.context-led').textContent=s.current===key?'●':exists?'✓':'○';e.querySelector('small').textContent=key==='travel'?(s.restored?'已接回 · 两天 / 杭州 / 慢节奏':s.travel?'已保留 · 两天 / 杭州 / 慢节奏':'等待第一条消息'):(s.release?'已保留 · 发布检查清单':'等待切换话题');});
 }
 function sync(surface){surface.clock.setRunning(surface.visible&&!surface.paused&&!document.hidden&&!preference.matches,performance.now());surface.control.textContent=preference.matches?'已减少动态效果':surface.paused?'▶ 继续演示':'Ⅱ 暂停演示';surface.control.disabled=preference.matches;surface.control.setAttribute('aria-pressed',String(surface.paused));paint(surface);}
 surfaces.forEach(surface=>{surface.clock=model.clock();surface.visible=false;surface.paused=false;surface.control.addEventListener('click',()=>{surface.paused=!surface.paused;sync(surface);});new IntersectionObserver(entries=>{surface.visible=entries[0].isIntersecting;sync(surface);},{threshold:.25}).observe(surface.root);sync(surface);});
 document.addEventListener('visibilitychange',()=>surfaces.forEach(sync));preference.addEventListener('change',()=>surfaces.forEach(sync));
 setInterval(()=>surfaces.forEach(surface=>{if(!surface.clock.running)return;surface.clock.sample(performance.now());paint(surface);}),40);
})();
