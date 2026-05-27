/**
 * Backup automatizado — dumpa todas as tabelas principais como JSON
 * em uma pasta protegida (backups/). Mantém últimos 30 backups.
 */
const fs = require('fs');
const path = require('path');
const { supabase } = require('../config/supabase');

const BACKUP_DIR = path.join(__dirname, '../../backups');

const TABELAS = [
  'company_settings',
  'user_profiles',
  'departments',
  'positions',
  'position_grades',
  'career_movements',
  'employees',
  'employee_documents',
  'payslips',
  'email_logs',
  'scheduled_sends',
  'absences',
  'vacations',
  'vacation_requests',
  'vacation_receipts',
  'salary_history',
  'warnings',
  'time_entries',
  'time_bank_balance',
  'process_checklists',
  'checklist_items',
  'useful_contacts',
  'announcements',
  'company_documents',
  'terminations',
  'thirteenth_salary',
  'epis',
  'epi_deliveries',
  'audit_logs',
];

async function executarBackup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const arquivo = path.join(BACKUP_DIR, `backup_${timestamp}.json`);

  const dump = { meta: { timestamp: new Date().toISOString(), versao: '1.1.0', tabelas: {} }, dados: {} };

  for (const tabela of TABELAS) {
    try {
      const { data, error } = await supabase.from(tabela).select('*');
      if (error) {
        dump.meta.tabelas[tabela] = { erro: error.message };
        continue;
      }
      dump.dados[tabela] = data || [];
      dump.meta.tabelas[tabela] = { registros: data?.length || 0 };
    } catch (err) {
      dump.meta.tabelas[tabela] = { erro: err.message };
    }
  }

  fs.writeFileSync(arquivo, JSON.stringify(dump, null, 2), 'utf8');
  const sizeMB = (fs.statSync(arquivo).size / 1024 / 1024).toFixed(2);

  // Retenção: mantém só os últimos 30
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
    .sort().reverse();
  for (let i = 30; i < files.length; i++) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, files[i])); } catch {}
  }

  console.log(`  [backup] ${arquivo} (${sizeMB} MB · ${TABELAS.length} tabelas)`);
  return { arquivo, sizeMB, tabelas: TABELAS.length, timestamp };
}

function listarBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { arquivo: f, tamanho_kb: Math.round(st.size / 1024), criado_em: st.mtime };
    })
    .sort((a, b) => b.criado_em - a.criado_em);
}

module.exports = { executarBackup, listarBackups, BACKUP_DIR };
