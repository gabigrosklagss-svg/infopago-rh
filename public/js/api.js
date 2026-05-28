/* =====================================================
   API client + utilitários globais
   ===================================================== */

const API_BASE = '';

/* ── Premium layer: injeta CSS e inicializa tema antes de tudo ── */
(function injectPremium() {
  if (!document.querySelector('link[href="/css/premium.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/css/premium.css';
    document.head.appendChild(l);
  }
  // Tema: localStorage 'rh_theme' = 'light' | 'dark' | 'auto' (default)
  const pref = localStorage.getItem('rh_theme') || 'auto';
  const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const apply = (mode) => {
    const dark = mode === 'dark' || (mode === 'auto' && sysDark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  };
  apply(pref);
  // Reage a mudança no SO se estiver em auto
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('rh_theme') || 'auto') === 'auto') apply('auto');
    });
  }
})();

function setTheme(mode) {
  localStorage.setItem('rh_theme', mode);
  const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode === 'auto' && sysDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.getElementById('cmdk-overlay')?.remove();
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(cur === 'dark' ? 'light' : 'dark');
}

function getToken() { return localStorage.getItem('rh_token'); }
function setToken(t) { localStorage.setItem('rh_token', t); }
function getUser()  { try { return JSON.parse(localStorage.getItem('rh_user') || 'null'); } catch { return null; } }
function setUser(u) { localStorage.setItem('rh_user', JSON.stringify(u)); }
function logout() {
  localStorage.removeItem('rh_token');
  localStorage.removeItem('rh_user');
  location.href = '/login.html';
}

async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${endpoint}`, {
    ...options,
    headers,
    body: options.body && typeof options.body === 'object' && !(options.body instanceof FormData)
      ? JSON.stringify(options.body) : options.body,
  });

  if (res.status === 401) { logout(); throw new Error('Sessão expirada.'); }

  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = (data && data.error) || `Erro ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/* ── Toast (canto inferior direito) ───────────────────── */
