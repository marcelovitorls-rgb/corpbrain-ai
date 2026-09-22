const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractKeywords, rankDocuments } = require('../server/lib/retrieval');

test('keyword extraction normalizes accents and removes stopwords', () => {
    assert.deepEqual(extractKeywords('Quais são os documentos sobre reembolso?'), ['documentos', 'reembolso']);
});

test('ranking prefers coverage of the question and truncates context', () => {
    const result = rankDocuments([
        { name: 'fraco.pdf', category: 'Processos', text: 'reembolso' },
        { name: 'forte.pdf', category: 'Processos', text: 'A política de reembolso explica prazo, comprovantes e aprovação.' }
    ], 'qual é a política de reembolso e quais comprovantes são necessários?', 1, 25);

    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'forte.pdf');
    assert.equal(result[0].text.length, 26);
    assert.equal(result[0].text.endsWith('…'), true);
});

test('single generic keyword must appear twice before a document is selected', () => {
    assert.deepEqual(rankDocuments([
        { name: 'one.txt', category: 'Geral', text: 'teste isolado' },
        { name: 'two.txt', category: 'Geral', text: 'teste com outro teste' }
    ], 'teste').map(item => item.name), ['two.txt']);
});
