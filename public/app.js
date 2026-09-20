/* ==============================================
   CorpBrain AI — Lógica Principal (app.js)
   Backend API + SPA Navigation
   ============================================== */

// ============================================
// 0. CLIENTE API (comunicação com o backend)
// ============================================
const API = {
    baseUrl: '/api',
    
    /** Retorna headers com JWT se disponível */
    headers(contentType = 'application/json') {
        const h = {};
        if (contentType) h['Content-Type'] = contentType;
        return h;
    },

    async get(path) {
        const res = await fetch(this.baseUrl + path, { headers: this.headers(), credentials: 'same-origin' });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Erro ${res.status}`); }
        return res.json();
    },

    async post(path, body) {
        const res = await fetch(this.baseUrl + path, {
            method: 'POST', headers: this.headers(), credentials: 'same-origin', body: JSON.stringify(body)
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Erro ${res.status}`); }
        return res.json();
    },

    async put(path, body) {
        const res = await fetch(this.baseUrl + path, {
            method: 'PUT', headers: this.headers(), credentials: 'same-origin', body: JSON.stringify(body)
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Erro ${res.status}`); }
        return res.json();
    },

    async delete(path) {
        const res = await fetch(this.baseUrl + path, {
            method: 'DELETE', headers: this.headers(), credentials: 'same-origin'
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Erro ${res.status}`); }
        return res.json();
    },

    async upload(path, formData) {
        const res = await fetch(this.baseUrl + path, {
            method: 'POST',
            credentials: 'same-origin',
            body: formData
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Erro ${res.status}`); }
        return res.json();
    }
};

/** Fecha um modal ao pressionar Esc (remove o listener sozinho após disparar) */
function enableEscapeToClose(closeFn) {
    const handler = (e) => {
        if (e.key === 'Escape') {
            document.removeEventListener('keydown', handler);
            closeFn();
        }
    };
    document.addEventListener('keydown', handler);
}

/** Escapa texto vindo de dados (banco, usuário) antes de inserir em innerHTML */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================
// 0.1 SISTEMA DE AUTENTICAÇÃO (API-backed)
// ============================================
const AuthSystem = {
    currentUser: null,

    async login(email, password) {
        try {
            const data = await API.post('/auth/login', { email, password });
            this.currentUser = data.user;
            return { success: true, user: this.currentUser };
        } catch (err) {
            return { success: false, message: err.message };
        }
    },

    logout() {
        fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        this.currentUser = null;
    },

    isLoggedIn() {
        return this.currentUser !== null;
    },

    isAdmin() {
        return this.currentUser && this.currentUser.role === 'admin';
    },

    canUpload() {
        return this.isAdmin();
    },

    canDelete() {
        return this.isAdmin();
    },

    /** Tenta restaurar sessão a partir do JWT salvo */
    async restoreSession() {
        // Remove tokens legados; a sessão atual é mantida apenas pelo cookie HttpOnly.
        localStorage.removeItem('corpbrain_token');
        try {
            const data = await API.get('/auth/me');
            this.currentUser = data.user;
            return true;
        } catch (err) {
            return false;
        }
    }
};

// ============================================
// 0.2 TEMA (CLARO / ESCURO / SISTEMA)
// ============================================

const THEME_STORAGE_KEY = 'corpbrain_theme';
const THEME_ICONS = { system: 'monitor', light: 'sun', dark: 'moon' };

/** Aplica um modo de tema ('system' | 'light' | 'dark'): atualiza o atributo no <html>, persiste e atualiza o menu. */
function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') {
        document.documentElement.setAttribute('data-theme', mode);
    } else {
        mode = 'system';
        document.documentElement.removeAttribute('data-theme');
    }

    try {
        localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (e) { /* localStorage indisponível — troca só vale para esta sessão */ }

    document.querySelectorAll('.theme-menu-item').forEach(btn => {
        const isActive = btn.getAttribute('data-theme-mode') === mode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });

    const iconWrap = document.getElementById('themeToggleIcon');
    if (iconWrap) {
        iconWrap.innerHTML = `<i data-lucide="${THEME_ICONS[mode]}"></i>`;
        if (window.lucide) lucide.createIcons({ nodes: [iconWrap] });
    }
}

/** Abre/fecha o menu suspenso de tema perto do botão Sair. */
function toggleThemeMenu(forceOpen) {
    const btn = document.getElementById('themeToggleBtn');
    const menu = document.getElementById('themeMenu');
    if (!btn || !menu) return;
    const open = forceOpen !== undefined ? forceOpen : menu.hidden;
    menu.hidden = !open;
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/** Lê o tema salvo (ou 'system' por padrão), aplica e liga o menu suspenso. */
function initThemeSwitcher() {
    let saved = 'system';
    try {
        saved = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    } catch (e) { /* segue com 'system' */ }

    applyTheme(saved);

    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleThemeMenu();
        });
    }

    document.querySelectorAll('.theme-menu-item').forEach(btn => {
        btn.addEventListener('click', () => {
            applyTheme(btn.getAttribute('data-theme-mode'));
            toggleThemeMenu(false);
        });
    });

    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('themeDropdown');
        if (dropdown && !dropdown.contains(e.target)) toggleThemeMenu(false);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') toggleThemeMenu(false);
    });
}

// ============================================
// 1. ESTADO GLOBAL DA APLICAÇÃO
// ============================================
const AppState = {
    currentPage: 'chat',
    sidebarCollapsed: false,
    conversations: [],
    currentConversationId: null,
    pendingUploadFiles: [],
    selectedUploadCategory: null,

    // Metadados das categorias (dinâmico)
    categoryMeta: [
        { key: 'produtos', label: 'Produtos', desc: 'Fichas técnicas, tabelas de preços, FAQs comerciais', icon: 'box', color: 'produtos' },
        { key: 'processos', label: 'Processos', desc: 'Guias de RH, reembolso, onboarding, políticas internas', icon: 'git-branch', color: 'processos' },
        { key: 'apresentacoes', label: 'Apresentações', desc: 'Decks de slides comerciais, cases de sucesso, logotipos e diretrizes de marca', icon: 'monitor', color: 'apresentacoes' }
    ],

    knowledgeBase: {
        produtos: [
            { name: 'Ficha_Tecnica_Produto_X.pdf', desc: 'Especificações completas do Produto X', tags: ['especificação', 'produto-x', 'técnico'], size: '2.4 MB', ext: 'pdf' },
            { name: 'Ficha_Tecnica_Produto_Y.pdf', desc: 'Especificações do Produto Y', tags: ['especificação', 'produto-y'], size: '1.8 MB', ext: 'pdf' },
            { name: 'Ficha_Tecnica_Produto_Z.pdf', desc: 'Especificações do Produto Z', tags: ['especificação', 'produto-z'], size: '3.1 MB', ext: 'pdf' },
            { name: 'Tabela_Precos_2026.xlsx', desc: 'Tabela de preços atualizada', tags: ['preços', 'comercial'], size: '540 KB', ext: 'xlsx' },
            { name: 'FAQ_Comercial_Produtos.pdf', desc: 'Perguntas frequentes comerciais', tags: ['faq', 'comercial', 'vendas'], size: '890 KB', ext: 'pdf' },
            { name: 'Comparativo_Produtos.pdf', desc: 'Comparativo entre produtos', tags: ['comparativo', 'análise'], size: '1.2 MB', ext: 'pdf' },
            { name: 'Manual_Usuario_Produto_X.pdf', desc: 'Manual do usuário Produto X', tags: ['manual', 'produto-x', 'usuário'], size: '5.6 MB', ext: 'pdf' },
            { name: 'Catalogo_Geral_2026.pdf', desc: 'Catálogo geral de produtos', tags: ['catálogo', 'geral'], size: '12.3 MB', ext: 'pdf' }
        ],
        processos: [
            { name: 'Manual_Reembolso_Corp.pdf', desc: 'Guia completo para solicitação de reembolsos', tags: ['reembolso', 'financeiro', 'RH'], size: '1.1 MB', ext: 'pdf' },
            { name: 'Guia_Onboarding_2026.pdf', desc: 'Guia de integração de novos funcionários', tags: ['onboarding', 'novo-funcionário', 'RH'], size: '3.4 MB', ext: 'pdf' },
            { name: 'Politica_Viagens.pdf', desc: 'Política de viagens corporativas', tags: ['viagem', 'política', 'despesas'], size: '780 KB', ext: 'pdf' },
            { name: 'Manual_RH_Completo.pdf', desc: 'Manual completo de RH', tags: ['RH', 'férias', 'benefícios', 'políticas'], size: '4.2 MB', ext: 'pdf' },
            { name: 'Fluxo_Aprovacao_Compras.pdf', desc: 'Fluxo de aprovação de compras', tags: ['compras', 'aprovação', 'financeiro'], size: '920 KB', ext: 'pdf' },
            { name: 'Codigo_Conduta_Etica.pdf', desc: 'Código de conduta e ética', tags: ['ética', 'conduta', 'compliance'], size: '1.5 MB', ext: 'pdf' },
            { name: 'Procedimento_TI_Suporte.pdf', desc: 'Procedimentos de suporte de TI', tags: ['TI', 'suporte', 'helpdesk'], size: '670 KB', ext: 'pdf' },
            { name: 'Politica_Home_Office.pdf', desc: 'Política de trabalho remoto', tags: ['home-office', 'remoto', 'flexível'], size: '450 KB', ext: 'pdf' }
        ],
        apresentacoes: [
            { name: 'Apresentacao_Institucional_2026.pptx', desc: 'Deck institucional oficial para clientes', tags: ['institucional', 'clientes', 'deck'], size: '15.2 MB', ext: 'pptx' },
            { name: 'Case_Sucesso_Empresa_Alpha.pptx', desc: 'Case de sucesso - Empresa Alpha', tags: ['case', 'sucesso', 'referência'], size: '8.7 MB', ext: 'pptx' },
            { name: 'Case_Sucesso_Empresa_Beta.pptx', desc: 'Case de sucesso - Empresa Beta', tags: ['case', 'sucesso', 'referência'], size: '9.1 MB', ext: 'pptx' },
            { name: 'Manual_Marca_Diretrizes.pdf', desc: 'Manual de marca e identidade visual', tags: ['marca', 'logo', 'identidade-visual', 'brand'], size: '6.8 MB', ext: 'pdf' },
            { name: 'Template_Proposta_Comercial.pptx', desc: 'Template de proposta comercial', tags: ['proposta', 'comercial', 'template'], size: '4.3 MB', ext: 'pptx' },
            { name: 'Deck_Produto_X_Comercial.pptx', desc: 'Deck comercial do Produto X', tags: ['produto-x', 'comercial', 'vendas'], size: '7.5 MB', ext: 'pptx' },
            { name: 'Logos_Kit_Imprensa.zip', desc: 'Kit de logos para imprensa', tags: ['logo', 'imprensa', 'mídia'], size: '22.1 MB', ext: 'zip' }
        ]
    }
};

/** Lista de ícones disponíveis para blocos */
const CATEGORY_ICON_OPTIONS = [
    { icon: 'box', label: 'Caixa' },
    { icon: 'git-branch', label: 'Processos' },
    { icon: 'monitor', label: 'Apresentação' },
    { icon: 'book-open', label: 'Livro' },
    { icon: 'briefcase', label: 'Negócios' },
    { icon: 'shield', label: 'Segurança' },
    { icon: 'cpu', label: 'Tecnologia' },
    { icon: 'heart', label: 'Saúde' },
    { icon: 'graduation-cap', label: 'Educação' },
    { icon: 'folder', label: 'Pasta' },
    { icon: 'globe', label: 'Global' },
    { icon: 'wrench', label: 'Ferramentas' }
];

const CATEGORY_COLOR_OPTIONS = [
    { key: 'produtos', label: 'Azul' },
    { key: 'processos', label: 'Verde' },
    { key: 'apresentacoes', label: 'Rosa' },
    { key: 'custom-purple', label: 'Roxo' },
    { key: 'custom-yellow', label: 'Amarelo' },
    { key: 'custom-cyan', label: 'Ciano' }
];

// ============================================
// 2. PROVEDOR DE IA (Abstração Multi-Provider)
// ============================================

const AI_MODELS = {
    openai: [
        { value: 'gpt-4o', label: 'GPT-4o (Recomendado)' },
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
        { value: 'gpt-4', label: 'GPT-4' },
        { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
    ],
    gemini: [
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recomendado)' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
    ],
    claude: [
        { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (Recomendado)' },
        { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
        { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' }
    ],
    groq: [
        { value: 'openai/gpt-oss-120b', label: 'GPT OSS 120B (Recomendado)' },
        { value: 'openai/gpt-oss-20b', label: 'GPT OSS 20B (mais rápido)' },
        { value: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B' },
        { value: 'groq/compound', label: 'Groq Compound' },
        { value: 'groq/compound-mini', label: 'Groq Compound Mini' }
    ]
};

/**
 * Cliente do provedor de IA. A chave de API NUNCA fica no navegador: ela é
 * configurada e armazenada só no servidor (tabela ai_settings), e todo o
 * chat passa pelo backend (/api/ai/*), que faz a chamada ao provedor.
 */
const AIProvider = {
    // Espelha apenas dados não sensíveis vindos do servidor (nunca a apiKey).
    config: {
        provider: 'openai',
        model: '',
        systemPrompt: ''
    },
    configured: false,

    /** Verifica se a IA real está configurada (segundo o servidor) */
    isConfigured() {
        return this.configured;
    },

    /** Carrega configurações (não sensíveis) do servidor */
    async loadSettings() {
        try {
            const data = await API.get('/ai/settings');
            this.config = {
                provider: data.provider || 'openai',
                model: data.model || '',
                systemPrompt: data.systemPrompt || ''
            };
            this.configured = Boolean(data.configured);
        } catch (e) {
            console.warn('Erro ao carregar configurações de IA:', e);
        }
    },

    /** Salva configurações no servidor (somente admin). apiKey vazia mantém a atual. */
    async saveSettings(apiKey) {
        const data = await API.put('/ai/settings', {
            provider: this.config.provider,
            apiKey: apiKey || '',
            model: this.config.model,
            systemPrompt: this.config.systemPrompt
        });
        this.config = { provider: data.provider, model: data.model, systemPrompt: data.systemPrompt };
        this.configured = Boolean(data.configured);
    },

    /** Testa a conexão com o provedor (somente admin), sem persistir a chave testada */
    async testConnection(apiKey) {
        const data = await API.post('/ai/test', {
            provider: this.config.provider,
            apiKey,
            model: this.config.model
        });
        return data.response;
    },

    /**
     * Obtém resposta — usa a API real (via backend) se configurada, senão usa Mock
     */
    async getResponse(userMessage, history = []) {
        if (this.isConfigured()) {
            try {
                const data = await API.post('/ai/chat', { message: userMessage, history });
                return { response: data.response, sources: data.sources || [], isReal: true };
            } catch (error) {
                console.error('Erro na API de IA:', error);
                showToast(`Erro na IA: ${error.message}.`, 'error');
                throw error;
            }
        } else {
            const mock = MockAIEngine.getResponse(userMessage);
            return { ...mock, isReal: false };
        }
    }
};

// ============================================
// 3. MOTOR DE RESPOSTAS MOCK (IA Simulada)
// ============================================
const MockAIEngine = {
    // Mapeamento de palavras-chave → respostas (ordem de prioridade)
    keywordMap: [
        {
            keywords: ['reembolso', 'reembolsar'],
            response: `O processo de reembolso na empresa segue estas etapas:

**1.** Acesse o portal de RH (rh.corpbrain.com)
**2.** Clique em 'Solicitações' > 'Novo Reembolso'
**3.** Preencha o formulário com:
   - Tipo de despesa (viagem, material, etc.)
   - Valor e data
   - Anexe os comprovantes fiscais
**4.** O gestor direto receberá a solicitação para aprovação
**5.** Após aprovação, o pagamento é processado na próxima folha

⏱️ **Prazo médio**: 5 a 10 dias úteis após aprovação.

📌 Para valores acima de R$ 5.000, é necessária aprovação adicional da diretoria.`,
            sources: ['Manual de Reembolso Corp.pdf', 'Manual RH Completo.pdf']
        },
        {
            keywords: ['produto x', 'produtox', 'prazo de entrega'],
            response: `O **Produto X** é nossa solução enterprise de maior destaque. Aqui estão as principais especificações:

📋 **Características Técnicas:**
- Capacidade de processamento: 10.000 requisições/segundo
- Disponibilidade garantida: 99,97% (SLA Premium)
- Integrações nativas: SAP, Salesforce, Oracle, Microsoft 365
- Criptografia AES-256 de ponta a ponta

💰 **Faixa de Preço:**
- Plano Starter: R$ 2.500/mês
- Plano Business: R$ 7.800/mês
- Plano Enterprise: sob consulta

🚀 **Prazo de entrega/implementação:** 15 a 30 dias úteis, dependendo da complexidade da integração.

📦 O Produto X possui garantia de 24 meses e suporte técnico 24/7.`,
            sources: ['Ficha Técnica - Produto X.pdf', 'Tabela de Preços 2026.xlsx', 'Manual do Usuário - Produto X.pdf']
        },
        {
            keywords: ['produto y'],
            response: `O **Produto Y** é nossa solução intermediária focada em PMEs:

📋 **Características:**
- Até 3.000 requisições/segundo
- SLA de 99,5%
- Interface simplificada
- Integrações via API REST

💰 **Preço:** a partir de R$ 990/mês
🚀 **Implementação:** 7 a 15 dias úteis.`,
            sources: ['Ficha Técnica - Produto Y.pdf', 'Tabela de Preços 2026.xlsx']
        },
        {
            keywords: ['produto z'],
            response: `O **Produto Z** é nossa solução básica ideal para startups:

📋 **Características:**
- Até 1.000 requisições/segundo
- SLA de 99%
- Setup simplificado em até 48h
- Plano freemium disponível

💰 **Preço:** a partir de R$ 290/mês
🚀 **Implementação:** 3 a 7 dias úteis.`,
            sources: ['Ficha Técnica - Produto Z.pdf', 'Tabela de Preços 2026.xlsx']
        },
        {
            keywords: ['preço', 'preco', 'tabela de preço', 'quanto custa', 'valor', 'custo'],
            response: `Aqui está um resumo da nossa tabela de preços atualizada para 2026:

| Produto | Starter | Business | Enterprise |
|---------|---------|----------|------------|
| Produto X | R$ 2.500/mês | R$ 7.800/mês | Sob consulta |
| Produto Y | R$ 990/mês | R$ 2.800/mês | R$ 6.500/mês |
| Produto Z | R$ 290/mês | R$ 790/mês | R$ 1.900/mês |

📌 Todos os planos incluem suporte técnico. Planos Enterprise incluem gerente de conta dedicado.

💡 **Dica:** Para negociações com desconto por volume, entre em contato com a equipe comercial.`,
            sources: ['Tabela de Preços 2026.xlsx', 'FAQ Comercial.pdf']
        },
        {
            keywords: ['apresentação', 'apresentacao', 'deck', 'slide', 'institucional'],
            response: `Temos os seguintes materiais de apresentação disponíveis:

📊 **Decks Institucionais:**
- Apresentação Institucional 2026 (versão mais recente)
- Template de Proposta Comercial

🏆 **Cases de Sucesso:**
- Case Empresa Alpha — aumento de 340% em eficiência
- Case Empresa Beta — redução de 60% em custos operacionais

🎨 **Materiais de Marca:**
- Manual de Marca e Diretrizes Visuais
- Kit de Logos para Imprensa
- Deck Comercial do Produto X

💡 Todos os materiais estão disponíveis para download nos Materiais de Apoio, seção 'Apresentações'.`,
            sources: ['Apresentação Institucional 2026.pptx', 'Manual de Marca e Diretrizes.pdf', 'Case Empresa Alpha.pptx']
        },
        {
            keywords: ['comercial', 'vendas', 'proposta'],
            response: `Para atividades comerciais, temos os seguintes recursos:

📊 **Materiais de Vendas:**
- Deck Comercial do Produto X
- Template de Proposta Comercial
- Comparativo entre Produtos

📋 **Documentação de Apoio:**
- FAQ Comercial de Produtos
- Tabela de Preços 2026
- Cases de Sucesso (Alpha e Beta)

💡 Todos os materiais estão nos Materiais de Apoio. Recomendo começar pelo FAQ Comercial para argumentação rápida.`,
            sources: ['FAQ Comercial.pdf', 'Template Proposta Comercial.pptx', 'Comparativo Produtos.pdf']
        },
        {
            keywords: ['onboarding', 'novo funcionário', 'novo funcionario', 'integração', 'integracao'],
            response: `O processo de onboarding para novos funcionários segue este roteiro:

**Semana 1 — Integração Geral:**
- Dia 1: Recepção, kit de boas-vindas e tour pelo escritório
- Dia 2-3: Treinamento sobre cultura e valores da empresa
- Dia 4-5: Setup de ferramentas (e-mail, Slack, sistemas internos)

**Semana 2 — Imersão na Área:**
- Reuniões com o gestor e equipe
- Apresentação dos projetos em andamento
- Definição de metas para os primeiros 90 dias

**Semana 3-4 — Treinamento Técnico:**
- Treinamento nos produtos da empresa
- Acesso aos Materiais de Apoio do CorpBrain AI
- Sessões de acompanhamento com buddy

📌 O buddy designado acompanha o novo colaborador por 3 meses.`,
            sources: ['Guia de Onboarding 2026.pdf', 'Manual RH Completo.pdf']
        },
        {
            keywords: ['férias', 'ferias', 'folga', 'licença', 'licenca'],
            response: `As políticas de férias da empresa são:

📅 **Férias Regulares:**
- 30 dias corridos após 12 meses de trabalho
- Podem ser fracionadas em até 3 períodos (mínimo 5 dias cada)
- Solicitação com 30 dias de antecedência via portal RH

🎉 **Day-offs Especiais:**
- Aniversário: 1 dia de folga
- Aniversário de empresa: 1 dia
- Sexta-feira pós-feriado (mediante aprovação)

💰 **Abono Pecuniário:**
- Possibilidade de vender até 10 dias de férias
- Solicitação até 15 dias antes do início das férias

📌 Em caso de dúvidas, contate o RH pelo e-mail rh@corpbrain.com.`,
            sources: ['Manual RH Completo.pdf', 'Política de Home Office.pdf']
        },
        {
            keywords: ['viagem', 'viagens', 'deslocamento'],
            response: `A política de viagens corporativas inclui:

✈️ **Reservas:**
- Solicitar com mínimo 7 dias de antecedência
- Utilizar apenas a agência credenciada (TravelCorp)
- Classe econômica para voos < 4h, executiva para > 4h (direção e acima)

🏨 **Hospedagem:**
- Limite diário: R$ 450 (capitais) / R$ 300 (interior)
- Hotéis da rede credenciada têm tarifa preferencial

🍽️ **Alimentação:**
- Per diem de R$ 120/dia
- Necessário comprovante fiscal para valores acima

📌 Todas as despesas devem ser lançadas no sistema de reembolso em até 5 dias úteis após o retorno.`,
            sources: ['Política de Viagens.pdf', 'Manual de Reembolso Corp.pdf']
        },
        {
            keywords: ['marca', 'logo', 'identidade visual', 'brand'],
            response: `As diretrizes de marca da empresa incluem:

🎨 **Cores Oficiais:**
- Primária: Azul Corporativo (#1E40AF)
- Secundária: Cinza Neutro (#6B7280)
- Destaque: Roxo Inovação (#7C3AED)

📝 **Tipografia:**
- Título: Inter Bold
- Corpo: Inter Regular
- Tamanho mínimo: 12px

🖼️ **Uso do Logo:**
- Área de proteção: 2x a altura do ícone
- Não distorcer, rotacionar ou alterar cores
- Versões: colorido, monocromático, negativo

📦 O kit completo de logos para download está disponível nos Materiais de Apoio.`,
            sources: ['Manual de Marca e Diretrizes.pdf', 'Kit de Logos Imprensa.zip']
        },
        {
            keywords: ['suporte', 'ti', 'help desk', 'helpdesk', 'computador', 'sistema'],
            response: `Para suporte de TI, siga os canais disponíveis:

🖥️ **Canais de Atendimento:**
- Portal: helpdesk.corpbrain.com
- E-mail: suporte@corpbrain.com
- Slack: #canal-ti-suporte
- Ramal: 5555

⏱️ **SLA de Atendimento:**
- Crítico (sistema fora do ar): 1h
- Alto (funcionalidade comprometida): 4h
- Médio (dúvida/configuração): 8h
- Baixo (melhoria/solicitação): 24h

📌 Para reset de senha, acesse diretamente: senha.corpbrain.com`,
            sources: ['Procedimento TI Suporte.pdf']
        },
        {
            keywords: ['compra', 'compras', 'fornecedor', 'aprovação'],
            response: `O fluxo de aprovação de compras funciona assim:

📋 **Etapas:**
1. Solicitante preenche formulário no portal de compras
2. Gestor direto aprova (até R$ 10.000)
3. Diretor da área aprova (R$ 10.001 a R$ 50.000)
4. CFO aprova (acima de R$ 50.000)
5. Departamento de Compras executa a aquisição

⏱️ **Prazos:**
- Aprovação: 2 a 5 dias úteis
- Processamento: 3 a 10 dias úteis

📌 Compras recorrentes podem ter aprovação automática após cadastro.`,
            sources: ['Fluxo de Aprovação de Compras.pdf']
        },
        {
            keywords: ['ética', 'etica', 'conduta', 'compliance'],
            response: `O Código de Conduta e Ética da empresa estabelece:

📋 **Princípios Fundamentais:**
- Integridade e transparência em todas as relações
- Respeito à diversidade e inclusão
- Confidencialidade de informações estratégicas
- Proibição de conflito de interesses

🔒 **Canal de Denúncias:**
- Plataforma anônima: etica.corpbrain.com
- Ouvidoria: ouvidoria@corpbrain.com

📌 Todo funcionário deve concluir o treinamento anual de compliance até dezembro.`,
            sources: ['Código de Conduta e Ética.pdf']
        },
        {
            keywords: ['home office', 'remoto', 'híbrido', 'hibrido'],
            response: `A política de trabalho remoto/híbrido inclui:

🏠 **Modelo Híbrido:**
- 3 dias presenciais + 2 dias home office por semana
- Dias presenciais obrigatórios: terça, quarta e quinta
- Flexibilidade em segunda e sexta

💻 **Infraestrutura:**
- Auxílio home office: R$ 150/mês
- Cadeira ergonômica fornecida mediante solicitação
- VPN corporativa obrigatória

📌 Exceções ao modelo devem ser aprovadas pelo gestor e RH.`,
            sources: ['Política de Home Office.pdf', 'Manual RH Completo.pdf']
        }
    ],

    // Resposta padrão quando não há match — não inventa nomes de documentos:
    // avisa de forma cordial e corporativa que a informação não consta na base.
    defaultResponse: {
        response: `Agradeço a sua pergunta! Verifiquei atentamente nossa base de conhecimento, porém não localizei essa informação nos materiais disponíveis no momento.

Recomendo consultar a área responsável ou aguardar a inclusão de um documento sobre esse tema em nossos **Materiais de Apoio**. Fico à disposição para ajudar com outras dúvidas relacionadas ao conteúdo já cadastrado.`,
        sources: []
    },

    // Respostas extras para arquivos enviados via upload
    dynamicResponses: [],

    /**
     * Processa a mensagem do usuário e retorna resposta + fontes
     */
    getResponse(userMessage) {
        const msg = userMessage.toLowerCase().trim();

        // Primeiro checa respostas dinâmicas (de uploads)
        for (const entry of this.dynamicResponses) {
            for (const kw of entry.keywords) {
                if (msg.includes(kw.toLowerCase())) {
                    return { response: entry.response, sources: entry.sources };
                }
            }
        }

        // Depois checa respostas estáticas
        for (const entry of this.keywordMap) {
            for (const kw of entry.keywords) {
                if (msg.includes(kw.toLowerCase())) {
                    return { response: entry.response, sources: entry.sources };
                }
            }
        }

        return this.defaultResponse;
    },

    /**
     * Adiciona resposta dinâmica para arquivo enviado via upload
     */
    addDynamicResponse(fileName, category) {
        const baseName = fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
        const entry = {
            keywords: [baseName.toLowerCase()],
            response: `Encontrei informações no documento **${fileName}**, recentemente adicionado à base de conhecimento na categoria **${category}**.

📄 Este documento foi processado e indexado com sucesso. O conteúdo já está disponível para consultas futuras.

💡 Para mais detalhes, acesse os Materiais de Apoio no menu lateral.`,
            sources: [fileName]
        };
        this.dynamicResponses.push(entry);
    }
};

// ============================================
// 3. FUNÇÕES UTILITÁRIAS
// ============================================

/** Gera um ID único */
function generateId() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

/** Retorna hora atual formatada HH:MM */
function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Retorna extensão de um arquivo */
function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

/** Retorna nome do ícone Lucide com base na extensão */
function getFileIconName(ext) {
    const map = { pdf: 'file-text', xlsx: 'table', pptx: 'presentation', docx: 'file-text', zip: 'archive' };
    return map[ext] || 'file';
}

/** Converte markdown simplificado para HTML */
function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Tabelas markdown
    const tableRegex = /\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g;
    html = html.replace(tableRegex, (match, header, body) => {
        const headers = header.split('|').filter(h => h.trim());
        const rows = body.trim().split('\n').map(row => row.split('|').filter(c => c.trim()));
        let table = '<table><thead><tr>';
        headers.forEach(h => { table += `<th>${h.trim()}</th>`; });
        table += '</tr></thead><tbody>';
        rows.forEach(row => {
            table += '<tr>';
            row.forEach(cell => { table += `<td>${cell.trim()}</td>`; });
            table += '</tr>';
        });
        table += '</tbody></table>';
        return table;
    });

    // Bold **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Newlines
    html = html.replace(/\n/g, '<br>');
    return html;
}

/** Animação de contagem numérica */
function animateCounter(element, target, duration = 1500) {
    let start = 0;
    const startTime = performance.now();
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Easing ease-out
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(eased * target);
        element.textContent = current.toLocaleString('pt-BR');
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

/** Exibe toast notification */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const iconMap = { success: 'check-circle', error: 'x-circle', info: 'info' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon"><i data-lucide="${iconMap[type] || 'info'}"></i></span>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    lucide.createIcons({ nodes: [toast] });

    setTimeout(() => {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

// ============================================
// 4. GERENCIAMENTO DE CONVERSAS
// ============================================

/** Cria uma nova conversa */
function createConversation(title = null) {
    const conv = {
        id: generateId(),
        title: title || 'Nova conversa',
        messages: [],
        createdAt: new Date()
    };
    AppState.conversations.unshift(conv);
    AppState.currentConversationId = conv.id;
    persistConversation(conv);
    return conv;
}

async function persistConversation(conv) {
    if (!conv || !AuthSystem.isLoggedIn()) return;
    try {
        await API.put(`/conversations/${encodeURIComponent(conv.id)}`, {
            title: conv.title,
            messages: conv.messages
        });
    } catch (error) {
        console.warn('Não foi possível persistir a conversa:', error.message);
    }
}

async function loadConversationsFromAPI() {
    try {
        const data = await API.get('/conversations');
        AppState.conversations = (data.conversations || []).map(c => ({
            ...c,
            createdAt: new Date(c.created_at),
            messages: Array.isArray(c.messages) ? c.messages : []
        }));
        AppState.currentConversationId = null;
    } catch (error) {
        console.warn('Não foi possível carregar o histórico:', error.message);
    }
}

/** Retorna a conversa atual */
function getCurrentConversation() {
    return AppState.conversations.find(c => c.id === AppState.currentConversationId);
}

/** Renderiza o histórico de conversas na sidebar */
function renderChatHistory() {
    const todayEl = document.getElementById('historyToday');
    const yesterdayEl = document.getElementById('historyYesterday');
    const weekEl = document.getElementById('historyWeek');
    todayEl.innerHTML = '';
    yesterdayEl.innerHTML = '';
    weekEl.innerHTML = '';

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);

    AppState.conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'history-item' + (conv.id === AppState.currentConversationId ? ' active' : '');
        item.innerHTML = `
            <span class="history-item-label">
                <i data-lucide="message-square"></i><span>${escapeHtml(conv.title)}</span>
            </span>
            <button class="history-item-delete" data-conv-id="${escapeHtml(conv.id)}" title="Excluir conversa">
                <i data-lucide="trash-2"></i>
            </button>
        `;
        item.addEventListener('click', () => loadConversation(conv.id));
        item.querySelector('.history-item-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            showDeleteConversationModal(conv.id);
        });

        const d = new Date(conv.createdAt);
        if (d >= todayStart) todayEl.appendChild(item);
        else if (d >= yesterdayStart) yesterdayEl.appendChild(item);
        else weekEl.appendChild(item);
    });

    // Mostra/oculta seções vazias
    document.getElementById('history-today').style.display = todayEl.children.length ? '' : 'none';
    document.getElementById('history-yesterday').style.display = yesterdayEl.children.length ? '' : 'none';
    document.getElementById('history-week').style.display = weekEl.children.length ? '' : 'none';

    lucide.createIcons();
}

/** Remove uma conversa do histórico. Se era a conversa aberta, volta para a tela de boas-vindas. */
function deleteConversation(convId) {
    AppState.conversations = AppState.conversations.filter(c => c.id !== convId);
    API.delete(`/conversations/${encodeURIComponent(convId)}`).catch(error => console.warn('Falha ao excluir conversa:', error.message));

    if (AppState.currentConversationId === convId) {
        AppState.currentConversationId = null;
        document.getElementById('welcomeScreen').style.display = '';
        document.getElementById('messagesContainer').innerHTML = '';
    }

    renderChatHistory();
    showToast('Conversa excluída.', 'success');
}

/** Modal de confirmação para excluir uma única conversa do histórico. */
function showDeleteConversationModal(convId) {
    const conv = AppState.conversations.find(c => c.id === convId);
    if (!conv) return;

    const overlay = document.createElement('div');
    overlay.className = 'delete-modal-overlay';
    overlay.innerHTML = `
        <div class="delete-modal">
            <div class="delete-modal-icon"><i data-lucide="alert-triangle"></i></div>
            <h3>Excluir conversa?</h3>
            <p>Isso irá remover permanentemente a conversa <strong>"${escapeHtml(conv.title)}"</strong> do seu histórico. Esta ação não pode ser desfeita.</p>
            <div class="delete-modal-actions">
                <button class="btn-cancel" id="deleteConvCancelBtn">Cancelar</button>
                <button class="btn-delete" id="deleteConvConfirmBtn">Excluir Conversa</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });
    overlay.querySelector('#deleteConvCancelBtn').focus();

    const closeFn = () => overlay.remove();
    overlay.querySelector('#deleteConvCancelBtn').addEventListener('click', closeFn);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFn(); });
    overlay.querySelector('#deleteConvConfirmBtn').addEventListener('click', () => {
        deleteConversation(convId);
        closeFn();
    });
    enableEscapeToClose(closeFn);
}

/** Reseta o estado de conversas do chat (sidebar + painel). Usado ao apagar o histórico e ao trocar de usuário no logout. */
function resetChatState() {
    AppState.conversations = [];
    AppState.currentConversationId = null;
    document.getElementById('welcomeScreen').style.display = '';
    document.getElementById('messagesContainer').innerHTML = '';
    renderChatHistory();
}

/** Apaga todo o histórico de conversas. */
function clearAllHistory() {
    resetChatState();
    API.delete('/conversations').catch(error => console.warn('Falha ao apagar histórico:', error.message));
    showToast('Histórico de conversas apagado.', 'success');
}

/** Modal de confirmação para apagar todo o histórico de conversas. */
function showClearHistoryModal() {
    if (AppState.conversations.length === 0) {
        showToast('Não há conversas no histórico.', 'info');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'delete-modal-overlay';
    overlay.innerHTML = `
        <div class="delete-modal">
            <div class="delete-modal-icon"><i data-lucide="alert-triangle"></i></div>
            <h3>Apagar todo o histórico?</h3>
            <p>Isso irá remover permanentemente todas as <strong>${AppState.conversations.length} conversa(s)</strong> do seu histórico. Esta ação não pode ser desfeita.</p>
            <div class="delete-modal-actions">
                <button class="btn-cancel" id="clearHistoryCancelBtn">Cancelar</button>
                <button class="btn-delete" id="clearHistoryConfirmBtn">Apagar Histórico</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });
    overlay.querySelector('#clearHistoryCancelBtn').focus();

    const closeFn = () => overlay.remove();
    overlay.querySelector('#clearHistoryCancelBtn').addEventListener('click', closeFn);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFn(); });
    overlay.querySelector('#clearHistoryConfirmBtn').addEventListener('click', () => {
        clearAllHistory();
        closeFn();
    });
    enableEscapeToClose(closeFn);
}

/** Carrega uma conversa no painel de chat */
function loadConversation(convId) {
    AppState.currentConversationId = convId;
    const conv = getCurrentConversation();
    if (!conv) return;

    const welcomeScreen = document.getElementById('welcomeScreen');
    const messagesContainer = document.getElementById('messagesContainer');

    if (conv.messages.length === 0) {
        welcomeScreen.style.display = '';
        messagesContainer.innerHTML = '';
    } else {
        welcomeScreen.style.display = 'none';
        messagesContainer.innerHTML = '';
        conv.messages.forEach(msg => {
            appendMessageToDOM(msg.role, msg.text, msg.sources, msg.time, false);
        });
    }

    renderChatHistory();
    scrollChatToBottom();
}

// ============================================
// 5. LÓGICA DO CHAT
// ============================================

/** Adiciona um balão de mensagem ao DOM */
function appendMessageToDOM(role, text, sources = [], time = null, animate = true) {
    const container = document.getElementById('messagesContainer');
    const msgEl = document.createElement('div');
    msgEl.className = `message ${role}` + (animate ? '' : '');

    const formattedText = formatMarkdown(text);
    const timeStr = time || formatTime();

    if (role === 'user') {
        const userInitials = AuthSystem.currentUser ? AuthSystem.currentUser.initials : 'MC';
        msgEl.innerHTML = `
            <div class="message-avatar">${escapeHtml(userInitials)}</div>
            <div class="message-content">
                <div class="message-bubble">${formattedText}</div>
                <span class="message-time">${timeStr}</span>
            </div>
        `;
    } else {
        let sourcesHtml = '';
        if (sources && sources.length > 0) {
            sourcesHtml = '<div class="message-sources">' +
                sources.map(s => `<span class="source-tag"><i data-lucide="file-text"></i> Fonte: ${escapeHtml(s)}</span>`).join('') +
                '</div>';
        }
        msgEl.innerHTML = `
            <div class="message-avatar"><i data-lucide="brain"></i></div>
            <div class="message-content">
                <div class="message-bubble">${formattedText}</div>
                ${sourcesHtml}
                <span class="message-time">${timeStr}</span>
            </div>
        `;
    }

    container.appendChild(msgEl);
    lucide.createIcons({ nodes: [msgEl] });
}

/** Mostra o indicador de digitação */
function showTypingIndicator() {
    const container = document.getElementById('messagesContainer');
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.id = 'typingIndicator';
    typing.innerHTML = `
        <div class="message-avatar"><i data-lucide="brain"></i></div>
        <div class="typing-bubble">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
    `;
    container.appendChild(typing);
    lucide.createIcons({ nodes: [typing] });
    scrollChatToBottom();
}

/** Remove o indicador de digitação */
function removeTypingIndicator() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
}

/** Rola o chat para o final */
function scrollChatToBottom() {
    const chatContainer = document.getElementById('chatContainer');
    setTimeout(() => { chatContainer.scrollTop = chatContainer.scrollHeight; }, 50);
}

/** Envia uma mensagem do usuário */
async function sendMessage(text) {
    if (!text.trim()) return;

    // Garante que há uma conversa ativa
    let conv = getCurrentConversation();
    if (!conv) {
        conv = createConversation();
    }

    // Esconde tela de boas-vindas
    document.getElementById('welcomeScreen').style.display = 'none';

    // Adiciona mensagem do usuário
    const timeStr = formatTime();
    // Captura o histórico ANTES de adicionar a mensagem atual, para enviar ao backend
    // e a IA manter contexto entre perguntas de acompanhamento na mesma conversa.
    const history = conv.messages.slice(-12).map(m => ({ role: m.role, text: m.text }));
    conv.messages.push({ role: 'user', text: text.trim(), time: timeStr });
    appendMessageToDOM('user', text.trim(), [], timeStr);

    // Atualiza título da conversa (baseado na primeira mensagem)
    if (conv.messages.length === 1) {
        conv.title = text.trim().substring(0, 45) + (text.length > 45 ? '...' : '');
    }

    scrollChatToBottom();

    // Limpa input imediatamente
    const input = document.getElementById('chatInput');
    input.value = '';
    input.style.height = 'auto';
    document.getElementById('sendBtn').disabled = true;

    renderChatHistory();

    // Mostra indicador de digitação
    showTypingIndicator();

    try {
        // Obtém resposta (real ou mock)
        const aiResult = await AIProvider.getResponse(text, history);
        
        removeTypingIndicator();

        const aiTime = formatTime();
        conv.messages.push({ role: 'ai', text: aiResult.response, sources: aiResult.sources || [], time: aiTime });
        persistConversation(conv);
        appendMessageToDOM('ai', aiResult.response, aiResult.sources || [], aiTime);

        scrollChatToBottom();
        renderChatHistory();
    } catch (error) {
        removeTypingIndicator();
        showToast('Erro ao processar resposta: ' + error.message, 'error');
    }
}

// ============================================
// 6. SINCRONIZAÇÃO COM API
// ============================================

/** Carrega categorias e arquivos da API e popula o AppState */
async function loadKnowledgeBaseFromAPI() {
    try {
        // Carrega categorias
        const categories = await API.get('/categories');
        AppState.categoryMeta = categories.map(c => ({
            key: c.key,
            label: c.label,
            desc: c.description,
            icon: c.icon,
            color: c.color,
            id: c.id
        }));

        // Carrega arquivos de cada categoria
        AppState.knowledgeBase = {};
        const files = await API.get('/files');
        
        // Agrupa por categoria key
        AppState.categoryMeta.forEach(meta => {
            AppState.knowledgeBase[meta.key] = [];
        });
        
        files.forEach(f => {
            const catMeta = AppState.categoryMeta.find(m => m.id === f.category_id);
            if (catMeta) {
                AppState.knowledgeBase[catMeta.key] = AppState.knowledgeBase[catMeta.key] || [];
                AppState.knowledgeBase[catMeta.key].push({
                    id: f.id,
                    name: f.original_name,
                    desc: f.description,
                    tags: typeof f.tags === 'string' ? JSON.parse(f.tags) : (f.tags || []),
                    size: f.size,
                    ext: f.ext,
                    storedName: f.stored_name
                });
            }
        });
    } catch (err) {
        console.error('Erro ao carregar base de conhecimento:', err);
        showToast('Erro ao carregar base de conhecimento do servidor.', 'error');
    }
}

/** Carrega usuários da API */
async function loadUsersFromAPI() {
    try {
        const data = await API.get('/users');
        return data.users || [];
    } catch (err) {
        console.error('Erro ao carregar usuários:', err);
        return [];
    }
}

async function loadMaterialAudit() {
    const container = document.getElementById('auditContent');
    if (!container) return;
    container.innerHTML = '<div class="audit-loading">Carregando alterações…</div>';
    try {
        const { logs } = await API.get('/material-audit?limit=200');
        const labels = { upload: 'Enviou', create: 'Criou', update: 'Editou', delete: 'Excluiu' };
        const entities = { file: 'documento', category: 'pasta' };
        container.innerHTML = logs.length ? `<div class="audit-table-wrap"><table class="audit-table"><thead><tr><th>Data</th><th>Responsável</th><th>Ação</th><th>Material</th><th>Detalhes</th></tr></thead><tbody>${logs.map(log => `<tr><td>${escapeHtml(new Date(log.created_at + 'Z').toLocaleString('pt-BR'))}</td><td><strong>${escapeHtml(log.user_name)}</strong></td><td><span class="audit-action ${escapeHtml(log.action)}">${escapeHtml(labels[log.action] || log.action)}</span></td><td>${escapeHtml(entities[log.entity_type] || log.entity_type)} · <strong>${escapeHtml(log.entity_name)}</strong></td><td>${escapeHtml(log.details || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="audit-empty"><i data-lucide="clipboard-list"></i><h3>Nenhuma alteração registrada</h3><p>Uploads e mudanças futuras aparecerão aqui.</p></div>';
        lucide.createIcons({ nodes: [container] });
    } catch (error) {
        container.innerHTML = `<div class="audit-empty"><i data-lucide="alert-circle"></i><h3>Não foi possível carregar o log</h3><p>${escapeHtml(error.message)}</p></div>`;
        lucide.createIcons({ nodes: [container] });
    }
}

// ============================================
// 7. NAVEGAÇÃO SPA
// ============================================

function navigateToPage(pageName) {
    // Bloqueia acesso de usuários à Central de Uploads e Gerenciar Usuários
    if (pageName === 'uploads' && !AuthSystem.canUpload()) {
        showToast('Acesso restrito a administradores.', 'error');
        return;
    }
    
    if (pageName === 'settings' && !AuthSystem.isAdmin()) {
        showToast('Acesso restrito a administradores.', 'error');
        return;
    }
    
    if (pageName === 'users' && !AuthSystem.isAdmin()) {
        showToast('Acesso restrito a administradores.', 'error');
        return;
    }
    if (pageName === 'analytics' && !AuthSystem.isAdmin()) {
        showToast('Acesso restrito a administradores.', 'error');
        return;
    }
    if (pageName === 'audit' && !AuthSystem.isAdmin()) {
        showToast('Acesso restrito a administradores.', 'error');
        return;
    }

    // Remove active de todos
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    // Ativa a nova página
    const navItem = document.querySelector(`.nav-item[data-page="${pageName}"]`);
    const page = document.getElementById(`page-${pageName}`);
    if (navItem) navItem.classList.add('active');
    if (page) page.classList.add('active');
    if (['analytics', 'settings', 'users', 'audit'].includes(pageName)) {
        const toggle = document.getElementById('settingsNavToggle');
        const subnav = document.getElementById('settingsSubnav');
        if (toggle && subnav) { toggle.setAttribute('aria-expanded', 'true'); subnav.hidden = false; }
    }
    if (pageName === 'audit') loadMaterialAudit();

    AppState.currentPage = pageName;

    // Atualiza título do documento
    const titles = {
        chat: 'CorpBrain AI — Chat',
        knowledge: 'CorpBrain AI — Materiais de Apoio',
        uploads: 'CorpBrain AI — Central de Uploads',
        analytics: 'CorpBrain AI — Analytics',
        settings: 'CorpBrain AI — Configurações IA',
        users: 'CorpBrain AI — Gerenciar Usuários',
        audit: 'CorpBrain AI — Log de Materiais'
    };
    document.title = titles[pageName] || 'CorpBrain AI';

    // Fecha sidebar no mobile
    if (window.innerWidth <= 768) {
        closeMobileSidebar();
    }
}

// ============================================
// 7. BASE DE CONHECIMENTO
// ============================================

/** Renderiza os arquivos da base de conhecimento (dinâmico) */
function renderKnowledgeBase(filterText = '') {
    const container = document.getElementById('knowledgeCategories');
    container.innerHTML = '';

    AppState.categoryMeta.forEach(meta => {
        const cat = meta.key;
        const allFiles = AppState.knowledgeBase[cat] || [];

        const files = allFiles.filter(file => {
            if (!filterText) return true;
            const q = filterText.toLowerCase();
            return file.name.toLowerCase().includes(q) ||
                   file.tags.some(t => t.toLowerCase().includes(q)) ||
                   file.ext.toLowerCase().includes(q);
        });

        // Botões de editar/excluir bloco (admin)
        const editCatBtn = AuthSystem.canDelete() ? `
            <button class="action-btn category-edit-btn" data-cat-key="${escapeHtml(cat)}" title="Editar bloco">
                <i data-lucide="pencil"></i>
            </button>
        ` : '';
        const deleteCatBtn = AuthSystem.canDelete() ? `
            <button class="action-btn delete-btn category-delete-btn" data-cat-key="${escapeHtml(cat)}" title="Excluir bloco">
                <i data-lucide="trash-2"></i>
            </button>
        ` : '';

        // Section do bloco
        const section = document.createElement('div');
        section.className = 'category-section';
        section.setAttribute('data-category', cat);

        section.innerHTML = `
            <div class="category-header">
                <div class="category-icon ${escapeHtml(meta.color)}"><i data-lucide="${escapeHtml(meta.icon)}"></i></div>
                <div class="category-info">
                    <h2>${escapeHtml(meta.label)}</h2>
                    <p>${escapeHtml(meta.desc)}</p>
                </div>
                <span class="category-count">${files.length}</span>
                ${editCatBtn}
                ${deleteCatBtn}
            </div>
            <div class="category-files"></div>
        `;

        const filesContainer = section.querySelector('.category-files');

        files.forEach(file => {
            const card = document.createElement('div');
            card.className = 'file-card';
            card.setAttribute('data-filename', file.name);
            const iconName = getFileIconName(file.ext);
            const tagsHtml = file.tags.slice(0, 3).map(t => `<span class="file-tag">${escapeHtml(t)}</span>`).join('');

            const deleteBtn = AuthSystem.canDelete() ? `
                <button class="file-delete-btn" data-cat="${escapeHtml(cat)}" data-file="${escapeHtml(file.name)}" title="Excluir documento">
                    <i data-lucide="trash-2"></i>
                </button>
            ` : '';

            card.innerHTML = `
                <div class="file-icon ${escapeHtml(file.ext)}"><i data-lucide="${escapeHtml(iconName)}"></i></div>
                <div class="file-info">
                    <span class="file-name">${escapeHtml(file.name)}</span>
                    <div class="file-meta">
                        ${tagsHtml}
                        <span>· ${escapeHtml(file.size)}</span>
                    </div>
                </div>
                ${deleteBtn}
            `;

            // Evento para visualizar o arquivo
            card.addEventListener('click', () => {
                showFileViewer(file, cat);
            });

            filesContainer.appendChild(card);
        });

        // Durante uma busca, oculta blocos sem nenhum resultado em vez de mostrar um cabeçalho vazio
        if (filterText && files.length === 0) return;

        container.appendChild(section);
    });

    if (filterText && container.children.length === 0) {
        container.innerHTML = `
            <div class="kb-empty-state">
                <i data-lucide="search-x"></i>
                <h3>Nenhum resultado para "${escapeHtml(filterText)}"</h3>
                <p>Tente buscar por outro nome de arquivo, tag ou extensão.</p>
            </div>
        `;
    }

    // Event listeners: excluir arquivo
    document.querySelectorAll('.file-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const category = btn.getAttribute('data-cat');
            const fileName = btn.getAttribute('data-file');
            showDeleteConfirmation(category, fileName);
        });
    });

    // Event listeners: editar bloco
    document.querySelectorAll('.category-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const catKey = btn.getAttribute('data-cat-key');
            showEditCategoryModal(catKey);
        });
    });

    // Event listeners: excluir bloco
    document.querySelectorAll('.category-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const catKey = btn.getAttribute('data-cat-key');
            showDeleteCategoryConfirmation(catKey);
        });
    });

    // Atualiza seletor de upload
    renderUploadCategoryOptions();

    lucide.createIcons();
}

/** Renderiza as opções de categoria no seletor de upload */
function renderUploadCategoryOptions() {
    const optionsContainer = document.getElementById('uploadCategoryOptions');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = AppState.categoryMeta.map(meta => `
        <button class="category-option" data-upload-cat="${escapeHtml(meta.key)}">
            <i data-lucide="${escapeHtml(meta.icon)}"></i> ${escapeHtml(meta.label)}
        </button>
    `).join('');

    lucide.createIcons({ nodes: [optionsContainer] });

    // Re-attach event listeners
    optionsContainer.querySelectorAll('.category-option').forEach(option => {
        option.addEventListener('click', () => {
            optionsContainer.querySelectorAll('.category-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            const cat = option.getAttribute('data-upload-cat');
            AppState.selectedUploadCategory = cat;

            setTimeout(() => {
                processUploadFiles(AppState.pendingUploadFiles, cat);
                AppState.pendingUploadFiles = [];
            }, 300);
        });
    });
}

/** Mostra modal de confirmação de exclusão de arquivo */
function showDeleteConfirmation(category, fileName) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-modal-overlay';
    overlay.innerHTML = `
        <div class="delete-modal">
            <div class="delete-modal-icon"><i data-lucide="alert-triangle"></i></div>
            <h3>Excluir documento?</h3>
            <p>Tem certeza que deseja excluir <strong>${escapeHtml(fileName)}</strong> da base de conhecimento? Esta ação não pode ser desfeita.</p>
            <div class="delete-modal-actions">
                <button class="btn-cancel" id="deleteCancelBtn">Cancelar</button>
                <button class="btn-delete" id="deleteConfirmBtn">Excluir</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });
    overlay.querySelector('#deleteCancelBtn').focus();

    const closeFn = () => overlay.remove();
    overlay.querySelector('#deleteCancelBtn').addEventListener('click', closeFn);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFn(); });
    overlay.querySelector('#deleteConfirmBtn').addEventListener('click', () => {
        deleteKnowledgeFile(category, fileName);
        closeFn();
    });
    enableEscapeToClose(closeFn);
}

