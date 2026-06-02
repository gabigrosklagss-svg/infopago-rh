const router = require('express').Router();
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { supabase } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

/* ── Status do 2FA do usuário logado ─────────────────── */
router.get('/status', requireAuth, async (req, res) => {
  const { data } = await supabase.from('auth_2fa')
    .select('ativado, ativado_em, last_used_at').eq('user_id', req.user.id).maybeSingle();
  res.json({
    enabled: !!data?.ativado,
    ativado_em: data?.ativado_em || null,
    last_used_at: data?.last_used_at || null,
  });
});

/* ── Setup: gera secret + QR ─────────────────────────── */
router.post('/setup', requireAuth, async (req, res) => {
  const userEmail = req.user.email || 'user';
  const secret = speakeasy.generateSecret({
    name: `InfoPago RH (${userEmail})`,
    issuer: 'InfoPago RH',
    length: 32,
  });

  // Guarda o secret SEM ativar (só ativa depois de confirmar com código)
  await supabase.from('auth_2fa').upsert({
    user_id: req.user.id,
    secret: secret.base32,
    ativado: false,
  }, { onConflict: 'user_id' });

  // Gera QR code data URL
  const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  res.json({
    secret: secret.base32,
    qr_code: qrCodeDataUrl,
    otpauth_url: secret.otpauth_url,
  });
});

/* ── Verifica e ativa o 2FA ──────────────────────────── */
router.post('/verify-setup', requireAuth, async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ error: 'Código obrigatório.' });

  const { data } = await supabase.from('auth_2fa').select('secret').eq('user_id', req.user.id).maybeSingle();
  if (!data?.secret) return res.status(404).json({ error: 'Setup não iniciado. Chame /setup antes.' });

  const verified = speakeasy.totp.verify({
    secret: data.secret, encoding: 'base32', token: codigo, window: 1,
  });
  if (!verified) return res.status(400).json({ error: 'Código inválido.' });

  // Gera 10 backup codes (8 dígitos cada)
  const backupCodes = Array.from({ length: 10 }, () =>
    crypto.randomBytes(4).toString('hex').slice(0, 8).toUpperCase()
  );
  const backupHashes = backupCodes.map(c => crypto.createHash('sha256').update(c).digest('hex'));

  await supabase.from('auth_2fa').update({
    ativado: true,
    ativado_em: new Date().toISOString(),
    backup_codes: backupHashes,
  }).eq('user_id', req.user.id);

  res.json({ success: true, backup_codes: backupCodes });
});

/* ── Desativa 2FA (exige código atual) ──────────────── */
router.post('/disable', requireAuth, async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ error: 'Código obrigatório.' });

  const { data } = await supabase.from('auth_2fa').select('secret').eq('user_id', req.user.id).maybeSingle();
  if (!data) return res.status(404).json({ error: '2FA não está ativo.' });

  const verified = speakeasy.totp.verify({
    secret: data.secret, encoding: 'base32', token: codigo, window: 1,
  });
  if (!verified) return res.status(400).json({ error: 'Código inválido.' });

  await supabase.from('auth_2fa').delete().eq('user_id', req.user.id);
  res.json({ success: true });
});

/* ── Validação durante o login (passo 2) ─────────────── */
router.post('/login-verify', async (req, res) => {
  const { pending_token, codigo } = req.body;
  if (!pending_token || !codigo) {
    return res.status(400).json({ error: 'pending_token e codigo são obrigatórios.' });
  }

  // Limpa expirados
  await supabase.from('auth_2fa_pending').delete().lt('expires_at', new Date().toISOString());

  const { data: pend } = await supabase.from('auth_2fa_pending')
    .select('user_id, expires_at').eq('token', pending_token).maybeSingle();
  if (!pend) return res.status(401).json({ error: 'Token expirado. Faça login novamente.', code: 'EXPIRED' });

  const { data: cfg } = await supabase.from('auth_2fa').select('secret, backup_codes').eq('user_id', pend.user_id).maybeSingle();
  if (!cfg) return res.status(400).json({ error: '2FA não configurado.' });

  let verified = speakeasy.totp.verify({
    secret: cfg.secret, encoding: 'base32', token: codigo, window: 1,
  });
  let usedBackup = false;

  // Se TOTP falhou, tenta backup code
  if (!verified) {
    const codigoHash = crypto.createHash('sha256').update(codigo.toUpperCase().trim()).digest('hex');
    const codes = cfg.backup_codes || [];
    if (codes.includes(codigoHash)) {
      verified = true;
      usedBackup = true;
      // Remove o código usado
      await supabase.from('auth_2fa').update({
        backup_codes: codes.filter(c => c !== codigoHash),
      }).eq('user_id', pend.user_id);
    }
  }

  if (!verified) return res.status(401).json({ error: 'Código incorreto.', code: 'INVALID_2FA' });

  // Consome o pending_token
  await supabase.from('auth_2fa_pending').delete().eq('token', pending_token);
  await supabase.from('auth_2fa').update({ last_used_at: new Date().toISOString() }).eq('user_id', pend.user_id);

  // Emite tokens reais via Supabase Admin (gera magic link → session)
  // Simplificação: aqui já que o user já logou com senha (validado no passo 1),
  // retornamos um token de sessão buscando direto.
  // Como o Supabase Auth não permite gerar token sem a senha, guardamos a session do passo 1.
  const { data: sess } = await supabase.from('auth_2fa_pending_session')
    .select('access_token, refresh_token, expires_at, user_data').eq('pending_token', pending_token).maybeSingle();
  if (sess) {
    await supabase.from('auth_2fa_pending_session').delete().eq('pending_token', pending_token);
    return res.json({
      token: sess.access_token,
      refresh_token: sess.refresh_token,
      expires_at: sess.expires_at,
      user: sess.user_data,
      used_backup: usedBackup,
    });
  }

  res.status(500).json({ error: 'Sessão do login não encontrada.' });
});

module.exports = router;
