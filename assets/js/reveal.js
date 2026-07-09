/* ======================================================
   JJ Paper — Scroll Reveal (IntersectionObserver)
   ====================================================== */

// Elementos que se revelan: .rv clásico + variantes direccionales del motion pack
const REVEAL_SEL = '.rv, .rv-up, .rv-left, .rv-right, .rv-zoom';

function observeReveal(root = document) {
  if (!window.IntersectionObserver) {
    root.querySelectorAll(REVEAL_SEL).forEach(el => el.classList.add('vi'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('vi');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.08 });

  root.querySelectorAll(REVEAL_SEL).forEach(el => {
    if (!el.classList.contains('vi')) io.observe(el);
  });
}

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => observeReveal());
