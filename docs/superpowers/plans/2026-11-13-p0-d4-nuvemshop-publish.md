# P0-D4 — Publicação Nuvemshop completa (imagem, categoria, atributos, variações)

> **Para quem executa:** este plano assume que você conhece TypeScript, Vitest e PostgreSQL, mas nunca viu este repositório. Siga as tarefas na ordem. Cada tarefa termina com teste verde e `typecheck` limpo. Não pule o passo do teste que falha.

**Goal:** publicar na Nuvemshop um produto com checklist verde enviando descrição em HTML sanitizado, categoria, marca, **todas** as variações (sem perder SKU), e as imagens com a capa na posição 1 — e reconciliar imagens quando o produto já existe.

**Architecture:** o `listingDraftNow` passa a montar um draft específico da Nuvemshop (`buildNuvemshopDraft`) com eixos reais de `product_axes`/`variant_attributes`, descrição e imagens. O conector `nuvemshop-publish.ts` traduz esse draft para o payload da API `2025-03` (`attributes` = nomes dos eixos, `variants[].values` na mesma ordem), faz o POST do produto e depois sincroniza imagens por `Set` de `src`. O Mercado Livre continua usando o preview atual.

**Tech stack:** Node 20, TypeScript 5.6, Express, pg / pg-mem, Vitest 2, `sanitize-html`.

**Referências que você deve ler antes de começar:**
- `apps/api/src/connectors/strategy/nuvemshop-publish.ts` (arquivo central)
- `apps/api/src/connectors/strategy/nuvemshop-listing.ts` (`fetchNuvemshopListing`)
- `apps/api/src/catalog/publish-preview.ts` (`buildPublishPreview`, `checklistForChannels`)
- `apps/api/src/queues/publish-queue.ts` (`listingDraftNow`, `processPublishQueueItem`)
- `.planning/2026-11-13-p0-d4/design.md` (desenho aprovado)

**Regras que não podem ser violadas:**
1. `variants` tem exatamente um objeto por variante ativa. Nunca descarte SKU.
2. `attributes` são **nomes** de eixos; `values` são os valores na mesma ordem.
3. Marca vai em `brand`, nunca em `attributes`.
4. Descrição nunca é enviada como texto puro: converta e sanitize.
5. Imagens: `Set` de `src` existentes; envie só o que falta; `position = Set.size + i + 1`; capa primeiro; máximo 50.
6. Categoria exige ID numérico positivo; inválida falha o job.
7. 429/5xx é retryable; 4xx encerra.

---

## Task 1: Dependência `sanitize-html` e conversão de descrição

**Files:**
- Modify: `apps/api/package.json` (via npm)
- Create: `apps/api/src/connectors/strategy/nuvemshop-html.ts`
- Create: `apps/api/src/__tests__/nuvemshop-html.test.ts`

- [x] **Step 1: instalar a dependência**

```powershell
npm install sanitize-html@2.13.1 --workspace=@bling-sync/api
npm install -D @types/sanitize-html@2.13.3 --workspace=@bling-sync/api
```

Confirme que `apps/api/package.json` ganhou `sanitize-html` em `dependencies` e `@types/sanitize-html` em `devDependencies`, e que o `package-lock.json` da raiz mudou.

- [x] **Step 2: escrever o teste que falha**

`apps/api/src/__tests__/nuvemshop-html.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { plainTextToHtml, toNuvemshopHtml } from '../connectors/strategy/nuvemshop-html.js';

describe('toNuvemshopHtml', () => {
  it('converte texto puro com parágrafo em <p>', () => {
    expect(toNuvemshopHtml('Linha 1\n\nLinha 2')).toBe('<p>Linha 1</p><p>Linha 2</p>');
  });

  it('converte quebra simples em <br>', () => {
    expect(toNuvemshopHtml('Linha 1\nLinha 2')).toBe('<p>Linha 1<br />Linha 2</p>');
  });

  it('escapa sinal de menor em texto puro', () => {
    expect(toNuvemshopHtml('5 < 10')).toBe('<p>5 &lt; 10</p>');
  });

  it('preserva HTML existente sem escapar de novo', () => {
    expect(toNuvemshopHtml('<p>Texto <strong>forte</strong></p>')).toBe('<p>Texto <strong>forte</strong></p>');
  });

  it('não transforma &amp; em &amp;amp;', () => {
    expect(toNuvemshopHtml('<p>A &amp; B</p>')).toBe('<p>A &amp; B</p>');
  });

  it('remove script, onerror e javascript:', () => {
    const clean = toNuvemshopHtml(
      '<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">link</a>'
    );
    expect(clean).toContain('<p>ok</p>');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('javascript:');
  });

  it('injeta rel seguro em link externo', () => {
    expect(toNuvemshopHtml('<p><a href="https://exemplo.com">x</a></p>')).toContain(
      'rel="noopener noreferrer"'
    );
  });

  it('devolve null para entrada vazia ou só tags removidas', () => {
    expect(toNuvemshopHtml('')).toBeNull();
    expect(toNuvemshopHtml('   ')).toBeNull();
    expect(toNuvemshopHtml(null)).toBeNull();
    expect(toNuvemshopHtml('<script>alert(1)</script>')).toBeNull();
  });

  it('plainTextToHtml normaliza CRLF', () => {
    expect(plainTextToHtml('A\r\nB')).toBe('<p>A<br />B</p>');
  });
});
```

- [x] **Step 3: rodar e ver falhar**

```powershell
npm test --workspace=@bling-sync/api -- nuvemshop-html
```

Esperado: falha de resolução do módulo `nuvemshop-html.js`.

- [x] **Step 4: criar o módulo**

`apps/api/src/connectors/strategy/nuvemshop-html.ts`:

```ts
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

/** Texto puro com sinal de menor ("5 < 10") não casa: exige letra logo após o "<". */
const HTML_TAG = /<[a-z][^>]*>/i;

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
```

- [x] **Step 5: rodar o teste**

```powershell
npm test --workspace=@bling-sync/api -- nuvemshop-html
```

Esperado: 9 testes verdes. Se `sanitize-html` emitir `<br />` em vez de `<br>`, ajuste a asserção ao output real **e** mantenha `<br />` como formato canônico no teste; não mexa no sanitizador para forçar `<br>`.

- [x] **Step 6: commit**

```powershell
git add apps/api/package.json package-lock.json apps/api/src/connectors/strategy/nuvemshop-html.ts apps/api/src/__tests__/nuvemshop-html.test.ts
git commit -m "feat(nuvemshop): converter e sanitizar descricao para HTML"
```

---

## Task 2: Tipos do draft e payload do produto com N variações

**Files:**
- Modify: `apps/api/src/connectors/strategy/types.ts` (interface `ListingDraft`, linhas 126-132)
- Modify: `apps/api/src/connectors/strategy/nuvemshop-publish.ts` (`productBody`)
- Create: `apps/api/src/__tests__/nuvemshop-product-body.test.ts`

- [x] **Step 1: escrever o teste que falha**

