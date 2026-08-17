const API = '';
let token = sessionStorage.getItem('admin_token') || null;

function headers() {
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

async function api(url, opts = {}) {
  if (!opts.headers) opts.headers = {};
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + url, opts);
  if (res.status === 401) { logout(); throw new Error('Neautorizováno'); }
  return res;
}

// Toast
function toast(msg, error = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (error ? ' error' : '');
  setTimeout(() => el.className = 'toast', 3000);
}

// Auth
async function login() {
  const pw = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  try {
    const res = await fetch(API + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if (!res.ok) {
      errEl.textContent = 'Nesprávné heslo';
      errEl.style.display = 'block';
      return;
    }
    const data = await res.json();
    token = data.token;
    sessionStorage.setItem('admin_token', token);
    showAdmin();
  } catch (e) {
    errEl.textContent = 'Chyba připojení';
    errEl.style.display = 'block';
  }
}

function logout() {
  token = null;
  sessionStorage.removeItem('admin_token');
  document.getElementById('login-screen').style.display = 'flex';
  document.querySelector('.admin-layout').style.display = 'none';
}

async function showAdmin() {
  document.getElementById('login-screen').style.display = 'none';
  document.querySelector('.admin-layout').style.display = 'block';
  switchTab('gallery');
}

async function checkSession() {
  if (!token) return;
  try {
    const res = await api('/api/settings');
    if (res.ok) { showAdmin(); return; }
  } catch (e) {}
  logout();
}

// Tabs
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'gallery') loadGallery();
  if (name === 'services') loadServices();
  if (name === 'reviews') loadReviews();
  if (name === 'settings') loadSettings();
}

// ========== GALLERY ==========

async function loadGallery() {
  const res = await api('/api/gallery');
  const items = await res.json();
  const grid = document.getElementById('gallery-grid');
  if (items.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-light);font-size:0.85rem;">Zatím žádné fotky. Nahrajte první!</p>';
    return;
  }
  grid.innerHTML = items.map(item => `
    <div class="gallery-admin-item">
      <img src="${item.image}" alt="${item.title || ''}">
      <div class="item-info">
        <span class="item-title">${item.title || 'Bez názvu'}</span>
        <button class="btn btn-danger" onclick="deleteGalleryItem('${item.id}')">Smazat</button>
      </div>
    </div>
  `).join('');
}

function initUploadZone() {
  const zone = document.getElementById('upload-zone');
  const input = document.getElementById('upload-input');

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
  });

  input.addEventListener('change', () => {
    if (input.files.length) uploadFile(input.files[0]);
    input.value = '';
  });
}

async function uploadFile(file) {
  const title = prompt('Název fotky (volitelné):') || '';
  const category = prompt('Kategorie (volitelné):') || '';
  const fd = new FormData();
  fd.append('image', file);
  fd.append('title', title);
  fd.append('category', category);

  try {
    const res = await fetch(API + '/api/gallery', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: fd
    });
    if (!res.ok) throw new Error();
    toast('Fotka nahrána');
    loadGallery();
  } catch (e) {
    toast('Chyba při nahrávání', true);
  }
}

async function deleteGalleryItem(id) {
  if (!confirm('Opravdu smazat tuto fotku?')) return;
  try {
    await api('/api/gallery/' + id, { method: 'DELETE' });
    toast('Fotka smazána');
    loadGallery();
  } catch (e) {
    toast('Chyba při mazání', true);
  }
}

// ========== SERVICES ==========

let servicesData = [];

async function loadServices() {
  const res = await api('/api/services');
  servicesData = await res.json();
  renderServices();
}

function renderServices() {
  const container = document.getElementById('services-list');
  container.innerHTML = servicesData.map((s, i) => `
    <div class="service-edit-card">
      <div class="service-edit-header">
        <h3>${s.title || 'Nová služba'}</h3>
        <button class="btn btn-danger" onclick="removeService(${i})">Odebrat</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Název</label>
          <input value="${esc(s.title)}" onchange="servicesData[${i}].title=this.value">
        </div>
        <div class="form-group">
          <label>Cena</label>
          <input value="${esc(s.price)}" onchange="servicesData[${i}].price=this.value">
        </div>
      </div>
      <div class="form-group">
        <label>Popis</label>
        <textarea onchange="servicesData[${i}].description=this.value">${esc(s.description)}</textarea>
      </div>
    </div>
  `).join('');
}

