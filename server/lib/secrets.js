const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JWT_SECRET } = require('../config');

const LEGACY_PREFIX = 'enc:v1:';
const PREFIX = 'enc:v2:';
const KEY_FILE = path.join(__dirname, '..', '.ai-encryption-key');

function resolveEncryptionKey() {
    const configured = process.env.AI_ENCRYPTION_KEY;
    if (configured) return crypto.scryptSync(configured, 'corpbrain-ai-api-key-v2', 32);

    if (fs.existsSync(KEY_FILE)) {
        const value = fs.readFileSync(KEY_FILE, 'utf8').trim();
        if (value) return Buffer.from(value, 'base64url');
    }

    const generated = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, generated.toString('base64url'), { mode: 0o600 });
    console.log('🔐 Chave independente de criptografia da IA gerada em server/.ai-encryption-key');
    return generated;
}

const KEY = resolveEncryptionKey();
const LEGACY_KEY = crypto.scryptSync(JWT_SECRET, 'corpbrain-ai-api-key-v1', 32);

function encryptSecret(value) {
    if (!value) return value;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decryptSecret(value) {
    if (!value) return value;
    if (value.startsWith(LEGACY_PREFIX)) return decryptWithKey(value, LEGACY_KEY, LEGACY_PREFIX);
    if (!value.startsWith(PREFIX)) return value; // compatibilidade para texto puro legado
    return decryptWithKey(value, KEY, PREFIX);
}

function decryptWithKey(value, key, prefix) {
    const [ivText, tagText, ciphertextText] = value.slice(prefix.length).split(':');
    if (!ivText || !tagText || !ciphertextText) throw new Error('API key criptografada inválida.');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertextText, 'base64url')),
        decipher.final()
    ]).toString('utf8');
}

module.exports = {
    encryptSecret,
    decryptSecret,
    isEncrypted: value => Boolean(value && (value.startsWith(PREFIX) || value.startsWith(LEGACY_PREFIX))),
    isCurrentEncryption: value => Boolean(value && value.startsWith(PREFIX))
};