/** Mostra modal de confirmação de exclusão de bloco/categoria */
function showDeleteCategoryConfirmation(catKey) {
    const meta = AppState.categoryMeta.find(m => m.key === catKey);
    if (!meta) return;

    const fileCount = (AppState.knowledgeBase[catKey] || []).length;

    const overlay = document.createElement('div');
    overlay.className = 'delete-modal-overlay';
    overlay.innerHTML = `
        <div class="delete-modal">
            <div class="delete-modal-icon"><i data-lucide="alert-triangle"></i></div>
            <h3>Excluir bloco "${escapeHtml(meta.label)}"?</h3>
            <p>Isso irá remover o bloco <strong>${escapeHtml(meta.label)}</strong> e seus <strong>${fileCount} documento(s)</strong> da base de conhecimento. Esta ação não pode ser desfeita.</p>
            <div class="delete-modal-actions">
                <button class="btn-cancel" id="deleteCancelBtn">Cancelar</button>
                <button class="btn-delete" id="deleteConfirmBtn">Excluir Bloco</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });
    overlay.querySelector('#deleteCancelBtn').focus();

    const closeFn = () => overlay.remove();
    overlay.querySelector('#deleteCancelBtn').addEventListener('click', closeFn);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFn(); });
    overlay.querySelector('#deleteConfirmBtn').addEventListener('click', () => {
        deleteCategory(catKey);
        closeFn();
    });
    enableEscapeToClose(closeFn);
}

/** Exclui um bloco/categoria inteira */
async function deleteCategory(catKey) {
    if (!AuthSystem.canDelete()) {
        showToast('Apenas administradores podem excluir blocos.', 'error');
        return;
    }

    const meta = AppState.categoryMeta.find(m => m.key === catKey);
    const label = meta ? meta.label : catKey;

    try {
        await API.delete(`/categories/${meta.id}`);
        await loadKnowledgeBaseFromAPI();
        renderKnowledgeBase();
        updateAnalyticsMetrics();
        showToast(`Bloco "${label}" excluído com sucesso.`, 'success');
    } catch (err) {
        showToast('Erro ao excluir bloco: ' + err.message, 'error');
    }
}

/** Mostra modal para criar novo bloco de conhecimento */
function showAddCategoryModal() {
    const overlay = document.createElement('div');
    overlay.className = 'user-modal-overlay';

    const iconOptionsHtml = CATEGORY_ICON_OPTIONS.map(opt => `
        <option value="${opt.icon}">${opt.label}</option>
    `).join('');

    const colorOptionsHtml = CATEGORY_COLOR_OPTIONS.map(opt => `
        <option value="${opt.key}">${opt.label}</option>
    `).join('');

    overlay.innerHTML = `
        <div class="user-modal">
            <div class="user-modal-header">
                <h2><i data-lucide="folder-plus"></i> Nova Pasta de Conhecimento</h2>
                <button class="action-btn close-modal-btn" id="closeCatModal">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <form id="categoryForm">
                <div class="user-modal-body">
                    <div class="user-form">
                        <div class="form-group">
                            <label>Nome do Bloco</label>
                            <input type="text" id="modalCatLabel" required placeholder="Ex: Treinamentos">
                        </div>
                        <div class="form-group">
                            <label>Descrição</label>
                            <input type="text" id="modalCatDesc" required placeholder="Ex: Materiais de treinamento e capacitação">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Ícone</label>
                                <select id="modalCatIcon">
                                    ${iconOptionsHtml}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Cor</label>
                                <select id="modalCatColor">
                                    ${colorOptionsHtml}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="user-modal-footer">
                    <button type="button" class="btn-cancel" id="cancelCatModal">Cancelar</button>
                    <button type="submit" class="btn-save">Criar Bloco</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });
    document.getElementById('modalCatLabel').focus();

    const closeFn = () => overlay.remove();
    overlay.querySelector('#closeCatModal').addEventListener('click', closeFn);
    overlay.querySelector('#cancelCatModal').addEventListener('click', closeFn);
    enableEscapeToClose(closeFn);

    overlay.querySelector('#categoryForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const label = document.getElementById('modalCatLabel').value.trim();
        const desc = document.getElementById('modalCatDesc').value.trim();
        const icon = document.getElementById('modalCatIcon').value;
        const color = document.getElementById('modalCatColor').value;

        // Gera chave única
        const key = label.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');

        const submitBtn = overlay.querySelector('.btn-save');
        const originalLabel = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Criando...';

        try {
            await API.post('/categories', { key, label, description: desc, icon, color });
            await loadKnowledgeBaseFromAPI();
            renderKnowledgeBase();
            closeFn();
            showToast(`Bloco "${label}" criado com sucesso!`, 'success');
        } catch (err) {
            showToast('Erro ao criar bloco: ' + err.message, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
        }
    });
}

