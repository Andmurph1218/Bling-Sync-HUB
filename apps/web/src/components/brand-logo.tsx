import React from 'react';

const BRANDS: Record<string, { src: string; bg: string; label: string; fit?: 'contain' | 'cover' }> = {
  mercadolivre: { src: '/brands/mercadolivre.svg', bg: '#fff159', label: 'Mercado Livre' },
  nuvemshop: { src: '/brands/nuvemshop.ico', bg: '#ffffff', label: 'Nuvemshop' },
  shopee: { src: '/brands/shopee.svg', bg: '#ee4d2d', label: 'Shopee' },
  amazon: { src: '/brands/amazon.svg', bg: '#232f3e', label: 'Amazon' },
  tiktok: { src: '/brands/tiktok.svg', bg: '#111111', label: 'TikTok Shop' },
  bling: { src: '/brands/bling.ico', bg: '#ffffff', label: 'Bling' },
  omie: { src: '/brands/omie.ico', bg: '#000000', label: 'Omie', fit: 'cover' },
  correios: { src: '/brands/correios.png', bg: '#000000', label: 'Correios', fit: 'cover' },
  melhorenvio: { src: '/brands/melhorenvio.png', bg: '#3d7a45', label: 'Melhor Envio', fit: 'cover' },
};

export function BrandLogo({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  const brand = BRANDS[id];
  if (!brand) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-lg bg-bg-surface text-xs font-bold text-text-primary"
        style={{ width: size, height: size }}
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/10"
      style={{ width: size, height: size, backgroundColor: brand.bg }}
      title={brand.label}
    >
      <img
        src={brand.src}
        alt=""
        className={brand.fit === 'cover' ? 'h-full w-full object-cover' : 'h-[70%] w-[70%] object-contain'}
      />
    </span>
  );
}
