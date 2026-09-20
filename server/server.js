const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Importa o inicializador do banco
const { initDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.secure) return next();
        if (req.path.startsWith('/api/')) return res.status(426).json({ error: 'HTTPS é obrigatório em produção.' });
        return res.redirect(`https://${req.headers.host}${req.originalUrl}`);
    });
}

// ============================================
// MIDDLEWARES GLOBAIS
// ============================================
// Headers de segurança (CSP restrita aos hosts que o frontend realmente usa:
// script do Lucide via unpkg e Google Fonts; 'unsafe-inline' em style-src é
// necessário porque a UI usa muitos atributos style="" inline).
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://unpkg.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// O frontend é servido pelo próprio Express (mesma origem), então a API não
// precisa de CORS aberto. Só habilita origens cruzadas se CORS_ORIGIN for
// definido explicitamente (lista separada por vírgula) — nunca por padrão.
const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : false;
app.use(cors({ origin: corsOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// ARQUIVOS ESTÁTICOS (Frontend)
// ============================================
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================
// INICIA O SERVIDOR (após banco inicializar)
// ============================================
async function startServer() {
    // Inicializa banco de dados
    await initDatabase();
    console.log('✅ Banco de dados inicializado');

    // Importa rotas (após banco estar pronto)
    const authRoutes = require('./routes/auth');
    const usersRoutes = require('./routes/users');
    const categoriesRoutes = require('./routes/categories');
    const filesRoutes = require('./routes/files');
    const aiRoutes = require('./routes/ai');
    const auditRoutes = require('./routes/audit');
    const conversationsRoutes = require('./routes/conversations');

    // Middleware de autenticação
    const { authMiddleware } = require('./middleware/auth');

    // ============================================
    // ROTAS DA API
    // ============================================
    app.use('/api/auth', authRoutes);
    app.use('/api/users', authMiddleware, usersRoutes);
    app.use('/api/categories', authMiddleware, categoriesRoutes);
    app.use('/api/files', authMiddleware, filesRoutes);
    app.use('/api/ai', authMiddleware, aiRoutes);
    app.use('/api/material-audit', auditRoutes);
    app.use('/api/conversations', authMiddleware, conversationsRoutes);

    // ============================================
    // FALLBACK: SPA - qualquer rota não-API retorna index.html
    // ============================================
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
        }
    });

    // ============================================
    // HANDLER DE ERROS GLOBAL
    // ============================================
    app.use((err, req, res, next) => {
        console.error('❌ Erro:', err.message);

        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'Arquivo muito grande. Limite: 50MB.' });
        }

        res.status(500).json({ error: 'Erro interno do servidor.' });
    });

    // ============================================
    // ESCUTA
    // ============================================
    app.listen(PORT, () => {
        console.log('');
        console.log('  ╔══════════════════════════════════════╗');
        console.log('  ║                                      ║');
        console.log('  ║   🧠 CorpBrain AI — Servidor         ║');
        console.log(`  ║   🌐 http://localhost:${PORT}            ║`);
        console.log('  ║   📁 Banco de dados: SQLite           ║');
        console.log('  ║                                      ║');
        console.log('  ╚══════════════════════════════════════╝');
        console.log('');
    });
}

startServer().catch(err => {
    console.error('❌ Falha ao iniciar servidor:', err);
    process.exit(1);
});
