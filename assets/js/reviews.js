/* ======================================================
   JJ Paper — Reviews (Supabase)
   ====================================================== */

let currentStars = 0;

function setStars(n) {
  currentStars = n;
  document.querySelectorAll('.sb').forEach((b, i) => {
    b.style.color = i < n ? '#f59e0b' : '#ddd';
  });
}

async function submitReview() {
  const name = document.getElementById('rv-name')?.value.trim();
  const text = document.getElementById('rv-text')?.value.trim();
  if (!name || !text)  { showToast('Completa nombre y reseña', 'warn'); return; }
  if (!currentStars)   { showToast('Selecciona una puntuación', 'warn'); return; }

  const { error } = await sb.from('jjp_reviews').insert({
    name, stars: currentStars, text, approved: false,
  });
  if (error) { showToast('Error al enviar la reseña', 'err'); return; }

  document.getElementById('rv-name').value = '';
  document.getElementById('rv-text').value = '';
  currentStars = 0;
  setStars(0);
  showToast('¡Gracias! Tu reseña está pendiente de aprobación.');
}

async function loadReviews(limit = null) {
  const grid = document.getElementById('rvGrid');
  if (!grid) return;

  let query = sb.from('jjp_reviews')
    .select('name,stars,text,created_at')
    .eq('approved', true)
    .order('created_at', { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;

  if (error || !data?.length) {
    grid.innerHTML = `<p style="color:var(--gr);font-size:13px;text-align:center">Sé el primero en dejar una reseña.</p>`;
    return 0;
  }

  grid.innerHTML = data.map(r => {
    const stars = Math.max(0, Math.min(5, r.stars | 0));
    return `
    <div class="rv-card rv">
      <div class="rv-stars">${'★'.repeat(stars)}${'☆'.repeat(5-stars)}</div>
      <p class="rv-text">${escapeHTML(r.text)}</p>
      <div class="rv-auth">${escapeHTML(r.name)}
        <span class="rv-date"> · ${fmtDate(r.created_at)}</span>
      </div>
    </div>`;
  }).join('');

  observeReveal(grid);
  return data.length;
}
