const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { getDb } = require('../database');
const { adminMiddleware } = require('../middleware/auth');
const { extractFileText, PLAIN_TEXT_EXTS, OFFICE_EXTS } = require('../lib/extractText');
const { encryptSecret, decryptSecret, isEncrypted, isCurrentEncryption } = require('../lib/secrets');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const VALID_PROVIDERS = ['openai', 'gemini', 'claude', 'groq'];
const MAX_USER_MESSAGE_CHARS = 12000;
const MAX_SYSTEM_PROMPT_CHARS = 8000;
const PROVIDER_REQUEST_TIMEOUT_MS = 45000;

const AI_ENDPOINTS = {
    openai: 'https://api.openai.com/v1/chat/completions',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    claude: 'https://api.anthropic.com/v1/messages',
    // API da Groq é compatível com o formato da OpenAI (mesmo request/response shape).
    groq: 'https://api.groq.com/openai/v1/chat/completions'
};

/**
 * Lê a configuração de IA salva no banco (linha única, id=1).
 * Retorna valores padrão se nada foi configurado ainda.
 */
function readSettings() {
    const db = getDb();
    const row = db.prepare('SELECT * FROM ai_settings WHERE id = 1').get();
    const storedApiKey = row?.api_key || '';
    const apiKey = decryptSecret(storedApiKey);

    // Migra automaticamente instalações antigas que armazenavam a chave em texto puro.
    if (apiKey && (!isEncrypted(storedApiKey) || !isCurrentEncryption(storedApiKey))) {
        db.prepare('UPDATE ai_settings SET api_key = ? WHERE id = 1').run(encryptSecret(apiKey));
    }

    return {
        provider: row?.provider || 'openai',
        apiKey,
        model: row?.model || '',
        systemPrompt: row?.system_prompt || ''
    };
}

function saveSettings({ provider, apiKey, model, systemPrompt }) {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM ai_settings WHERE id = 1').get();
    if (existing) {
        db.prepare(`
            UPDATE ai_settings SET provider = ?, api_key = ?, model = ?, system_prompt = ? WHERE id = 1
        `).run(provider, encryptSecret(apiKey), model || null, systemPrompt || null);
    } else {
        db.prepare(`
            INSERT INTO ai_settings (id, provider, api_key, model, system_prompt) VALUES (1, ?, ?, ?, ?)
        `).run(provider, encryptSecret(apiKey), model || null, systemPrompt || null);
    }
}

/** Constrói um resumo textual da base de conhecimento a partir do banco */
function buildKBContext() {
    const db = getDb();
    const rows = db.prepare(`
        SELECT c.label AS cat_label, f.original_name, f.description, f.tags, f.size
        FROM files f
        INNER JOIN categories c ON c.id = f.category_id
        ORDER BY c.label, f.original_name
    `).all();

    const byCategory = {};
    rows.forEach(r => {
        if (!byCategory[r.cat_label]) byCategory[r.cat_label] = [];
        byCategory[r.cat_label].push(r);
    });

    const lines = [];
    Object.keys(byCategory).forEach(catLabel => {
        lines.push(`\n## ${catLabel}`);
        byCategory[catLabel].forEach(f => {
            const tags = f.tags ? JSON.parse(f.tags) : [];
            lines.push(`- ${f.original_name} (${f.size}): ${f.description || ''} [Tags: ${tags.join(', ')}]`);
        });
    });
    return lines.join('\n');
}

const STOPWORDS = new Set([
    'para', 'com', 'uma', 'umas', 'uns', 'que', 'como', 'qual', 'quais', 'quando', 'onde',
    'sobre', 'isso', 'esse', 'essa', 'este', 'esta', 'pelo', 'pela', 'dos', 'das', 'nos', 'nas',
    'tem', 'ser', 'sao', 'the', 'and', 'for', 'from', 'com', 'de', 'da', 'do', 'em', 'no', 'na',
    'os', 'as', 'seu', 'sua', 'seus', 'suas', 'mais', 'muito', 'quero', 'gostaria', 'poderia'
]);