`apps/api/src/__tests__/nuvemshop-product-body.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildNuvemshopProductBody, NuvemshopPublishError } from '../connectors/strategy/nuvemshop-publish.js';
import { ListingDraft } from '../connectors/strategy/types.js';

function draft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    sku: 'NS-MESTRE',
    title: 'Camiseta Dry Fit',
    price: 49.9,
    stock: 3,
    attributes: [
      { id: 'cor', value_name: 'Cor', name: 'Cor' },
      { id: 'tamanho', value_name: 'Tamanho', name: 'Tamanho' },
    ],
    description: '<p>Descrição</p>',
    brand: 'JHS',
    categoryIds: [123456],
    variants: [
      { sku: 'NS-AZ-M', price: 49.9, stock: 3, values: ['Azul', 'M'] },
      { sku: 'NS-PT-G', price: 54.9, stock: 4, values: ['Preto', 'G'] },
    ],
    images: ['https://hub.test/api/media/a.jpg'],
    ...overrides,
  };
}

describe('buildNuvemshopProductBody', () => {
  it('emite um objeto por variação, com values na ordem dos attributes', () => {
    const body = buildNuvemshopProductBody(draft()) as {
      name: { pt: string };
      description: { pt: string };
      categories: number[];
      brand: string;
      attributes: Array<{ pt: string }>;
      variants: Array<{ sku: string; price: string; stock: number; values: Array<{ pt: string }> }>;
    };
    expect(body.name).toEqual({ pt: 'Camiseta Dry Fit' });
    expect(body.description).toEqual({ pt: '<p>Descrição</p>' });
    expect(body.categories).toEqual([123456]);
    expect(body.brand).toBe('JHS');
    expect(body.attributes).toEqual([{ pt: 'Cor' }, { pt: 'Tamanho' }]);
    expect(body.variants).toHaveLength(2);
    expect(body.variants[0]).toEqual({
      price: '49.90',
      sku: 'NS-AZ-M',
      stock_management: true,
      stock: 3,
      values: [{ pt: 'Azul' }, { pt: 'M' }],
    });
    expect(body.variants[1]).toMatchObject({ sku: 'NS-PT-G', price: '54.90', stock: 4 });
    expect(body.variants[1]!.values).toEqual([{ pt: 'Preto' }, { pt: 'G' }]);
  });

  it('não perde SKU quando o produto tem 10 variações', () => {
    const variants = Array.from({ length: 10 }, (_, index) => ({
      sku: `NS-${index}`,
      price: 10,
      stock: index,
      values: ['Azul', 'M'],
    }));
    const body = buildNuvemshopProductBody(draft({ variants })) as {
      variants: Array<{ sku: string }>;
    };
    expect(body.variants.map((variant) => variant.sku)).toEqual(variants.map((variant) => variant.sku));
  });

  it('produto simples sem eixos envia uma variação sem attributes/values', () => {
    const body = buildNuvemshopProductBody(
      draft({
        sku: 'NS-SIMPLES',
        attributes: [],
        variants: [{ sku: 'NS-SIMPLES', price: 10, stock: 2, values: [] }],
        description: null,
        categoryIds: [],
        brand: null,
        images: [],
      })
    ) as Record<string, unknown>;
    expect(body).toEqual({
      name: { pt: 'Camiseta Dry Fit' },
      published: true,
      variants: [
        { price: '10.00', sku: 'NS-SIMPLES', stock_management: true, stock: 2 },
      ],
    });
  });

  it('falha com mais de 3 eixos', () => {
    expect(() =>
      buildNuvemshopProductBody(
        draft({
          attributes: [
            { id: 'a', value_name: 'A' },
            { id: 'b', value_name: 'B' },
            { id: 'c', value_name: 'C' },
            { id: 'd', value_name: 'D' },
          ],
          variants: [{ sku: 'X', price: 1, stock: 1, values: ['a', 'b', 'c', 'd'] }],
        })
      )
    ).toThrow(/3 atributos/);
  });

  it('falha quando a variação não tem valor para todo eixo', () => {
    expect(() =>
      buildNuvemshopProductBody(
        draft({ variants: [{ sku: 'NS-X', price: 10, stock: 1, values: ['Azul'] }] })
      )
    ).toThrow(/NS-X/);
  });

  it('falha com SKU duplicado', () => {
    expect(() =>
      buildNuvemshopProductBody(
        draft({
          variants: [
            { sku: 'NS-X', price: 10, stock: 1, values: ['Azul', 'M'] },
            { sku: 'NS-X', price: 10, stock: 1, values: ['Preto', 'G'] },
          ],
        })
      )
    ).toThrow(/duplicado/i);
  });

  it('falha com preço inválido', () => {
    expect(() =>
      buildNuvemshopProductBody(
        draft({ variants: [{ sku: 'NS-X', price: 0, stock: 1, values: ['Azul', 'M'] }] })
      )
    ).toThrow(NuvemshopPublishError);
  });
});
```

- [x] **Step 2: rodar e ver falhar**

```powershell
npm test --workspace=@bling-sync/api -- nuvemshop-product-body
```

- [x] **Step 3: estender `ListingDraft`**

Em `apps/api/src/connectors/strategy/types.ts`, substitua a interface atual por:

```ts
export interface ListingDraftAttribute {
  id: string;
  value_name: string;
  /**
   * Nome do eixo na Nuvemshop. A API 2025-03 recebe `attributes: [{ pt: nome }]`;
   * `value_name` continua sendo o valor para o Mercado Livre.
   */
  name?: string | null;
}

export interface ListingDraftVariant {
  sku: string;
  price: number;
  stock: number;
  /** Valores na mesma ordem de `ListingDraft.attributes`. */
  values: string[];
}

export interface ListingDraft {
  sku: string;
  title?: string | null;
  price: number;
  stock: number;
  attributes: ListingDraftAttribute[];
  description?: string | null;
  brand?: string | null;
  categoryIds?: number[];
  variants?: ListingDraftVariant[];
  /** URLs públicas na ordem de envio; a capa vem primeiro. */
  images?: string[];
}
```

- [x] **Step 4: implementar `buildNuvemshopProductBody`**

Em `apps/api/src/connectors/strategy/nuvemshop-publish.ts`, apague `productBody` e adicione no lugar (mantenha `NuvemshopPublishError` e `publishMessage` acima):

```ts
export const NUVEMSHOP_MAX_AXES = 3;
export const NUVEMSHOP_MAX_IMAGES = 50;
export const NUVEMSHOP_EXISTENCE_TIMEOUT_MS = 5_000;

/**
 * Traduz o draft para o payload de POST /products da API 2025-03.
 * `attributes` é a lista de NOMES de eixos; `variants[].values` segue a mesma ordem.
 * Validação falha com 400 para o job não retentar um payload inválido.
 */
export function buildNuvemshopProductBody(draft: ListingDraft): Record<string, unknown> {
  const name = (draft.title ?? '').trim() || draft.sku;
  const attributes = (draft.attributes ?? [])
    .map((attribute) => ({ pt: (attribute.name ?? attribute.value_name ?? attribute.id).trim() }))
    .filter((attribute) => attribute.pt.length > 0);

  if (attributes.length > NUVEMSHOP_MAX_AXES) {
    throw new NuvemshopPublishError(
      400,
      `Nuvemshop aceita até ${NUVEMSHOP_MAX_AXES} atributos de variação. O produto ${draft.sku} tem ${attributes.length}.`
    );
  }

  const variants = draft.variants?.length
    ? draft.variants
    : [{ sku: draft.sku, price: draft.price, stock: draft.stock, values: [] as string[] }];

  const seen = new Set<string>();
  const variantBodies = variants.map((variant) => {
    const sku = variant.sku.trim();
    if (!sku) throw new NuvemshopPublishError(400, 'Variação sem SKU — não sincroniza.');
    if (seen.has(sku)) throw new NuvemshopPublishError(400, `SKU duplicado no anúncio: ${sku}`);
    seen.add(sku);
    if (!Number.isFinite(variant.price) || variant.price <= 0) {
      throw new NuvemshopPublishError(400, `Preço inválido para o SKU ${sku}.`);
    }
    const values = attributes.length > 0 ? variant.values : [];
    if (attributes.length > 0 && values.length !== attributes.length) {
      throw new NuvemshopPublishError(
        400,
        `A variação ${sku} não tem valor para todos os ${attributes.length} atributos.`
      );
    }
    return {
      price: variant.price.toFixed(2),
      sku,
      stock_management: true,
      stock: Math.max(0, Math.floor(variant.stock)),
      ...(attributes.length > 0 ? { values: values.map((value) => ({ pt: value })) } : {}),
    };
  });

  return {
    name: { pt: name },
    published: true,
    ...(draft.description ? { description: { pt: draft.description } } : {}),
    ...(draft.categoryIds?.length ? { categories: draft.categoryIds } : {}),
    ...(draft.brand?.trim() ? { brand: draft.brand.trim() } : {}),
    ...(attributes.length > 0 ? { attributes } : {}),
    variants: variantBodies,
  };
}
```

Troque a chamada no POST de `productBody(draft)` por `buildNuvemshopProductBody(draft)`.

- [x] **Step 5: rodar**

```powershell
npm test --workspace=@bling-sync/api -- nuvemshop-product-body
npm run typecheck
```

Esperado: testes verdes; `typecheck` pode acusar outros usos de `ListingDraft` que ainda compilam (campos novos são opcionais). Se acusar `attributes` sem `name`, nada a fazer: `name` é opcional.

- [x] **Step 6: commit**

```powershell
git add apps/api/src/connectors/strategy/types.ts apps/api/src/connectors/strategy/nuvemshop-publish.ts apps/api/src/__tests__/nuvemshop-product-body.test.ts
git commit -m "feat(nuvemshop): montar payload com todas as variacoes e atributos"
```

---

## Task 3: `buildNuvemshopDraft` — banco para draft completo

**Files:**
- Modify: `apps/api/src/catalog/publish-preview.ts`
- Create: `apps/api/src/__tests__/nuvemshop-draft.test.ts`

- [x] **Step 1: escrever o teste que falha**

