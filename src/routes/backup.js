const router = require('express').Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { executarBackup, listarBackups, BACKUP_DIR } = require('../services/backup');
const path = require('path');
const fs = require('fs');

router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  res.json(listarBackups());
});

router.post('/run', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const r = await executarBackup();
    res.json({ success: true, ...r });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/download/:filename', requireAuth, requireRole('admin'), (req, res) => {
  const fname = req.params.filename;
  if (!fname.match(/^backup_[0-9T\-]+\.json$/)) return res.status(400).json({ error: 'Nome inválido.' });
  const file = path.join(BACKUP_DIR, fname);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.download(file);
});

router.delete('/:filename', requireAuth, requireRole('admin'), (req, res) => {
  const fname = req.params.filename;
  if (!fname.match(/^backup_[0-9T\-]+\.json$/)) return res.status(400).json({ error: 'Nome inválido.' });
  const file = path.join(BACKUP_DIR, fname);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ success: true });
});

module.exports = router;
