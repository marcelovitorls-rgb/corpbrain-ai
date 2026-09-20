const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { getDb } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { recordMaterialChange } = require('../lib/materialAudit');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Todas as rotas exigem autenticação
router.use(authMiddleware);

/**
 * GET /
 * Lista todas as categorias com contagem de arquivos.
 */
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const categories = db.prepare(`
            SELECT
                c.id,
                c.key,
                c.label,
                c.description,
                c.icon,
                c.color,
                c.created_at,
                COUNT(f.id) AS file_count
            FROM categories c
            LEFT JOIN files f ON f.category_id = c.id
            GROUP BY c.id
            ORDER BY c.label ASC
        `).all();

        res.json(categories);
    } catch (error) {
        console.error('Erro ao listar categorias:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao listar categorias.' });
    }
});

/**
 * POST /
 * Cria uma nova categoria (somente admin).
 */
router.post('/', adminMiddleware, (req, res) => {
    try {
        const db = getDb();
        const { key, label, description, icon, color } = req.body;

        if (!key || !label) {
            return res.status(400).json({
                success: false,
                message: 'Os campos "key" e "label" são obrigatórios.'
            });
        }

        const existing = db.prepare('SELECT id FROM categories WHERE key = ?').get(key);
        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'Já existe uma categoria com essa chave.'
            });
        }

        const result = db.prepare(`
            INSERT INTO categories (key, label, description, icon, color)
            VALUES (?, ?, ?, ?, ?)
        `).run(key, label, description || null, icon || null, color || null);

        const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
        recordMaterialChange(req, { action: 'create', entityType: 'category', entityId: category.id, entityName: category.label });

        res.status(201).json({
            success: true,
            message: 'Categoria criada com sucesso.',
            data: category
        });
    } catch (error) {
        console.error('Erro ao criar categoria:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao criar categoria.' });
    }
});

/**
 * PUT /:id
 * Atualiza uma categoria existente (somente admin).
 */
router.put('/:id', adminMiddleware, (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const { key, label, description, icon, color } = req.body;

        const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Categoria não encontrada.'
            });
        }

        if (key && key !== category.key) {
            const duplicate = db.prepare('SELECT id FROM categories WHERE key = ? AND id != ?').get(key, id);
            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    message: 'Já existe outra categoria com essa chave.'
                });
            }
        }

        db.prepare(`
            UPDATE categories
            SET key = ?, label = ?, description = ?, icon = ?, color = ?
            WHERE id = ?
        `).run(
            key || category.key,
            label || category.label,
            description !== undefined ? description : category.description,
            icon !== undefined ? icon : category.icon,
            color !== undefined ? color : category.color,
            id
        );

        const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
        recordMaterialChange(req, { action: 'update', entityType: 'category', entityId: updated.id, entityName: updated.label });

        res.json({
            success: true,
            message: 'Categoria atualizada com sucesso.',
            data: updated
        });
    } catch (error) {
        console.error('Erro ao atualizar categoria:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao atualizar categoria.' });
    }
});

/**
 * DELETE /:id
 * Remove uma categoria e todos os seus arquivos do disco e do banco (somente admin).
 */
router.delete('/:id', adminMiddleware, (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;

        const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Categoria não encontrada.'
            });
        }

        // Buscar todos os arquivos da categoria para remoção física
        const files = db.prepare('SELECT stored_name FROM files WHERE category_id = ?').all(id);

        // Remover arquivos físicos do disco
        for (const file of files) {
            const filePath = path.join(UPLOADS_DIR, file.stored_name);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (unlinkError) {
                console.error(`Erro ao remover arquivo físico "${file.stored_name}":`, unlinkError);
            }
        }

        // Remover registros do banco
        db.transaction(() => {
            db.prepare('DELETE FROM files WHERE category_id = ?').run(id);
            db.prepare('DELETE FROM categories WHERE id = ?').run(id);
        });
        recordMaterialChange(req, { action: 'delete', entityType: 'category', entityId: category.id, entityName: category.label, details: `${files.length} arquivo(s) removido(s)` });

        res.json({
            success: true,
            message: `Categoria "${category.label}" e ${files.length} arquivo(s) removidos com sucesso.`
        });
    } catch (error) {
        console.error('Erro ao excluir categoria:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao excluir categoria.' });
    }
});

module.exports = router;
