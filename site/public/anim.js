/* Starts a scene when it is on screen and stops it when it is not. One button pauses every scene (animation that runs for more than a few seconds needs a way to stop). */
(() => {
  const scenes = [...document.querySelectorAll('.ill')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('in', e.isIntersecting)), { threshold: 0.35 });
    scenes.forEach((s) => io.observe(s));
  } else scenes.forEach((s) => s.classList.add('in'));
  const btn = document.getElementById('motion');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const off = document.body.classList.toggle('motion-off');
    btn.setAttribute('aria-pressed', String(off));
    btn.textContent = off ? 'Play animations' : 'Pause animations';
  });
})();