/** Mostra modal para editar um bloco de conhecimento existente */
function showEditCategoryModal(catKey) {
    const meta = AppState.categoryMeta.find(m => m.key === catKey);
    if (!meta) return;

    const overlay = document.createElement('div');
    overlay.className = 'user-modal-overlay';

    const iconOptionsHtml = CATEGORY_ICON_OPTIONS.map(opt => `
        <option value="${opt.icon}" ${opt.icon === meta.icon ? 'selected' : ''}>${opt.label}</option>
    `).join('');

    const colorOptionsHtml = CATEGORY_COLOR_OPTIONS.map(opt => `
        <option value="${opt.key}" ${opt.key === meta.color ? 'selected' : ''}>${opt.label}</option>
    `).join('');

    overlay.innerHTML = `
        <div class="user-modal">
            <div class="user-modal-header">
                <h2><i data-lucide="pencil"></i> Editar Bloco de Conhecimento</h2>
                <button class="action-btn close-modal-btn" id="closeCatModal">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <form id="categoryEditForm">
                <div class="user-modal-body">
                    <div class="user-form">
                        <div class="form-group">
                            <label>Nome do Bloco</label>
                            <input type="text" id="modalCatLabel" required value="${escapeHtml(meta.label)}">
                        </div>
                        <div class="form-group">
                            <label>Descrição</label>
                            <input type="text" id="modalCatDesc" required value="${escapeHtml(meta.desc || '')}">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Ícone</label>
                                <select id="modalCatIcon">
                                    ${iconOptionsHtml}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Cor</label>
                                <select id="modalCatColor">
                                    ${colorOptionsHtml}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="user-modal-footer">
                    <button type="button" class="btn-cancel" id="cancelCatModal">Cancelar</button>
                    <button type="submit" class="btn-save">Salvar Alterações</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });
    document.getElementById('modalCatLabel').focus();

    const closeFn = () => overlay.remove();
    overlay.querySelector('#closeCatModal').addEventListener('click', closeFn);
    overlay.querySelector('#cancelCatModal').addEventListener('click', closeFn);
    enableEscapeToClose(closeFn);

    overlay.querySelector('#categoryEditForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const label = document.getElementById('modalCatLabel').value.trim();
        const desc = document.getElementById('modalCatDesc').value.trim();
        const icon = document.getElementById('modalCatIcon').value;
        const color = document.getElementById('modalCatColor').value;

        const submitBtn = overlay.querySelector('.btn-save');
        const originalLabel = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Salvando...';

        try {
            await API.put(`/categories/${meta.id}`, { label, description: desc, icon, color });
            await loadKnowledgeBaseFromAPI();
            renderKnowledgeBase();
            closeFn();
            showToast(`Bloco "${label}" atualizado com sucesso!`, 'success');
        } catch (err) {
            showToast('Erro ao atualizar bloco: ' + err.message, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
        }
    });
}

/** Exclui um arquivo da base de conhecimento */
async function deleteKnowledgeFile(category, fileName) {
    if (!AuthSystem.canDelete()) {
        showToast('Apenas administradores podem excluir documentos.', 'error');
        return;
    }

    const files = AppState.knowledgeBase[category] || [];
    const file = files.find(f => f.name === fileName);
    if (!file) return;

    try {
        await API.delete(`/files/${file.id}`);
        await loadKnowledgeBaseFromAPI();
        renderKnowledgeBase();
        updateAnalyticsMetrics();
        showToast(`"${fileName}" foi excluído da base de conhecimento.`, 'success');
    } catch (err) {
        showToast('Erro ao excluir arquivo: ' + err.message, 'error');
    }
}

/** Mostra o modal de visualização de arquivos */
function showFileViewer(file, category) {
    const overlay = document.createElement('div');
    overlay.className = 'file-viewer-overlay';
    
    const iconName = getFileIconName(file.ext);
    const catMeta = AppState.categoryMeta.find(m => m.key === category);
    const catLabel = catMeta ? catMeta.label : category;
    
    overlay.innerHTML = `
        <div class="file-viewer-modal">
            <div class="file-viewer-header">
                <div class="file-viewer-title-group">
                    <div class="file-viewer-icon ${escapeHtml(file.ext)}">
                        <i data-lucide="${escapeHtml(iconName)}"></i>
                    </div>
                    <div class="file-viewer-info">
                        <span class="file-viewer-name">${escapeHtml(file.name)}</span>
                        <div class="file-viewer-meta">
                            ${(file.tags || []).map(t => `<span class="file-tag">${escapeHtml(t)}</span>`).join('')}
                            <span>· ${escapeHtml(file.size)}</span>
                        </div>
                    </div>
                </div>
                <button class="action-btn close-modal-btn" id="closeViewerBtn" title="Fechar">
                    <i data-lucide="x"></i>
                </button>
            </div>
            
            <div class="file-viewer-body" id="fileViewerBody">
                <div class="mock-doc-content" style="text-align:center; padding: 3rem;">
                    <div class="typing-dots" style="justify-content:center">
                        <span></span><span></span><span></span>
                    </div>
                    <p style="margin-top:1rem; opacity:0.6;">Carregando conteúdo do documento...</p>
                </div>
            </div>
            
            <div class="file-viewer-toolbar">
                <button class="btn-download" id="downloadFileBtn">
                    <i data-lucide="download"></i>
                    Fazer Download
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });
    
    const closeFn = () => overlay.remove();
    overlay.querySelector('#closeViewerBtn').addEventListener('click', closeFn);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeFn();
    });
    enableEscapeToClose(closeFn);

    // Download
    overlay.querySelector('#downloadFileBtn').addEventListener('click', () => {
        if (file.id) {
            const token = localStorage.getItem('corpbrain_token');
            fetch(`/api/files/${file.id}/download`, { headers: { 'Authorization': `Bearer ${token}` } })
                .then(res => { if (!res.ok) throw new Error('Erro'); return res.blob(); })
                .then(blob => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = file.name;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    showToast(`Download de "${file.name}" iniciado!`, 'success');
                })
                .catch(() => showToast('Erro ao baixar arquivo.', 'error'));
        } else {
            showToast('Arquivo de demonstração — download não disponível.', 'info');
        }
    });
    
    // Fechar ao clicar fora (no overlay)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeFn();
    });

    // Busca conteúdo real da API
    const viewerBody = overlay.querySelector('#fileViewerBody');
    
    if (file.id) {
        API.get(`/files/${file.id}/preview`)
            .then(data => {
                if (data.text) {
                    const escapedText = data.text
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    
                    const pageInfo = data.pages ? `<p style="opacity:0.5; font-size:0.85rem; margin-bottom:1rem;">${data.pages} página(s) | Categoria: ${escapeHtml(catLabel)}</p>` : '';

                    viewerBody.innerHTML = `
                        <div class="mock-doc-content ${escapeHtml(data.type || '')}">
                            <div class="mock-doc-header">
                                <h1>${escapeHtml(file.name.replace(/\.[^/.]+$/, ''))}</h1>
                                ${pageInfo}
                            </div>
                            <div class="mock-doc-text" style="white-space: pre-wrap; font-family: inherit; line-height: 1.7;">
                                ${escapedText}
                            </div>
                        </div>
                    `;
                } else {
                    viewerBody.innerHTML = `
                        <div class="mock-doc-content">
                            <div class="mock-doc-header">
                                <h1>${escapeHtml(file.name)}</h1>
                                <p>Categoria: ${escapeHtml(catLabel)} | Tamanho: ${escapeHtml(file.size)}</p>
                            </div>
                            <div class="mock-doc-text">
                                <p>${escapeHtml(data.message) || 'Pré-visualização não disponível para este tipo de arquivo.'}</p>
                                <p>Use o botão <strong>Fazer Download</strong> abaixo para baixar o arquivo completo.</p>
                            </div>
                        </div>
                    `;
                }
            })
            .catch(() => {
                viewerBody.innerHTML = `
                    <div class="mock-doc-content">
                        <div class="mock-doc-text">
                            <p>Não foi possível carregar o conteúdo. Use o botão de download.</p>
                        </div>
                    </div>
                `;
            });
    } else {
        viewerBody.innerHTML = `
            <div class="mock-doc-content">
                <div class="mock-doc-header">
                    <h1>${escapeHtml(file.name)}</h1>
                    <p>Categoria: ${escapeHtml(catLabel)} | Tamanho: ${escapeHtml(file.size)}</p>
                </div>
                <div class="mock-doc-text">
                    <p>Arquivo de demonstração — conteúdo disponível após upload real.</p>
                </div>
            </div>
        `;
    }
}

