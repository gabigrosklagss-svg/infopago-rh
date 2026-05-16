const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const nodemailer = require('nodemailer');

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('company_settings').select('*').eq('id', 1).single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.put('/', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body };
  delete payload.id; delete payload.created_at;
  ['smtp_port','dia_pagamento'].forEach(f => {
    if (payload[f] === '' || payload[f] == null) delete payload[f];
    else payload[f] = parseInt(payload[f]);
  });
  const { data, error } = await supabase.from('company_settings').update(payload).eq('id', 1).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/test-smtp', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { smtp_host, smtp_port, smtp_user, smtp_pass } = req.body;
  try {
    const transporter = nodemailer.createTransport({
      host: smtp_host || 'smtp.gmail.com',
      port: parseInt(smtp_port) || 587,
      secure: false,
      auth: { user: smtp_user, pass: smtp_pass },
    });
    await transporter.verify();
    res.json({ success: true, message: 'Conexão SMTP estabelecida com sucesso!' });
  } catch (err) {
    res.status(400).json({ success: false, error: `Falha SMTP: ${err.message}` });
  }
});

module.exports = router;