function toast(message, type = 'info', title = '') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✓', error: '✕', warning: '', info: '' };
  const titles = { success: 'Sucesso', error: 'Erro', warning: 'Atenção', info: 'Aviso' };

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div class="toast-body">
      <strong>${title || titles[type] || titles.info}</strong>
      <small>${message}</small>
    </div>
    <button class="toast-close">×</button>
  `;
  const remove = () => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('.toast-close').onclick = remove;
  setTimeout(remove, type === 'error' ? 6000 : 4000);
  container.appendChild(el);
}

/* ── Validação de campos obrigatórios ────────────────── */
/**
 * Valida um <form> ou um conjunto de campos.
 *  - Campos com atributo `required` ficam vermelhos se estiverem vazios
 *  - Toast aparece no canto inferior direito listando os campos faltando
 * Retorna true se TUDO ok, false caso contrário.
 */
function validateForm(form) {
  const root = typeof form === 'string' ? document.querySelector(form) : form;
  if (!root) return true;

  const missing = [];

  // Limpa estado anterior
  root.querySelectorAll('.field.error').forEach(f => {
    f.classList.remove('error');
    const msg = f.querySelector('.field-error-msg');
    if (msg) msg.remove();
  });

  root.querySelectorAll('[required]').forEach(input => {
    const field = input.closest('.field') || input.parentElement;
    let valor = (input.value || '').trim();
    let invalido = !valor;

    // Tipos especiais
    if (!invalido) {
      if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) invalido = true;
      if (input.type === 'number' && isNaN(Number(valor))) invalido = true;
    }

    if (invalido) {
      field.classList.add('error');
      const labelEl = field.querySelector('label');
      const label = labelEl ? labelEl.textContent.replace(/\*/g, '').trim() : input.name || input.id || 'Campo';

      const msg = document.createElement('span');
      msg.className = 'field-error-msg';
      msg.textContent = 'Preenchimento obrigatório';
      field.appendChild(msg);

      // Remove o erro assim que o usuário começar a digitar
      input.addEventListener('input', function _h() {
        field.classList.remove('error');
        const m = field.querySelector('.field-error-msg');
        if (m) m.remove();
        input.removeEventListener('input', _h);
      });

      missing.push(label);
    }
  });

  if (missing.length) {
    const lista = missing.length > 3
      ? `${missing.slice(0, 3).join(', ')} e mais ${missing.length - 3}`
      : missing.join(', ');
    toast(`Preencha: ${lista}`, 'error', `${missing.length} campo(s) obrigatório(s) em falta`);

    // Foca o primeiro campo com erro
    const firstError = root.querySelector('.field.error input, .field.error select, .field.error textarea');
    if (firstError) firstError.focus();
    return false;
  }

  return true;
}

/* ── Form helpers ────────────────────────────────────── */
function formToObject(form) {
  const fd = new FormData(form);
  const obj = {};
  for (const [k, v] of fd.entries()) obj[k] = v;
  // Captura checkboxes não marcados (FormData não inclui)
  form.querySelectorAll('input[type="checkbox"]').forEach(c => {
    obj[c.name] = c.checked;
  });
  return obj;
}

function fillForm(form, data) {
  Object.entries(data || {}).forEach(([k, v]) => {
    const el = form.querySelector(`[name="${k}"]`);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : v;
  });
}

/* ── Formatadores ────────────────────────────────────── */
const fmt = {
  brl: (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  number: (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  data: (s) => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return s; } },
  dataHora: (s) => { if (!s) return '—'; try { return new Date(s).toLocaleString('pt-BR'); } catch { return s; } },
  cpf: (v) => (v || '').replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
  cnpj: (v) => (v || '').replace(/\D/g, '').replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'),
  cep: (v) => (v || '').replace(/\D/g, '').replace(/(\d{5})(\d{3})/, '$1-$2'),
  telefone: (v) => {
    const d = (v || '').replace(/\D/g, '');
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return v;
  },
  matricula: (v) => String(v || '').padStart(4, '0'),
  competencia: (mes, ano) => {
    const m = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${m[parseInt(mes) - 1] || '?'}/${ano}`;
  },
  idade: (data) => {
    if (!data) return '';
    const d = new Date(data);
    const hoje = new Date();
    let i = hoje.getFullYear() - d.getFullYear();
    if (hoje.getMonth() < d.getMonth() || (hoje.getMonth() === d.getMonth() && hoje.getDate() < d.getDate())) i--;
    return i;
  },
  tempo: (data) => {
    if (!data) return '';
    const d = new Date(data);
    const hoje = new Date();
    let anos = hoje.getFullYear() - d.getFullYear();
    let meses = hoje.getMonth() - d.getMonth();
    if (meses < 0) { anos--; meses += 12; }
    return `${anos}a ${meses}m`;
  },
};

/* ── Máscaras automáticas ────────────────────────────── */
function applyMask(input, type) {
  input.addEventListener('input', () => {
    const before = input.selectionStart;
    let v = input.value.replace(/\D/g, '');
    if (type === 'cpf') v = v.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    else if (type === 'cnpj') v = v.slice(0, 14).replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    else if (type === 'cep') v = v.slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
    else if (type === 'telefone') {
      v = v.slice(0, 11);
      if (v.length > 10) v = v.replace(/(\d{2})(\d{5})(\d{1,4})/, '($1) $2-$3');
      else if (v.length > 6) v = v.replace(/(\d{2})(\d{4})(\d{1,4})/, '($1) $2-$3');
      else if (v.length > 2) v = v.replace(/(\d{2})(\d{1,5})/, '($1) $2');
    }
    input.value = v;
  });
}

function initMasks(root = document) {
  root.querySelectorAll('[data-mask]').forEach(el => applyMask(el, el.dataset.mask));
}

/* ── Guard de auth ───────────────────────────────────── */
function requireAuth() {
  if (!getToken()) location.href = '/login.html';
}

