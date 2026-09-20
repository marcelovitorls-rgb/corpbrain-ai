const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { getDb } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { recordMaterialChange } = require('../lib/materialAudit');
const { extractFileText, PLAIN_TEXT_EXTS, OFFICE_EXTS } = require('../lib/extractText');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Extensões de documento/mídia aceitas na base de conhecimento. Bloqueia
// tipos executáveis/script (.exe, .sh, .html, .svg, .js, .php, etc.) que não
// têm uso legítimo aqui e reduzem a superfície de ataque do upload.
const ALLOWED_EXTENSIONS = new Set([
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.csv', '.txt', '.md', '.json', '.xml', '.log', '.yaml', '.yml',
    '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.zip'
]);

const MAGIC_SIGNATURES = {
    '.pdf': buffer => buffer.subarray(0, 5).toString('ascii') === '%PDF-',
    '.png': buffer => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    '.jpg': buffer => buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
    '.jpeg': buffer => buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
    '.gif': buffer => ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')),
    '.webp': buffer => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
    '.doc': buffer => buffer.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])),
    '.xls': buffer => buffer.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])),
    '.ppt': buffer => buffer.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])),
    '.docx': buffer => buffer.subarray(0, 2).toString('ascii') === 'PK',
    '.xlsx': buffer => buffer.subarray(0, 2).toString('ascii') === 'PK',
    '.pptx': buffer => buffer.subarray(0, 2).toString('ascii') === 'PK',
    '.zip': buffer => buffer.subarray(0, 2).toString('ascii') === 'PK'
};

// Configuração do multer
const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return cb(new Error(`Tipo de arquivo "${ext}" não permitido.`));
        }
        cb(null, true);
    }
});

/**
 * O multer/busboy decodifica o nome do arquivo do multipart/form-data como latin1
 * por padrão, então nomes com acentos (UTF-8) chegam corrompidos (mojibake).
 * Reinterpreta os bytes como UTF-8 para restaurar o nome original.
 */
function fixOriginalNameEncoding(name) {
    return Buffer.from(name, 'latin1').toString('utf8');
}

/**
 * Formata o tamanho do arquivo em unidades legíveis.
 * @param {number} bytes - Tamanho em bytes.
 * @returns {string} Tamanho formatado (ex: '2.4 MB', '540 KB').
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);
    return `${parseFloat(size.toFixed(i === 0 ? 0 : 1))} ${units[i]}`;
}

// Todas as rotas exigem autenticação
router.use(authMiddleware);

/**
 * GET /
 * Lista arquivos com filtro opcional por categoria (?category=key).
 */
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const { category } = req.query;

        let query = `
            SELECT
                f.id,
                f.category_id,
                c.key   AS category_key,
                c.label AS category_label,
                f.original_name,
                f.stored_name,
                f.description,
                f.tags,
                f.size,
                f.ext,
                f.mime_type,
                f.created_at
            FROM files f
            INNER JOIN categories c ON c.id = f.category_id
        `;
        const params = [];

        if (category) {
            query += ' WHERE c.key = ?';
            params.push(category);
        }

        query += ' ORDER BY f.created_at DESC';

        const files = db.prepare(query).all(...params);

        const data = files.map(file => ({
            ...file,
            tags: file.tags ? JSON.parse(file.tags) : [],
            size_formatted: formatFileSize(file.size)
        }));

        res.json(data);
    } catch (error) {
        console.error('Erro ao listar arquivos:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao listar arquivos.' });
    }
});

/**
 * POST /upload
 * Upload de arquivo (somente admin). Aceita campo 'file' (single) + 'category' (chave da categoria).
 */
