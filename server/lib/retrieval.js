const STOPWORDS = new Set([
    'para', 'com', 'uma', 'umas', 'uns', 'que', 'como', 'qual', 'quais', 'quando', 'onde',
    'sobre', 'isso', 'esse', 'essa', 'este', 'esta', 'pelo', 'pela', 'dos', 'das', 'nos', 'nas',
    'tem', 'ser', 'sao', 'the', 'and', 'for', 'from', 'com', 'de', 'da', 'do', 'em', 'no', 'na',
    'os', 'as', 'seu', 'sua', 'seus', 'suas', 'mais', 'muito', 'quero', 'gostaria', 'poderia'
]);

function extractKeywords(text) {
    const words = (text || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .match(/[a-z0-9]{3,}/g) || [];
    return words.filter(word => !STOPWORDS.has(word));
}

/** Rankeia textos por cobertura lexical da pergunta, sem afirmar busca semântica. */
function rankDocuments(documents, userMessage, maxDocs = 3, maxCharsPerDoc = 4000) {
    const questionKeywords = [...new Set(extractKeywords(userMessage))];
    if (questionKeywords.length === 0) return [];

    return documents
        .map(document => {
            const contentKeywords = extractKeywords(document.text);
            const contentKeywordSet = new Set(contentKeywords);
            const matchedKeywords = questionKeywords.filter(keyword => contentKeywordSet.has(keyword));
            const isRelevant = questionKeywords.length === 1
                ? contentKeywords.filter(word => word === questionKeywords[0]).length >= 2
                : matchedKeywords.length / questionKeywords.length >= 0.4;
            return isRelevant && matchedKeywords.length > 0
                ? { ...document, score: matchedKeywords.length }
                : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxDocs)
        .map(document => ({
            name: document.name,
            category: document.category,
            text: document.text.length > maxCharsPerDoc ? document.text.slice(0, maxCharsPerDoc) + '…' : document.text
        }));
}

module.exports = { extractKeywords, rankDocuments };