/* ── Download autenticado (rotas /api/...) ──────────── */
async function downloadAuth(url, filename = 'arquivo') {
  showLoading();
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!r.ok) {
      const ct = r.headers.get('content-type') || '';
      const msg = ct.includes('json') ? (await r.json()).error : `Erro ${r.status}`;
      throw new Error(msg);
    }
    // Pega o nome do arquivo do Content-Disposition se houver
    const cd = r.headers.get('content-disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/i);
    if (match) filename = match[1];

    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    toast(err.message, 'error', 'Falha no download');
  } finally {
    hideLoading();
  }
}

/* ── Loading overlay ─────────────────────────────────── */
function showLoading() {
  if (document.querySelector('.loading-overlay')) return;
  const o = document.createElement('div');
  o.className = 'loading-overlay';
  o.innerHTML = '<div class="loading" style="width:48px;height:48px"></div>';
  document.body.appendChild(o);
}
function hideLoading() { document.querySelector('.loading-overlay')?.remove(); }

/* ── ViaCEP ──────────────────────────────────────────── */
async function buscarCEP(cep) {
  const c = (cep || '').replace(/\D/g, '');
  if (c.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${c}/json/`);
    const d = await r.json();
    return d.erro ? null : d;
  } catch { return null; }
}

/* ── Ícones SVG (Lucide stroke) ──────────────────────── */
const ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>`,
  employees: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  payslips: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`,
  time: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  vacation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 0-7-17"/><path d="M2 14h12"/><path d="M9 6v8"/><path d="M5 10v4"/><path d="M13 10v4"/></svg>`,
  email: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9z"/></svg>`,
  agent: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>`,
  reports: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21H3"/><path d="M5 21V11l4-4 4 4 7-7"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  hrdocs: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h6"/><path d="M9 11h2"/><path d="M9 19h6"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  recruit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
  perf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>`,
  ctc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
};

/* ── Sidebar (estilo executivo bancário) ──────────────── */
function renderSidebar(active) {
  const item = (key, href, label) => `<a href="${href}" class="${active === key ? 'active' : ''}">${ICONS[key]}<span>${label}</span></a>`;
  return `<aside class="sidebar">
    <div class="brand">
      <div class="brand-mark"></div>
      <div class="brand-text">
        <span class="name">Info<em>Pago</em></span>
        <span class="tag">RH · Folha</span>
      </div>
    </div>

    <div class="nav-group">
      <div class="nav-label">Análise</div>
      <nav>
        ${item('dashboard', '/dashboard.html', 'Painel executivo')}
        ${item('reports',   '/analytics.html', 'Relatórios analíticos')}
      </nav>
    </div>

    <div class="nav-group">
      <div class="nav-label">Cadastros</div>
      <nav>
        ${item('employees', '/employees.html', 'Funcionários')}
        ${item('agent',     '/agent.html',     'Agente IA · Cadastro')}
      </nav>
    </div>

    <div class="nav-group">
      <div class="nav-label">Gente &amp; Talentos</div>
      <nav>
        ${item('recruit', '/recruitment.html', 'Recrutamento &amp; Seleção')}
        ${item('perf',    '/performance.html', 'Avaliação de desempenho')}
        ${item('ctc',     '/ctc.html',         'Custo de Contratação')}
      </nav>
    </div>

    <div class="nav-group">
      <div class="nav-label">Jornada &amp; Férias</div>
      <nav>
        ${item('time',     '/time.html',     'Controle de ponto')}
        ${item('vacation', '/vacations.html','Solicitações de férias')}
      </nav>
    </div>

    <div class="nav-group">
      <div class="nav-label">Folha de pagamento</div>
      <nav>
        ${item('payslips', '/payslips.html', 'Holerites e Folha')}
        ${item('hrdocs',   '/hr-docs.html',  'Rescisão e 13º Salário')}
        ${item('email',    '/email-send.html', 'Envios e Agendamentos')}
        ${item('settings', '/settings.html', 'Departamentos e Cargos')}
      </nav>
    </div>

    ${getUser()?.role === 'admin' ? `<div class="nav-group">
      <div class="nav-label">Administração</div>
      <nav>
        ${item('admin', '/admin.html', 'Auditoria · Backup · EPIs')}
      </nav>
    </div>` : ''}

    <div class="sidebar-footer">
      <div class="sidebar-user-card" title="Ver perfil" onclick="abrirPerfilUsuario()" style="cursor:pointer">
        <div class="avatar">${getUser()?.avatar_url
          ? `<img src="${getUser().avatar_url}" alt="">`
          : (getUser()?.full_name || getUser()?.email || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}</div>
        <div class="info">
          <strong>${getUser()?.full_name || getUser()?.email?.split('@')[0] || ''}</strong>
          <small>${getUser()?.role || 'rh'}${getUser()?.role === 'admin' ? ' · master' : ''}</small>
        </div>
      </div>

      <button class="btn-sair" onclick="logout()" title="Encerrar sessão">
        ${ICONS.logout}
        <span>Sair do sistema</span>
      </button>

      <div class="sidebar-meta">
        <span class="env-badge">Produção</span>
        <span class="sidebar-version">v1.1</span>
      </div>
    </div>
  </aside>`;
}

/* ── Top Navbar Premium (busca + tema + notif + perfil) ─────── */
const ICON_SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const ICON_MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function renderTopbar() {
  return `<header class="topbar">
    <div class="topbar-search" onclick="abrirCommandPalette()">
      <input id="globalSearch" placeholder="Buscar página, funcionário, ação…  (Ctrl+K)" autocomplete="off" readonly style="cursor:pointer">
      <span class="kbd">⌘K</span>
    </div>

    <div class="topbar-actions">
      <button class="topbar-btn theme-toggle" title="Alternar tema (claro/escuro)" onclick="toggleTheme()">
        <span class="sun">${ICON_SUN}</span>
        <span class="moon">${ICON_MOON}</span>
      </button>
      <a href="/help.html" class="topbar-btn" title="Central de ajuda" style="text-decoration:none">${ICONS.help}</a>
      <button class="topbar-btn" title="Notificações" onclick="abrirNotificacoes(event)">
        ${ICONS.bell}<span class="dot" id="notif-dot" style="display:none"></span>
      </button>
    </div>
  </header>`;
}

/* ── Footer com status do sistema ─────────────────────── */
function renderFooter() {
  const now = new Date();
  const horaBackup = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `<footer class="app-footer">
    <span class="status-dot">Sistema operacional</span>
    <span class="sep">·</span>
    <span>Último backup: <span class="mono">${horaBackup}</span></span>
    <span class="spacer"></span>
    <span class="version">InfoPago RH v1.1.0</span>
  </footer>`;
}

function buildId() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

/* ── Mount shell — injeta sidebar + topbar + footer ──── */
function mountShell(activeNav) {
  // 1) Sidebar
  const sb = document.getElementById('sidebar');
  if (sb) sb.outerHTML = renderSidebar(activeNav);

  // 2) Wrap .main em .app-main (se ainda não tiver) + topbar + footer
  const main = document.querySelector('.main');
  if (!main) return;
  let appMain = main.parentElement;
  if (!appMain.classList.contains('app-main')) {
    const wrap = document.createElement('div');
    wrap.className = 'app-main';
    main.parentNode.insertBefore(wrap, main);
    wrap.appendChild(main);
    appMain = wrap;
  }

  // Topbar antes do .main
  if (!appMain.querySelector('.topbar')) {
    const tb = document.createElement('div');
    tb.innerHTML = renderTopbar();
    appMain.insertBefore(tb.firstElementChild, main);
  }
  // Footer depois do .main
  if (!appMain.querySelector('.app-footer')) {
    const ft = document.createElement('div');
    ft.innerHTML = renderFooter();
    appMain.appendChild(ft.firstElementChild);
  }

  // Ctrl/Cmd + K = abrir command palette
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      abrirCommandPalette();
    }
    if (e.key === 'Escape') {
      document.getElementById('cmdk-overlay')?.remove();
      document.getElementById('notif-panel')?.remove();
    }
  });

  // Busca de notificações em background
  carregarNotificacoes();
}

