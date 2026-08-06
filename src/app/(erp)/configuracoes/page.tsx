"use client";

import React from "react";
import Link from "next/link";
import { 
  UserCog, 
  Building2, 
  Cpu, 
  ReceiptText, 
  FileText, 
  Settings, 
  ArrowRight,
  ShieldCheck
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { AcessoNegado } from "@/features/usuarios-perfis/components/AcessoNegado";
import { APP_NAME } from "@/constants/brand";

interface ConfigHubCardProps {
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

function ConfigHubCard({ title, description, href, icon: Icon, disabled = false }: ConfigHubCardProps) {
  const CardBody = (
    <div 
      className={`group relative rounded-3xl border p-6 flex flex-col justify-between h-48 transition-all duration-200 ${
        disabled 
          ? "opacity-60 cursor-not-allowed" 
          : "hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
      }`}
      style={{ 
        borderColor: "var(--border)", 
        background: "var(--card, white)" 
      }}
    >
      <div className="space-y-3">
        <div 
          className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ${
            disabled
              ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
              : "bg-blue-50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30"
          }`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-1.5">
            {title}
            {disabled && (
              <span className="rounded-md bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground uppercase">
                Em breve
              </span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {description}
          </p>
        </div>
      </div>

      {!disabled && (
        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 mt-2">
          Acessar painel
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
        </div>
      )}
    </div>
  );

  if (disabled) {
    return CardBody;
  }

  return (
    <Link href={href}>
      {CardBody}
    </Link>
  );
}

export default function ConfiguracoesHubPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            Carregando configurações...
          </p>
        </div>
      </div>
    );
  }

  // Permissão de acesso igual à de gestão de usuários (leitura ou escrita)
  const isAuthorized =
    user.isSuperAdmin ||
    user.isAdmin ||
    hasPermissao(user, "admin.usuarios.edit") ||
    hasPermissao(user, "admin.usuarios.view");

  if (!isAuthorized) {
    return (
      <div className="max-w-7xl mx-auto py-6 px-4">
        <AcessoNegado />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 py-6 px-4">
      {/* Cabeçalho */}
      <div className="border-b pb-5" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-900 text-foreground">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Configurações
            </h1>
            <p className="text-sm mt-0.5 text-muted-foreground">
              Painel administrativo para controle e parametrização do {APP_NAME}.
            </p>
          </div>
        </div>
      </div>

      {/* Grid de Configurações */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <ConfigHubCard
          title="Usuários e Perfis"
          description="Vincule perfis de acesso a operadores do sistema, audite permissões ativas e controle fallbacks legados."
          href="/configuracoes/usuarios"
          icon={UserCog}
        />
        <ConfigHubCard
          title="Perfis e Permissões"
          description="Gerencie as permissões granulares de acesso para cada perfil do catálogo do sistema."
          href="/configuracoes/perfis"
          icon={ShieldCheck}
        />
        <ConfigHubCard
          title="Empresas"
          description="Gerencie as filiais operacionais do grupo, chaves de acesso, logos e dados cadastrais comerciais."
          href="/configuracoes/empresas"
          icon={Building2}
          disabled
        />
        <ConfigHubCard
          title="Integrações"
          description="Configure webhooks, conexões com bancos, gateways de pagamento, APIs de Notas Fiscais e serviços externos."
          href="/configuracoes/integracoes"
          icon={Cpu}
          disabled
        />
        <ConfigHubCard
          title="Faturamento e Cobranças"
          description="Parametrizar formas de pagamento permitidas por filial, limites de crédito globais e taxas de parcelamento."
          href="/configuracoes/faturamento"
          icon={ReceiptText}
          disabled
        />
        <ConfigHubCard
          title="Parâmetros Fiscais"
          description="Defina CFOPs de fallbacks internos e interestaduais, alíquotas de ICMS/ISS padrão e séries de NFs operacionais."
          href="/configuracoes/fiscal"
          icon={FileText}
          disabled
        />
      </div>
    </div>
  );
}
