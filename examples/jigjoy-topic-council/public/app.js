const $ = id => document.getElementById(id);
const terminal = new Set(['completed', 'complete', 'succeeded', 'success', 'failed', 'error', 'cancelled', 'canceled', 'interrupted']);
const stopped = new Set(['failed', 'error', 'cancelled', 'canceled', 'interrupted']);
let csrfToken = '';
let modelAvailable = false;
let selectedId = null;
let currentRun = null;
let currentResult = null;
let submitting = false;
let cancelling = false;
let pollTimer = null;
let selectedRevision = '';

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = String(value);
  if (className) node.className = className;
  return node;
}
function stringValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
function statusOf(run) { return String(run?.status ?? 'unknown').toLowerCase(); }
function isActive(run) { return Boolean(run?.id) && !terminal.has(statusOf(run)); }
function readable(value) { return String(value ?? '').replace(/[_-]+/g, ' '); }
function dateLabel(value) {
  if (value === undefined || value === null) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formMessage(value, error = false) {
  $('form-message').textContent = value;
  $('form-message').className = `form-message${error ? ' error' : ''}`;
}
function updateStart() { $('start-button').disabled = !modelAvailable || !csrfToken || submitting; }
async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (method !== 'GET') {
    if (!csrfToken) throw new Error('Local session is not ready. Refresh this page before trying again.');
    headers['x-council-token'] = csrfToken;
    headers['Content-Type'] = 'application/json';
  }
  let response;
  try { response = await fetch(path, { method, headers, ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}) }); }
  catch { throw new Error('The local server could not be reached. Check that Topic Council is still running.'); }
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`The local server returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message ?? `Request failed (${response.status}).`);
  return result;
}
async function refreshStatus() {
  try {
    const status = await api('/api/status');
    csrfToken = typeof status.csrfToken === 'string' ? status.csrfToken : '';
    modelAvailable = Boolean(status.ready);
    $('runtime-model').textContent = status.model ?? 'Not configured';
    $('runtime-endpoint').textContent = status.endpoint ?? 'Not configured';
    $('connection-label').textContent = modelAvailable ? 'Model available locally' : 'Local model unavailable';
    $('connection-dot').className = `dot ${modelAvailable ? 'available' : 'unavailable'}`;
    const note = 'Model availability means it is listed by Ollama. It does not prove successful inference or output quality.';
    $('runtime-warning').textContent = status.warning ? `${String(status.warning)} ${note}` : note;
    if (!modelAvailable) formMessage(status.warning ?? 'Make the configured model available in local Ollama, then refresh.', true);
    if (modelAvailable && !csrfToken) formMessage('The local server did not provide a session token. Refresh this page.', true);
  } catch (error) {
    modelAvailable = false;
    $('connection-label').textContent = 'Local server unavailable';
    $('connection-dot').className = 'dot unavailable';
    $('runtime-warning').textContent = error.message;
    formMessage(error.message, true);
  }
  updateStart();
}
function output(target, value) {
  target.replaceChildren();
  target.hidden = value === undefined || value === null || value === '';
  if (!target.hidden) target.append(element('pre', stringValue(value), typeof value === 'string' ? '' : 'structured'));
}
function agentRole(event) {
  const id = String(event.agentId ?? event.agent ?? '').toLowerCase();
  if (/planner|action/.test(id)) return 'planner';
  if (/reviewer|risk/.test(id)) return 'reviewer';
  if (event.phase === 'risk' || event.key === 'risk') return 'reviewer';
  if (['plan', 'reconcile'].includes(event.phase) || ['plan', 'final'].includes(event.key)) return 'planner';
  return null;
}
function renderAgents(run, events) {
  const result = run.result;
  for (const role of ['planner', 'reviewer']) {
    const own = events.filter(event => agentRole(event) === role);
    const last = own.at(-1);
    let state = own.length ? 'Working' : 'Waiting';
    if (own.some(event => /error|fail|cancel/.test(String(event.type)))) state = 'Stopped';
    if (last && /complete|finished|end$/.test(String(last.type))) state = 'Complete';
    if (!isActive(run) && own.length) state = stopped.has(statusOf(run)) ? 'Stopped' : 'Complete';
    const saved = own.filter(event => event.type === 'shared-state.updated' && event.key === (role === 'planner' ? 'plan' : 'risk')).at(-1);
    const value = result?.[role === 'planner' ? 'plan' : 'risk'] ?? saved?.text ?? saved?.value;
    if (value !== undefined && !isActive(run) && !stopped.has(statusOf(run))) state = 'Complete';
    $('' + role + '-state').textContent = state;
    $('' + role + '-message').textContent = last
      ? (typeof last.message === 'string' ? last.message : `${readable(last.type ?? 'Event received')}${last.phase ? ` · ${readable(last.phase)}` : ''}`)
      : 'Waiting for the backend to report this agent’s activity.';
    output($('' + role + '-output'), value);
  }
}
function renderEvents(events) {
  const open = new Set(Array.from($('event-list').querySelectorAll('details[open]'), node => node.dataset.index));
  $('event-list').replaceChildren();
  $('event-count').textContent = String(events.length);
  $('timeline-empty').hidden = events.length > 0;
  events.forEach((event, index) => {
    const item = element('li');
    const line = element('div', undefined, 'event-line');
    line.append(element('span', dateLabel(event.at ?? event.recordedAt ?? event.timestamp ?? event.time ?? event.startedAt) || `Event ${index + 1}`, 'event-time'));
    line.append(element('span', readable(event.type ?? event.event ?? 'Event'), 'event-name'));
    if (event.agentId ?? event.agent) line.append(element('span', event.agentId ?? event.agent, 'event-agent'));
    item.append(line);
    if (typeof event.message === 'string') item.append(element('p', event.message, 'event-message'));
    const details = element('details', undefined, 'event-details');
    details.dataset.index = String(index);
    details.open = open.has(String(index));
    details.append(element('summary', 'Inspect raw event'), element('pre', stringValue(event)));
    item.append(details);
    $('event-list').append(item);
  });
}
function renderRun(run) {
  currentRun = run;
  $('run-title').textContent = run.topic ?? 'Untitled run';
  $('run-subtitle').textContent = run.brief ?? '';
  const status = statusOf(run);
  $('run-status').textContent = readable(status);
  $('run-status').className = `badge ${['failed', 'error', 'interrupted'].includes(status) ? 'error' : ['completed', 'complete', 'succeeded', 'success'].includes(status) ? 'success' : isActive(run) ? 'active' : 'neutral'}`;
  $('run-actions').hidden = false;
  $('run-id').textContent = run.id ? `Run ${run.id}` : '';
  $('cancel-button').hidden = !isActive(run);
  $('cancel-button').disabled = cancelling;
  $('run-error').hidden = !run.error;
  $('run-error').textContent = run.error ? (run.error.message ?? stringValue(run.error)) : '';
  const events = Array.isArray(run.events) ? run.events : Array.isArray(run.result?.trace) ? run.result.trace : [];
  renderAgents(run, events);
  renderEvents(events);
  const hasSeparateFindings = run.result && typeof run.result === 'object' && ('plan' in run.result || 'risk' in run.result);
  currentResult = run.result?.final ?? run.result?.synthesis ?? run.result?.combined ?? (hasSeparateFindings ? null : run.result);
  output($('result-output'), currentResult);
  $('result-empty').hidden = !$('result-output').hidden;
  $('result-note').hidden = $('result-output').hidden;
  $('copy-result').disabled = $('result-output').hidden;
  $('copy-result').textContent = 'Copy result';
  const overlap = run.result?.overlap;
  $('overlap-note').hidden = !overlap || typeof overlap.concurrent !== 'boolean';
  if (!$('overlap-note').hidden) {
    const duration = Number.isFinite(overlap.overlapMs) ? ` (${Math.round(overlap.overlapMs)} ms)` : '';
    const observation = overlap.concurrent ? `The backend recorded overlapping request intervals${duration}.` : 'The backend did not record overlapping request intervals.';
    $('overlap-note').textContent = `${observation} ${overlap.measurement ?? 'Request overlap does not prove simultaneous model computation.'}`;
  }
}
async function refreshRun(id) {
  if (id !== selectedId) return;
  try {
    const run = await api(`/api/runs/${encodeURIComponent(id)}`);
    if (id !== selectedId) return;
    const revision = JSON.stringify(run);
    if (revision !== selectedRevision) { selectedRevision = revision; renderRun(run); }
    if (isActive(run)) pollTimer = setTimeout(() => refreshRun(id), 1000);
    else { await refreshHistory(false); await refreshStatus(); }
  } catch (error) {
    if (id !== selectedId) return;
    $('run-error').hidden = false;
    $('run-error').textContent = `${error.message} The last received output is kept below.`;
    pollTimer = setTimeout(() => refreshRun(id), 3000);
  }
}
async function selectRun(id) {
  clearTimeout(pollTimer);
  selectedId = id;
  selectedRevision = '';
  for (const button of $('history').querySelectorAll('button')) {
    button.classList.toggle('selected', button.dataset.id === id);
    button.setAttribute('aria-pressed', String(button.dataset.id === id));
  }
  await refreshRun(id);
}
async function refreshHistory(selectLatest = false) {
  try {
    const data = await api('/api/runs');
    const runs = Array.isArray(data.runs) ? data.runs : [];
    $('history').replaceChildren();
    $('history-empty').textContent = 'No runs saved yet.';
    $('history-empty').hidden = runs.length > 0;
    for (const run of runs) {
      if (!run.id) continue;
      const button = element('button', undefined, `history-item${run.id === selectedId ? ' selected' : ''}`);
      button.type = 'button'; button.dataset.id = run.id; button.setAttribute('aria-pressed', String(run.id === selectedId));
      button.append(element('strong', run.topic ?? 'Untitled run'));
      const meta = element('span', undefined, 'history-meta');
      meta.append(element('span', readable(run.status ?? 'Unknown')), element('span', dateLabel(run.createdAt ?? run.created_at ?? run.startedAt)));
      button.append(meta);
      button.addEventListener('click', () => selectRun(run.id));
      $('history').append(button);
    }
    if (selectLatest && !selectedId && runs[0]?.id) await selectRun(runs[0].id);
  } catch (error) {
    $('history-empty').hidden = false;
    $('history-empty').textContent = `History unavailable: ${error.message}`;
  }
}
$('run-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  const topic = $('topic').value.trim(), brief = $('brief').value.trim();
  if (!topic || !brief) { formMessage('Add a topic and a brief before starting.', true); return; }
  submitting = true; updateStart(); formMessage('Creating a local run…');
  try {
    const run = await api('/api/runs', { method: 'POST', body: { topic, brief } });
    if (!run.id) throw new Error('The server did not return a run ID. Check local history before retrying.');
    formMessage('Run created. Progress below comes from the backend.');
    await refreshHistory(false);
    await selectRun(run.id);
  } catch (error) { formMessage(error.message, true); }
  finally { submitting = false; updateStart(); }
});
$('cancel-button').addEventListener('click', async () => {
  if (!currentRun?.id || cancelling) return;
  cancelling = true; $('cancel-button').disabled = true;
  const id = currentRun.id;
  try {
    await api(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    formMessage('Cancellation requested. The server will report the final state.');
    if (id === selectedId) { clearTimeout(pollTimer); await refreshRun(id); }
  } catch (error) { formMessage(error.message, true); }
  finally { cancelling = false; if (currentRun?.id === id) $('cancel-button').disabled = false; }
});
$('copy-result').addEventListener('click', async () => {
  if (currentResult === null || currentResult === undefined) return;
  try { await navigator.clipboard.writeText(stringValue(currentResult)); $('copy-result').textContent = 'Copied'; }
  catch { formMessage('Copy is unavailable in this browser. Select the result text or export the run JSON.', true); }
});
$('export-button').addEventListener('click', () => {
  if (!currentRun) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(currentRun, null, 2) + '\n'], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = `topic-council-${String(currentRun.id).replace(/[^a-z0-9_-]/gi, '')}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('refresh-history').addEventListener('click', async () => { await refreshStatus(); await refreshHistory(false); if (selectedId) await selectRun(selectedId); });
window.addEventListener('beforeunload', () => clearTimeout(pollTimer));
$('history-empty').textContent = 'Loading local runs…';
await refreshStatus();
await refreshHistory(true);