function addService() {
  servicesData.push({ id: Date.now().toString(36), title: '', description: '', price: '', icon: '' });
  renderServices();
}

function removeService(index) {
  if (!confirm('Odebrat tuto službu?')) return;
  servicesData.splice(index, 1);
  renderServices();
}

async function saveServices() {
  try {
    await api('/api/services', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(servicesData)
    });
    toast('Služby uloženy');
  } catch (e) {
    toast('Chyba při ukládání', true);
  }
}

// ========== REVIEWS ==========

async function loadReviews() {
  const res = await api('/api/reviews');
  const reviews = await res.json();
  const list = document.getElementById('reviews-list');
  if (reviews.length === 0) {
    list.innerHTML = '<p style="color:var(--text-light);font-size:0.85rem;">Zatím žádné recenze.</p>';
    return;
  }
  list.innerHTML = reviews.map(r => `
    <div class="review-admin-card">
      <div class="review-text">"${esc(r.text)}"</div>
      <div class="review-meta">
        <div>
          <div class="review-author">${esc(r.author)}</div>
          <div class="review-detail">${esc(r.detail)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <span class="review-stars-display">${'&#9733;'.repeat(r.stars)}</span>
          <button class="btn btn-danger" onclick="deleteReview('${r.id}')">Smazat</button>
        </div>
      </div>
    </div>
  `).join('');
}

function openReviewModal() {
  document.getElementById('review-modal').classList.add('active');
  document.getElementById('review-text').value = '';
  document.getElementById('review-author').value = '';
  document.getElementById('review-detail').value = '';
  document.getElementById('review-stars').value = '5';
}

function closeReviewModal() {
  document.getElementById('review-modal').classList.remove('active');
}

async function saveReview() {
  const text = document.getElementById('review-text').value.trim();
  const author = document.getElementById('review-author').value.trim();
  const detail = document.getElementById('review-detail').value.trim();
  const stars = document.getElementById('review-stars').value;

  if (!text || !author) { toast('Vyplňte text a autora', true); return; }

  try {
    await api('/api/reviews', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ text, author, detail, stars: parseInt(stars) })
    });
    closeReviewModal();
    toast('Recenze přidána');
    loadReviews();
  } catch (e) {
    toast('Chyba při ukládání', true);
  }
}

async function deleteReview(id) {
  if (!confirm('Smazat tuto recenzi?')) return;
  try {
    await api('/api/reviews/' + id, { method: 'DELETE' });
    toast('Recenze smazána');
    loadReviews();
  } catch (e) {
    toast('Chyba při mazání', true);
  }
}

// ========== SETTINGS ==========

async function loadSettings() {
  const res = await api('/api/settings');
  const s = await res.json();
  document.getElementById('set-email').value = s.email || '';
  document.getElementById('set-phone').value = s.phone || '';
  document.getElementById('set-instagram').value = s.instagram || '';
  document.getElementById('set-instagram-url').value = s.instagramUrl || '';
}

async function saveSettings() {
  const data = {
    email: document.getElementById('set-email').value,
    phone: document.getElementById('set-phone').value,
    instagram: document.getElementById('set-instagram').value,
    instagramUrl: document.getElementById('set-instagram-url').value
  };
  try {
    await api('/api/settings', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(data)
    });
    toast('Nastavení uloženo');
  } catch (e) {
    toast('Chyba při ukládání', true);
  }
}

async function changePassword() {
  const cur = document.getElementById('pw-current').value;
  const nw = document.getElementById('pw-new').value;
  if (!cur || !nw) { toast('Vyplňte obě pole', true); return; }
  if (nw.length < 4) { toast('Heslo musí mít alespoň 4 znaky', true); return; }
  try {
    const res = await api('/api/change-password', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ currentPassword: cur, newPassword: nw })
    });
    if (!res.ok) {
      const err = await res.json();
      toast(err.error || 'Chyba', true);
      return;
    }
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value = '';
    toast('Heslo změněno');
  } catch (e) {
    toast('Chyba při změně hesla', true);
  }
}

// Helpers
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  initUploadZone();
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });
  checkSession();
});
