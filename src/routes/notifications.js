const router = require('express').Router();
const { requireAuth, authorize } = require('../middleware/auth');
const { supabase } = require('../config/supabase');
const { coletarAlertas, buildHTMLDigest, enviarDigestRH } = require('../services/notifications');

/* Preview do digest atual (HTML) */
router.get('/digest/preview', requireAuth, async (req, res) => {
  const alertas = await coletarAlertas();
  const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();
  res.send(buildHTMLDigest(alertas, company || {}));
});

/* Dados brutos do digest (JSON) */
router.get('/digest/data', requireAuth, async (req, res) => {
  const alertas = await coletarAlertas();
  res.json(alertas);
});

/* Dispara o envio manual (admin) */
router.post('/digest/send-now', requireAuth, authorize('email.send'), async (req, res) => {
  try {
    await enviarDigestRH();
    res.json({ success: true, message: 'Digest enviado para os destinatários cadastrados.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Log de envios anteriores */
router.get('/log', requireAuth, async (req, res) => {
  const { data } = await supabase.from('notification_log')
    .select('*').order('enviado_em', { ascending: false }).limit(50);
  res.json(data || []);
});

module.exports = router;
