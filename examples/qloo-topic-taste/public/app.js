const $ = id => document.getElementById(id);
let busy = false;
async function api(path, body) {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'The request failed.'); return result;
}
function node(tag, value, className) { const n = document.createElement(tag); if (value !== undefined) n.textContent = value; if (className) n.className = className; return n; }
function message(value, className = 'assistant') { const card = node('article', undefined, `message ${className}`); card.append(node('p', value)); $('messages').append(card); card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return card; }
async function run(action) { if (busy) return; busy = true; $('send').disabled = true;
  try { render(await action()); await refresh(); } catch (e) { message(e.message, 'error'); }
  finally { busy = false; $('send').disabled = false; } }
function render(result) {
  const card = message(result.message ?? result.question ?? 'Topic ready. Search for a favorite to get started.');
  if (result.topic) card.prepend(node('span', result.topic.title, 'route'));
  if (result.candidates?.length) {
    const list = node('div', undefined, 'cards');
    for (const candidate of result.candidates) {
      const item = node('div', undefined, 'card'); item.append(node('h3', candidate.name), node('p', 'Found by Qloo · not yet saved'));
      const button = node('button', 'This is the one');
      button.onclick = () => run(async () => { const saved = await api('confirm', { token: result.token, entityId: candidate.id }); list.querySelectorAll('button').forEach(b => { b.disabled = true; }); return saved; });
      item.append(button); list.append(item);
    } card.append(list);
  }
  if (result.basedOn) card.append(node('p', `Favorites used: ${result.basedOn.map(s => s.name).join(' · ')}`, 'muted'));
  if (result.picks?.length) {
    const list = node('div', undefined, 'cards');
    for (const pick of result.picks) { const item = node('div', undefined, 'card'); item.append(node('h3', pick.name), node('p', 'Qloo recommendation'));
      if (pick.affinity !== null) item.append(node('p', `Relative affinity: ${Number(pick.affinity).toFixed(3)}`));
      // Do not turn unexplained API metadata into a made-up natural-language reason.
      list.append(item);
    } card.append(list);
  }
}
async function refresh() {
  const state = await api('state'); const ready = state.qlooReady && state.modelReady;
  $('readiness').className = ready ? 'ready' : '';
  $('readiness').textContent = ready ? 'Live endpoints configured. Picks come from Qloo; only your confirmed favorites are used.' : `Development preview. ${state.qlooReady ? '' : 'Qloo key pending: no live picks yet. '}${state.modelReady ? '' : 'Routing model not configured. '}`;
  $('topics').replaceChildren();
  for (const topic of state.topics) {
    const card = node('section', undefined, 'topic'); card.append(node('h3', topic.title), node('div', topic.seeds.length ? topic.seeds.map(s => s.name).join(' · ') : 'No confirmed favorites yet', 'seeds'));
    const controls = node('div', undefined, 'topic-controls'), select = document.createElement('select'); select.setAttribute('aria-label', `Category for ${topic.title}`);
    for (const [value, label] of Object.entries({ movie: 'Movies', artist: 'Music artists', book: 'Books', place: 'Places' })) { const option = node('option', label); option.value = value; select.append(option); }
    const row = node('div', undefined, 'row'), input = document.createElement('input'); input.placeholder = 'A favorite title or name'; input.maxLength = 120; input.setAttribute('aria-label', `Favorite for ${topic.title}`);
    const search = node('button', 'Search'); search.onclick = () => run(() => api('search', { topicId: topic.id, query: input.value, category: select.value }));
    const recommend = node('button', 'Find picks for this topic'); recommend.onclick = () => run(() => api('recommend', { topicId: topic.id, category: select.value }));
    row.append(input, search); controls.append(select, row, recommend); card.append(controls); $('topics').append(card);
  }
}
$('new-topic').onsubmit = event => { event.preventDefault(); run(async () => { const result = await api('topics', { title: $('topic-title').value }); $('topic-title').value = ''; return result; }); };
$('chat').onsubmit = event => { event.preventDefault(); if (busy) return; const value = $('message').value.trim(); if (!value) return; message(value, 'user'); $('message').value = ''; run(() => api('chat', { message: value })); };
refresh().catch(e => message(e.message, 'error'));
