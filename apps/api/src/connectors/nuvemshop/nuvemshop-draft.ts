import { AttributeMapInput, materializeChannelAttributes } from '../../catalog/channel-attributes.js';
import { isBlankSku } from '../../catalog/blank-sku.js';
import { getPublicBaseUrl } from '../../config/public-url.js';
import { query } from '../../db/pool.js';
import { resolveProductCategory } from '../../services/category-resolver.service.js';
import { mediaRelativePath } from '../../routes/media.js';
import { ListingDraft, ListingDraftAttribute } from '../strategy/types.js';
import { toNuvemshopHtml } from './nuvemshop-html.js';
import { NUVEMSHOP_MAX_AXES, NUVEMSHOP_MAX_IMAGES } from './nuvemshop-publish.js';

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
      name:
        inputs.find((input) => input.channelAttributeId === attribute.id)?.channelAttributeName ??
        attribute.id,
    }));
  }

  const categoryRaw = (await resolveProductCategory(productId, 'nuvemshop') ?? '').trim();
  const categoryId = Number(categoryRaw);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new Error(
      `Categoria da Nuvemshop inválida para o produto ${masterSku}: "${categoryRaw}". Confira o vínculo no ERP e sincronize em Atributos.`
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
