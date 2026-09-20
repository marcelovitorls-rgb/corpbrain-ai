const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'corpbrain.db');
const INITIAL_CREDENTIALS_FILE = path.join(__dirname, '.initial-credentials');
const DB_LOCK_PATH = path.join(__dirname, '..', 'corpbrain.db.lock');
const DB_TMP_PATH = path.join(__dirname, '..', 'corpbrain.db.tmp');
let dbLockOwned = false;

// Garante que a pasta uploads existe
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

let db = null;

/**
 * Wrapper para manter compatibilidade com a API do better-sqlite3.
 * sql.js retorna arrays; este wrapper simula .get(), .all(), .run().
 */
class DBWrapper {
    constructor(sqlJsDb) {
        this._db = sqlJsDb;
        this._transactionDepth = 0;
    }

    prepare(sql) {
        const self = this;
        return {
            // get/all/run deliberately do NOT swallow errors: a caught exception here
            // (constraint violation, bad FK, etc.) is re-thrown after logging, so the
            // route's own try/catch can return a proper error response instead of the
            // caller mistaking a failed write for success (e.g. undefined row, 0 changes).
            get(...params) {
                try {
                    const stmt = self._db.prepare(sql);
                    if (params.length > 0) stmt.bind(params);
                    if (stmt.step()) {
                        const cols = stmt.getColumnNames();
                        const vals = stmt.get();
                        const row = {};
                        cols.forEach((col, i) => { row[col] = vals[i]; });
                        stmt.free();
                        return row;
                    }
                    stmt.free();
                    return undefined;
                } catch (e) {
                    console.error('DB get error:', sql, params, e.message);
                    throw e;
                }
            },
            all(...params) {
                try {
                    const results = [];
                    const stmt = self._db.prepare(sql);
                    if (params.length > 0) stmt.bind(params);
                    while (stmt.step()) {
                        const cols = stmt.getColumnNames();
                        const vals = stmt.get();
                        const row = {};
                        cols.forEach((col, i) => { row[col] = vals[i]; });
                        results.push(row);
                    }
                    stmt.free();
                    return results;
                } catch (e) {
                    console.error('DB all error:', sql, params, e.message);
                    throw e;
                }
            },
            run(...params) {
                try {
                    self._db.run(sql, params);
                    const info = {
                        changes: self._db.getRowsModified(),
                        lastInsertRowid: self._lastId()
                    };
                    if (self._transactionDepth === 0) self._save();
                    return info;
                } catch (e) {
                    console.error('DB run error:', sql, params, e.message);
                    throw e;
                }
            }
        };
    }

    exec(sql) {
        this._db.exec(sql);
        if (this._transactionDepth === 0) this._save();
    }

    transaction(callback) {
        if (this._transactionDepth > 0) return callback();
        this._db.exec('BEGIN');
        this._transactionDepth++;
        try {
            const result = callback();
            this._db.exec('COMMIT');
            this._transactionDepth--;
            this._save();
            return result;
        } catch (error) {
            this._db.exec('ROLLBACK');
            this._transactionDepth = 0;
            throw error;
        }
    }

    pragma(str) {
        try {
            this._db.exec(`PRAGMA ${str}`);
        } catch (e) {
            // Some pragmas may not be supported in sql.js
        }
    }

    _lastId() {
        try {
            const stmt = this._db.prepare('SELECT last_insert_rowid() as id');
            stmt.step();
            const id = stmt.get()[0];
            stmt.free();
            return id;
        } catch (e) {
            return 0;
        }
    }

    _save() {
        try {
            const data = this._db.export();
            const buffer = Buffer.from(data);
            // Primeiro grava a cópia completa; só depois troca o arquivo final.
            // Isso evita que uma interrupção deixe um SQLite parcialmente escrito.
            fs.writeFileSync(DB_TMP_PATH, buffer);
            fs.renameSync(DB_TMP_PATH, DB_PATH);
        } catch (e) {
            console.error('Erro ao salvar banco:', e.message);
            try { if (fs.existsSync(DB_TMP_PATH)) fs.unlinkSync(DB_TMP_PATH); } catch (_) { /* ignore */ }
        }
    }
}

