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

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 200 }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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

app.listen(PORT, () => {
  console.log(`\n  ✅ InfoPago RH rodando em http://localhost:${PORT}`);
  console.log(`  📅 ${new Date().toLocaleString('pt-BR')}\n`);
  try { initScheduler(); } catch (e) { console.warn('Scheduler não iniciado:', e.message); }
});
