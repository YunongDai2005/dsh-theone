const scenes = {
  trip: { topic:'trip', question:'周末去杭州，安排两天行程。', answer:'换到旅行这件事：可以先把西湖和周边街区放在第一天，第二天留给灵隐一带。你想走得轻松些，还是多看几个地方？' },
  work: { topic:'work', question:'回到页面，首屏再简洁一点。', answer:'接着之前的产品页面：米白底不变，首屏只留一句核心介绍、一个演示和安装入口，把详细说明放到下面。' }
};
document.querySelectorAll('[data-scene]').forEach(button => {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    const scene = scenes[button.dataset.scene];
    const conversation = document.querySelector('#conversation');
    conversation.replaceChildren();
    for (const [kind, avatar, text] of [['user','你',scene.question], ['assistant','T.',scene.answer]]) {
      const row = document.createElement('div'); row.className = `message ${kind}`;
      const label = document.createElement('span'); label.textContent = avatar;
      if (kind === 'assistant') label.className = 'mini-brand';
      const body = document.createElement('p'); body.textContent = text;
      row.append(label, body); conversation.append(row);
    }
    document.querySelectorAll('[data-topic]').forEach(topic => {
      const selected = topic.dataset.topic === scene.topic;
      topic.classList.toggle('selected', selected);
      topic.querySelector('.topic-status').textContent = selected ? '当前' : '';
    });
    document.querySelectorAll('[data-scene]').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
  });
});
document.querySelector('#copy').addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try { await navigator.clipboard.writeText('dsh-theone'); status.textContent = '已复制包名'; }
  catch { status.textContent = '请选中左侧 dsh-theone 手动复制。'; }
});
