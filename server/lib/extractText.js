const fs = require('fs');
const AdmZip = require('adm-zip');

// Extensões de texto puro (lidas diretamente, sem parsing especial)
const PLAIN_TEXT_EXTS = new Set(['txt', 'csv', 'md', 'json', 'xml', 'html', 'log', 'ini', 'cfg', 'yaml', 'yml']);

// Formatos Office (OOXML): zips contendo XML. Extraídos via regex sobre o XML interno,
// sem precisar de um parser de DOM completo.
const OFFICE_EXTS = new Set(['pptx', 'docx', 'xlsx']);

/** Remove entidades XML comuns (&amp; &lt; &gt; &quot; &apos;) de um texto já extraído. */
function decodeXmlEntities(str) {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

/** Extrai os textos de dentro de uma tag específica (ex.: <a:t>texto</a:t>) de um XML bruto. */
function extractTagContents(xml, tagName) {
    const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'g');
    const out = [];
    let match;
    while ((match = regex.exec(xml)) !== null) {
        out.push(decodeXmlEntities(match[1]));
    }
    return out;
}

/** PPTX: um slide por entrada em ppt/slides/slideN.xml, texto nas tags <a:t>. */
function extractPptxText(filePath) {
    const zip = new AdmZip(filePath);
    const slideEntries = zip.getEntries()
        .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
        .sort((a, b) => {
            const na = parseInt(a.entryName.match(/slide(\d+)\.xml$/)[1], 10);
            const nb = parseInt(b.entryName.match(/slide(\d+)\.xml$/)[1], 10);
            return na - nb;
        });

    const slides = slideEntries.map((entry, i) => {
        const xml = entry.getData().toString('utf-8');
        const texts = extractTagContents(xml, 'a:t');
        return `--- Slide ${i + 1} ---\n${texts.join(' ')}`;
    });

    return slides.join('\n\n');
}

/** DOCX: texto do corpo em word/document.xml, um parágrafo por linha. */
function extractDocxText(filePath) {
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) return '';

    const xml = entry.getData().toString('utf-8');
    // Quebra por parágrafo (<w:p>) preservando a ordem, e junta os "runs" (<w:t>) de cada um.
    const paragraphs = xml.split(/<w:p(?:\s[^>]*)?>/).slice(1);
    return paragraphs
        .map(p => extractTagContents(p, 'w:t').join(''))
        .filter(line => line.trim())
        .join('\n');
}

/** XLSX: strings compartilhadas (xl/sharedStrings.xml) + valores de cada planilha, em formato de tabela simples. */
function extractXlsxText(filePath) {
    const zip = new AdmZip(filePath);

    const sharedStringsEntry = zip.getEntry('xl/sharedStrings.xml');
    const sharedStrings = sharedStringsEntry
        ? extractTagContents(sharedStringsEntry.getData().toString('utf-8'), 't')
        : [];

    const sheetEntries = zip.getEntries()
        .filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName))
        .sort((a, b) => {
            const na = parseInt(a.entryName.match(/sheet(\d+)\.xml$/)[1], 10);
            const nb = parseInt(b.entryName.match(/sheet(\d+)\.xml$/)[1], 10);
            return na - nb;
        });

    const sheets = sheetEntries.map((entry, i) => {
        const xml = entry.getData().toString('utf-8');
        const rows = [];
        const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
        let rowMatch;
        while ((rowMatch = rowRegex.exec(xml)) !== null) {
            const cellRegex = /<c[^>]*?(?:\st="([^"]*)")?[^>]*>(?:<v>([\s\S]*?)<\/v>)?(?:<is>([\s\S]*?)<\/is>)?<\/c>/g;
            const cells = [];
            let cellMatch;
            while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
                const [, cellType, rawValue, inlineStr] = cellMatch;
                if (inlineStr) {
                    cells.push(extractTagContents(inlineStr, 't').join(''));
                } else if (cellType === 's' && rawValue !== undefined) {
                    cells.push(decodeXmlEntities(sharedStrings[parseInt(rawValue, 10)] || ''));
                } else if (rawValue !== undefined) {
                    cells.push(decodeXmlEntities(rawValue));
                }
            }
            if (cells.some(c => c.trim())) rows.push(cells.join('\t'));
        }
        return `--- Planilha ${i + 1} ---\n${rows.join('\n')}`;
    });

    return sheets.join('\n\n');
}

/**
 * Extrai o texto de um arquivo em disco. Suporta PDF (via pdf-parse), Office
 * (PPTX/DOCX/XLSX, via leitura direta do XML interno do .zip) e extensões de
 * texto puro. Usado tanto pela pré-visualização de arquivos quanto pela busca
 * de conteúdo relevante para o chat de IA.
 * @returns {Promise<{text: string|null, pages: number|null, error: boolean}>}
 */
async function extractFileText(filePath, ext) {
    const cleanExt = (ext || '').toLowerCase().replace('.', '');

    if (cleanExt === 'pdf') {
        try {
            const { PDFParse } = require('pdf-parse');
            const dataBuffer = fs.readFileSync(filePath);
            const uint8 = new Uint8Array(dataBuffer);
            const parser = new PDFParse(uint8);
            await parser.load();
            const result = await parser.getText();

            const numPages = result.pages ? result.pages.length : 0;
            const fullText = result.pages
                ? result.pages.map(p => p.text || '').join('\n\n--- Página ---\n\n')
                : '';

            return { text: fullText || null, pages: numPages, error: false };
        } catch (err) {
            console.error('Erro ao extrair PDF:', err.message);
            return { text: null, pages: 0, error: true };
        }
    }

    if (OFFICE_EXTS.has(cleanExt)) {
        try {
            let text = '';
            if (cleanExt === 'pptx') text = extractPptxText(filePath);
            else if (cleanExt === 'docx') text = extractDocxText(filePath);
            else if (cleanExt === 'xlsx') text = extractXlsxText(filePath);

            return { text: text || null, pages: null, error: false };
        } catch (err) {
            console.error(`Erro ao extrair ${cleanExt}:`, err.message);
            return { text: null, pages: null, error: true };
        }
    }

    if (PLAIN_TEXT_EXTS.has(cleanExt)) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return { text: content, pages: null, error: false };
        } catch (err) {
            console.error('Erro ao ler arquivo de texto:', err.message);
            return { text: null, pages: null, error: true };
        }
    }

    return { text: null, pages: null, error: false };
}

module.exports = { extractFileText, PLAIN_TEXT_EXTS, OFFICE_EXTS };