/** Extrai palavras "significativas" (>=3 letras, sem acento, sem stopwords) de um texto */
function extractKeywords(text) {
    const words = (text || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .match(/[a-z0-9]{3,}/g) || [];
    return words.filter(w => !STOPWORDS.has(w));
}

/**
 * Busca, entre os arquivos com conteúdo extraível (PDF/texto) já enviados,
 * os que têm mais palavras da pergunta do usuário aparecendo no próprio texto,
 * e retorna trechos do conteúdo real deles. É uma busca por palavra-chave (não
 * semântica) — suficiente para uma base de conhecimento de porte moderado sem
 * precisar de embeddings/índice vetorial.
 */
async function findRelevantDocuments(userMessage, maxDocs = 3, maxCharsPerDoc = 4000) {
    const questionKeywords = [...new Set(extractKeywords(userMessage))];
    if (questionKeywords.length === 0) return [];

    const db = getDb();
    const files = db.prepare(`
        SELECT f.original_name, f.stored_name, f.ext, f.extracted_text, c.label AS cat_label
        FROM files f
        INNER JOIN categories c ON c.id = f.category_id
    `).all();

    const scored = [];
    for (const file of files) {
        const ext = (file.ext || '').toLowerCase().replace('.', '');
        if (ext !== 'pdf' && !PLAIN_TEXT_EXTS.has(ext) && !OFFICE_EXTS.has(ext)) continue; // tipo sem extração de texto

        const filePath = path.join(UPLOADS_DIR, file.stored_name);
        if (!file.extracted_text && !fs.existsSync(filePath)) continue; // registro de seed, sem arquivo físico real

        const text = file.extracted_text || (await extractFileText(filePath, ext)).text;
        if (!text) continue;

        const contentKeywords = extractKeywords(text);
        const contentKeywordSet = new Set(contentKeywords);
        const matchedKeywords = questionKeywords.filter(kw => contentKeywordSet.has(kw));
        if (matchedKeywords.length === 0) continue;

        // Evita falsos positivos: uma pergunta com uma única palavra-chave genérica
        // (ex.: "teste") que aparece só de passagem no documento não é evidência real
        // de que o conteúdo seja sobre aquele assunto. Exige presença mais robusta.
        const isRelevant = questionKeywords.length === 1
            ? contentKeywords.filter(w => w === questionKeywords[0]).length >= 2
            : (matchedKeywords.length / questionKeywords.length) >= 0.4;
        if (!isRelevant) continue;

        scored.push({ name: file.original_name, category: file.cat_label, text, score: matchedKeywords.length });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxDocs).map(d => ({
        name: d.name,
        category: d.category,
        text: d.text.length > maxCharsPerDoc ? d.text.slice(0, maxCharsPerDoc) + '…' : d.text
    }));
}

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS_PER_MESSAGE = 4000;

/** Valida e normaliza o histórico enviado pelo cliente antes de repassá-lo ao provedor de IA. */
function sanitizeHistory(rawHistory) {
    if (!Array.isArray(rawHistory)) return [];
    return rawHistory
        .filter(h => h && (h.role === 'user' || h.role === 'ai') && typeof h.text === 'string' && h.text.trim())
        .slice(-MAX_HISTORY_MESSAGES)
        .map(h => ({ role: h.role, text: h.text.slice(0, MAX_HISTORY_CHARS_PER_MESSAGE) }));
}

const KB_MISS_TEMPLATE = 'Agradeço a sua pergunta! Verifiquei atentamente nossa base de conhecimento, porém não localizei essa informação nos materiais disponíveis no momento. Recomendo consultar a área responsável ou aguardar a inclusão de um documento sobre esse tema em nossos Materiais de Apoio. Fico à disposição para ajudar com outras dúvidas relacionadas ao conteúdo já cadastrado.';

async function buildSystemPrompt(adminSystemPrompt, userMessage, history) {
    let basePrompt = `Você é o CorpBrain AI, um assistente de inteligência artificial corporativo. Responda sempre em português brasileiro, em tom cordial, profissional e corporativo.

REGRA CRÍTICA — Você deve responder EXCLUSIVAMENTE com base no conteúdo da base de conhecimento da empresa (a lista de documentos e os trechos extraídos fornecidos abaixo, quando existirem). Nunca utilize conhecimento geral, público ou externo à base para complementar ou substituir uma resposta sobre processos, produtos, políticas ou qualquer assunto que deveria estar documentado internamente — mesmo que você "saiba" a resposta por treinamento geral.

Se a pergunta não puder ser respondida com o conteúdo disponível na base de conhecimento (nenhum trecho relevante foi encontrado, ou os trechos encontrados não cobrem o que foi perguntado), NÃO tente adivinhar, complementar com informações externas nem oferecer um "resumo geral". Em vez disso, responda de forma cordial e corporativa, seguindo este modelo (adapte a redação, mas mantenha o sentido):

"${KB_MISS_TEMPLATE}"

Essa regra não se aplica a interações que não dependem da base de conhecimento (cumprimentos, agradecimentos, perguntas sobre o funcionamento do próprio assistente) — responda normalmente nesses casos, sem citar a base de conhecimento.

Formate suas respostas usando markdown (negrito, listas, etc.) para melhor legibilidade.`;

    if (adminSystemPrompt) {
        basePrompt += '\n\nInstruções adicionais do administrador:\n' + adminSystemPrompt;
    }

    const kbSummary = buildKBContext();
    if (kbSummary) {
        basePrompt += '\n\nMateriais de Apoio disponíveis (lista de documentos):\n' + kbSummary;
    }

    // Inclui as mensagens anteriores do usuário na busca por documentos relevantes,
    // para que perguntas de acompanhamento (ex: "que documentos preciso enviar?")
    // ainda encontrem o documento do assunto que já estava sendo discutido.
    const recentUserText = history.filter(h => h.role === 'user').map(h => h.text).join(' ');
    const relevantDocs = await findRelevantDocuments(`${recentUserText} ${userMessage}`.trim());
    if (relevantDocs.length > 0) {
        basePrompt += '\n\nTrechos extraídos de documentos relevantes para a pergunta atual:\n';
        relevantDocs.forEach(d => {
            basePrompt += `\n--- ${d.name} (${d.category}) ---\n${d.text}\n`;
        });
        basePrompt += '\nResponda com base nesses trechos sempre que cobrirem a pergunta. Ao final da resposta, indique sempre o(s) arquivo(s) e a pasta/categoria consultados (ex.: "📄 Fonte: nome-do-arquivo.pptx — pasta Nome da Categoria"), para que a pessoa possa consultar o material original se quiser. Se os trechos não cobrirem a pergunta, aplique a regra crítica acima (mensagem de "não encontrado") em vez de complementar com conhecimento externo.';
    } else {
        basePrompt += '\n\nNenhum trecho de documento relevante foi encontrado para a pergunta atual. Se a pergunta exigir informação documentada da empresa, aplique a regra crítica acima e use o modelo de resposta de "não encontrado".';
    }

    const sources = relevantDocs.map(d => ({ name: d.name, category: d.category }));
    return { prompt: basePrompt, sources };
}

/** OpenAI e Groq usam o mesmo formato de request/response (chat completions) */
async function callOpenAICompatible(endpoint, providerLabel, { apiKey, model, systemPrompt, userMessage, history }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS);
    const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
                { role: 'user', content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 2000
        })
    }).catch(error => {
        if (error.name === 'AbortError') {
            throw new Error(`Tempo esgotado ao consultar a API ${providerLabel}.`);
        }
        throw new Error(`Não foi possível conectar à API ${providerLabel}.`);
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Erro da API ${providerLabel} (${response.status})`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function callOpenAI(args) {
    return callOpenAICompatible(AI_ENDPOINTS.openai, 'OpenAI', args);
}

async function callGroq(args) {
    return callOpenAICompatible(AI_ENDPOINTS.groq, 'Groq', args);
}

async function callGemini({ apiKey, model, systemPrompt, userMessage, history }) {
    const url = AI_ENDPOINTS.gemini.replace('{model}', model) + `?key=${apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS);
    const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [
                ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] })),
                { role: 'user', parts: [{ text: userMessage }] }
            ],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
        })
    }).catch(error => {
        if (error.name === 'AbortError') throw new Error('Tempo esgotado ao consultar a API Gemini.');
        throw new Error('Não foi possível conectar à API Gemini.');
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Erro da API Gemini (${response.status})`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

async function callClaude({ apiKey, model, systemPrompt, userMessage, history }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS);
    const response = await fetch(AI_ENDPOINTS.claude, {
        method: 'POST',
        signal: controller.signal,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model,
            max_tokens: 2000,
            system: systemPrompt,
            messages: [
                ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
                { role: 'user', content: userMessage }
            ]
        })
    }).catch(error => {
        if (error.name === 'AbortError') throw new Error('Tempo esgotado ao consultar a API Claude.');
        throw new Error('Não foi possível conectar à API Claude.');
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Erro da API Claude (${response.status})`);
    }

    const data = await response.json();
    return data.content[0].text;
}

