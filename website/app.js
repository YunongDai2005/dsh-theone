const recording = document.querySelector('#dsh-recording');
const still = document.querySelector('#dsh-still');
const toggle = document.querySelector('#demo-toggle');
let paused = false;
function setPaused(value) {
  if (value) {
    still.width = recording.naturalWidth;
    still.height = recording.naturalHeight;
    still.getContext('2d').drawImage(recording, 0, 0);
  }
  paused = value;
  recording.hidden = paused;
  still.hidden = !paused;
  toggle.textContent = paused ? '播放演示' : '暂停演示';
}
function ready() {
  toggle.disabled = false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) setPaused(true);
}
if (recording.complete && recording.naturalWidth) ready();
else recording.addEventListener('load', ready, { once: true });
toggle.addEventListener('click', () => setPaused(!paused));
document.querySelector('#copy').addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try { await navigator.clipboard.writeText('dsh-theone'); status.textContent = '已复制包名'; }
  catch { status.textContent = '请选中左侧 dsh-theone 手动复制。'; }
});