`apps/api/src/__tests__/nuvemshop-draft.test.ts` (bootstrap igual ao dos outros testes de banco):

```ts
import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildNuvemshopDraft } from '../catalog/publish-preview.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';

describe('buildNuvemshopDraft', () => {
  let poolInstance: DbPoolLike;
  let categoryId: string;
  const previousBase = process.env.PUBLIC_BASE_URL;

  beforeAll(async () => {
    const mem = newDb();
    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });
    for (const [name, impl] of [
      ['trim', (value: string) => (value ? value.trim() : '')],
      ['lower', (value: string) => (value ? value.toLowerCase() : '')],
    ] as const) {
      mem.public.registerFunction({ name, args: [DataType.text], returns: DataType.text, implementation: impl });
    }
    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value: string) => (value ? value.length : 0),
    });
    const adapter = mem.adapters.createPg();
    poolInstance = new adapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });

    const category = await query<{ id: string }>(
      `INSERT INTO hub_categories (name) VALUES ('Vestuário') RETURNING id`
    );
    categoryId = category.rows[0]!.id;
    const map = await query<{ id: string }>(
      `INSERT INTO channel_category_maps (hub_category_id, platform, channel_category_id, channel_category_name)
       VALUES ($1, 'nuvemshop', '123456', 'Camisetas')
       RETURNING id`,
      [categoryId]
    );
    await query(
      `INSERT INTO channel_attribute_maps (
         channel_category_map_id, channel_attribute_id, channel_attribute_name, required, mode, fixed_value
       ) VALUES ($1, 'BRAND', 'Marca', true, 'fixed', 'JHS')`,
      [map.rows[0]!.id]
    );
    process.env.PUBLIC_BASE_URL = 'https://hub.test';
  });

  afterAll(async () => {
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  async function createVariableProduct(sku: string): Promise<string> {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, brand, description, bling_tipo, product_format, hub_category_id, ncm_status, ncm_fiscal_risk)
       VALUES ($1, $2, 'Camiseta Dry Fit', 'JHS', $3, 'P', 'V', $4, 'valid', false)
       RETURNING id`,
      [`erp-${sku}`, sku, 'Linha 1\n\nLinha 2', categoryId]
    );
    const productId = created.rows[0]!.id;

    const axes = await query<{ id: string; canonical_name: string }>(
      `SELECT id, canonical_name FROM attribute_axes WHERE canonical_name IN ('cor', 'tamanho')`
    );
    for (const axis of axes.rows) {
      await query(
        `INSERT INTO product_axes (master_product_id, axis_id, sort_order)
         VALUES ($1, $2, $3)`,
        [productId, axis.id, axis.canonical_name === 'cor' ? 1 : 2]
      );
    }

    const first = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
       VALUES ($1, 'NS-AZ-M', false, 'V', 49.9, 3, 3) RETURNING id`,
      [productId]
    );
    const second = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
       VALUES ($1, 'NS-PT-G', false, 'V', 54.9, 4, 4) RETURNING id`,
      [productId]
    );

    const byName = new Map(axes.rows.map((axis) => [axis.canonical_name, axis.id]));
    const rows: Array<[string, string, string]> = [
      [first.rows[0]!.id, byName.get('cor')!, 'Azul'],
      [first.rows[0]!.id, byName.get('tamanho')!, 'M'],
      [second.rows[0]!.id, byName.get('cor')!, 'Preto'],
      [second.rows[0]!.id, byName.get('tamanho')!, 'G'],
    ];
    for (const [variantId, axisId, value] of rows) {
      await query(
        `INSERT INTO variant_attributes (variant_id, axis_id, canonical_value, sort_order)
         VALUES ($1, $2, $3, 0)`,
        [variantId, axisId, value]
      );
    }

    await query(
      `INSERT INTO product_images (
         master_product_id, source_url, url_normalized, source_platform,
         sha256_hash, format, is_cover_eligible, position_ns
       ) VALUES
         ($1, 'https://bling.test/secundaria.jpg', 'https://bling.test/secundaria.jpg', 'bling', NULL, 'jpeg', false, 2),
         ($1, 'https://bling.test/capa.jpg', 'https://bling.test/capa.jpg', 'bling', $2, 'jpeg', true, 1)`,
      [productId, 'a'.repeat(64)]
    );

    return productId;
  }

  it('monta eixos, todas as variações, descrição, categoria, marca e imagens (capa primeiro)', async () => {
    const productId = await createVariableProduct('NS-VAR-DRAFT');
    const draft = await buildNuvemshopDraft(productId);
    expect(draft).not.toBeNull();
    expect(draft!.sku).toBe('NS-VAR-DRAFT');
    expect(draft!.brand).toBe('JHS');
    expect(draft!.categoryIds).toEqual([123456]);
    expect(draft!.attributes).toEqual([
      { id: 'cor', value_name: 'Cor', name: 'Cor' },
      { id: 'tamanho', value_name: 'Tamanho', name: 'Tamanho' },
    ]);
    expect(draft!.description).toBe('<p>Linha 1</p><p>Linha 2</p>');
    expect(draft!.variants).toEqual([
      { sku: 'NS-AZ-M', price: 49.9, stock: 3, values: ['Azul', 'M'] },
      { sku: 'NS-PT-G', price: 54.9, stock: 4, values: ['Preto', 'G'] },
    ]);
    expect(draft!.images).toEqual([
      `https://hub.test/api/media/${'a'.repeat(64)}.jpg`,
      'https://bling.test/secundaria.jpg',
    ]);
  });

  it('usa o override de descrição da Nuvemshop com prioridade sobre o master', async () => {
    const productId = await createVariableProduct('NS-VAR-OVERRIDE');
    const variant = await query<{ id: string }>(
      `SELECT id FROM product_variants WHERE master_product_id = $1 ORDER BY erp_sku LIMIT 1`,
      [productId]
    );
    await query(
      `INSERT INTO channel_content_overrides (
         master_product_id, variant_id, platform, field, value, source, status
       ) VALUES ($1, $2, 'nuvemshop', 'description', '<p>Override</p><script>x</script>', 'manual', 'live')`,
      [productId, variant.rows[0]!.id]
    );
    const draft = await buildNuvemshopDraft(productId);
    expect(draft!.description).toBe('<p>Override</p>');
  });

  it('falha quando o ID da categoria não é numérico', async () => {
    const productId = await createVariableProduct('NS-VAR-CAT');
    await query(
      `UPDATE channel_category_maps SET channel_category_id = 'NS-CAT' WHERE hub_category_id = $1 AND platform = 'nuvemshop'`,
      [categoryId]
    );
    await expect(buildNuvemshopDraft(productId)).rejects.toThrow(/Categoria da Nuvemshop inválida/);
    await query(
      `UPDATE channel_category_maps SET channel_category_id = '123456' WHERE hub_category_id = $1 AND platform = 'nuvemshop'`,
      [categoryId]
    );
  });
});
```

- [x] **Step 2: rodar e ver falhar**

```powershell
npm test --workspace=@bling-sync/api -- nuvemshop-draft
```

- [x] **Step 3: implementar**

Em `apps/api/src/catalog/publish-preview.ts`, adicione os imports:

```ts
import { getPublicBaseUrl } from '../config/public-url.js';
import { mediaRelativePath } from '../routes/media.js';
import { ListingDraft, ListingDraftAttribute } from '../connectors/strategy/types.js';
import { toNuvemshopHtml } from '../connectors/strategy/nuvemshop-html.js';
```

> A importação de `connectors/strategy` em `catalog` é só de funções puras; não crie ciclo importando `publish-preview` de volta do conector.

Adicione ao final do arquivo:

```ts
const NUVEMSHOP_MAX_AXES = 3;
const NUVEMSHOP_MAX_IMAGES = 50;
const BRAND_ATTRIBUTE_IDS = new Set(['BRAND', 'BRAND_ID', 'MARCA']);

function axisName(row: { ns_option_name: string | null; display_name: string; canonical_name: string }): string {
  return (row.ns_option_name ?? row.display_name ?? row.canonical_name).trim();
}

function isBrandAttribute(id: string, sourceField: string | null): boolean {
  return sourceField === 'brand' || BRAND_ATTRIBUTE_IDS.has(id.trim().toUpperCase());
}

/**
 * Draft da Nuvemshop com eixos reais, todas as variações, descrição em HTML,
 * categoria numérica e imagens ordenadas (capa primeiro).
 * Devolve null só quando o produto não tem SKU mestre.
 */