/* ── Command Palette (Cmd+K) ────────────────────── */
function abrirCommandPalette() {
  if (document.getElementById('cmdk-overlay')) return;
  const u = getUser();
  const ACTIONS = [
    { lbl: 'Dashboard', sub: 'Painel executivo', href: '/dashboard.html', grp: 'Análise', ico: ICONS.dashboard },
    { lbl: 'Relatórios analíticos', sub: 'KPIs e gráficos', href: '/analytics.html', grp: 'Análise', ico: ICONS.reports },
    { lbl: 'Funcionários', sub: 'Cadastro e edição', href: '/employees.html', grp: 'Cadastros', ico: ICONS.employees },
    { lbl: 'Agente IA · Ingrid', sub: 'Cadastro por chat', href: '/agent.html', grp: 'Cadastros', ico: ICONS.agent },
    { lbl: 'Recrutamento & Seleção', sub: 'Vagas e candidatos', href: '/recruitment.html', grp: 'Gente', ico: ICONS.recruit },
    { lbl: 'Avaliação de desempenho', sub: 'Ciclos e notas', href: '/performance.html', grp: 'Gente', ico: ICONS.perf },
    { lbl: 'Custo Total de Contratação', sub: 'Calculadora CTC', href: '/ctc.html', grp: 'Gente', ico: ICONS.ctc },
    { lbl: 'Controle de ponto', sub: 'Jornada e HE', href: '/time.html', grp: 'Jornada', ico: ICONS.time },
    { lbl: 'Solicitações de férias', sub: 'Inclui coletivas', href: '/vacations.html', grp: 'Jornada', ico: ICONS.vacation },
    { lbl: 'Holerites e Folha', sub: 'Geração e envio', href: '/payslips.html', grp: 'Folha', ico: ICONS.payslips },
    { lbl: 'Rescisão e 13º Salário', sub: 'TRCT e décimo', href: '/hr-docs.html', grp: 'Folha', ico: ICONS.hrdocs },
    { lbl: 'Envios e Agendamentos', sub: 'E-mail de holerites', href: '/email-send.html', grp: 'Folha', ico: ICONS.email },
    { lbl: 'Departamentos e Cargos', sub: 'Configuração', href: '/settings.html', grp: 'Folha', ico: ICONS.settings },
    { lbl: 'Tema: alternar claro/escuro', sub: 'Visual', action: 'toggleTheme()', grp: 'Configuração', ico: ICON_MOON },
    { lbl: 'Tema: seguir o sistema', sub: 'Automático', action: "setTheme('auto')", grp: 'Configuração', ico: ICON_SUN },
    { lbl: 'Meu perfil', sub: 'Foto e nome', action: 'abrirPerfilUsuario()', grp: 'Conta', ico: ICONS.employees },
    { lbl: 'Sair do sistema', sub: 'Logout', action: 'logout()', grp: 'Conta', ico: ICONS.logout },
  ];
  if (u?.role === 'admin') ACTIONS.push({ lbl: 'Administração', sub: 'Auditoria · Backup · EPIs', href: '/admin.html', grp: 'Admin', ico: ICONS.admin });

  const overlay = document.createElement('div');
  overlay.id = 'cmdk-overlay';
  overlay.className = 'cmdk-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div class="cmdk">
    <input class="cmdk-input" id="cmdk-input" placeholder="Buscar página, ação..." autocomplete="off">
    <div class="cmdk-list" id="cmdk-list"></div>
  </div>`;
  document.body.appendChild(overlay);

  const input = document.getElementById('cmdk-input');
  const list = document.getElementById('cmdk-list');
  let idx = 0;
  function render(q) {
    const norm = (q || '').toLowerCase().trim();
    const matches = !norm ? ACTIONS : ACTIONS.filter(a => (a.lbl + ' ' + a.sub + ' ' + a.grp).toLowerCase().includes(norm));
    if (!matches.length) { list.innerHTML = `<div class="cmdk-empty">Nada encontrado pra "${q}"</div>`; return; }
    list.innerHTML = matches.map((a, i) => `<div class="cmdk-item ${i === idx ? 'active' : ''}" data-i="${i}" data-href="${a.href || ''}" data-action="${a.action || ''}">
      ${a.ico} <div><div>${a.lbl}</div><div style="font-size:11px;color:var(--ink-4)">${a.sub}</div></div>
      <span class="grp">${a.grp}</span>
    </div>`).join('');
    list.querySelectorAll('.cmdk-item').forEach(el => {
      el.onclick = () => exec(matches[parseInt(el.dataset.i)]);
    });
  }
  function exec(a) {
    overlay.remove();
    if (a.href) location.href = a.href;
    else if (a.action) try { eval(a.action); } catch (e) { console.error(e); }
  }
  render('');
  input.focus();
  input.oninput = () => { idx = 0; render(input.value); };
  input.onkeydown = (e) => {
    const items = list.querySelectorAll('.cmdk-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); render(input.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); render(input.value); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const el = items[idx];
      if (el) el.click();
    }
  };
}

/* ── Notificações inteligentes ───────────────────── */
async function carregarNotificacoes() {
  try {
    const [fer, dat] = await Promise.all([
      api('/reports/vacation-alerts').catch(() => ({ vencidas: [], vence_30dias: [] })),
      api('/reports/key-dates').catch(() => ({ aniversariantes_mes: [], contratos_experiencia: [] })),
    ]);
    const hoje = new Date();
    const dia = hoje.getDate();
    const itens = [];

    fer.vencidas.forEach(f => itens.push({
      tipo: 'danger', titulo: `Férias vencidas: ${f.nome}`,
      sub: 'Risco de multa em dobro. Agende imediatamente.',
      href: '/vacations.html',
    }));
    fer.vence_30dias.slice(0, 5).forEach(f => itens.push({
      tipo: 'warn', titulo: `Férias vencem em ${f.dias_ate_vencimento}d: ${f.nome}`,
      sub: 'Próximo do limite de 12 meses do período aquisitivo.',
      href: '/vacations.html',
    }));
    dat.contratos_experiencia.slice(0, 5).forEach(c => itens.push({
      tipo: 'warn', titulo: `Contrato de experiência: ${c.nome_completo}`,
      sub: `${c.etapa} em ${fmt.data(c.data_evento)}. Decisão: efetivar ou desligar.`,
      href: '/employees.html',
    }));
    dat.aniversariantes_mes.filter(a => a.dia === dia).forEach(a => itens.push({
      tipo: 'info', titulo: `🎂 Aniversário hoje: ${a.nome_completo}`,
      sub: `${a.idade} anos. Lembre o time!`,
    }));

    window._notifs = itens;
    document.getElementById('notif-dot') && (document.getElementById('notif-dot').style.display = itens.length ? 'block' : 'none');
  } catch (e) {
    // silent
  }
}

function abrirNotificacoes(ev) {
  ev?.stopPropagation();
  const old = document.getElementById('notif-panel');
  if (old) { old.remove(); return; }
  const itens = window._notifs || [];
  const html = `<div class="notif-panel" id="notif-panel">
    <div class="notif-header"><h3>Notificações</h3><small style="color:var(--ink-4)">${itens.length} ativa(s)</small></div>
    <div class="notif-body">
      ${itens.length ? itens.map(n => `<div class="notif-item ${n.tipo}" ${n.href ? `onclick="location.href='${n.href}'"` : ''}>
        <div class="ico">${n.tipo === 'danger' ? '!' : n.tipo === 'warn' ? '⚠' : 'i'}</div>
        <div class="body"><strong>${n.titulo}</strong><small>${n.sub}</small></div>
      </div>`).join('')
      : `<div class="empty-state" style="padding:32px 16px"><div class="ill">${ICONS.bell}</div><h3>Tudo em ordem</h3><p>Sem alertas no momento.</p></div>`}
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  setTimeout(() => document.addEventListener('click', closeNotifOnce), 50);
}
function closeNotifOnce(e) {
  if (!e.target.closest('.notif-panel') && !e.target.closest('.topbar-btn')) {
    document.getElementById('notif-panel')?.remove();
    document.removeEventListener('click', closeNotifOnce);
  }
}

