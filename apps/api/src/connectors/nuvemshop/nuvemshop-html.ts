import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'a', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'hr', 'span', 'div',
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

/**
 * Só considera HTML quando aparece uma tag que o sanitizador conhece (ou uma
 * que ele remove). Texto puro como "Tamanho <G>" ou "5 < 10" não casa: a letra
 * logo após o "<" não forma uma tag válida, então o texto é escapado e preservado.
 */
const HTML_TAG = new RegExp(
  `</?(?:${[...ALLOWED_TAGS, 'script', 'style', 'img'].join('|')})\\b[^>]*>`,
  'i'
);

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Texto puro: parágrafos por linha em branco, quebras simples viram <br>. */
export function plainTextToHtml(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeText(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

/**
 * HTML de origem passa direto pelo sanitizador (sem escape duplo).
 * Texto puro é escapado antes de virar HTML.
 */
export function toNuvemshopHtml(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const html = HTML_TAG.test(raw) ? raw : plainTextToHtml(raw);
  const clean = sanitizeHtml(html, SANITIZE_OPTIONS).trim();
  return clean.length > 0 ? clean : null;
}
