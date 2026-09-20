const jwt = require('jsonwebtoken');

const { JWT_SECRET } = require('../config');
const { getDb } = require('../database');

/**
 * Middleware: verifica se o usuário está autenticado via JWT.
 * Além de validar a assinatura/expiração do token, reconsulta o usuário no
 * banco a cada requisição — assim, se ele for excluído ou tiver o papel
 * (role) alterado após o token ser emitido, o token antigo deixa de valer
 * imediatamente em vez de continuar válido com o papel antigo por até 7 dias.
 */
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    const cookieToken = (req.headers.cookie || '').split(';').map(v => v.trim())
        .find(v => v.startsWith('corpbrain_session='))?.slice('corpbrain_session='.length);

    if ((!authHeader || !authHeader.startsWith('Bearer ')) && !cookieToken) {
        return res.status(401).json({ error: 'Token de autenticação não fornecido.' });
    }

    const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : decodeURIComponent(cookieToken);

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const db = getDb();
        const user = db.prepare('SELECT id, email, role, name, must_change_password, auth_version FROM users WHERE id = ?').get(decoded.id);
        if (!user) {
            return res.status(401).json({ error: 'Usuário não existe mais.' });
        }
        if ((decoded.authVersion || 0) !== (user.auth_version || 0)) {
            return res.status(401).json({ error: 'Sessão invalidada. Faça login novamente.' });
        }

        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
            mustChangePassword: Boolean(user.must_change_password)
        };

        // Senha temporária é uma pré-condição para usar a aplicação. Permite
        // apenas consultar a própria sessão e concluir a troca de senha.
        const isPasswordFlow = req.baseUrl.endsWith('/auth') &&
            (req.path === '/me' || req.path === '/password');
        if (req.user.mustChangePassword && !isPasswordFlow) {
            return res.status(428).json({
                error: 'Troque sua senha temporária antes de continuar.',
                code: 'PASSWORD_CHANGE_REQUIRED'
            });
        }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
}

/**
 * Middleware: verifica se o usuário é admin
 * Deve ser usado APÓS authMiddleware
 */
function adminMiddleware(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso restrito a administradores.' });
    }
    next();
}

module.exports = { authMiddleware, adminMiddleware, JWT_SECRET };