export async function buildNuvemshopDraft(productId: string): Promise<ListingDraft | null> {
  const productRes = await query<{
    id: string;
    erp_sku: string | null;
    name: string | null;
    brand: string | null;
    description: string | null;
    short_description: string | null;
    hub_category_id: string | null;
  }>(
    `SELECT id, erp_sku, name, brand, description, short_description, hub_category_id
     FROM master_products
     WHERE id = $1 AND catalog_status = 'active'`,
    [productId]
  );
  const product = productRes.rows[0];
  if (!product || isBlankSku(product.erp_sku)) return null;
  const masterSku = product.erp_sku!.trim();

  const variantsRes = await query<{
    id: string;
    erp_sku: string;
    price: string | null;
    stock: string | null;
  }>(
    `SELECT id, erp_sku, price::text AS price, stock::text AS stock
     FROM product_variants
     WHERE master_product_id = $1 AND is_active = true
     ORDER BY is_default DESC, created_at ASC, erp_sku ASC`,
    [productId]
  );
  if (variantsRes.rows.length === 0) return null;
  const variants = variantsRes.rows;

  const axesRes = await query<{
    axis_id: string;
    canonical_name: string;
    display_name: string;
    ns_option_name: string | null;
  }>(
    `SELECT ax.id AS axis_id, ax.canonical_name, ax.display_name, ax.ns_option_name
     FROM product_axes pa
     INNER JOIN attribute_axes ax ON ax.id = pa.axis_id
     WHERE pa.master_product_id = $1
     ORDER BY pa.sort_order ASC, ax.sort_order ASC, ax.canonical_name ASC`,
    [productId]
  );

  let attributes: ListingDraftAttribute[] = [];
  let valuesByVariantAxis = new Map<string, string>();

  if (axesRes.rows.length > 0) {
    if (axesRes.rows.length > NUVEMSHOP_MAX_AXES) {
      throw new Error(
        `Nuvemshop aceita até ${NUVEMSHOP_MAX_AXES} eixos de variação. O produto ${masterSku} tem ${axesRes.rows.length}.`
      );
    }
    const slots = variants.map((_, index) => `$${index + 1}`).join(', ');
    const variantValues = await query<{ variant_id: string; axis_id: string; canonical_value: string }>(
      `SELECT variant_id, axis_id, canonical_value
       FROM variant_attributes
       WHERE variant_id IN (${slots})`,
      variants.map((variant) => variant.id)
    );
    valuesByVariantAxis = new Map(
      variantValues.rows.map((row) => [`${row.variant_id}:${row.axis_id}`, row.canonical_value])
    );
    attributes = axesRes.rows.map((axis) => {
      const name = axisName(axis);
      return { id: axis.canonical_name, value_name: name, name };
    });
  } else {
    // Produto simples: os atributos fixos do mapa da categoria viram eixos de valor único.
    const mapRows = product.hub_category_id
      ? await query<{
          channel_attribute_id: string;
          channel_attribute_name: string | null;
          required: boolean;
          mode: 'fixed' | 'dynamic' | 'manual';
          fixed_value: string | null;
          source_field: string | null;
        }>(
          `SELECT am.channel_attribute_id, am.channel_attribute_name, am.required, am.mode, am.fixed_value, am.source_field
           FROM channel_attribute_maps am
           INNER JOIN channel_category_maps cm ON cm.id = am.channel_category_map_id
           WHERE cm.hub_category_id = $1 AND cm.platform = 'nuvemshop'`,
          [product.hub_category_id]
        )
      : { rows: [] };

    const inputs: AttributeMapInput[] = mapRows.rows
      .filter((row) => !isBrandAttribute(row.channel_attribute_id, row.source_field))
      .map((row) => ({
        channelAttributeId: row.channel_attribute_id,
        channelAttributeName: row.channel_attribute_name ?? row.channel_attribute_id,
        required: row.required,
        mode: row.mode,
        fixedValue: row.fixed_value,
        sourceField: row.source_field,
        valueMaps: [],
      }));
    const materialized = materializeChannelAttributes({
      maps: inputs,
      product: { brand: product.brand, name: product.name },
      variantAttributes: {},
    });
    if (materialized.attributes.length > NUVEMSHOP_MAX_AXES) {
      throw new Error(
        `Nuvemshop aceita até ${NUVEMSHOP_MAX_AXES} atributos de variação. O produto ${masterSku} tem ${materialized.attributes.length}.`
      );
    }
    attributes = materialized.attributes.map((attribute) => ({
      id: attribute.id,
      value_name: attribute.value_name,
      // `materialized` pode pular mapas sem valor; procure pelo id, não pelo índice.
      name: inputs.find((input) => input.channelAttributeId === attribute.id)?.channelAttributeName ?? attribute.id,
    }));
  }

  const categoryRes = product.hub_category_id
    ? await query<{ channel_category_id: string }>(
        `SELECT channel_category_id
         FROM channel_category_maps
         WHERE hub_category_id = $1 AND platform = 'nuvemshop'
         LIMIT 1`,
        [product.hub_category_id]
      )
    : { rows: [] as Array<{ channel_category_id: string }> };
  const categoryRaw = (categoryRes.rows[0]?.channel_category_id ?? '').trim();
  const categoryId = Number(categoryRaw);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new Error(
      `Categoria da Nuvemshop inválida para o produto ${masterSku}: "${categoryRaw}". Mapeie um ID numérico em Canais > Categorias.`
    );
  }

  const overrideRes = await query<{ value: string }>(
    `SELECT value
     FROM channel_content_overrides
     WHERE master_product_id = $1
       AND platform = 'nuvemshop'
       AND field = 'description'
       AND status IN ('live', 'shadow')
     ORDER BY CASE WHEN variant_id = $2 THEN 0 ELSE 1 END,
              CASE status WHEN 'live' THEN 0 ELSE 1 END,
              updated_at DESC
     LIMIT 1`,
    [productId, variants[0]!.id]
  );
  const description = toNuvemshopHtml(
    overrideRes.rows[0]?.value ?? product.description ?? product.short_description
  );

  const imagesRes = await query<{
    source_url: string;
    url_normalized: string;
    sha256_hash: string | null;
    format: string | null;
  }>(
    `SELECT source_url, url_normalized, sha256_hash, format
     FROM product_images
     WHERE master_product_id = $1
     ORDER BY is_cover_eligible DESC, COALESCE(position_ns, 32767) ASC, created_at ASC
     LIMIT ${NUVEMSHOP_MAX_IMAGES}`,
    [productId]
  );
  const publicBase = getPublicBaseUrl();
  const images = imagesRes.rows
    .map((row) =>
      publicBase && row.sha256_hash
        ? `${publicBase}${mediaRelativePath(row.sha256_hash, row.format)}`
        : row.source_url || row.url_normalized
    )
    .filter((url): url is string => Boolean(url));

  const draftVariants = variants.map((variant) => ({
    sku: variant.erp_sku.trim(),
    price: variant.price === null ? 0 : Number(variant.price),
    stock: variant.stock === null ? 0 : Math.max(0, Math.floor(Number(variant.stock))),
    values:
      axesRes.rows.length > 0
        ? axesRes.rows.map((axis) => valuesByVariantAxis.get(`${variant.id}:${axis.axis_id}`) ?? '')
        : attributes.map((attribute) => attribute.value_name),
  }));

  return {
    sku: masterSku,
    title: product.name,
    price: draftVariants[0]!.price,
    stock: draftVariants[0]!.stock,
    attributes,
    description,
    brand: product.brand?.trim() || null,
    categoryIds: [categoryId],
    variants: draftVariants,
    images,
  };
}
```

- [x] **Step 4: rodar**

```powershell
npm test --workspace=@bling-sync/api -- nuvemshop-draft
```

Esperado: 3 testes verdes. Se a ordem das imagens falhar, confira `is_cover_eligible DESC` e `COALESCE(position_ns, 32767)` — a capa precisa vir primeiro.

> **pg-mem + índice parcial:** o planejador do pg-mem usa `product_images_cover_lookup` (parcial, `WHERE is_cover_eligible = true`) em qualquer igualdade de `master_product_id` e devolve só a capa. O índice foi envolvido em `-- mem-skip-start/-- mem-skip-end` na migration 16 (mecanismo já usado na migration 33); em produção ele continua sendo criado. Sem esse ajuste o teste de imagens vê uma imagem só.

- [x] **Step 5: commit**

```powershell
git add apps/api/src/catalog/publish-preview.ts apps/api/src/db/migrations/1729080000016_catalog-list-indexes.ts apps/api/src/__tests__/nuvemshop-draft.test.ts
git commit -m "feat(nuvemshop): montar draft com eixos, descricao, categoria e imagens"
```

---

## Task 4: Checklist lê a variante representante (produto sem `is_default`)

O Bling grava produto variável sem `is_default=true`. Hoje `checklistForChannels` faz `LEFT JOIN ... AND pv.is_default = true`, o preço fica `null` e o checklist nunca fica verde.

**Files:**
- Modify: `apps/api/src/catalog/publish-preview.ts` (`checklistForChannels`, query `products`)
- Modify: `apps/api/src/__tests__/nuvemshop-draft.test.ts` (novo teste)
- Modify: `apps/api/src/__tests__/publish-queue-concurrency.test.ts` (fixture de categoria numérica)

- [x] **Step 1: escrever o teste que falha**

Adicione ao `nuvemshop-draft.test.ts` (novo `it` no describe já existente). Importe `checklistForChannel` na linha de import de `../catalog/publish-preview.js` que já existe no topo (`import { buildNuvemshopDraft, checklistForChannel } ...`):

```ts
  it('checklist fica verde para produto variável sem is_default', async () => {
    const productId = await createVariableProduct('NS-VAR-CHECK');
    await query(
      `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
       VALUES ('DEP-CHECK', 'Loja Check', 'seller', true)`
    );
    const variants = await query<{ id: string; stock: string | null }>(
      `SELECT id, stock::text AS stock FROM product_variants WHERE master_product_id = $1`,
      [productId]
    );
    for (const variant of variants.rows) {
      await query(
        `INSERT INTO variant_stock_balances (variant_id, bling_warehouse_id, saldo_fisico, saldo_virtual)
         VALUES ($1, 'DEP-CHECK', 3, 3)`,
        [variant.id]
      );
    }
    const checklist = await checklistForChannel(productId, 'nuvemshop');
    expect(checklist?.ready).toBe(true);
    expect(checklist?.items.filter((item) => !item.ok)).toEqual([]);
  });
