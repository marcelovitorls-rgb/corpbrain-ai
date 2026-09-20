const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { JWT_SECRET } = require('../config');

const INITIAL_CREDENTIALS_FILE = path.join(__dirname, '..', '.initial-credentials');
const SESSION_COOKIE = 'corpbrain_session';

function removeInitialCredential(email) {
  try {
    if (!fs.existsSync(INITIAL_CREDENTIALS_FILE)) return;
    const remaining = fs.readFileSync(INITIAL_CREDENTIALS_FILE, 'utf8')
      .split(/\r?\n/)
      .filter(line => line && !line.startsWith(`${email}=`));

    if (remaining.length === 0) {
      fs.unlinkSync(INITIAL_CREDENTIALS_FILE);
    } else {
      fs.writeFileSync(INITIAL_CREDENTIALS_FILE, `${remaining.join('\n')}\n`, { mode: 0o600 });
    }
  } catch (error) {
    // A senha já foi alterada; a limpeza do arquivo não deve desfazer a operação.
    console.error('Não foi possível limpar a credencial inicial:', error.message);
  }
}

const router = express.Router();

const JWT_EXPIRES_IN = '7d';

/** Limita tentativas de login por IP para dificultar força bruta de senha */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' }
});

/**
 * POST /login
 * Autentica o usuário com email e senha, retorna token JWT + dados do usuário.
 */
router.post('/login', loginLimiter, (req, res) => {
  try {
    const db = getDb();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'E-mail e senha são obrigatórios.'
      });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      return res.status(401).json({
        error: 'Credenciais inválidas.'
      });
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'Credenciais inválidas.'
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, authVersion: user.auth_version || 0 },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    const { password: _, ...userWithoutPassword } = user;

    res.json({
      user: userWithoutPassword
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({
      error: 'Erro interno do servidor.'
    });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  res.json({ success: true });
});

/**
 * GET /me
 * Retorna os dados do usuário autenticado (sem a senha).
 */
router.get('/me', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({
        error: 'Usuário não encontrado.'
      });
    }

    const { password: _, ...userWithoutPassword } = user;

    res.json({ user: userWithoutPassword });
  } catch (err) {
    console.error('Erro ao buscar usuário:', err);
    res.status(500).json({
      error: 'Erro interno do servidor.'
    });
  }
});

/**
 * PUT /password
 * Permite ao usuário substituir a senha temporária ou alterar a senha atual.
 */
router.put('/password', authMiddleware, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Informe a senha atual e uma nova senha com no mínimo 8 caracteres.' });
    }

    const db = getDb();
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
    if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(401).json({ error: 'Senha atual inválida.' });
    }

    db.prepare('UPDATE users SET password = ?, must_change_password = 0, auth_version = auth_version + 1 WHERE id = ?')
      .run(bcrypt.hashSync(newPassword, 10), req.user.id);
    removeInitialCredential(req.user.email);
    res.json({ success: true, message: 'Senha alterada com sucesso.' });
  } catch (err) {
    console.error('Erro ao alterar senha:', err);
    res.status(500).json({ error: 'Não foi possível alterar a senha.' });
  }
});

// Self-service profile: identity comes exclusively from the authenticated session.
router.put('/me', authMiddleware, (req, res) => {
  const { name, title, initials } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
      typeof title !== 'string' || title.trim().length > 100 ||
      typeof initials !== 'string' || initials.trim().length > 3) {
    return res.status(400).json({ error: 'Informe um nome (até 100 caracteres), cargo (até 100) e iniciais (até 3).' });
  }
  try {
    const db = getDb();
    const avatar = initials.trim().toLocaleUpperCase('pt-BR') || name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase('pt-BR');
    db.prepare('UPDATE users SET name = ?, title = ?, initials = ? WHERE id = ?')
      .run(name.trim(), title.trim(), avatar, req.user.id);
    const user = db.prepare('SELECT id, email, role, name, initials, title, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
  } catch (err) {
    console.error('Erro ao atualizar perfil:', err);
    res.status(500).json({ error: 'Não foi possível salvar o perfil. Tente novamente.' });
  }
});

module.exports = router;