/* Compatibilidade retro: páginas antigas usam renderSidebar como innerHTML.
   Vamos detectar e migrar — se renderSidebar for chamada como string-assign,
   ela ainda retorna a sidebar; mas o ideal é a página chamar mountShell(). */

/* Handlers básicos das ações da topbar (legados) */
function abrirAjuda() { location.href = '/help.html'; }
function abrirMenuUsuario(ev) {
  ev?.stopPropagation();
  const old = document.getElementById('user-menu');
  if (old) { old.remove(); return; }
  const u = getUser();
  const m = document.createElement('div');
  m.id = 'user-menu';
  m.style.cssText = 'position:fixed;top:54px;right:20px;background:#fff;border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--sh-3);min-width:240px;z-index:1000;overflow:hidden;';
  m.innerHTML = `
    <div style="padding:14px 16px;border-bottom:1px solid var(--border);background:var(--paper-2)">
      <strong style="display:block;font-size:13px">${u?.full_name || u?.email}</strong>
      <small style="color:var(--ink-4);font-size:11px">${u?.email || ''}</small>
    </div>
    <a href="/settings.html" style="display:block;padding:10px 16px;font-size:13px;color:var(--ink);text-decoration:none">  Configurações</a>
    <button onclick="logout()" style="width:100%;text-align:left;padding:10px 16px;font-size:13px;color:var(--danger);background:transparent;border:0;border-top:1px solid var(--border);cursor:pointer;font-family:inherit">  Sair do sistema</button>`;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 100);
}