```

- [x] **Step 2: rodar e ver falhar**

```powershell
npm test --workspace=@bling-sync/api -- nuvemshop-draft
```

Esperado: falha em `checklist?.ready` / preço.

- [x] **Step 3: corrigir a query**

Em `checklistForChannels`, troque o `SELECT` de `products` por:

```sql
SELECT mp.id, mp.erp_id, mp.erp_sku, mp.ncm_status, mp.ncm_fiscal_risk, mp.hub_category_id,
       pv.price::text AS price, pv.ean, pv.ean_status
FROM master_products mp
LEFT JOIN product_variants pv
  ON pv.master_product_id = mp.id AND pv.is_active = true
WHERE mp.id IN (${idSlots})
ORDER BY mp.id,
         (pv.is_default = true) DESC,
         pv.created_at ASC,
         pv.erp_sku ASC
```

O `productById` já mantém a **primeira** linha de cada produto (`if (!productById.has(row.id))`), então o `ORDER BY` faz a variante default vencer e, sem default, a mais antiga por SKU. Não remova esse dedupe.

> Se o pg-mem reclamar de `ORDER BY (pv.is_default = true) DESC`, troque por `CASE WHEN pv.is_default = true THEN 0 ELSE 1 END ASC` — o comportamento é o mesmo.

- [x] **Step 4: ajustar a fixture do teste de concorrência**

Em `apps/api/src/__tests__/publish-queue-concurrency.test.ts`, o mapa usa `'NS-DUP'`, que vai falhar na validação de categoria numérica da Task 3. Troque por `'123457'` nas duas ocorrências:

```ts
VALUES ($1, 'nuvemshop', '123457', 'Duplicidade')
```

- [x] **Step 5: rodar**

```powershell
npm test --workspace=@bling-sync/api -- nuvemshop-draft publish-queue-concurrency
```

Esperado: verde.

- [x] **Step 6: commit**

```powershell
git add apps/api/src/catalog/publish-preview.ts apps/api/src/__tests__/nuvemshop-draft.test.ts apps/api/src/__tests__/publish-queue-concurrency.test.ts
git commit -m "fix(checklist): usar variante representante quando nao ha is_default"
```

---

## Task 5: Existência por SKU com timeout curto e body validado antes do POST

**Files:**
- Modify: `apps/api/src/connectors/strategy/nuvemshop-listing.ts` (`fetchNuvemshopListing`)
- Modify: `apps/api/src/connectors/strategy/nuvemshop-publish.ts` (`createNuvemshopListing`)
- Modify: `apps/api/src/__tests__/publish-queue-concurrency.test.ts` (mock separa produto de imagem)

- [x] **Step 1: estender `fetchNuvemshopListing` com opções**

Em `nuvemshop-listing.ts`, troque a assinatura e o miolo de rede:

```ts
export interface FetchNuvemshopListingOptions {
  /** Timeout de cada requisição. O default continua 15s. */
  timeoutMs?: number;
  /** Só o endpoint /products/sku/{sku}, sem o fallback /products?q=. */
  skuOnly?: boolean;
}

export async function fetchNuvemshopListing(
  product: MasterProduct,
  options: FetchNuvemshopListingOptions = {}
): Promise<MarketplaceListing | null> {
  const sku = product.sku.trim();
  const storeId = await resolveNuvemshopStoreId();
  if (!storeId || !sku) return null;
  const tokens = new OAuthTokenManager();
  const stored = await tokens.getToken('nuvemshop');
  if (!stored) return null;
  const headers = nuvemshopHeaders(stored.accessToken);
  const base = `https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}`;
  const init: RequestInit = {
    headers,
    ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
  };
  const bySku = await nuvemshopFetch(`${base}/products/sku/${encodeURIComponent(sku)}`, init);
  // ... (o bloco de sucesso continua exatamente igual) ...
  if (options.skuOnly) return null;

  const response = await nuvemshopFetch(`${base}/products?q=${encodeURIComponent(sku)}`, init);
  // ... (restante igual) ...
}
```

Não altere `NUVEMSHOP_FETCH_TIMEOUT_MS` (15s) nem o comportamento do caminho sem opções.

- [x] **Step 2: reescrever `createNuvemshopListing`**

Em `nuvemshop-publish.ts`, extraia autenticação e implemente a busca por SKU:

```ts
import { fetchNuvemshopListing, NuvemshopListingError, resolveNuvemshopStoreId } from './nuvemshop-listing.js';

export interface NuvemshopAuth {
  storeId: string;
  accessToken: string;
}

async function nuvemshopAuth(): Promise<NuvemshopAuth> {
  const storeId = await resolveNuvemshopStoreId();
  if (!storeId) throw new NuvemshopPublishError(401, 'Loja da Nuvemshop não configurada.');
  const stored = await new OAuthTokenManager().getToken('nuvemshop');
  if (!stored) throw new NuvemshopPublishError(401, 'Token da Nuvemshop ausente.');
  return { storeId, accessToken: stored.accessToken };
}

function apiBase(storeId: string): string {
  return `https://api.nuvemshop.com.br/2025-03/${encodeURIComponent(storeId)}`;
}

