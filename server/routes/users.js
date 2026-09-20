const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 10;

// Todas as rotas de usuários requerem autenticação + permissão de admin
router.use(authMiddleware, adminMiddleware);

/**
 * GET /
 * Lista todos os usuários (sem o campo de senha).
 */
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const users = db.prepare(
      'SELECT id, email, role, name, initials, title, created_at FROM users'
    ).all();

    res.json({ users });
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({
      error: 'Erro interno do servidor.'
    });
  }
});

/**
 * POST /
 * Cria um novo usuário. Exige email, password, role, name, initials e title.
 */
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { email, password, role, name, initials, title } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        error: 'E-mail, senha e nome são obrigatórios.'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'A senha deve ter no mínimo 8 caracteres.'
      });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

    if (existing) {
      return res.status(409).json({
        error: 'Já existe um usuário com este e-mail.'
      });
    }

    const hashedPassword = bcrypt.hashSync(password, BCRYPT_ROUNDS);

    const result = db.prepare(
      `INSERT INTO users (email, password, role, name, initials, title, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(email, hashedPassword, role || 'user', name, initials || '', title || '');

    const user = db.prepare(
      'SELECT id, email, role, name, initials, title, created_at FROM users WHERE id = ?'
    ).get(result.lastInsertRowid);

    res.status(201).json({ user });
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    res.status(500).json({
      error: 'Erro interno do servidor.'
    });
  }
});

/**
 * PUT /:id
 * Atualiza um usuário existente. Se a senha for fornecida, ela será re-hashada.
 */
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { email, password, role, name, initials, title } = req.body;
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    if (!existing) {
      return res.status(404).json({
        error: 'Usuário não encontrado.'
      });
    }

    if (email && email !== existing.email) {
      const emailTaken = db.prepare(
        'SELECT id FROM users WHERE email = ? AND id != ?'
      ).get(email, id);

      if (emailTaken) {
        return res.status(409).json({
          error: 'Já existe um usuário com este e-mail.'
        });
      }
    }

    if (password && password.length < 8) {
      return res.status(400).json({
        error: 'A senha deve ter no mínimo 8 caracteres.'
      });
    }

    const updatedPassword = password
      ? bcrypt.hashSync(password, BCRYPT_ROUNDS)
      : existing.password;

    db.prepare(
      `UPDATE users
       SET email = ?, password = ?, role = ?, name = ?, initials = ?, title = ?,
           must_change_password = CASE WHEN ? IS NOT NULL THEN 1 ELSE must_change_password END,
           auth_version = CASE WHEN ? IS NOT NULL THEN auth_version + 1 ELSE auth_version END
       WHERE id = ?`
    ).run(
      email || existing.email,
      updatedPassword,
      role || existing.role,
      name || existing.name,
      initials !== undefined ? initials : existing.initials,
      title !== undefined ? title : existing.title,
      password || null,
      password || null,
      id
    );

    const user = db.prepare(
      'SELECT id, email, role, name, initials, title, created_at FROM users WHERE id = ?'
    ).get(id);

    res.json({ user });
  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
    res.status(500).json({
      error: 'Erro interno do servidor.'
    });
  }
});

/**
 * DELETE /:id
 * Remove um usuário. Não permite que o admin exclua a si mesmo.
 */
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    if (String(req.user.id) === String(id)) {
      return res.status(400).json({
        error: 'Você não pode excluir sua própria conta.'
      });
    }

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);

    if (!existing) {
      return res.status(404).json({
        error: 'Usuário não encontrado.'
      });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);

    res.json({ message: 'Usuário removido com sucesso.' });
  } catch (err) {
    console.error('Erro ao remover usuário:', err);
    res.status(500).json({
      error: 'Erro interno do servidor.'
    });
  }
});

module.exports = router;
