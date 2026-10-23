import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '../components/app-shell';

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
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