function apiHeaders(auth: NuvemshopAuth, json = false): Record<string, string> {
  return {
    Authentication: `bearer ${auth.accessToken}`,
    'User-Agent': 'JH Sync Hub (catalogo@jhshopping.com.br)',
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

/**
 * O worker já bloqueia quando há vínculo em channel_listing_links; este lookup
 * cobre anúncio criado fora do HUB. Para no primeiro anúncio encontrado e
 * interrompe a sequência no primeiro 429/5xx.
 */
export async function findExistingNuvemshopListing(skus: string[]): Promise<{ externalId: string } | null> {
  const seen = new Set<string>();
  for (const raw of skus) {
    const sku = raw.trim();
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const probe: MasterProduct = { id: sku, sku, ean: null, price: null, stock: null };
    try {
      const found = await fetchNuvemshopListing(probe, {
        timeoutMs: NUVEMSHOP_EXISTENCE_TIMEOUT_MS,
        skuOnly: true,
      });
      if (found) return { externalId: found.externalId };
    } catch (error) {
      if (error instanceof NuvemshopListingError) {
        throw new NuvemshopPublishError(error.status, error.message);
      }
      throw error;
    }
  }
  return null;
}

/** Cria o produto na loja. Se algum SKU já existe lá, devolve o id sem um segundo POST. */
export async function createNuvemshopListing(draft: ListingDraft): Promise<ListingResult> {
  const sku = draft.sku.trim();
  if (!sku) throw new NuvemshopPublishError(400, 'Sem SKU — não sincroniza');

  // Valida o payload antes de qualquer chamada de rede (falha rápida e determinística).
  const body = buildNuvemshopProductBody(draft);

  const auth = await nuvemshopAuth();
  const existing = await findExistingNuvemshopListing([
    sku,
    ...(draft.variants ?? []).map((variant) => variant.sku),
  ]);
  if (existing) {
    await syncNuvemshopImages(existing.externalId, draft.images, auth);
    return { performed: true, reason: 'ja_existia', externalId: existing.externalId };
  }

  const response = await nuvemshopFetch(`${apiBase(auth.storeId)}/products`, {
    method: 'POST',
    headers: apiHeaders(auth, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(NUVEMSHOP_FETCH_TIMEOUT_MS),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status !== 200 && response.status !== 201) {
    throw new NuvemshopPublishError(response.status, publishMessage(response.status, payload));
  }
  const id = payload && typeof payload === 'object' ? (payload as { id?: unknown }).id : undefined;
  if (id === undefined || id === null || String(id).trim() === '') {
    throw new NuvemshopPublishError(502, 'Nuvemshop não devolveu o id do anúncio.');
  }
  await syncNuvemshopImages(String(id), draft.images, auth);
  return { performed: true, reason: 'criado', externalId: String(id) };
}
```

> `syncNuvemshopImages` é criado na Task 6. Para o `typecheck` passar agora, adicione a função vazia no fim do arquivo:
>
> ```ts
> export async function syncNuvemshopImages(
>   _externalId: string,
>   _images: string[] | undefined,
>   _auth: NuvemshopAuth
> ): Promise<void> {}
> ```
>
> Use `_` nos parâmetros para satisfazer `noUnusedParameters`. Esta Task commita **somente** o lookup (`nuvemshop-listing.ts`) e o mock de concorrência; as mudanças de `nuvemshop-publish.ts` entram no commit da Task 6.

Ajuste também o import de `MasterProduct` se ele deixar de ser usado.

- [x] **Step 3: separar POST de produto de POST de imagem no mock de concorrência**

Em `publish-queue-concurrency.test.ts`:

```ts
setNuvemshopFetchForTests(async (url, init) => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-rate-limit-remaining': '20' },
  });
  if (init?.method === 'POST' && url.includes('/images')) {
    images += 1;
    return json(201, { id: images, src: JSON.parse(String(init.body)).src });
  }
  if (init?.method === 'POST') {
    posts += 1;
    return json(201, { id: nextListingId });
  }
  if (url.includes('/products/') && url.includes('/images')) return json(200, []);
  if (url.includes('/products/sku/')) return json(404, {});
  return json(200, []);
});
```

Declare `let images = 0;` junto de `posts`, zere em `beforeEach` e no `afterAll`. O teste continua contando **somente** POST de produto em `posts`.

- [x] **Step 4: rodar**

```powershell
npm run typecheck
npm test --workspace=@bling-sync/api -- publish-queue-concurrency
```

- [x] **Step 5: commit**

```powershell
git add apps/api/src/connectors/strategy/nuvemshop-listing.ts apps/api/src/__tests__/publish-queue-concurrency.test.ts
git commit -m "feat(nuvemshop): procurar existencia por SKU com timeout curto"
```

> `nuvemshop-publish.ts` fica fora deste commit de propósito: ele ainda tem o stub de imagens e vai junto com a Task 6.

---

## Task 6: `syncNuvemshopImages` por `Set` de URL

**Files:**
- Modify: `apps/api/src/connectors/strategy/nuvemshop-publish.ts`
- Modify: `apps/api/src/__tests__/nuvemshop-product-body.test.ts` (novo teste isolado com mock de fetch)

- [x] **Step 1: escrever o teste que falha**

Acrescente ao `nuvemshop-product-body.test.ts` (junte `beforeEach`/`afterEach` ao import de `vitest` do topo e `syncNuvemshopImages` ao import de `nuvemshop-publish.js`):

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetNuvemshopRateLimitForTests, setNuvemshopFetchForTests } from '../connectors/strategy/nuvemshop-http.js';
import { syncNuvemshopImages } from '../connectors/strategy/nuvemshop-publish.js';

describe('syncNuvemshopImages', () => {
  const auth = { storeId: '998877', accessToken: 'token' };
  let posts: Array<{ url: string; body: { src: string; position: number } }> = [];
  let existing: string[] = [];

  beforeEach(() => {
    posts = [];
    existing = [];
    resetNuvemshopRateLimitForTests();
    setNuvemshopFetchForTests(async (url, init) => {
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'x-rate-limit-remaining': '20' },
      });
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return json(201, { id: posts.length });
      }
      return json(200, existing.map((src) => ({ src })));
    });
  });

  afterEach(() => {
    setNuvemshopFetchForTests(null);
    resetNuvemshopRateLimitForTests();
  });

  it('envia só o que falta, com position sequencial a partir do tamanho existente', async () => {
    existing = ['https://cdn.nuvemshop.test/1.jpg'];
    await syncNuvemshopImages('88421', [
      'https://cdn.nuvemshop.test/1.jpg',
      'https://hub.test/api/media/b.jpg',
      'https://hub.test/api/media/c.jpg',
    ], auth);
    expect(posts.map((post) => post.body)).toEqual([
      { src: 'https://hub.test/api/media/b.jpg', position: 2 },
      { src: 'https://hub.test/api/media/c.jpg', position: 3 },
    ]);
  });

  it('envia a capa na posição 1 quando o anúncio não tem imagem', async () => {
    await syncNuvemshopImages('88421', ['https://hub.test/api/media/capa.jpg'], auth);
    expect(posts[0]!.body).toEqual({ src: 'https://hub.test/api/media/capa.jpg', position: 1 });
  });

  it('não repete imagem em retry quando o src continua igual', async () => {
    existing = ['https://hub.test/api/media/capa.jpg'];
    await syncNuvemshopImages('88421', ['https://hub.test/api/media/capa.jpg'], auth);
    expect(posts).toEqual([]);
  });

  it('falha com 429 para o job retentar', async () => {
    setNuvemshopFetchForTests(async (url, init) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ message: 'limite' }), { status: 429 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    await expect(
      syncNuvemshopImages('88421', ['https://hub.test/api/media/capa.jpg'], auth)
    ).rejects.toMatchObject({ status: 429 });
  });

  it('não chama a API quando o draft não tem imagem', async () => {
    await syncNuvemshopImages('88421', [], auth);
    expect(posts).toEqual([]);
  });
});
```

- [x] **Step 2: rodar e ver falhar**

```powershell
npm test --workspace=@bling-sync/api -- nuvemshop-product-body
```

- [x] **Step 3: implementar**

Substitua o stub `syncNuvemshopImages` por:

```ts
interface NuvemshopImage {
  src?: unknown;
}

async function readNuvemshopImageSrcs(externalId: string, auth: NuvemshopAuth): Promise<string[]> {
  const response = await nuvemshopFetch(
    `${apiBase(auth.storeId)}/products/${encodeURIComponent(externalId)}/images?per_page=200`,
    { headers: apiHeaders(auth), signal: AbortSignal.timeout(NUVEMSHOP_FETCH_TIMEOUT_MS) }
  );
  if (response.status < 200 || response.status >= 300) {
    throw new NuvemshopPublishError(
      response.status,
      `Nuvemshop respondeu ${response.status} ao listar as imagens do anúncio ${externalId}.`
    );
  }
  const body = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(body)) return [];
  return body
    .map((item) => (item && typeof item === 'object' ? (item as NuvemshopImage).src : null))
    .map((src) => (typeof src === 'string' ? src.trim() : ''))
    .filter((src) => src.length > 0);
}

/**
 * Reconcilia imagens por URL: só envia o src que não existe no anúncio.
 * Capa primeiro porque o draft já vem ordenado; position = existentes + i + 1.
 * Limitação V1: a Nuvemshop pode reescrever src para o CDN dela, e nesse caso
 * o Set não casa no retry. Resolver em P1 com mapa listing/position/sha256.
 */
export async function syncNuvemshopImages(
  externalId: string,
  images: string[] | undefined,
  auth: NuvemshopAuth
): Promise<void> {
  const planned = [...new Set((images ?? []).map((src) => src.trim()).filter(Boolean))].slice(
    0,
    NUVEMSHOP_MAX_IMAGES
  );
  if (planned.length === 0) return;

  const existing = new Set(await readNuvemshopImageSrcs(externalId, auth));
  const missing = planned.filter((src) => !existing.has(src));

  let position = existing.size;
  for (const src of missing) {
    if (position >= NUVEMSHOP_MAX_IMAGES) break;
    position += 1;
    const response = await nuvemshopFetch(
      `${apiBase(auth.storeId)}/products/${encodeURIComponent(externalId)}/images`,
      {
        method: 'POST',
        headers: apiHeaders(auth, true),
        body: JSON.stringify({ src, position }),
        signal: AbortSignal.timeout(NUVEMSHOP_FETCH_TIMEOUT_MS),
      }
    );
    if (response.status < 200 || response.status >= 300) {
      throw new NuvemshopPublishError(response.status, `Nuvemshop respondeu ${response.status} ao enviar a imagem.`);
    }
  }
}
```

- [x] **Step 4: rodar**

```powershell
npm test --workspace=@bling-sync/api -- nuvemshop-product-body
```

Esperado: 12 testes verdes (7 do body + 5 de imagens).

- [x] **Step 5: commit**

```powershell
git add apps/api/src/connectors/strategy/nuvemshop-publish.ts apps/api/src/__tests__/nuvemshop-product-body.test.ts
git commit -m "feat(nuvemshop): sincronizar imagens por URL sem duplicar no retry"
```

---

## Task 7: Ligar `listingDraftNow` ao draft da Nuvemshop

**Files:**
- Modify: `apps/api/src/queues/publish-queue.ts` (`listingDraftNow`)
- Modify: `apps/api/src/__tests__/publish-queue.test.ts` (fixture de categoria numérica)

- [x] **Step 1: implementar o roteamento**

Em `publish-queue.ts`, importe `buildNuvemshopDraft` de `../catalog/publish-preview.js` e troque `listingDraftNow` por:

```ts
async function listingDraftNow(productId: string, channel: PublishChannel): Promise<ListingDraft | null> {
  if (channel === 'nuvemshop') return buildNuvemshopDraft(productId);
  const preview = await buildPublishPreview(productId, channel);
  if (!preview?.payload.seller_custom_field) return null;
  return {
    sku: preview.payload.seller_custom_field,
    title: preview.payload.title,
    price: preview.payload.price,
    stock: preview.payload.available_quantity,
    attributes: preview.payload.attributes,
  };
}
```

> `buildPublishPreview` continua sendo usado por `enqueueReadyProducts` e `enqueueAutoPublish`; não remova o import.

- [x] **Step 2: ajustar a fixture numérica em `publish-queue.test.ts`**

A categoria `'NS-CAT'` do teste "cria o anúncio na Nuvemshop..." falharia na validação. Troque por `'123456'`:

```ts
channelCategoryId: '123456',
```

- [x] **Step 3: separar POST de imagem no mock do teste existente**

O mock atual conta **todo** POST como criação de produto. Com a sincronização de imagens, a capa passaria a inflar `posts` e quebraria `expect(posts).toHaveLength(3)`. Em `publish-queue.test.ts`, no teste "cria o anúncio na Nuvemshop...", troque o mock por:

```ts
const imagePosts: Array<{ src: string; position: number }> = [];
setNuvemshopFetchForTests(async (url, init) => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-rate-limit-remaining': '20' },
  });
  if (init?.method === 'POST' && url.includes('/images')) {
    imagePosts.push(JSON.parse(String(init.body)) as { src: string; position: number });
    return json(201, { id: imagePosts.length });
  }
  if (init?.method === 'POST') {
    posts.push(String(init.body ?? ''));
    if (mode === 'retry') return json(503, { message: 'indisponível' });
    if (mode === 'reject') return json(400, { description: 'nome inválido' });
    return json(201, { id: 88421 });
  }
  if (url.includes('/images')) {
    return json(200, imagePosts.map((image) => ({ src: image.src })));
  }
  if (url.includes('/products/sku/')) {
    if (mode === 'exists') return json(200, { product_id: 88421, sku: 'NS-NOVO', price: '49.90', stock: 7 });
    return json(404, {});
  }
  return json(200, []);
});
```

Mantenha o resto do teste igual. `posts` continua contando só produto.

- [x] **Step 4: rodar**

```powershell
npm run typecheck
npm test --workspace=@bling-sync/api -- publish-queue.test
```

Esperado: o teste existente continua verde. As asserções atuais (`sent.variants[0]` com `price`, `stock`, `sku`) seguem válidas porque o produto é simples.

- [x] **Step 5: commit**

```powershell
git add apps/api/src/queues/publish-queue.ts apps/api/src/__tests__/publish-queue.test.ts
git commit -m "feat(nuvemshop): usar draft completo no worker de publicacao"
```

---

## Task 8: Teste de contrato end-to-end e suíte completa

**Files:**
- Modify: `apps/api/src/__tests__/publish-queue.test.ts`

- [x] **Step 1: escrever o teste de contrato**

Adicione um novo `it` no describe `P2 — fila de publicação`, com SKUs únicos. Use exatamente esta estrutura (adapte o helper de enqueue do bloco existente):

```ts
it('publica produto variável com HTML, categoria, marca, atributos e imagens na ordem', async () => {
  const category = await query<{ id: string }>(
    `INSERT INTO hub_categories (name) VALUES ('Nuvemshop Variável') RETURNING id`
  );
  const categoryId = category.rows[0]!.id;
  const product = await query<{ id: string }>(
    `INSERT INTO master_products (
       erp_id, erp_sku, name, brand, description, bling_tipo, product_format,
       hub_category_id, ncm_status, ncm_fiscal_risk
     ) VALUES ('ns-var', 'NS-VAR', 'Camiseta Dry Fit', 'JHS', $2, 'P', 'V', $1, 'valid', false)
     RETURNING id`,
    [categoryId, 'Linha 1\n\nLinha 2']
  );
  const productId = product.rows[0]!.id;

  const axes = await query<{ id: string; canonical_name: string }>(
    `SELECT id, canonical_name FROM attribute_axes WHERE canonical_name IN ('cor', 'tamanho')`
  );
  for (const axis of axes.rows) {
    await query(
      `INSERT INTO product_axes (master_product_id, axis_id, sort_order) VALUES ($1, $2, $3)`,
      [productId, axis.id, axis.canonical_name === 'cor' ? 1 : 2]
    );
  }

  const first = await query<{ id: string }>(
    `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
     VALUES ($1, 'NS-AZ-M', false, 'V', 49.9, 3, 3) RETURNING id`,
    [productId]
  );
  const second = await query<{ id: string }>(
    `INSERT INTO product_variants (master_product_id, erp_sku, is_default, product_format, price, stock, catalog_stock)
     VALUES ($1, 'NS-PT-G', false, 'V', 54.9, 4, 4) RETURNING id`,
    [productId]
  );
  const axisId = new Map(axes.rows.map((axis) => [axis.canonical_name, axis.id]));
  const entries: Array<[string, string, string]> = [
    [first.rows[0]!.id, axisId.get('cor')!, 'Azul'],
    [first.rows[0]!.id, axisId.get('tamanho')!, 'M'],
    [second.rows[0]!.id, axisId.get('cor')!, 'Preto'],
    [second.rows[0]!.id, axisId.get('tamanho')!, 'G'],
  ];
  for (const [variantId, axis, value] of entries) {
    await query(
      `INSERT INTO variant_attributes (variant_id, axis_id, canonical_value, sort_order) VALUES ($1, $2, $3, 0)`,
      [variantId, axis, value]
    );
  }
  await query(
    `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
     VALUES ('DEP-VAR', 'Loja Variável', 'seller', true)`
  );
  for (const variantId of [first.rows[0]!.id, second.rows[0]!.id]) {
    await query(
      `INSERT INTO variant_stock_balances (variant_id, bling_warehouse_id, saldo_fisico, saldo_virtual)
       VALUES ($1, 'DEP-VAR', 3, 3)`,
      [variantId]
    );
  }
  await query(
    `INSERT INTO product_images (
       master_product_id, source_url, url_normalized, source_platform,
       sha256_hash, format, is_cover_eligible, position_ns
     ) VALUES
       ($1, 'https://bling.test/sec.jpg', 'https://bling.test/sec.jpg', 'bling', NULL, 'jpeg', false, 2),
       ($1, 'https://bling.test/capa.jpg', 'https://bling.test/capa.jpg', 'bling', $2, 'jpeg', true, 1)`,
    [productId, 'b'.repeat(64)]
  );

  await request(app)
    .put(`/api/catalog/categories/${categoryId}/channels/nuvemshop`)
    .set('Cookie', cookie)
    .send({
      channelCategoryId: '123456',
      channelCategoryName: 'Camisetas',
      attributes: [
        { channelAttributeId: 'BRAND', channelAttributeName: 'Marca', required: true, mode: 'fixed', fixedValue: 'JHS' },
      ],
    });

  const previousBase = process.env.PUBLIC_BASE_URL;
  const previousStore = process.env.NUVEMSHOP_STORE_ID;
  process.env.PUBLIC_BASE_URL = 'https://hub.test';
  process.env.NUVEMSHOP_STORE_ID = '998877';
  process.env.LIVE_PUBLISH_ALLOWLIST = 'NS-VAR';
  resetNuvemshopRateLimitForTests();
  await new OAuthTokenManager().upsertToken({
    provider: 'nuvemshop',
    accessToken: 'token-de-teste',
    refreshToken: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const productPosts: Array<Record<string, unknown>> = [];
  const imagePosts: Array<{ src: string; position: number }> = [];
  let createdProductId: number | null = null;
  let imageAttempts = 0;

  setNuvemshopFetchForTests(async (url, init) => {
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'x-rate-limit-remaining': '20' },
    });

    if (init?.method === 'POST' && url.includes('/images')) {
      imageAttempts += 1;
      // A capa entra; a segunda imagem falha para forçar retry parcial.
      if (imageAttempts === 2) return json(503, { message: 'indisponível' });
      const body = JSON.parse(String(init.body)) as { src: string; position: number };
      imagePosts.push(body);
      return json(201, { id: imagePosts.length, src: body.src });
    }
    if (init?.method === 'POST') {
      productPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      createdProductId = 88422;
      return json(201, { id: createdProductId });
    }
    if (url.includes('/products/') && url.includes('/images')) {
      return json(200, imagePosts.map((post) => ({ src: post.src })));
    }
    if (url.includes('/products/sku/')) {
      if (createdProductId === null) return json(404, {});
      const sku = decodeURIComponent(url.split('/products/sku/')[1]!.split('?')[0]!);
      return json(200, { product_id: createdProductId, sku, price: '49.90', stock: 3 });
    }
    return json(200, []);
  });

  const enqueue = async () => {
    await query(
      `UPDATE publish_queue SET status = 'failed'
       WHERE product_id = $1 AND channel = 'nuvemshop' AND status IN ('pending', 'processing')`,
      [productId]
    );
    const inserted = await query<{ id: string }>(
      `INSERT INTO publish_queue (product_id, channel, payload_json)
       VALUES ($1, 'nuvemshop', '{}') RETURNING id`,
      [productId]
    );
    return inserted.rows[0]!.id;
  };

  try {
    const retryId = await enqueue();
    await expect(processPublishQueueItem(retryId, { live: true })).rejects.toBeInstanceOf(NuvemshopPublishError);
    expect(productPosts).toHaveLength(1);
    expect(await query<{ status: string }>(`SELECT status FROM publish_queue WHERE id = $1`, [retryId]))
      .toMatchObject({ rows: [{ status: 'pending' }] });
    expect(imagePosts).toEqual([
      { src: `https://hub.test/api/media/${'b'.repeat(64)}.jpg`, position: 1 },
    ]);

    const createdId = await enqueue();
    await processPublishQueueItem(createdId, { live: true });

    // Retry não repete o POST do produto: o lookup por SKU achou 88422.
    expect(productPosts).toHaveLength(1);
    const body = productPosts[0] as {
      name: { pt: string };
      description: { pt: string };
      categories: number[];
      brand: string;
      attributes: Array<{ pt: string }>;
      variants: Array<{ sku: string; price: string; stock: number; values: Array<{ pt: string }> }>;
    };
    expect(body.name).toEqual({ pt: 'Camiseta Dry Fit' });
    expect(body.description).toEqual({ pt: '<p>Linha 1</p><p>Linha 2</p>' });
    expect(body.categories).toEqual([123456]);
    expect(body.brand).toBe('JHS');
    expect(body.attributes).toEqual([{ pt: 'Cor' }, { pt: 'Tamanho' }]);
    expect(body.variants).toHaveLength(2);
    expect(body.variants.find((variant) => variant.sku === 'NS-AZ-M')).toMatchObject({
      price: '49.90',
      stock: 3,
      values: [{ pt: 'Azul' }, { pt: 'M' }],
    });
    expect(body.variants.find((variant) => variant.sku === 'NS-PT-G')).toMatchObject({
      price: '54.90',
      stock: 4,
      values: [{ pt: 'Preto' }, { pt: 'G' }],
    });

    // O retry reconciliou: a capa já estava no anúncio e só a secundária subiu, na posição 2.
    expect(imagePosts).toEqual([
      { src: `https://hub.test/api/media/${'b'.repeat(64)}.jpg`, position: 1 },
      { src: 'https://bling.test/sec.jpg', position: 2 },
    ]);

    const link = await query<{ listing_id: string }>(
      `SELECT listing_id FROM channel_listing_links WHERE product_id = $1 AND channel = 'nuvemshop'`,
      [productId]
    );
    expect(link.rows).toEqual([{ listing_id: '88422' }]);
  } finally {
    setNuvemshopFetchForTests(null);
    resetNuvemshopRateLimitForTests();
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
    if (previousStore === undefined) delete process.env.NUVEMSHOP_STORE_ID;
    else process.env.NUVEMSHOP_STORE_ID = previousStore;
    delete process.env.LIVE_PUBLISH_ALLOWLIST;
  }
});
```

> O `GET /products/{id}/images` do mock devolve o que já entrou em `imagePosts`. Na segunda tentativa, a capa está no `Set` e só a secundária é enviada na posição 2 — é exatamente a reconciliação que queremos provar.

- [x] **Step 2: rodar o contrato**

```powershell
npm test --workspace=@bling-sync/api -- publish-queue.test
```

Esperado: verde, com 2 objetos em `variants` e imagens nas posições 1 e 2.

- [x] **Step 3: rodar a suíte completa e o typecheck**

```powershell
npm run typecheck
npm test -- --maxWorkers=2
```

`--maxWorkers=2` evita a flakiness do `p1-catalog` causada pelos processos externos do wago. Esperado: **exit 0**, todos os arquivos verdes.

- [x] **Step 4: conferir o comportamento de produção**

Antes de fechar, verifique no `.env` de produção:
- `PUBLIC_BASE_URL` preenchido (sem ele, as imagens usam a URL de origem e podem ser recusadas);
- `LIVE_PUBLISH_ALLOWLIST` com os SKUs do teste ou vazio, conforme a política da janela;
- `NUVEMSHOP_STORE_ID` resolvido (env ou cursor).

- [x] **Step 5: commit**

```powershell
git add apps/api/src/__tests__/publish-queue.test.ts
git commit -m "test(nuvemshop): contrato de publicacao com variacoes e imagens"
```

---

## Critérios de aceite (verificar um por um)

- [x] `npm run typecheck` exit 0.
- [x] `npm test -- --maxWorkers=2` exit 0.
- [x] `POST /products` contém `description.pt` em HTML, `categories` numérico, `brand` e `attributes` com os nomes dos eixos.
- [x] O body tem **um objeto em `variants` por variante ativa**, com SKU, preço, estoque e `values` na ordem dos `attributes`.
- [x] Produto com 10 variações envia 10 objetos (teste unitário cobre).
- [x] Primeira imagem enviada tem `position: 1`; capa elegível vem primeiro.
- [x] Retry após falha de imagem não reenvia o que já está no anúncio.
- [x] Produto variável sem `is_default` fica com checklist verde.
- [x] Categoria não numérica falha com mensagem clara e não faz POST.
- [x] SKU existente na Nuvemshop (fora do HUB) não gera segundo POST.
- [x] 429/5xx voltam o job para `pending`; 4xx encerram.

## Riscos conhecidos (não resolver nesta entrega)

1. **Reescrita de `src` pelo CDN**: o `Set` pode não casar no retry; a imagem pode ser reenviada. P1: persistir `{listing_id, position, sha256}`.
2. **N+1 no lookup de existência**: até 1 chamada por SKU, com timeout de 5s e parada no primeiro acerto/erro. P1: busca em lote por `GET /products?q=`.
3. **Mais de 3 eixos**: falha explícita; não publica torto.
4. **Reordenação de imagem em anúncio existente**: `position` é append; reordenar exige `PUT /images/{id}`.
5. **Campos de ficha técnica** (GTIN, voltagem livre) não têm campo na API `2025-03`; continuam apenas no mapa da categoria. Não invente `metafields` nesta entrega.

## Adendo — 13/11/2026

Todas as tarefas deste plano foram concluídas e estão em `main` (`82ba787` → `75f7365`), com `npm test` em 55 suítes / 222 testes aprovados.

O N+1 na busca de SKUs foi aceito como risco conhecido para o Go-Live. A solução definitiva (GET em lote) fica para o P1.