async function callProvider(provider, args) {
    let text;
    if (provider === 'openai') text = await callOpenAI(args);
    else if (provider === 'gemini') text = await callGemini(args);
    else if (provider === 'claude') text = await callClaude(args);
    else if (provider === 'groq') text = await callGroq(args);
    else throw new Error('Provedor não suportado: ' + provider);

    // Alguns modelos de raciocínio (ex.: Qwen3 na Groq) embutem o "pensamento"
    // interno em tags <think>...</think> junto com a resposta final — isso nunca
    // deve chegar ao usuário no chat.
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Estimativa aproximada de tokens (~4 caracteres por token). Não usa o campo
 * `usage` retornado pelas APIs dos provedores — é só uma aproximação para dar
 * uma noção de consumo no Analytics, não um valor de billing exato.
 */
function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}

/**
 * Registra uma estimativa de uso de tokens, junto com dados para o Analytics:
 * a pergunta em si (para o "termos mais pesquisados"), se a base de conhecimento
 * tinha conteúdo relevante para responder (kbHit — vira "baixa confiança" quando
 * não), e quais documentos foram citados como fonte (para "mais acessados").
 * Falha aqui não deve derrubar a resposta do chat.
 */
function logUsage({ userId, provider, model, promptText, completionText, question, kbHit, sources }) {
    try {
        const promptTokens = estimateTokens(promptText);
        const completionTokens = estimateTokens(completionText);
        getDb().prepare(`
            INSERT INTO ai_usage (user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, question, kb_hit, sources)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId, provider, model || '', promptTokens, completionTokens, promptTokens + completionTokens,
            (question || '').slice(0, 500), kbHit ? 1 : 0, JSON.stringify(sources || [])
        );
    } catch (error) {
        console.error('Erro ao registrar uso estimado de tokens:', error.message);
    }
}

/**
 * GET /
 * Retorna a configuração de IA sem expor a chave (apenas se está configurada).
 */
router.get('/settings', (req, res) => {
    try {
        const settings = readSettings();
        res.json({
            provider: settings.provider,
            model: settings.model,
            systemPrompt: settings.systemPrompt,
            configured: Boolean(settings.apiKey && settings.apiKey.trim().length > 10)
        });
    } catch (error) {
        console.error('Erro ao ler configurações de IA:', error);
        res.status(500).json({ error: 'Erro interno ao ler configurações de IA.' });
    }
});

/**
 * PUT /settings
 * Salva a configuração de IA (somente admin). A chave só é atualizada se enviada
 * (string não vazia); enviar vazio mantém a chave já salva.
 */
router.put('/settings', adminMiddleware, (req, res) => {
    try {
        const { provider, apiKey, model, systemPrompt } = req.body;

        if (!provider || !VALID_PROVIDERS.includes(provider)) {
            return res.status(400).json({ error: 'Provedor inválido. Use: ' + VALID_PROVIDERS.join(', ') });
        }
        if (typeof model !== 'string' || !model.trim() || model.trim().length > 200) {
            return res.status(400).json({ error: 'Informe um modelo válido.' });
        }
        if (typeof systemPrompt !== 'string' || systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
            return res.status(400).json({ error: `O prompt administrativo deve ter no máximo ${MAX_SYSTEM_PROMPT_CHARS} caracteres.` });
        }

        const current = readSettings();
        const finalApiKey = (typeof apiKey === 'string' && apiKey.trim().length > 0)
            ? apiKey.trim()
            : current.apiKey;

        saveSettings({
            provider,
            apiKey: finalApiKey,
            model: model.trim(),
            systemPrompt: systemPrompt.trim()
        });

        res.json({
            provider,
            model: model.trim(),
            systemPrompt: systemPrompt.trim(),
            configured: Boolean(finalApiKey && finalApiKey.trim().length > 10)
        });
    } catch (error) {
        console.error('Erro ao salvar configurações de IA:', error);
        res.status(500).json({ error: 'Erro interno ao salvar configurações de IA.' });
    }
});

/**
 * POST /test
 * Testa a conexão com o provedor (somente admin). Permite testar uma chave
 * ainda não salva, enviando-a no corpo — nunca é persistida por esta rota.
 */
router.post('/test', adminMiddleware, async (req, res) => {
    try {
        const { provider, apiKey, model } = req.body;

        if (!provider || !VALID_PROVIDERS.includes(provider)) {
            return res.status(400).json({ error: 'Provedor inválido.' });
        }
        if (!apiKey || apiKey.trim().length < 10) {
            return res.status(400).json({ error: 'Informe uma API key antes de testar.' });
        }
        if (typeof model !== 'string' || !model.trim() || model.trim().length > 200) {
            return res.status(400).json({ error: 'Informe um modelo válido.' });
        }

        const text = await callProvider(provider, {
            apiKey: apiKey.trim(),
            model,
            systemPrompt: 'Você é um assistente de teste.',
            userMessage: 'Responda apenas "Conexão OK" para testar.',
            history: []
        });

        res.json({ response: text });
    } catch (error) {
        res.status(502).json({ error: error.message || 'Falha ao conectar com o provedor de IA.' });
    }
});

/**
 * POST /chat
 * Envia uma mensagem ao provedor configurado, usando a chave salva no servidor.
 * Qualquer usuário autenticado pode usar o chat.
 */
router.post('/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        if (typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'A mensagem não pode ser vazia.' });
        }
        if (message.trim().length > MAX_USER_MESSAGE_CHARS) {
            return res.status(413).json({ error: `A mensagem deve ter no máximo ${MAX_USER_MESSAGE_CHARS} caracteres.` });
        }

        const settings = readSettings();
        if (!settings.apiKey || settings.apiKey.trim().length < 10) {
            return res.status(409).json({ error: 'IA não configurada. Peça a um administrador para configurar em Configurações.' });
        }

        const safeHistory = sanitizeHistory(history);
        const { prompt: systemPrompt, sources } = await buildSystemPrompt(settings.systemPrompt, message, safeHistory);
        const text = await callProvider(settings.provider, {
            apiKey: settings.apiKey,
            model: settings.model,
            systemPrompt,
            userMessage: message,
            history: safeHistory
        });

        logUsage({
            userId: req.user.id,
            provider: settings.provider,
            model: settings.model,
            promptText: systemPrompt + safeHistory.map(h => h.text).join(' ') + message,
            completionText: text,
            question: message,
            kbHit: sources.length > 0,
            sources
        });

        res.json({
            response: text,
            sources: sources.map(s => `${s.name} (${s.category})`)
        });
    } catch (error) {
        console.error('Erro no chat de IA:', error.message);
        res.status(502).json({ error: error.message || 'Falha ao consultar a IA.' });
    }
});

/**
 * GET /usage
 * Métricas reais do Analytics, derivadas de ai_usage (uma linha por chamada real
 * ao /chat — o MockAIEngine local nunca grava aqui): consumo estimado de tokens
 * (hoje, mês, por provedor, por usuário), volume de perguntas, respostas de
 * "baixa confiança" (kb_hit = 0, ou seja, nenhum documento relevante encontrado),
 * termos mais pesquisados e documentos mais citados como fonte no mês.
 * Qualquer usuário autenticado pode ver — é um painel de Analytics, não uma
 * área administrativa.
 */
router.get('/usage', (req, res) => {
    try {
        const db = getDb();
        const today = db.prepare(`
            SELECT COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS requests
            FROM ai_usage WHERE date(created_at) = date('now', 'localtime')
        `).get();
        const month = db.prepare(`
            SELECT COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS requests
            FROM ai_usage WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
        `).get();
        const byProvider = db.prepare(`
            SELECT provider, COALESCE(SUM(total_tokens), 0) AS tokens
            FROM ai_usage
            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
            GROUP BY provider
            ORDER BY tokens DESC
        `).all();
        const topUsers = db.prepare(`
            SELECT COALESCE(u.name, 'Usuário removido') AS name, COALESCE(SUM(a.total_tokens), 0) AS tokens
            FROM ai_usage a
            LEFT JOIN users u ON u.id = a.user_id
            WHERE strftime('%Y-%m', a.created_at) = strftime('%Y-%m', 'now', 'localtime')
            GROUP BY a.user_id
            ORDER BY tokens DESC
            LIMIT 5
        `).all();

        const lowConfidenceToday = db.prepare(`
            SELECT COUNT(*) AS count FROM ai_usage
            WHERE kb_hit = 0 AND date(created_at) = date('now', 'localtime')
        `).get();
        const lowConfidenceMonth = db.prepare(`
            SELECT COUNT(*) AS count FROM ai_usage
            WHERE kb_hit = 0 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
        `).get();
        const lowConfidenceList = db.prepare(`
            SELECT question, created_at
            FROM ai_usage
            WHERE kb_hit = 0 AND question IS NOT NULL AND question != ''
            ORDER BY created_at DESC
            LIMIT 10
        `).all();

        // Termos mais pesquisados e documentos mais citados como fonte no mês:
        // agregados em JS a partir das perguntas/fontes já registradas (evita
        // depender de funções JSON do SQLite, que o sql.js pode não expor).
        const monthRows = db.prepare(`
            SELECT question, sources
            FROM ai_usage
            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
        `).all();

        const termCounts = {};
        const docCounts = {};
        monthRows.forEach(r => {
            extractKeywords(r.question || '').forEach(kw => {
                termCounts[kw] = (termCounts[kw] || 0) + 1;
            });
            let srcs = [];
            try { srcs = JSON.parse(r.sources || '[]'); } catch (e) { /* linha antiga sem fontes */ }
            srcs.forEach(s => {
                const key = `${s.name} (${s.category})`;
                docCounts[key] = (docCounts[key] || 0) + 1;
            });
        });

        const topTerms = Object.entries(termCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 14)
            .map(([text, count]) => ({ text, count }));

        const topDocuments = Object.entries(docCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

        res.json({
            today,
            month,
            byProvider,
            topUsers,
            lowConfidence: { today: lowConfidenceToday.count, month: lowConfidenceMonth.count },
            lowConfidenceList,
            topTerms,
            topDocuments,
            estimated: true
        });
    } catch (error) {
        console.error('Erro ao ler uso de tokens:', error);
        res.status(500).json({ error: 'Erro interno ao ler uso de tokens.' });
    }
});

module.exports = router;
