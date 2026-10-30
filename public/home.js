const legacy = { websites: '/website-builder', shopping: '/shopping', internships: '/internships' };
if (legacy[location.hash.slice(1)]) location.replace(legacy[location.hash.slice(1)]);
const video = document.querySelector('video'),
  toggle = document.querySelector('.motion-toggle'),
  reduced = matchMedia('(prefers-reduced-motion: reduce)');
function update() {
  toggle.textContent = video.paused ? 'Play motion' : 'Pause motion';
  toggle.setAttribute(
    'aria-label',
    video.paused ? 'Play background motion' : 'Pause background motion',
  );
}
function preference() {
  if (reduced.matches) {
    video.pause();
    video.classList.add('motion-reduced');
  } else {
    video.classList.remove('motion-reduced');
    void video.play().catch(() => {});
  }
  update();
}
toggle.onclick = () => {
  video.classList.remove('motion-reduced');
  if (video.paused) void video.play().catch(() => {});
  else video.pause();
};
video.addEventListener('play', update);
video.addEventListener('pause', update);
video.addEventListener('error', () => {
  video.hidden = true;
  toggle.hidden = true;
});
reduced.addEventListener('change', preference);
preference();
const menu = document.querySelector('.menu-toggle'),
  nav = document.querySelector('#site-nav');
menu.onclick = () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  nav.classList.toggle('is-open', open);
};
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    menu.click();
    menu.focus();
  }
});
