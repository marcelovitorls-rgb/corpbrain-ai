const express = require('express');
const { getDb } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

router.get('/', (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
        const logs = getDb().prepare(`
            SELECT id, user_id, user_name, action, entity_type, entity_id, entity_name, details, created_at
            FROM material_audit_logs ORDER BY id DESC LIMIT ?
        `).all(limit);
        res.json({ logs });
    } catch (error) {
        console.error('Erro ao listar log de materiais:', error);
        res.status(500).json({ error: 'Não foi possível carregar o log de alterações.' });
    }
});

module.exports = router;
