"use client";

import Link from "next/link";
import { AlertTriangle, Clock3, Scale } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters/currency";
import type { DashboardExecutivoPayload } from "@/features/dashboard/types";

type AlertTone = "danger" | "warning" | "info";

const toneClasses: Record<AlertTone, string> = {
  danger:
    "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800",
  warning:
    "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800",
  info: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800"
};

type Alerta = {
  key: string;
  tone: AlertTone;
  icon: LucideIcon;
  label: string;
  href: string;
};

/** Alertas derivados do próprio payload (nenhuma consulta extra). */
export function AlertasBanner({ data }: { data: DashboardExecutivoPayload }) {
  const alertas: Alerta[] = [];

  const nfErros = data.fiscal.nfe.rejeitadas + data.fiscal.nfse.rejeitadas;
  if (nfErros > 0) {
    alertas.push({
      key: "nf-erro",
      tone: "danger",
      icon: AlertTriangle,
      label: `${nfErros} nota(s) fiscal(is) com erro ou rejeição`,
      href: "/notas-fiscais"
    });
  }

  const vencidos = data.financeiro.carteira.vencido;
  if (vencidos.qtd > 0) {
    alertas.push({
      key: "boletos-vencidos",
      tone: "warning",
      icon: Clock3,
      label: `${vencidos.qtd} boleto(s) vencido(s) — ${formatCurrency(vencidos.valor)}`,
      href: "/contas-a-receber?status=VENCIDOS"
    });
  }

  const cc = data.financeiro.pendencias_cc;
  if (cc.qtd > 0) {
    alertas.push({
      key: "cc-pendencias",
      tone: "info",
      icon: Scale,
      label: `${cc.qtd} pendência(s) de conta corrente — ${formatCurrency(cc.valor)}`,
      href: "/conta-corrente"
    });
  }

  if (alertas.length === 0) return null;

  return (
    <section aria-label="Alertas importantes" className="flex flex-wrap gap-2">
      {alertas.map(({ key, tone, icon: Icon, label, href }) => (
        <Link
          key={key}
          href={href}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ring-1 transition hover:opacity-85",
            toneClasses[tone]
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </Link>
      ))}
    </section>
  );
}
