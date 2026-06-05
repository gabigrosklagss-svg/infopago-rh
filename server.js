const path = require('path');
const fs = require('fs');

// Carrega segredos da pasta protegida (secrets/.env), com fallback pro .env raiz
const secretsPath = path.join(__dirname, 'secrets', '.env');
const fallbackPath = path.join(__dirname, '.env');
if (fs.existsSync(secretsPath)) {
  require('dotenv').config({ path: secretsPath, override: true });
} else if (fs.existsSync(fallbackPath)) {
  require('dotenv').config({ path: fallbackPath, override: true });
  console.warn('⚠ .env na raiz — mova para secrets/.env para mais segurança');
} else {
  console.error('❌ Nenhum arquivo .env encontrado (procurei em secrets/.env e .env)');
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { supabase } = require('./src/config/supabase');
const { initScheduler } = require('./src/utils/scheduler');
const { auditLogger } = require('./src/middleware/audit');

const app = express();
const PORT = process.env.PORT || 3001;

// Helmet com CSP customizada (permite Chart.js CDN, Google Fonts, Supabase Storage)
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],  // permite onclick="...", onsubmit="..."
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://*.supabase.co", "https://viacep.com.br"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
}));

// CORS: apenas origens permitidas
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3001')
  .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // requests same-origin / cli
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) return cb(null, true);
    cb(new Error('Origem não permitida: ' + origin));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// Rate limits granulares por endpoint
const limitLogin   = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Muitas tentativas de login. Aguarde 15 minutos.', code: 'RATE_LIMITED' } });
const limitRefresh = rateLimit({ windowMs: 60 * 1000,      max: 30 });
const limitWrite   = rateLimit({ windowMs: 60 * 1000,      max: 60 });
const limitGeral   = rateLimit({ windowMs: 60 * 1000,      max: 300, standardHeaders: true });
const limitIA      = rateLimit({ windowMs: 60 * 1000,      max: 20 });
const limitEmail   = rateLimit({ windowMs: 60 * 1000,      max: 30 });

app.use('/api/auth/login',   limitLogin);
app.use('/api/auth/refresh', limitRefresh);
app.use('/api/agent',        limitIA);
app.use('/api/recruitment/parse-cv', limitIA);
app.use('/api/email',        limitEmail);
app.use('/api',              limitGeral);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de auditoria — registra todas as ações de escrita
app.use(auditLogger());

// Estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rotas API
app.use('/api/auth',        require('./src/routes/auth'));
app.use('/api/employees',   require('./src/routes/employees'));
app.use('/api/departments', require('./src/routes/departments'));
app.use('/api/positions',   require('./src/routes/positions'));
app.use('/api/payslips',    require('./src/routes/payslips'));
app.use('/api/email',       require('./src/routes/email'));
app.use('/api/reports',     require('./src/routes/reports'));
app.use('/api/settings',    require('./src/routes/settings'));
app.use('/api/warnings',    require('./src/routes/warnings'));
app.use('/api/absences',    require('./src/routes/absences'));
app.use('/api/documents',   require('./src/routes/documents'));
app.use('/api/time',        require('./src/routes/time'));
app.use('/api/vacation-requests', require('./src/routes/vacationRequests'));
app.use('/api/vacation-receipts', require('./src/routes/vacationReceipts'));
app.use('/api/checklists',  require('./src/routes/checklists'));
app.use('/api/help',        require('./src/routes/help'));
app.use('/api/agent',       require('./src/routes/agent'));
app.use('/api/terminations', require('./src/routes/terminations'));
app.use('/api/thirteenth',  require('./src/routes/thirteenth'));
app.use('/api/epis',        require('./src/routes/epis'));
app.use('/api/salary-plan', require('./src/routes/salaryPlan'));
app.use('/api/audit',       require('./src/routes/audit'));
app.use('/api/backup',      require('./src/routes/backup'));
app.use('/api/performance', require('./src/routes/performance'));
app.use('/api/recruitment', require('./src/routes/recruitment'));
app.use('/api/collective-vacations', require('./src/routes/collectiveVacations'));
app.use('/api/permissions', require('./src/routes/permissions'));
app.use('/api/cv-pool', require('./src/routes/cvPool'));
app.use('/api/events',  require('./src/routes/companyEvents'));
app.use('/api/2fa',           require('./src/routes/twofa'));
app.use('/api/signatures',    require('./src/routes/signatures'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/accounting',    require('./src/routes/accounting'));

// Endpoint público para confirmação de recebimento de holerite
app.get('/confirmar/:token', async (req, res) => {
  const { token } = req.params;
  const { data, error } = await supabase
    .from('email_logs')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('confirmation_token', token)
    .is('confirmed_at', null)
    .select()
    .maybeSingle();

  const ok = data && !error;
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Confirmação</title>
<style>body{font-family:-apple-system,sans-serif;background:#f5f7fb;display:grid;place-items:center;min-height:100vh;margin:0}
.box{background:#fff;padding:48px;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.08);text-align:center;max-width:480px}
h1{color:${ok ? '#1d6f42' : '#9c2a2a'};margin:0 0 16px}p{color:#555}</style></head>
<body><div class="box"><h1>${ok ? '✓ Recebimento confirmado' : 'Confirmação não encontrada'}</h1>
<p>${ok ? 'Obrigado! Seu RH foi notificado.' : 'O link expirou ou já foi utilizado.'}</p></div></body></html>`);
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Endpoint não encontrado.' });
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERRO]', err);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno do servidor.' });
});

// Captura crashes globais ANTES de matar o processo
process.on('uncaughtException', (err) => {
  console.error('[CRASH:uncaughtException]', err);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRASH:unhandledRejection]', reason);
});

app.listen(PORT, () => {
  console.log(`\n  ✅ InfoPago RH rodando em http://localhost:${PORT}`);
  console.log(`  📅 ${new Date().toLocaleString('pt-BR')}\n`);
  try { initScheduler(); } catch (e) { console.warn('Scheduler não iniciado:', e.message); }
});