function acquireDatabaseLock() {
    if (dbLockOwned) return;
    const lockContent = () => `${process.pid}\n${new Date().toISOString()}\n`;

    try {
        fs.writeFileSync(DB_LOCK_PATH, lockContent(), { flag: 'wx', mode: 0o600 });
        dbLockOwned = true;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;

        let stale = false;
        try {
            const pid = Number(fs.readFileSync(DB_LOCK_PATH, 'utf8').split(/\s+/)[0]);
            if (!pid || pid === process.pid) stale = true;
            else {
                try { process.kill(pid, 0); } catch (probeError) {
                    stale = probeError.code === 'ESRCH';
                }
            }
        } catch (_) {
            stale = true;
        }

        if (!stale) {
            throw new Error(`O banco já está em uso por outro processo (lock: ${DB_LOCK_PATH}).`);
        }

        fs.unlinkSync(DB_LOCK_PATH);
        fs.writeFileSync(DB_LOCK_PATH, lockContent(), { flag: 'wx', mode: 0o600 });
        dbLockOwned = true;
    }

    const release = () => {
        if (!dbLockOwned) return;
        dbLockOwned = false;
        try { fs.unlinkSync(DB_LOCK_PATH); } catch (_) { /* processo já pode ter removido */ }
    };
    process.once('exit', release);
    process.once('SIGINT', () => { release(); process.exit(130); });
    process.once('SIGTERM', () => { release(); process.exit(143); });
}

async function initDatabase() {
    acquireDatabaseLock();
    const SQL = await initSqlJs();

    // Carrega banco existente ou cria novo
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new DBWrapper(new SQL.Database(fileBuffer));
        console.log('📂 Banco de dados carregado de', DB_PATH);
    } else {
        db = new DBWrapper(new SQL.Database());
        console.log('🆕 Novo banco de dados criado');
    }

    // Habilita foreign keys
    db.pragma('foreign_keys = ON');

    // Cria tabelas
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
            name TEXT NOT NULL,
            initials TEXT,
            title TEXT,
            must_change_password INTEGER NOT NULL DEFAULT 0,
            auth_version INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            label TEXT NOT NULL,
            description TEXT,
            icon TEXT DEFAULT 'folder',
            color TEXT DEFAULT 'produtos',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            description TEXT,
            tags TEXT DEFAULT '[]',
            size TEXT,
            ext TEXT,
            mime_type TEXT,
            extracted_text TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ai_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            provider TEXT DEFAULT 'openai',
            api_key TEXT,
            model TEXT,
            system_prompt TEXT
        );

        CREATE TABLE IF NOT EXISTS ai_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            provider TEXT NOT NULL,
            model TEXT,
            prompt_tokens INTEGER DEFAULT 0,
            completion_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS material_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_name TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            entity_name TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            messages TEXT NOT NULL DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);

    // Migração leve: adiciona colunas novas em bancos já existentes (ai_usage
    // foi criada antes do rastreamento de pergunta/fontes/confiança).
    migrateAiUsageColumns();
    migrateUserColumns();
    migrateFileColumns();

    // Seed
    seedDatabase();
    enforceInitialCredentialFlags();

    return db;
}

/** Adiciona colunas que podem não existir em um corpbrain.db criado antes desta versão. */
function migrateAiUsageColumns() {
    const columns = db.prepare("PRAGMA table_info(ai_usage)").all().map(c => c.name);
    if (!columns.includes('question')) {
        db.exec('ALTER TABLE ai_usage ADD COLUMN question TEXT');
    }
    if (!columns.includes('kb_hit')) {
        db.exec('ALTER TABLE ai_usage ADD COLUMN kb_hit INTEGER DEFAULT 1');
    }
    if (!columns.includes('sources')) {
        db.exec("ALTER TABLE ai_usage ADD COLUMN sources TEXT DEFAULT '[]'");
    }
}

