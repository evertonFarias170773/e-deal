import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppToastProvider } from "@/components/common/AppToast";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { CobrancasProvider } from "@/features/cobrancas/CobrancasProvider";
import { CompanyProvider } from "@/features/companies/CompanyProvider";

export const metadata: Metadata = {
  title: "ERP Ideal Mockado",
  description: "Primeira versão navegável e mockada do ERP Ideal"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Google Fonts — Inter */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Script anti-flash: aplica classe dark antes do React hidratar */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('erp-theme');if(t==='dark'||(t==null&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`
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
