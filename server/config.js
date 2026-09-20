const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_FILE = path.join(__dirname, '.jwt-secret');

/**
 * Resolve o segredo de assinatura do JWT.
 * Usa JWT_SECRET do ambiente se definido; caso contrário, gera um segredo
 * aleatório na primeira execução e o persiste em disco (fora do controle de
 * versão) para que os tokens continuem válidos entre reinícios do servidor.
 * Nunca há um valor padrão fixo no código-fonte.
 */
function resolveJwtSecret() {
    if (process.env.JWT_SECRET) {
        return process.env.JWT_SECRET;
    }

    if (fs.existsSync(SECRET_FILE)) {
        return fs.readFileSync(SECRET_FILE, 'utf-8').trim();
    }

    const generated = crypto.randomBytes(64).toString('hex');
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    console.log('🔐 JWT_SECRET não definido no ambiente — gerado e salvo em server/.jwt-secret');
    return generated;
}

const JWT_SECRET = resolveJwtSecret();

module.exports = { JWT_SECRET };
