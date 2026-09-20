const { getDb } = require('../database');

function recordMaterialChange(req, { action, entityType, entityId = null, entityName, details = null }) {
    const user = req.user || {};
    getDb().prepare(`
        INSERT INTO material_audit_logs
            (user_id, user_name, action, entity_type, entity_id, entity_name, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.id || null, user.name || user.email || 'Administrador', action, entityType, entityId, entityName, details);
}

module.exports = { recordMaterialChange };
