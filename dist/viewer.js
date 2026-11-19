const byId = (id) => document.getElementById(id);
const canvas = byId('scene');
const stage = byId('stage');
const play = byId('play');
const seek = byId('seek');
const reset = byId('reset');
const chapters = [...document.querySelectorAll('[data-frame]')];
const lastFrame = 287;
const rate = 24;
const limit = (value, min, max) => Math.max(min, Math.min(max, value));
const requestedFrame = new URLSearchParams(location.search).get('frame');
let frame = /^\d{1,3}$/.test(requestedFrame ?? '') ? limit(Number(requestedFrame), 0, lastFrame) : 0;
let world, playing = false, epoch = 0, animation = 0, dirty = true, drag;
let width = 0;
function controls() {
  seek.value = frame;
  seek.style.setProperty('--fraction', (100 * frame / lastFrame) + '%');
  seek.setAttribute('aria-valuetext', (frame / rate).toFixed(2) + ' 秒');
  byId('time').textContent = '00:' + String(frame === lastFrame ? 12 : Math.floor(frame / rate)).padStart(2, '0');
  play.setAttribute('aria-label', playing ? '暂停漫游' : '开始漫游');
  byId('playIcon').setAttribute('d', playing ? 'M6 4h4v16H6zm8 0h4v16h-4z' : 'M7 4.8 20 12 7 19.2Z');
  const active = frame >= 192 ? 192 : frame >= 168 ? 168 : 0;
  for (const button of chapters) {
    if (+button.dataset.frame === active) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  reset.disabled = !world?.lookingAround;
}
function invalidate() {
  dirty = true;
  if (world && !animation) animation = requestAnimationFrame(draw);
}
function draw(now) {
  animation = 0;
  if (!world) return;
  if (playing) {
    const next = Math.floor((now - epoch) * rate / 1000);
    if (next > lastFrame) playing = false;
    const bounded = limit(next, 0, lastFrame);
    dirty ||= frame !== bounded;
    frame = bounded;
  }
  if (dirty) {
    world.render(frame);
    dirty = false;
  }
  controls();
  if (playing) animation = requestAnimationFrame(draw);
}
function toggle() {
  if (!world) return;
  playing = !playing;
  if (playing) {
    if (frame === lastFrame) frame = 0;
    epoch = performance.now() - frame * 1000 / rate;
  }
  controls();
  invalidate();
}
function jump(value) {
  playing = false;
  frame = limit(Math.round(value), 0, lastFrame);
  controls();
  invalidate();
}
function resetLook() {
  if (!world) return;
  world.resetLook();
  controls();
  invalidate();
}
function resize() {
  if (!world) return;
  const bounds = canvas.getBoundingClientRect();
  const size = limit(Math.round(Math.min(bounds.width, bounds.height * 975 / 984) * Math.min(devicePixelRatio, 1.65)), 325, 1300);
  if (size === width) return;
  width = size;
  world.resize(width, Math.round(width * 984 / 975));
  invalidate();
}
function failure(text) {
  cancelAnimationFrame(animation);
  animation = 0;
  playing = false;
  world = undefined;
  for (const control of [play, seek, ...chapters]) control.disabled = true;
  controls();
  byId('loading').hidden = false;
  byId('message').textContent = text;
  document.querySelector('.spinner').hidden = true;
  byId('retry').hidden = false;
}
byId('retry').onclick = () => location.reload();
play.onclick = toggle;
seek.oninput = () => jump(Number(seek.value));
for (const button of chapters) button.onclick = () => jump(Number(button.dataset.frame));
reset.onclick = resetLook;
canvas.addEventListener('pointerdown', event => {
  if (!world || !event.isPrimary || event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, orientation: world.orientation(), moved: false };
});
canvas.addEventListener('pointermove', event => {
  if (drag?.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag.moved ||= Math.hypot(dx, dy) > 4;
  if (drag.moved) {
    const radiansPerPixel = Math.PI / Math.min(canvas.clientWidth, canvas.clientHeight);
    world.rotateFrom(drag.orientation, dx * radiansPerPixel, dy * radiansPerPixel);
    invalidate();
  }
});
canvas.addEventListener('pointerup', event => {
  if (drag?.id !== event.pointerId) return;
  if (!drag.moved) toggle();
  drag = undefined;
});
canvas.addEventListener('lostpointercapture', () => { drag = undefined; });
document.addEventListener('keydown', event => {
  if (!world || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('button, input, a')) return;
  const direction = { ArrowLeft: [.04, 0], ArrowRight: [-.04, 0], ArrowUp: [0, .04], ArrowDown: [0, -.04] }[event.key];
  if (event.key === ' ') toggle();
  else if (event.target === canvas && direction) {
    world.rotateFrom(world.orientation(), direction[0], direction[1]);
    invalidate();
  }
  else if (event.target === canvas && event.key === 'Home') resetLook();
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') jump(frame + (event.key === 'ArrowLeft' ? -1 : 1));
  else return;
  event.preventDefault();
});
byId('full').hidden = !stage.requestFullscreen || !document.fullscreenEnabled;
byId('full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen()).catch(() => {});
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) toggle(); });
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  failure('图形连接已中断。请重新载入场景。');
});
controls();
try {
  const { createScene } = await import('./scene.js');
  world = await createScene(canvas, { high: innerWidth > 760 });
  resize();
  // Finish the first draw before enabling navigation.
  cancelAnimationFrame(animation);
  draw(performance.now());
  for (const control of [play, seek, ...chapters]) control.disabled = false;
  byId('loading').hidden = true;
  new ResizeObserver(resize).observe(canvas);
} catch (error) {
  console.error(error);
  failure('实时场景加载失败。请确认网络正常，并使用支持 WebGL 2 的浏览器。');
}
