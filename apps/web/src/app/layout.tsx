import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '../components/app-shell';
import { ThemeProvider } from '../components/theme-provider';

export const metadata: Metadata = {
  title: 'JH Sync Hub — Dashboard Operacional & Fiscal',
  description: 'Hub de sincronização de catálogo entre Bling ERP v3, Mercado Livre e Nuvemshop',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-screen bg-bg-base text-text-primary antialiased">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