/* ── Modal de perfil do usuário ─────────────────────── */
function abrirPerfilUsuario() {
  const u = getUser();
  if (!u) return;
  const initials = (u.full_name || u.email || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  // Remove se já existe
  document.getElementById('user-profile-modal')?.remove();

  const m = document.createElement('div');
  m.id = 'user-profile-modal';
  m.className = 'modal-overlay';
  m.onclick = (e) => { if (e.target === m) m.remove(); };

  m.innerHTML = `
    <div class="modal" style="max-width:520px">
      <div class="modal-header">
        <h2>Meu perfil</h2>
        <button class="modal-close" onclick="document.getElementById('user-profile-modal').remove()">×</button>
      </div>
      <div class="modal-body">

        <div class="flex gap-4 items-center mb-4" style="padding-bottom:18px;border-bottom:1px solid var(--border)">
          <div id="profile-avatar" class="avatar-md" style="width:96px;height:96px;font-size:28px;flex-shrink:0">
            ${u.avatar_url
              ? `<img src="${u.avatar_url}?t=${Date.now()}">`
              : initials}
          </div>
          <div class="flex-1">
            <div style="font-weight:600;font-size:11px;color:var(--ink-2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Foto de perfil</div>
            <p class="text-muted text-sm" style="margin:0 0 8px">JPG, PNG ou WebP · máx. 5 MB</p>
            <div class="flex gap-2">
              <input type="file" id="profile-photo-input" accept="image/jpeg,image/png,image/webp" style="display:none">
              <button class="btn btn-sm btn-primary" onclick="document.getElementById('profile-photo-input').click()">Selecionar foto</button>
              ${u.avatar_url ? `<button class="btn btn-sm" onclick="removerFotoUsuario()">Remover</button>` : ''}
            </div>
          </div>
        </div>

        <form id="profileForm">
          <div class="form-grid">
            <div class="field" style="grid-column:span 2">
              <label>Nome completo</label>
              <input name="full_name" value="${(u.full_name || '').replace(/"/g, '&quot;')}" required>
            </div>
            <div class="field">
              <label>E-mail</label>
              <input value="${u.email || ''}" disabled style="background:var(--paper-3);color:var(--ink-4)">
            </div>
            <div class="field">
              <label>Permissão</label>
              <input value="${u.role || 'rh'}${u.role === 'admin' ? ' · master' : ''}" disabled style="background:var(--paper-3);color:var(--ink-4)">
            </div>
            <div class="field" style="grid-column:span 2">
              <label>Departamento</label>
              <input name="department" value="${(u.department || '').replace(/"/g, '&quot;')}" placeholder="Ex: Recursos Humanos">
            </div>
          </div>

          <div style="margin-top:16px;padding:10px 14px;background:var(--paper-3);border-radius:var(--r-sm);font-size:11.5px;color:var(--ink-3)">
            <strong>ID:</strong> <code style="font-size:11px">${u.id}</code><br>
            <strong>Cadastrado em:</strong> ${u.created_at ? fmt.dataHora(u.created_at) : '—'}
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="document.getElementById('user-profile-modal').remove()">Fechar</button>
        <button class="btn btn-primary" onclick="salvarPerfilUsuario()">Salvar alterações</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);

  // Listener pra upload de foto
  document.getElementById('profile-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('foto', file);
    showLoading();
    try {
      const r = await fetch('/api/auth/me/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Falha no upload');
      const data = await r.json();
      // Atualiza user local + sidebar + modal
      const u2 = getUser();
      u2.avatar_url = data.avatar_url;
      setUser(u2);
      document.getElementById('profile-avatar').innerHTML = `<img src="${data.avatar_url}?t=${Date.now()}">`;
      // Atualiza sidebar avatar
      const sbAvatar = document.querySelector('.sidebar-user-card .avatar');
      if (sbAvatar) sbAvatar.innerHTML = `<img src="${data.avatar_url}?t=${Date.now()}" alt="">`;
      toast('Foto atualizada!', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { hideLoading(); }
  });
}

async function removerFotoUsuario() {
  if (!confirm('Remover sua foto de perfil?')) return;
  showLoading();
  try {
    await api('/auth/me/avatar', { method: 'DELETE' });
    const u = getUser();
    u.avatar_url = null;
    setUser(u);
    const initials = (u.full_name || u.email || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
    const av = document.getElementById('profile-avatar');
    if (av) av.innerHTML = initials;
    const sbAvatar = document.querySelector('.sidebar-user-card .avatar');
    if (sbAvatar) sbAvatar.innerHTML = initials;
    toast('Foto removida.', 'success');
    // Re-render do modal pra esconder o botão "Remover"
    document.getElementById('user-profile-modal')?.remove();
    abrirPerfilUsuario();
  } catch (err) { toast(err.message, 'error'); }
  finally { hideLoading(); }
}

async function salvarPerfilUsuario() {
  const f = document.getElementById('profileForm');
  const data = formToObject(f);
  if (!data.full_name?.trim()) {
    toast('Nome é obrigatório.', 'warning');
    return;
  }
  showLoading();
  try {
    const r = await api('/auth/me', { method: 'PUT', body: { full_name: data.full_name, department: data.department || null } });
    const u = getUser();
    Object.assign(u, r);
    setUser(u);
    // Atualiza nome na sidebar imediatamente
    const sbName = document.querySelector('.sidebar-user-card .info strong');
    if (sbName) sbName.textContent = u.full_name || u.email?.split('@')[0] || '';
    toast('Perfil atualizado!', 'success');
    document.getElementById('user-profile-modal')?.remove();
  } catch (err) { toast(err.message, 'error'); }
  finally { hideLoading(); }
}

document.addEventListener('DOMContentLoaded', () => initMasks());
