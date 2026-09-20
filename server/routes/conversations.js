const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

const MAX_MESSAGES = 200;
const MAX_PAYLOAD_CHARS = 200000;

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT id, title, messages, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
  res.json({ conversations: rows.map(row => ({ ...row, messages: JSON.parse(row.messages || '[]') })) });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { title, messages } = req.body || {};
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || typeof title !== 'string' || !title.trim() || !Array.isArray(messages) || messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: 'Conversa inválida.' });
  }
  const safeMessages = messages.filter(m => m && (m.role === 'user' || m.role === 'ai') && typeof m.text === 'string')
    .slice(-MAX_MESSAGES).map(m => ({ role: m.role, text: m.text.slice(0, 12000), sources: Array.isArray(m.sources) ? m.sources.slice(0, 20).map(String) : [], time: typeof m.time === 'string' ? m.time.slice(0, 30) : '' }));
  const payload = JSON.stringify(safeMessages);
  if (payload.length > MAX_PAYLOAD_CHARS) return res.status(413).json({ error: 'Conversa muito grande.' });
  const db = getDb();
  const existing = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (existing) {
    db.prepare('UPDATE conversations SET title = ?, messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(title.trim().slice(0, 200), payload, id, req.user.id);
  } else {
    db.prepare('INSERT INTO conversations (id, user_id, title, messages) VALUES (?, ?, ?, ?)').run(id, req.user.id, title.trim().slice(0, 200), payload);
  }
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  getDb().prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

router.delete('/', (req, res) => {
  getDb().prepare('DELETE FROM conversations WHERE user_id = ?').run(req.user.id);
  res.json({ success: true });
});

module.exports = router;