// ============================================
// 8. SISTEMA DE UPLOAD
// ============================================

function processUploadFiles(files, category) {
    const queueTitle = document.getElementById('queueTitle');
    const queueList = document.getElementById('queueList');
    const categorySelector = document.getElementById('uploadCategorySelector');

    categorySelector.style.display = 'none';
    queueTitle.style.display = 'flex';
    queueTitle.classList.add('spinning');

    files.forEach((file, index) => {
        const ext = getFileExtension(file.name);
        const iconName = getFileIconName(ext);

        const queueItem = document.createElement('div');
        queueItem.className = 'queue-item';
        queueItem.id = `queue-${index}-${Date.now()}`;
        queueItem.innerHTML = `
            <div class="queue-item-icon ${escapeHtml(ext)}"><i data-lucide="${escapeHtml(iconName)}"></i></div>
            <div class="queue-item-info">
                <span class="queue-item-name">${escapeHtml(file.name)}</span>
                <span class="queue-item-status reading">Enviando arquivo...</span>
                <div class="progress-bar-wrapper">
                    <div class="progress-bar" style="width: 0%"></div>
                </div>
            </div>
        `;
        queueList.appendChild(queueItem);
        lucide.createIcons({ nodes: [queueItem] });

        const progressBar = queueItem.querySelector('.progress-bar');
        const statusEl = queueItem.querySelector('.queue-item-status');

        progressBar.style.width = '30%';

        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', category);

        API.upload('/files/upload', formData)
            .then(async () => {
                statusEl.className = 'queue-item-status indexing';
                statusEl.textContent = 'Indexando conteúdo...';
                progressBar.style.width = '70%';
                await new Promise(r => setTimeout(r, 800));

                statusEl.className = 'queue-item-status done';
                statusEl.textContent = 'Pronto para consulta ✓';
                progressBar.style.width = '100%';

                const checkEl = document.createElement('div');
                checkEl.className = 'queue-item-check';
                checkEl.innerHTML = '<i data-lucide="check-circle"></i>';
                queueItem.appendChild(checkEl);
                lucide.createIcons({ nodes: [checkEl] });

                await loadKnowledgeBaseFromAPI();
                renderKnowledgeBase();
                updateAnalyticsMetrics();
                showToast(`"${file.name}" enviado com sucesso!`, 'success');

                if (index === files.length - 1) queueTitle.classList.remove('spinning');
            })
            .catch((err) => {
                statusEl.className = 'queue-item-status';
                statusEl.textContent = 'Erro no envio ✘';
                statusEl.style.color = '#ef4444';
                progressBar.style.width = '100%';
                progressBar.style.background = '#ef4444';
                showToast(`Erro ao enviar "${file.name}": ${err.message}`, 'error');
                if (index === files.length - 1) queueTitle.classList.remove('spinning');
            });
    });
}

