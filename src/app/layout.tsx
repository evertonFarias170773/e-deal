import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppToastProvider } from "@/components/common/AppToast";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { CobrancasProvider } from "@/features/cobrancas/CobrancasProvider";
import { CompanyProvider } from "@/features/companies/CompanyProvider";

// next/font/google — sem warning de lint, otimizado e auto-hospedado pelo Next.js
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  weight: ["400", "500", "600", "700", "800"]
});

export const metadata: Metadata = {
  title: "ERP Ideal",
  description: "Sistema ERP Ideal — Painel operacional"
};

// Script anti-flash extraído como constante para evitar bug de geração do
// validator.ts do Next.js com parênteses dentro de dangerouslySetInnerHTML inline.
const antiFlashScript =
  "(function(){try{var t=localStorage.getItem('erp-theme');" +
  "if(t==='dark'||(t==null&&window.matchMedia('(prefers-color-scheme: dark)').matches))" +
  "{document.documentElement.classList.add('dark')}}catch(e){}})();";

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={inter.variable}>
      <head>
        {/* Script anti-flash: aplica classe dark antes do React hidratar */}
        <script
          dangerouslySetInnerHTML={{
            __html: antiFlashScript
          }}
        />
      </head>
      <body>
        <AuthProvider>
          <CompanyProvider>
            <CobrancasProvider>
              <AppToastProvider>{children}</AppToastProvider>
            </CobrancasProvider>
          </CompanyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