function migrateUserColumns() {
    const columns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!columns.includes('must_change_password')) {
        db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
    }
    if (!columns.includes('auth_version')) {
        db.exec('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0');
    }
}

function migrateFileColumns() {
    const columns = db.prepare("PRAGMA table_info(files)").all().map(c => c.name);
    if (!columns.includes('extracted_text')) {
        db.exec('ALTER TABLE files ADD COLUMN extracted_text TEXT');
    }
}

function seedDatabase() {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (!userCount || userCount.count === 0) {
        console.log('🌱 Inserindo usuários padrão...');
        const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
        const userPassword = process.env.INITIAL_USER_PASSWORD || crypto.randomBytes(18).toString('base64url');
        const adminHash = bcrypt.hashSync(adminPassword, 10);
        const userHash = bcrypt.hashSync(userPassword, 10);

        db.prepare('INSERT INTO users (email, password, role, name, initials, title, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)').run('admin@example.com', adminHash, 'admin', 'Demo Admin', 'DA', 'Administrador');
        db.prepare('INSERT INTO users (email, password, role, name, initials, title, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)').run('user@example.com', userHash, 'user', 'Demo User', 'DU', 'Analista');
        writeInitialCredentials(adminPassword, userPassword);
    }

    const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
    if (!catCount || catCount.count === 0) {
        console.log('🌱 Inserindo categorias padrão...');
        db.prepare('INSERT INTO categories (key, label, description, icon, color) VALUES (?, ?, ?, ?, ?)').run('produtos', 'Produtos', 'Fichas técnicas, tabelas de preços, FAQs comerciais', 'box', 'produtos');
        db.prepare('INSERT INTO categories (key, label, description, icon, color) VALUES (?, ?, ?, ?, ?)').run('processos', 'Processos', 'Guias de RH, reembolso, onboarding, políticas internas', 'git-branch', 'processos');
        db.prepare('INSERT INTO categories (key, label, description, icon, color) VALUES (?, ?, ?, ?, ?)').run('apresentacoes', 'Apresentações', 'Decks de slides comerciais, cases de sucesso, logotipos e diretrizes de marca', 'monitor', 'apresentacoes');
    }
}

/** Mantém a exigência de troca enquanto a credencial inicial ainda está em uso. */
function enforceInitialCredentialFlags() {
    if (!fs.existsSync(INITIAL_CREDENTIALS_FILE)) return;
    try {
        const lines = fs.readFileSync(INITIAL_CREDENTIALS_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
            const separator = line.indexOf('=');
            if (separator <= 0) continue;
            const email = line.slice(0, separator);
            const password = line.slice(separator + 1);
            const user = db.prepare('SELECT id, password, must_change_password FROM users WHERE email = ?').get(email);
            if (user && bcrypt.compareSync(password, user.password) && !user.must_change_password) {
                db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(user.id);
            }
        }
    } catch (e) {
        console.error('Não foi possível validar credenciais iniciais:', e.message);
    }
}

function writeInitialCredentials(adminPassword, userPassword, extra = []) {
    const lines = [];
    if (adminPassword) lines.push(`admin@example.com=${adminPassword}`);
    if (userPassword) lines.push(`user@example.com=${userPassword}`);
    lines.push(...extra);
    if (!lines.length) return;
    try {
        // Substitui o arquivo para nunca deixar senhas temporárias antigas válidas
        // ou ambíguas após uma nova rotação.
        fs.writeFileSync(INITIAL_CREDENTIALS_FILE, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'w' });
    } catch (e) {
        console.error('Não foi possível salvar as credenciais iniciais:', e.message);
    }
}

function getDb() {
    return db;
}

module.exports = { initDatabase, getDb };