// ============================================
// 9. ANALYTICS
// ============================================

function renderAnalytics() {
    const totalDocs = Object.values(AppState.knowledgeBase).reduce((sum, cat) => sum + cat.length, 0);
    animateCounter(document.getElementById('metricDocsTotal'), totalDocs);
    renderUsageAnalytics();
}

const PROVIDER_LABELS = { openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude', groq: 'Groq' };

/** Formata "há X min/h/dias" a partir de um timestamp SQL vindo do backend. */
function formatRelativeTime(dateStr) {
    const then = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
    const diffMin = Math.floor((Date.now() - then.getTime()) / 60000);
    if (diffMin < 1) return 'agora mesmo';
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    return `há ${Math.floor(diffH / 24)}d`;
}

/**
 * Busca e renderiza todas as métricas reais do Analytics (perguntas hoje/mês,
 * baixa confiança, termos mais pesquisados, documentos mais citados e consumo
 * de tokens) a partir de /api/ai/usage — tudo derivado de chamadas reais à IA
 * (o MockAIEngine local, usado quando a IA não está configurada, não é contado).
 */
async function renderUsageAnalytics() {
    let usage;
    try {
        usage = await API.get('/ai/usage');
    } catch (err) {
        return; // deixa os cards com o valor anterior (ou 0) em caso de falha
    }

    animateCounter(document.getElementById('metricQueriesDay'), usage.today.requests);
    animateCounter(document.getElementById('metricQueriesMonth'), usage.month.requests);
    animateCounter(document.getElementById('metricLowConfidence'), usage.lowConfidence.month);

    // Termos Mais Pesquisados
    const tagCloud = document.getElementById('tagCloud');
    if (tagCloud) {
        if (usage.topTerms.length === 0) {
            tagCloud.innerHTML = '<p class="empty-hint">Nenhuma pergunta registrada ainda.</p>';
        } else {
            const maxTermCount = usage.topTerms[0].count;
            tagCloud.innerHTML = usage.topTerms.map(t => {
                const ratio = t.count / maxTermCount;
                const size = ratio >= 0.66 ? 'lg' : ratio >= 0.33 ? 'md' : 'sm';
                return `<span class="tag-item" data-size="${size}" title="${t.count}x">${escapeHtml(t.text)}</span>`;
            }).join('');
        }
    }

    // Documentos Mais Acessados (mais citados como fonte pela IA no mês)
    const topDocsList = document.getElementById('topDocsList');
    if (topDocsList) {
        if (usage.topDocuments.length === 0) {
            topDocsList.innerHTML = '<p class="empty-hint">Nenhum documento citado como fonte ainda.</p>';
        } else {
            const maxDocCount = usage.topDocuments[0].count;
            topDocsList.innerHTML = usage.topDocuments.map((doc, i) => `
                <div class="top-doc-item">
                    <span class="top-doc-rank">${i + 1}</span>
                    <div class="top-doc-info">
                        <span class="top-doc-name">${escapeHtml(doc.name)}</span>
                        <span class="top-doc-count">${doc.count} consulta(s)</span>
                    </div>
                    <div class="top-doc-bar-wrapper">
                        <div class="top-doc-bar" style="width: ${(doc.count / maxDocCount * 100)}%"></div>
                    </div>
                </div>
            `).join('');
        }
    }

    // Respostas com Baixa Confiança (perguntas sem correspondência na base)
    const lowConfList = document.getElementById('lowConfidenceList');
    if (lowConfList) {
        if (usage.lowConfidenceList.length === 0) {
            lowConfList.innerHTML = '<p class="empty-hint">Nenhuma pergunta ficou sem resposta na base até agora.</p>';
        } else {
            lowConfList.innerHTML = usage.lowConfidenceList.map(item => `
                <div class="low-conf-item">
                    <span class="conf-question">${escapeHtml(item.question)}</span>
                    <span class="conf-score low">Não encontrado na base</span>
                    <span class="conf-doc">${formatRelativeTime(item.created_at)}</span>
                </div>
            `).join('');
        }
    }

    const summaryEl = document.getElementById('tokensSummary');
    if (summaryEl) {
        summaryEl.innerHTML = `Hoje: <strong>${usage.today.tokens.toLocaleString('pt-BR')}</strong> tokens · Este mês: <strong>${usage.month.tokens.toLocaleString('pt-BR')}</strong> tokens`;
    }

    const byProviderList = document.getElementById('tokensByProviderList');
    if (byProviderList) {
        if (usage.byProvider.length === 0) {
            byProviderList.innerHTML = '<p class="empty-hint">Nenhum uso de IA registrado ainda.</p>';
        } else {
            const maxTokens = Math.max(...usage.byProvider.map(p => p.tokens), 1);
            byProviderList.innerHTML = usage.byProvider.map(p => `
                <div class="top-doc-item">
                    <div class="top-doc-info">
                        <span class="top-doc-name">${escapeHtml(PROVIDER_LABELS[p.provider] || p.provider)}</span>
                        <span class="top-doc-count">${p.tokens.toLocaleString('pt-BR')} tokens</span>
                    </div>
                    <div class="top-doc-bar-wrapper">
                        <div class="top-doc-bar" style="width: ${(p.tokens / maxTokens * 100)}%"></div>
                    </div>
                </div>
            `).join('');
        }
    }

    const byUserList = document.getElementById('tokensByUserList');
    if (byUserList) {
        if (usage.topUsers.length === 0) {
            byUserList.innerHTML = '<p class="empty-hint">Nenhum uso de IA registrado ainda.</p>';
        } else {
            const maxTokens = Math.max(...usage.topUsers.map(u => u.tokens), 1);
            byUserList.innerHTML = usage.topUsers.map(u => `
                <div class="top-doc-item">
                    <div class="top-doc-info">
                        <span class="top-doc-name">${escapeHtml(u.name)}</span>
                        <span class="top-doc-count">${u.tokens.toLocaleString('pt-BR')} tokens</span>
                    </div>
                    <div class="top-doc-bar-wrapper">
                        <div class="top-doc-bar" style="width: ${(u.tokens / maxTokens * 100)}%"></div>
                    </div>
                </div>
            `).join('');
        }
    }
}

/** Atualiza só a contagem de documentos indexados (chamado após upload/exclusão de arquivo/bloco) */
function updateAnalyticsMetrics() {
    const totalDocs = Object.values(AppState.knowledgeBase).reduce((sum, cat) => sum + cat.length, 0);
    const el = document.getElementById('metricDocsTotal');
    if (el) el.textContent = totalDocs;
}

// ============================================
// 10. GERENCIAMENTO DE USUÁRIOS
// ============================================

async function renderUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    let users;
    try {
        users = await loadUsersFromAPI();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5">Erro ao carregar usuários.</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => {
        const isCurrentUser = AuthSystem.currentUser && AuthSystem.currentUser.email === user.email;
        const roleBadge = user.role === 'admin'
            ? '<span class="login-hint-badge admin">Admin</span>'
            : '<span class="login-hint-badge user">Usuário</span>';

        const actions = `
            <div class="user-cell-actions">
                <button class="action-btn user-edit-btn" data-user-id="${user.id}" title="Editar usuário">
                    <i data-lucide="edit-2"></i>
                </button>
                ${!isCurrentUser ? `
                <button class="action-btn delete-btn user-delete-btn" data-user-id="${user.id}" data-user-email="${escapeHtml(user.email)}" title="Excluir usuário">
                    <i data-lucide="trash-2"></i>
                </button>` : ''}
            </div>
        `;

        return `
            <tr>
                <td class="user-cell-avatar">
                    <div class="user-table-avatar ${user.role !== 'admin' ? 'user-avatar-alt' : ''}">
                        ${escapeHtml(user.initials || user.name.charAt(0).toUpperCase())}
                    </div>
                </td>
                <td class="user-cell-name">
                    <span class="user-table-name">${escapeHtml(user.name)}</span>
                    <span class="user-table-title">${escapeHtml(user.title)}</span>
                </td>
                <td class="user-cell-email">${escapeHtml(user.email)}</td>
                <td class="user-cell-role">${roleBadge}</td>
                <td>${actions}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.user-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => showUserModal(Number(btn.getAttribute('data-user-id'))));
    });
    tbody.querySelectorAll('.user-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteUser(Number(btn.getAttribute('data-user-id')), btn.getAttribute('data-user-email')));
    });

    lucide.createIcons();
}

async function showUserModal(userId = null) {
    let user = null;
    let isEdit = false;
    
    if (userId) {
        try {
            const users = await loadUsersFromAPI();
            user = users.find(u => u.id === userId);
            isEdit = true;
        } catch (err) {
            showToast('Erro ao carregar dados do usuário.', 'error');
            return;
        }
    }

    const overlay = document.createElement('div');
    overlay.className = 'user-modal-overlay';
    
    const title = isEdit ? 'Editar Usuário' : 'Novo Usuário';
    
    overlay.innerHTML = `
        <div class="user-modal">
            <div class="user-modal-header">
                <h2><i data-lucide="${isEdit ? 'user-cog' : 'user-plus'}"></i> ${title}</h2>
                <button class="action-btn close-modal-btn" id="closeUserModal">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <form id="userForm">
                <div class="user-modal-body">
                    <div class="user-form">
                        <div class="form-group">
                            <label>Nome Completo</label>
                            <input type="text" id="modalUserName" value="${escapeHtml(user ? user.name : '')}" required placeholder="Ex: João Silva">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>E-mail</label>
                                <input type="email" id="modalUserEmail" value="${escapeHtml(user ? user.email : '')}" required ${isEdit ? 'readonly' : ''} placeholder="joao@corpbrain.com">
                            </div>
                            <div class="form-group">
                                <label>Senha ${isEdit ? '(deixe em branco para manter)' : ''}</label>
                                <input type="password" id="modalUserPassword" minlength="8" ${!isEdit ? 'required' : ''} placeholder="Mínimo 8 caracteres">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Cargo / Título</label>
                                <input type="text" id="modalUserTitle" value="${escapeHtml(user ? user.title : '')}" required placeholder="Ex: Analista Sênior">
                            </div>
                            <div class="form-group">
                                <label>Papel no Sistema</label>
                                <select id="modalUserRole">
                                    <option value="user" ${user && user.role === 'user' ? 'selected' : ''}>Usuário</option>
                                    <option value="admin" ${user && user.role === 'admin' ? 'selected' : ''}>Administrador</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="user-modal-footer">
                    <button type="button" class="btn-cancel" id="cancelUserModal">Cancelar</button>
                    <button type="submit" class="btn-save">${isEdit ? 'Salvar Alterações' : 'Criar Usuário'}</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(overlay);
    lucide.createIcons({ nodes: [overlay] });
    document.getElementById('modalUserName').focus();

    const closeFn = () => overlay.remove();
    overlay.querySelector('#closeUserModal').addEventListener('click', closeFn);
    overlay.querySelector('#cancelUserModal').addEventListener('click', closeFn);
    enableEscapeToClose(closeFn);
    
    overlay.querySelector('#userForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('modalUserName').value.trim();
        const emailInput = document.getElementById('modalUserEmail').value.trim();
        const pass = document.getElementById('modalUserPassword').value;
        const titleVal = document.getElementById('modalUserTitle').value.trim();
        const role = document.getElementById('modalUserRole').value;
        
        const parts = name.split(' ');
        let initials = parts[0].charAt(0).toUpperCase();
        if (parts.length > 1) {
            initials += parts[parts.length - 1].charAt(0).toUpperCase();
        }
        
        const submitBtn = overlay.querySelector('.btn-save');
        const originalLabel = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Salvando...';

        try {
            if (isEdit) {
                const body = { name, title: titleVal, role, initials };
                if (pass) body.password = pass;
                await API.put(`/users/${userId}`, body);
                showToast('Usuário atualizado com sucesso!', 'success');
            } else {
                await API.post('/users', { email: emailInput, password: pass, role, name, initials, title: titleVal });
                showToast('Usuário criado com sucesso!', 'success');
            }
            await renderUsers();
            closeFn();
        } catch (err) {
            showToast('Erro: ' + err.message, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
        }
    });
}

async function deleteUser(userId, email) {
    if (confirm(`Tem certeza que deseja excluir o usuário ${email}?`)) {
        try {
            await API.delete(`/users/${userId}`);
            await renderUsers();
            showToast('Usuário excluído com sucesso.', 'info');
        } catch (err) {
            showToast('Erro ao excluir: ' + err.message, 'error');
        }
    }
}

// ============================================
// 11. SIDEBAR TOGGLE
// ============================================

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    AppState.sidebarCollapsed = sidebar.classList.contains('collapsed');
}

function openMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.add('mobile-open');
    sidebar.classList.remove('collapsed');

    // Cria overlay
    let overlay = document.querySelector('.mobile-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'mobile-overlay';
        overlay.addEventListener('click', closeMobileSidebar);
        document.body.appendChild(overlay);
    }
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('mobile-open');

    const overlay = document.querySelector('.mobile-overlay');
    if (overlay) overlay.remove();
}

// ============================================
// 12. PÁGINA DE CONFIGURAÇÕES DE IA
// ============================================

/** Inicializa os event listeners da página de settings */
function initSettingsPage() {
    // Provider selection
    const providerGrid = document.getElementById('providerGrid');
    if (providerGrid) {
        providerGrid.querySelectorAll('.provider-option').forEach(btn => {
            btn.addEventListener('click', () => {
                providerGrid.querySelectorAll('.provider-option').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                AIProvider.config.provider = btn.getAttribute('data-provider');
                populateModelSelect(AIProvider.config.provider);
            });
        });
    }

    // Toggle API key visibility
    const toggleBtn = document.getElementById('toggleKeyVisibility');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const input = document.getElementById('apiKeyInput');
            if (input.type === 'password') {
                input.type = 'text';
                toggleBtn.innerHTML = '<i data-lucide="eye-off"></i>';
            } else {
                input.type = 'password';
                toggleBtn.innerHTML = '<i data-lucide="eye"></i>';
            }
            lucide.createIcons({ nodes: [toggleBtn] });
        });
    }

    // Save settings
    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const apiKeyTyped = document.getElementById('apiKeyInput').value.trim();
            AIProvider.config.model = document.getElementById('aiModelSelect').value;
            AIProvider.config.systemPrompt = document.getElementById('systemPromptInput').value.trim();

            saveBtn.disabled = true;
            saveBtn.querySelector('span').textContent = 'Salvando...';

            try {
                // Chave vazia mantém a já salva no servidor (nunca é reenviada ao cliente).
                await AIProvider.saveSettings(apiKeyTyped);
                document.getElementById('apiKeyInput').value = '';
                updateAIStatusCard();
                showToast('Configurações de IA salvas com sucesso!', 'success');
            } catch (error) {
                showToast('Erro ao salvar: ' + error.message, 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.querySelector('span').textContent = 'Salvar Configurações';
            }
        });
    }

    // Test connection
    const testBtn = document.getElementById('testConnectionBtn');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            const apiKeyTyped = document.getElementById('apiKeyInput').value.trim();
            AIProvider.config.model = document.getElementById('aiModelSelect').value;

            if (!apiKeyTyped) {
                showToast('Digite a API key para testar (mesmo que já tenha uma salva).', 'error');
                return;
            }

            testBtn.disabled = true;
            testBtn.querySelector('span').textContent = 'Testando...';

            try {
                const result = await AIProvider.testConnection(apiKeyTyped);
                showToast('Conexão bem-sucedida! Resposta: ' + result.substring(0, 100), 'success');
            } catch (error) {
                showToast('Falha na conexão: ' + error.message, 'error');
            } finally {
                testBtn.disabled = false;
                testBtn.querySelector('span').textContent = 'Testar Conexão';
            }
        });
    }

    // Popula os campos com as configurações salvas
    populateSettingsForm();
}

