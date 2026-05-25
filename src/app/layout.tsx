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
    <html lang="pt-BR">
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
