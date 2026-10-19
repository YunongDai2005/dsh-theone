const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target);}}),{threshold:.12});document.querySelectorAll('.reveal').forEach(e=>observer.observe(e));
const miniObserver=new IntersectionObserver(entries=>entries.forEach(e=>e.target.classList.toggle('running',e.isIntersecting)),{threshold:.15});document.querySelectorAll('.mini-demo').forEach(e=>miniObserver.observe(e));
document.querySelectorAll('.mini-demo').forEach((demo,i)=>{const control=document.createElement('button');control.className='mini-pause';control.textContent='Ⅱ';control.setAttribute('aria-label',`暂停第 ${i+1} 个功能示意`);control.setAttribute('aria-pressed','false');control.addEventListener('click',()=>{const stopped=demo.classList.toggle('paused');control.textContent=stopped?'▶':'Ⅱ';control.setAttribute('aria-pressed',String(stopped));control.setAttribute('aria-label',`${stopped?'播放':'暂停'}第 ${i+1} 个功能示意`);});demo.append(control);});
// Harness hero: target hero, offsets ["start start", "end start"].
// Progress [0, .65] -> [0, 1]; spring k=160, c=28, mass=.6.
// The entrance translation is on .preview-wrap, independent of this surface.
const heroSurface=document.querySelector('#desktop'),heroTarget=document.querySelector('.hero');
let springPosition=0,springVelocity=0,springTarget=0,springFrame=0,springTime=0;
const clamp=value=>Math.min(1,Math.max(0,value));
function paintTilt(){const p=clamp(springPosition);heroSurface.style.transform=p<.001?'none':`perspective(1600px) rotateX(${5*p}deg) scale(${1-.015*p})`;}
function tickTilt(now){
  springFrame=0;
  const dt=Math.max(0,(now-springTime)/1000);springTime=now;
  // Exact solution of the damped spring for a constant target in this frame.
  const r1=-20/3,r2=-40,z=springPosition-springTarget;
  const a=(springVelocity-r2*z)/(r1-r2),b=z-a;
  const e1=Math.exp(r1*dt),e2=Math.exp(r2*dt);
  springPosition=springTarget+a*e1+b*e2;springVelocity=r1*a*e1+r2*b*e2;
  if(Math.abs(springPosition-springTarget)<.00001&&Math.abs(springVelocity)<.0001){springPosition=springTarget;springVelocity=0;paintTilt();return;}
  paintTilt();springFrame=requestAnimationFrame(tickTilt);
}
function scroll(){
  document.querySelector('#nav').classList.toggle('compact',scrollY>80);
  const rect=heroTarget.getBoundingClientRect(),height=heroTarget.offsetHeight;
  springTarget=clamp((-rect.top/height)/.65);
  if(reduced.matches||innerWidth<768){cancelAnimationFrame(springFrame);springFrame=0;springPosition=0;springVelocity=0;heroSurface.style.transform='none';}
  else if(!springFrame){springTime=performance.now();springFrame=requestAnimationFrame(tickTilt);}
  document.querySelector('.ambient').style.filter=reduced.matches?'none':`blur(${clamp(-rect.top/(height*.6))*20}px)`;
}
reduced.addEventListener('change',scroll);addEventListener('scroll',scroll,{passive:true});addEventListener('resize',scroll);scroll();
document.querySelector('#copy').addEventListener('click',async()=>{const status=document.querySelector('#copy-status');try{await navigator.clipboard.writeText('dsh-theone');status.textContent='已复制 dsh-theone';}catch{status.textContent='请手动复制：dsh-theone';}});
const storyScenes=[
{user:'周末去杭州玩两天，想安排得轻松一点。',answer:'<p>那就留一半给风景，<br>另一半给没有安排的时间。</p><p>周六沿西湖散步，周日逛街巷、喝咖啡。<br>每天只留一个重点，不用赶路。</p>',context:'当前话题 · 周末旅行'},
{user:'先换件事。新版本发布前，要检查哪些内容？',answer:'<p>先把发布前的三件事确认好。</p><p>核对更新说明，验证关键流程，<br>再检查安装文档和反馈入口。</p>',context:'当前话题 · 版本发布'},
{user:'回到杭州旅行，第二天改成看展吧。',answer:'<p>好，继续那份<strong>两天的杭州慢游</strong>。</p><p>周六的西湖散步不变。<br>周日看展，下午在附近喝咖啡。<br>还是少赶路、多留白。</p>',context:'接续原话题 · 周末旅行'}];