/** Popula os campos da página de settings com os valores do AIProvider */
function populateSettingsForm() {
    const apiKeyInput = document.getElementById('apiKeyInput');
    const systemPromptInput = document.getElementById('systemPromptInput');
    const providerGrid = document.getElementById('providerGrid');

    // A chave nunca volta do servidor: campo fica vazio, com placeholder indicando se já há uma salva.
    if (apiKeyInput) {
        apiKeyInput.value = '';
        apiKeyInput.placeholder = AIProvider.configured
            ? '•••••••••••••••• (chave já configurada — deixe em branco para manter)'
            : 'sk-...';
    }
    if (systemPromptInput) systemPromptInput.value = AIProvider.config.systemPrompt || '';

    if (providerGrid) {
        providerGrid.querySelectorAll('.provider-option').forEach(btn => {
            btn.classList.toggle('selected', btn.getAttribute('data-provider') === AIProvider.config.provider);
        });
    }

    populateModelSelect(AIProvider.config.provider);
}

/** Popula o select de modelos com base no provedor selecionado */
function populateModelSelect(provider) {
    const select = document.getElementById('aiModelSelect');
    if (!select) return;

    const models = [...(AI_MODELS[provider] || [])];
    // Preserve modelos configurados no backend que ainda não estejam na lista
    // estática do frontend, evitando sobrescrevê-los ao salvar configurações.
    if (AIProvider.config.model && !models.some(m => m.value === AIProvider.config.model)) {
        models.unshift({ value: AIProvider.config.model, label: `${AIProvider.config.model} (configurado)` });
    }
    select.innerHTML = models.map(m =>
        `<option value="${m.value}" ${m.value === AIProvider.config.model ? 'selected' : ''}>${m.label}</option>`
    ).join('');
}

/** Atualiza o card de status da IA */
function updateAIStatusCard() {
    const indicator = document.getElementById('aiStatusIndicator');
    const label = document.getElementById('aiStatusLabel');
    const detail = document.getElementById('aiStatusDetail');

    if (!indicator || !label || !detail) return;

    if (AIProvider.isConfigured()) {
        const providerNames = { openai: 'OpenAI', gemini: 'Google Gemini', claude: 'Anthropic Claude', groq: 'Groq' };
        const provName = providerNames[AIProvider.config.provider] || AIProvider.config.provider;

        indicator.className = 'status-indicator online';
        label.textContent = `IA Online — ${provName} (${AIProvider.config.model})`;
        detail.textContent = 'O chat está usando inteligência artificial real para gerar respostas.';
    } else {
        indicator.className = 'status-indicator offline';
        label.textContent = 'IA Offline — Usando respostas simuladas (Mock)';
        detail.textContent = 'Configure uma API key para ativar a inteligência artificial real.';
    }
}

// ============================================
// 13. LÓGICA DE LOGIN / LOGOUT
// ============================================

/** Exibe a tela de login */
function showLoginScreen() {
    document.getElementById('loginScreen').style.display = '';
    document.getElementById('loginScreen').classList.remove('fade-out');
    document.getElementById('appWrapper').style.display = 'none';
}

/** Esconde a tela de login e mostra o app */
function hideLoginScreen() {
    const loginScreen = document.getElementById('loginScreen');
    loginScreen.classList.add('fade-out');

    setTimeout(() => {
        loginScreen.style.display = 'none';
        document.getElementById('appWrapper').style.display = 'flex';
    }, 550);
}

function openProfileEditor() {
    if (!AuthSystem.currentUser || document.getElementById('profileDialog')) return;
    const user = AuthSystem.currentUser;
    const dialog = document.createElement('dialog');
    dialog.id = 'profileDialog';
    dialog.className = 'profile-dialog';
    dialog.setAttribute('aria-labelledby', 'profileHeading');
    dialog.innerHTML = `
        <div class="profile-heading"><div><span class="eyebrow">DO SEU JEITO</span><h2 id="profileHeading">Meu perfil</h2></div>
        <button type="button" class="close-modal-btn" aria-label="Fechar perfil"><i data-lucide="x"></i></button></div>
        <p class="profile-intro">Como você aparece para sua equipe.</p>
        <form class="settings-form" id="profileForm">
            <div class="form-group"><label for="profileName">Nome</label><input id="profileName" name="name" required maxlength="100" autocomplete="name"></div>
            <div class="form-group"><label for="profileTitle">Cargo</label><input id="profileTitle" name="title" maxlength="100" autocomplete="organization-title" placeholder="Seu cargo ou área"></div>
            <div class="form-group"><label for="profileInitials">Iniciais do avatar</label><input id="profileInitials" name="initials" maxlength="3" placeholder="Ex.: MC"><span class="form-hint">Deixe em branco para gerar a partir do nome.</span></div>
            <div class="form-group"><label for="profileEmail">E-mail de acesso</label><input id="profileEmail" type="email" readonly><span class="form-hint">Para alterar o acesso, fale com o administrador.</span></div>
            <p class="profile-error" role="alert" hidden></p>
            <div class="settings-actions"><button type="button" class="btn-test profile-cancel">Cancelar</button><button type="submit" class="btn-save-settings">Salvar perfil</button></div>
        </form>`;
    document.body.appendChild(dialog);
    dialog.querySelector('#profileName').value = user.name || '';
    dialog.querySelector('#profileTitle').value = user.title || '';
    dialog.querySelector('#profileInitials').value = user.initials || '';
    dialog.querySelector('#profileEmail').value = user.email || '';
    let saving = false;
    const close = () => { if (!saving) dialog.close(); };
    dialog.querySelector('.close-modal-btn').addEventListener('click', close);
    dialog.querySelector('.profile-cancel').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => {
        dialog.remove();
        document.getElementById('userAvatar').focus();
    }, { once: true });
    dialog.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        if (saving) return;
        const name = dialog.querySelector('#profileName').value.trim();
        const error = dialog.querySelector('.profile-error');
        error.hidden = true;
        if (!name) { error.textContent = 'Informe seu nome.'; error.hidden = false; return; }
        saving = true;
        const submit = dialog.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = 'Salvando…';
        try {
            const result = await API.put('/auth/me', {
                name, title: dialog.querySelector('#profileTitle').value.trim(),
                initials: dialog.querySelector('#profileInitials').value.trim()
            });
            AuthSystem.currentUser = result.user;
            document.getElementById('userAvatar').textContent = result.user.initials;
            document.getElementById('userName').textContent = result.user.name;
            document.getElementById('userRole').textContent = result.user.title;
            if (AuthSystem.isAdmin()) renderUsers();
            dialog.close();
            showToast('Perfil atualizado!', 'success');
        } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
        } finally {
            saving = false;
            submit.disabled = false;
            submit.textContent = 'Salvar perfil';
        }
    });
    lucide.createIcons();
    dialog.showModal();
}

