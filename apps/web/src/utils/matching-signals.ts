export type SignalTone = 'positive' | 'conflict' | 'warning';

export interface TranslatedSignal {
  raw: string;
  label: string;
  tone: SignalTone;
}

const STATIC_SIGNAL_MAP: Record<string, { label: string; tone: SignalTone }> = {
  sku_exact: { label: 'SKU Idêntico', tone: 'positive' },
  sku: { label: 'SKU Idêntico', tone: 'positive' },
  ean_exact: { label: 'EAN Idêntico (GS1 Válido)', tone: 'positive' },
  ean: { label: 'EAN Idêntico (GS1 Válido)', tone: 'positive' },
  ean_shared_conflict: {
    label: 'EAN em conflito (mais de um dono)',
    tone: 'conflict',
  },
  family_multi_parent_conflict: {
    label: 'Família ML aponta para 2 pais distintos',
    tone: 'conflict',
  },
  title_divergent_warning: {
    label: 'SKU bate, mas nome diverge (possível anúncio reutilizado)',
    tone: 'warning',
  },
};

/**
 * Traduz códigos técnicos de sinais do PIRE (Seção 8.1 do Plano Mestre)
 * para rótulos amigáveis com semântica visual (positivo, aviso, conflito).
 */
export function translateMatchingSignal(rawSignal: string): TranslatedSignal {
  const normalized = rawSignal.trim();

  if (STATIC_SIGNAL_MAP[normalized]) {
    return {
      raw: rawSignal,
      ...STATIC_SIGNAL_MAP[normalized]!,
    };
  }

  // Padrão name_jw_70_89 (faixa de similaridade parcial — sinal auxiliar, não forte)
  const jwRange = normalized.match(/^name_jw_(\d{1,3})_(\d{1,3})$/i);
  if (jwRange) {
    return {
      raw: rawSignal,
      label: `Nome ${jwRange[1]}–${jwRange[2]}% similar (sinal fraco)`,
      tone: 'warning',
    };
  }

  // Padrão name_jw_92 ou name_jw: 92
  const jwMatch = normalized.match(/^name_jw[_:\s]+(\d{1,3})$/i);
  if (jwMatch) {
    const pct = Number(jwMatch[1]);
    return {
      raw: rawSignal,
      label: `Nome ${pct}% similar`,
      tone: pct >= 90 ? 'positive' : 'warning',
    };
  }

  // Padrão ean_7891234567895_shared
  const eanSharedMatch = normalized.match(/^ean_(\d+)_shared$/i);
  if (eanSharedMatch) {
    return {
      raw: rawSignal,
      label: `EAN ${eanSharedMatch[1]} em conflito (mais de um dono)`,
      tone: 'conflict',
    };
  }

  return {
    raw: rawSignal,
    label: rawSignal,
    tone: 'positive',
  };
}

export function buildBlingProductUrl(blingId: string): string {
  return `https://www.bling.com.br/produtos.php#edit/${encodeURIComponent(blingId)}`;
}

export function buildChannelAnnouncementUrl(
  platform: 'Mercado Livre' | 'Nuvemshop',
  channelItemId: string,
  nuvemshopStoreId = '6667412'
): string {
  if (platform === 'Mercado Livre') {
    const cleanId = channelItemId.replace(/^MLB-?/i, 'MLB-');
    return `https://produto.mercadolivre.com.br/${encodeURIComponent(cleanId)}`;
  }
  const cleanProductId = channelItemId.replace(/^NS-?/i, '');
  return `https://${encodeURIComponent(nuvemshopStoreId)}.mitiendanube.com/admin/products/${encodeURIComponent(cleanProductId)}`;
}
