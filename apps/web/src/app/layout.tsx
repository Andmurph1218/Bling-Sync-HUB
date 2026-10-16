import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bling Sync HUB — Dashboard Operacional & Fiscal',
  description: 'Hub de sincronização de catálogo entre Bling ERP v3, Mercado Livre e Nuvemshop',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <nav className="border-b border-slate-800 bg-slate-900/80 px-6 py-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/" className="text-lg font-bold tracking-tight text-white">
                Bling Sync HUB
              </Link>
              <div className="flex items-center gap-4 text-sm text-slate-300">
                <Link href="/" className="hover:text-white">
                  Visão Geral
                </Link>
                <Link href="/matching" className="hover:text-white">
                  Matching (PIRE / VIR)
                </Link>
                <Link href="/fiscal/ean" className="hover:text-white">
                  Fiscal · EAN (GVE)
                </Link>
                <Link href="/fiscal/ncm" className="hover:text-white">
                  Fiscal · NCM (Dupla Confirmação)
                </Link>
              </div>
            </div>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
              Soberania Bling ERP v3
            </span>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
