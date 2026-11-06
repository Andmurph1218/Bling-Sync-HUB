import ExcelJS from 'exceljs';
import { listCatalog } from './list.js';
import { query } from '../db/pool.js';

const HEADERS = ['SKU', 'Nome', 'Categoria', 'Status de Completude', 'Preço', 'Estoque', 'Canais Vinculados'] as const;

const CHANNEL_LABEL: Record<string, string> = {
  mercadolivre: 'Mercado Livre',
  nuvemshop: 'Nuvemshop',
};

function headerKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text.trim();
  if (typeof value === 'object' && 'result' in value) return cellText(value.result as ExcelJS.CellValue);
  return String(value).trim();
}

export async function buildCatalogWorkbook(): Promise<Buffer> {
  const listed = await listCatalog({
    tab: 'todos',
    sku: '',
    name: '',
    brand: '',
    page: 1,
    pageSize: 1,
    all: true,
  });
  const links = await query<{ product_id: string; channel: string }>(
    `SELECT product_id, channel FROM channel_listing_links WHERE link_status = 'vinculado'`
  );
  const extra = new Map<string, string[]>();
  for (const row of links.rows) {
    const label = CHANNEL_LABEL[row.channel] ?? row.channel;
    const list = extra.get(row.product_id) ?? [];
    if (!list.includes(label)) list.push(label);
    extra.set(row.product_id, list);
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Catalogo');
  sheet.addRow([...HEADERS]);
  for (const item of listed.items) {
    const fromChannels = item.channels
      .filter((channel) => channel.state === 'published')
      .map((channel) => CHANNEL_LABEL[channel.platform] ?? channel.platform);
    const linked = [...fromChannels, ...(extra.get(item.id) ?? [])].filter((label, index, all) => all.indexOf(label) === index);
    sheet.addRow([
      item.sku,
      item.name ?? '',
      item.categoryName ?? '',
      item.checklist.ready ? 'Pronto' : `Incompleto (${item.checklist.percent}%)`,
      item.price ?? '',
      item.stock ?? '',
      linked.join(', ') || 'Nenhum',
    ]);
  }
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.from(raw);
}

export interface ImportLine {
  line: number;
  sku: string;
  status: 'sucesso' | 'erro';
  message: string;
}

async function applyCover(productId: string, url: string): Promise<void> {
  await query(
    `INSERT INTO product_images (
       master_product_id, source_url, url_normalized, source_platform, is_cover_eligible, rights_status
     ) VALUES ($1, $2, $2, 'bling', true, 'owned')
     ON CONFLICT (master_product_id, url_normalized)
     DO UPDATE SET is_cover_eligible = true, updated_at = now()`,
    [productId, url]
  );
}

export async function importCatalogWorkbook(file: Buffer): Promise<{ lines: ImportLine[]; ignoredSovereignColumns: string[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { lines: [{ line: 1, sku: '', status: 'erro', message: 'Planilha vazia.' }], ignoredSovereignColumns: [] };

  const header = sheet.getRow(1);
  const columns = new Map<string, number>();
  header.eachCell((cell, index) => {
    const key = headerKey(cellText(cell.value));
    if (key) columns.set(key, index);
  });
  const skuColumn = columns.get('sku');
  if (!skuColumn) {
    return { lines: [{ line: 1, sku: '', status: 'erro', message: 'A planilha precisa da coluna SKU.' }], ignoredSovereignColumns: [] };
  }

  const ignoredPrice = ['preco', 'estoque', 'price', 'stock'].some((key) => columns.has(key));
  const ignoresBlingText = ['nome', 'name', 'descricao', 'description', 'categoria', 'category'].some((key) => columns.has(key));
  const imageColumn = columns.get('url da imagem') ?? columns.get('imagem') ?? columns.get('image_url');
  const channelColumns: Array<{ key: string; platform: 'mercadolivre' | 'nuvemshop'; field: 'title' | 'description' }> = [
    { key: 'titulo mercadolivre', platform: 'mercadolivre', field: 'title' },
    { key: 'descricao mercadolivre', platform: 'mercadolivre', field: 'description' },
    { key: 'titulo nuvemshop', platform: 'nuvemshop', field: 'title' },
    { key: 'descricao nuvemshop', platform: 'nuvemshop', field: 'description' },
  ].filter((column) => columns.has(column.key));

  const lines: ImportLine[] = [];
  for (let line = 2; line <= sheet.rowCount; line += 1) {
    const row = sheet.getRow(line);
    const sku = cellText(row.getCell(skuColumn).value);
    if (!sku) continue;
    const product = await query<{ id: string }>(
      `SELECT id FROM master_products WHERE bling_sku = $1 AND catalog_status = 'active' LIMIT 1`,
      [sku]
    );
    if (!product.rows[0]) {
      lines.push({ line, sku, status: 'erro', message: `Linha ${line}: SKU não encontrado.` });
      continue;
    }
    const productId = product.rows[0].id;
    const imageUrl = imageColumn ? cellText(row.getCell(imageColumn).value) : '';

    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      lines.push({ line, sku, status: 'erro', message: `Linha ${line}: URL da imagem inválida.` });
      continue;
    }
    if (imageUrl) await applyCover(productId, imageUrl);
    await applyEmptyChannelFields(productId, row, columns, channelColumns);
    const notes = [
      ignoredPrice ? 'Preço e estoque ignorados.' : '',
      ignoresBlingText ? 'Aviso: Descrição e Categoria são gerenciadas pelo Bling e foram ignoradas.' : '',
    ].filter(Boolean);
    lines.push({ line, sku, status: 'sucesso', message: `Linha ${line}: Sucesso.${notes.length ? ` ${notes.join(' ')}` : ''}` });
  }
  return {
    lines,
    ignoredSovereignColumns: [
      ...(ignoresBlingText ? ['nome', 'descricao', 'categoria'] : []),
      ...(ignoredPrice ? ['preco', 'estoque'] : []),
    ],
  };
}

async function applyEmptyChannelFields(
  productId: string,
  row: ExcelJS.Row,
  columns: Map<string, number>,
  channelColumns: Array<{ key: string; platform: 'mercadolivre' | 'nuvemshop'; field: 'title' | 'description' }>
): Promise<void> {
  if (channelColumns.length === 0) return;
  const variant = await query<{ id: string }>(
    `SELECT id FROM product_variants WHERE master_product_id = $1 AND is_default = true LIMIT 1`,
    [productId]
  );
  const variantId = variant.rows[0]?.id;
  if (!variantId) return;
  for (const column of channelColumns) {
    const value = cellText(row.getCell(columns.get(column.key)!).value);
    if (!value) continue;
    const existing = await query<{ id: string }>(
      `SELECT id FROM channel_content_overrides
       WHERE master_product_id = $1 AND variant_id = $2 AND platform = $3 AND field = $4
       LIMIT 1`,
      [productId, variantId, column.platform, column.field]
    );
    if (existing.rows[0]) continue;
    await query(
      `INSERT INTO channel_content_overrides (master_product_id, variant_id, platform, field, value, source, status)
       VALUES ($1, $2, $3, $4, $5, 'spreadsheet', 'shadow')`,
      [productId, variantId, column.platform, column.field, value]
    );
  }
}