router.post('/upload', adminMiddleware, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ success: false, message: 'Arquivo muito grande. Limite: 50MB.' });
            }
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        const db = getDb();
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Nenhum arquivo foi enviado.'
            });
        }

        const { category, description, tags } = req.body;

        if (!category) {
            // Remover arquivo órfão do disco
            fs.unlinkSync(req.file.path);
            return res.status(400).json({
                success: false,
                message: 'O campo "category" (chave da categoria) é obrigatório.'
            });
        }

        const cat = db.prepare('SELECT id FROM categories WHERE key = ?').get(category);
        if (!cat) {
            // Remover arquivo órfão do disco
            fs.unlinkSync(req.file.path);
            return res.status(404).json({
                success: false,
                message: 'Categoria não encontrada com a chave informada.'
            });
        }

        const originalName = fixOriginalNameEncoding(req.file.originalname);
        const ext = path.extname(originalName).toLowerCase();
        const signatureCheck = MAGIC_SIGNATURES[ext];
        if (signatureCheck && !signatureCheck(fs.readFileSync(req.file.path, { encoding: null, flag: 'r' }))) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, message: 'O conteúdo do arquivo não corresponde à extensão informada.' });
        }

        let extractedText = null;
        if (ext === '.pdf' || PLAIN_TEXT_EXTS.has(ext.slice(1)) || OFFICE_EXTS.has(ext.slice(1))) {
            const extracted = await extractFileText(req.file.path, ext);
            extractedText = extracted.text ? extracted.text.slice(0, 200000) : null;
        }

        const result = db.prepare(`
            INSERT INTO files (category_id, original_name, stored_name, description, tags, size, ext, mime_type, extracted_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            cat.id,
            originalName,
            req.file.filename,
            description || null,
            tags ? (typeof tags === 'string' ? tags : JSON.stringify(tags)) : null,
            req.file.size,
            ext,
            req.file.mimetype,
            extractedText
        );

        const savedFile = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid);
        recordMaterialChange(req, { action: 'upload', entityType: 'file', entityId: savedFile.id, entityName: savedFile.original_name, details: `Pasta: ${category}` });

        res.status(201).json({
            success: true,
            message: 'Arquivo enviado com sucesso.',
            data: {
                ...savedFile,
                tags: savedFile.tags ? JSON.parse(savedFile.tags) : [],
                size_formatted: formatFileSize(savedFile.size)
            }
        });
    } catch (error) {
        // Tentar remover arquivo do disco em caso de erro
        if (req.file && req.file.path) {
            try { fs.unlinkSync(req.file.path); } catch (_) { /* ignore */ }
        }
        console.error('Erro ao fazer upload:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao fazer upload do arquivo.' });
    }
});

/**
 * GET /:id/preview
 * Retorna o conte\u00fado textual de um arquivo para pr\u00e9-visualiza\u00e7\u00e3o.
 * Suporta PDF, PPTX, DOCX, XLSX (extra\u00e7\u00e3o de texto) e txt, csv, md, json etc.
 */
router.get('/:id/preview', async (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;

        const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
        if (!file) {
            return res.status(404).json({ error: 'Arquivo n\u00e3o encontrado.' });
        }

        const filePath = path.join(UPLOADS_DIR, file.stored_name);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Arquivo f\u00edsico n\u00e3o encontrado.' });
        }

        const ext = (file.ext || '').toLowerCase().replace('.', '');

        if (ext === 'pdf') {
            const { text, pages, error } = await extractFileText(filePath, ext);
            return res.json({
                type: 'pdf',
                text: error ? 'Não foi possível extrair o texto deste PDF.' : (text || 'PDF sem conteúdo de texto extraível.'),
                pages: pages || 0,
                info: {}
            });
        } else if (OFFICE_EXTS.has(ext)) {
            const { text, error } = await extractFileText(filePath, ext);
            return res.json({
                type: ext,
                text: error ? `Não foi possível extrair o texto deste ${ext.toUpperCase()}.` : (text || `${ext.toUpperCase()} sem conteúdo de texto extraível.`)
            });
        } else if (PLAIN_TEXT_EXTS.has(ext)) {
            const { text } = await extractFileText(filePath, ext);
            return res.json({
                type: ext,
                text
            });
        } else {
            return res.json({
                type: ext,
                text: null,
                message: 'Pr\u00e9-visualiza\u00e7\u00e3o n\u00e3o dispon\u00edvel para este tipo de arquivo.'
            });
        }
    } catch (error) {
        console.error('Erro ao gerar preview:', error);
        res.status(500).json({ error: 'Erro ao gerar pr\u00e9-visualiza\u00e7\u00e3o.' });
    }
});

/**
 * GET /:id/download
 * Faz o download de um arquivo pelo ID.
 */
router.get('/:id/download', (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;

        const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
        if (!file) {
            return res.status(404).json({
                success: false,
                message: 'Arquivo não encontrado.'
            });
        }

        const filePath = path.join(UPLOADS_DIR, file.stored_name);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: 'Arquivo físico não encontrado no servidor.'
            });
        }

        res.download(filePath, file.original_name);
    } catch (error) {
        console.error('Erro ao baixar arquivo:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao baixar o arquivo.' });
    }
});

/**
 * DELETE /:id
 * Remove um arquivo do banco e do disco (somente admin).
 */
router.delete('/:id', adminMiddleware, (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;

        const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
        if (!file) {
            return res.status(404).json({
                success: false,
                message: 'Arquivo não encontrado.'
            });
        }

        // Remover arquivo físico do disco
        const filePath = path.join(UPLOADS_DIR, file.stored_name);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (unlinkError) {
            console.error(`Erro ao remover arquivo físico "${file.stored_name}":`, unlinkError);
        }

        // Remover registro do banco
        db.transaction(() => db.prepare('DELETE FROM files WHERE id = ?').run(id));
        recordMaterialChange(req, { action: 'delete', entityType: 'file', entityId: file.id, entityName: file.original_name });

        res.json({
            success: true,
            message: `Arquivo "${file.original_name}" removido com sucesso.`
        });
    } catch (error) {
        console.error('Erro ao excluir arquivo:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao excluir o arquivo.' });
    }
});

module.exports = router;