/** Atualiza a UI com os dados do usuário logado */
function updateUIForUser() {
    const user = AuthSystem.currentUser;
    if (!user) return;

    // Sidebar - avatar, nome, cargo
    document.getElementById('userAvatar').textContent = user.initials;
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userRole').textContent = user.title;

    // Badge Admin
    const badge = document.getElementById('userBadge');
    badge.style.display = user.role === 'admin' ? '' : 'none';

    // Visibilidade do menu de Usuários
    const navUsers = document.getElementById('nav-users');
    if (navUsers) {
        navUsers.style.display = user.role === 'admin' ? 'flex' : 'none';
    }
    const navAudit = document.getElementById('nav-audit');
    if (navAudit) navAudit.style.display = user.role === 'admin' ? 'flex' : 'none';
    const settingsNavGroup = document.getElementById('settingsNavGroup');
    if (settingsNavGroup) settingsNavGroup.style.display = user.role === 'admin' ? '' : 'none';
    const adminOnlyNav = ['nav-analytics', 'nav-settings', 'nav-users', 'nav-audit'];
    adminOnlyNav.forEach(id => {
        const item = document.getElementById(id);
        if (item) item.style.display = user.role === 'admin' ? 'flex' : 'none';
    });

    // Visibilidade do menu de Configurações IA
    const navSettings = document.getElementById('nav-settings');
    if (navSettings) {
        navSettings.style.display = user.role === 'admin' ? 'flex' : 'none';
    }

    // Botão de novo bloco de conhecimento
    const addCatBtn = document.getElementById('addCategoryBtn');
    if (addCatBtn) {
        addCatBtn.style.display = user.role === 'admin' ? 'flex' : 'none';
    }

    // Botão de upload dentro de Materiais de Apoio (somente admin)
    const goToUploadsBtn = document.getElementById('goToUploadsBtn');
    if (goToUploadsBtn) {
        goToUploadsBtn.style.display = user.role === 'admin' ? 'flex' : 'none';
    }

    // Carrega config de IA (não sensível) do servidor e atualiza status/formulário
    AIProvider.loadSettings().then(() => {
        populateSettingsForm();
        updateAIStatusCard();
    });

    // Re-renderiza base de conhecimento (com/sem bot\u00f5es de excluir)
    renderKnowledgeBase();
    
    // Renderiza usu\u00e1rios se admin
    if (user.role === 'admin') {
        renderUsers();
    }
}

/** Faz o login */
async function performLogin(email, password) {
    const result = await AuthSystem.login(email, password);
    return result;
}

async function forceTemporaryPasswordChange() {
    const dialog = document.createElement('dialog');
    dialog.className = 'profile-dialog';
    dialog.setAttribute('aria-labelledby', 'temporaryPasswordHeading');
    dialog.innerHTML = `
        <div class="profile-heading"><div><span class="eyebrow">PRIMEIRO ACESSO</span><h2 id="temporaryPasswordHeading">Troque sua senha</h2></div></div>
        <p class="profile-intro">Por segurança, a senha temporária precisa ser substituída antes de continuar.</p>
        <form class="settings-form" id="temporaryPasswordForm">
            <div class="form-group"><label for="temporaryCurrentPassword">Senha temporária</label><input id="temporaryCurrentPassword" type="password" required autocomplete="current-password"></div>
            <div class="form-group"><label for="temporaryNewPassword">Nova senha</label><input id="temporaryNewPassword" type="password" required minlength="8" autocomplete="new-password"><span class="form-hint">Use pelo menos 8 caracteres.</span></div>
            <p class="profile-error" role="alert" hidden></p>
            <div class="settings-actions"><button type="submit" class="btn-save-settings">Alterar senha</button></div>
        </form>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', event => event.preventDefault());
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const error = form.querySelector('.profile-error');
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        error.hidden = true;
        try {
            await API.put('/auth/password', {
                currentPassword: form.querySelector('#temporaryCurrentPassword').value,
                newPassword: form.querySelector('#temporaryNewPassword').value
            });
            dialog.close();
            showToast('Senha alterada com sucesso!', 'success');
        } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
            button.disabled = false;
        }
    });
    dialog.showModal();
    dialog.querySelector('#temporaryCurrentPassword').focus();
}

/** Faz o logout */
function performLogout() {
    AuthSystem.logout();
    resetChatState();
    showLoginScreen();

    // Reset formulário
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').style.display = 'none';

    // Volta para a página de chat
    navigateToPage('chat');
}

// ============================================
// 13. INICIALIZAÇÃO E EVENT LISTENERS
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Inicializa ícones Lucide
    lucide.createIcons();

    // Tema (claro/escuro/sistema) — independente de login
    initThemeSwitcher();

    // --- LOGIN EVENT LISTENERS ---
    const loginForm = document.getElementById('loginForm');
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const loginError = document.getElementById('loginError');
    const loginErrorMsg = document.getElementById('loginErrorMsg');
    const loginBtn = document.getElementById('loginBtn');
    const loginBtnText = loginBtn.querySelector('.login-btn-text');
    const loginBtnLoader = loginBtn.querySelector('.login-btn-loader');
    const passwordToggle = document.getElementById('passwordToggle');

    // Toggle senha visível
    passwordToggle.addEventListener('click', () => {
        const input = document.getElementById('loginPassword');
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        // Troca ícone
        passwordToggle.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}"></i>`;
        lucide.createIcons({ nodes: [passwordToggle] });
    });

    // Submit do form de login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.style.display = 'none';

        // Mostra loader
        loginBtn.disabled = true;
        loginBtn.classList.add('loading');
        loginBtnText.style.display = 'none';
        loginBtnLoader.style.display = '';

        try {
            const result = await performLogin(loginEmail.value.trim(), loginPassword.value);

            loginBtn.disabled = false;
            loginBtn.classList.remove('loading');
            loginBtnText.style.display = '';
            loginBtnLoader.style.display = 'none';

            if (result.success) {
                // Login bem-sucedido
                hideLoginScreen();

                await loadConversationsFromAPI();
                renderChatHistory();
                await loadKnowledgeBaseFromAPI();
                renderKnowledgeBase();
                renderAnalytics();
                updateUIForUser();

                if (result.user.must_change_password) {
                    await forceTemporaryPasswordChange();
                    await loadConversationsFromAPI();
                    renderChatHistory();
                }

                showToast(`Bem-vindo(a), ${result.user.name}!`, 'success');
            } else {
                // Login falhou
                loginErrorMsg.textContent = result.message;
                loginError.style.display = '';
                lucide.createIcons({ nodes: [loginError] });

                // Shake no campo de senha
                loginPassword.focus();
                loginPassword.select();
            }
        } catch (err) {
            loginBtn.disabled = false;
            loginBtn.classList.remove('loading');
            loginBtnText.style.display = '';
            loginBtnLoader.style.display = 'none';
            loginErrorMsg.textContent = 'Erro de conexão com o servidor.';
            loginError.style.display = '';
            lucide.createIcons({ nodes: [loginError] });
        }
    });

    // --- LOGOUT ---
    document.getElementById('logoutBtn').addEventListener('click', () => {
        performLogout();
        showToast('Você saiu da sua conta.', 'info');
    });

    // --- APP EVENT LISTENERS (inicializados uma vez) ---
    
    // Admin: Add User Button
    const addUserBtn = document.getElementById('addUserBtn');
    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => showUserModal());
    }

    // Admin: Add Category Button
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    if (addCategoryBtn) {
        addCategoryBtn.addEventListener('click', () => showAddCategoryModal());
    }

    // Admin: Botão de upload dentro de Materiais de Apoio (leva à Central de Uploads)
    const goToUploadsBtn = document.getElementById('goToUploadsBtn');
    if (goToUploadsBtn) {
        goToUploadsBtn.addEventListener('click', () => navigateToPage('uploads'));
    }

    // Botão de voltar na Central de Uploads
    const uploadsBackBtn = document.getElementById('uploadsBackBtn');
    if (uploadsBackBtn) {
        uploadsBackBtn.addEventListener('click', () => navigateToPage('knowledge'));
    }

    // Sidebar toggle
    document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
    document.getElementById('sidebarOpenBtn').addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            openMobileSidebar();
        } else {
            toggleSidebar();
        }
    });

    // Nova Conversa
    document.getElementById('newChatBtn').addEventListener('click', () => {
        const conv = createConversation();
        document.getElementById('welcomeScreen').style.display = '';
        document.getElementById('messagesContainer').innerHTML = '';
        renderChatHistory();
    });

    // Apagar todo o histórico de conversas
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => showClearHistoryModal());
    }
    const refreshAuditBtn = document.getElementById('refreshAuditBtn');
    if (refreshAuditBtn) refreshAuditBtn.addEventListener('click', loadMaterialAudit);

    const settingsNavToggle = document.getElementById('settingsNavToggle');
    const settingsSubnav = document.getElementById('settingsSubnav');
    if (settingsNavToggle && settingsSubnav) settingsNavToggle.addEventListener('click', () => {
        const expanded = settingsNavToggle.getAttribute('aria-expanded') === 'true';
        settingsNavToggle.setAttribute('aria-expanded', String(!expanded));
        settingsSubnav.hidden = expanded;
    });

    // Navegação SPA
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navigateToPage(item.getAttribute('data-page'));
        });
    });

    document.getElementById('userAvatar').addEventListener('click', openProfileEditor);

    // Chat Input
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');

    chatInput.addEventListener('input', () => {
        // Auto-resize
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        // Enable/disable send
        sendBtn.disabled = !chatInput.value.trim();
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (chatInput.value.trim()) sendMessage(chatInput.value);
        }
    });

    sendBtn.addEventListener('click', () => {
        if (chatInput.value.trim()) sendMessage(chatInput.value);
    });

    // Attach button (simula funcionalidade)
    document.getElementById('attachBtn').addEventListener('click', () => {
        if (AuthSystem.canUpload()) {
            showToast('Para enviar arquivos, utilize a Central de Uploads no menu lateral.', 'info');
        } else {
            showToast('Apenas administradores podem enviar arquivos.', 'error');
        }
    });

    // Knowledge Base Search
    const searchInput = document.getElementById('knowledgeSearch');
    const searchClear = document.getElementById('searchClearBtn');

    searchInput.addEventListener('input', () => {
        const val = searchInput.value;
        searchClear.style.display = val ? '' : 'none';
        renderKnowledgeBase(val);
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        renderKnowledgeBase();
    });

    // Upload Dropzone
    const dropzone = document.getElementById('uploadDropzone');
    const fileInput = document.getElementById('fileInput');
    const categorySelector = document.getElementById('uploadCategorySelector');

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        handleFileSelection(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', (e) => {
        handleFileSelection(e.target.files);
        fileInput.value = ''; // Reset
    });

    function handleFileSelection(files) {
        if (files.length === 0) return;
        AppState.pendingUploadFiles = Array.from(files);
        categorySelector.style.display = '';
        // Renderiza opções de categoria dinâmicas
        renderUploadCategoryOptions();
    }

    // Responsive - sidebar fechado no mobile
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.add('collapsed');
    }

    window.addEventListener('resize', () => {
        const isCompact = window.matchMedia('(max-width: 768px)').matches;
        if (!isCompact) {
            closeMobileSidebar();
            document.getElementById('sidebar').classList.remove('collapsed');
        } else if (!document.getElementById('sidebar').classList.contains('mobile-open')) {
            document.getElementById('sidebar').classList.add('collapsed');
        }
    });

    // ========================================
    // SETTINGS PAGE EVENT LISTENERS
    // (config de IA \u00e9 carregada do servidor ap\u00f3s o login, em updateUIForUser)
    // ========================================
    initSettingsPage();

    // ========================================
    // Tenta restaurar sess\u00e3o ou mostra login
    // ========================================
    (async () => {
        const restored = await AuthSystem.restoreSession();
        if (restored) {
            hideLoginScreen();
            await loadConversationsFromAPI();
            renderChatHistory();
            await loadKnowledgeBaseFromAPI();
            renderKnowledgeBase();
            renderAnalytics();
            updateUIForUser();
            if (AuthSystem.currentUser.must_change_password) {
                await forceTemporaryPasswordChange();
                await loadConversationsFromAPI();
                renderChatHistory();
            }
            showToast(`Bem-vindo(a) de volta, ${AuthSystem.currentUser.name}!`, 'success');
        } else {
            showLoginScreen();
        }
    })();
});
