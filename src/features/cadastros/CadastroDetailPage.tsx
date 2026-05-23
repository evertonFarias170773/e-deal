"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, CreditCard, Mail, MapPin, Phone, ShieldCheck } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import { formatDocument } from "@/lib/formatters/document";
import type { Cadastro, CadastroCategoria } from "@/features/cadastros/types";

const categoriaLabel: Record<CadastroCategoria, string> = {
  CLIENTE: "Cliente",
  TRANSPORTADORA: "Transportadora",
  FORNECEDOR: "Fornecedor",
  ORGAO_PUBLICO: "Orgao publico"
};

type CadastroDetailPageProps = {
  cadastro: Cadastro;
  dataSource?: "supabase" | "mock";
};

export function CadastroDetailPage({ cadastro, dataSource = "mock" }: CadastroDetailPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();

  function showMockActionToast(title: string) {
    showToast({
      type: "info",
      title,
      description: "Acao mockada para validacao visual. Nenhum backend real foi acionado."
    });
  }

  return (
    <div className="space-y-6" data-cadastros-detail-source={dataSource}>
      <div>
        <Link
          href="/cadastros"
          className="inline-flex items-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-3 py-2 text-sm font-semibold text-[#0b2f4a] shadow-sm transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para cadastros
        </Link>
      </div>

      <PageHeader
        title={cadastro.nome}
        subtitle={`Cadastro #${cadastro.idCliente} - ${categoriaLabel[cadastro.categoria]} - ${cadastro.cidadeUf}`}
        context="Detalhe do cadastro"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {cadastro.restricao ? (
              <StatusBadge status="COM RESTRICAO" tone="danger" />
            ) : cadastro.ativo ? (
              <StatusBadge status="ATIVO" tone="success" />
            ) : (
              <StatusBadge status="INATIVO" tone="neutral" />
            )}
            <ActionsMenu
              items={[
                { label: "Editar cadastro", onClick: () => router.push(`/cadastros/${cadastro.idCliente}/editar`) },
                { label: "Criar proposta", onClick: () => showMockActionToast("Criar proposta") },
                { label: "Consultar credito", onClick: () => showMockActionToast("Consulta de credito") },
                { label: "Abrir WhatsApp", onClick: () => showMockActionToast("Abrir WhatsApp") },
                { label: "Ver financeiro", onClick: () => showMockActionToast("Ver financeiro") },
                { label: "Ver notas fiscais", onClick: () => showMockActionToast("Ver notas fiscais") },
                { label: "Inativar cadastro", destructive: true, onClick: () => showMockActionToast("Inativar cadastro") }
              ]}
            />
          </div>
        }
      />

      {cadastro.restricao ? (
        <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5 text-orange-800">
          <h2 className="font-semibold">Atencao necessaria</h2>
          <p className="mt-1 text-sm">
            Este cadastro possui restricao. Revise credito, documento e observacoes antes de criar
            nova proposta.
          </p>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Limite de credito"
          value={formatCurrency(cadastro.limiteCredito)}
          description="Valor operacional configurado no cadastro."
          tone="info"
          icon={CreditCard}
        />
        <SummaryCard
          title="Credito disponivel"
          value={formatCurrency(cadastro.creditoDisponivel)}
          description={`Risco ${cadastro.riscoCredito.toLowerCase()} para analise comercial.`}
          tone={cadastro.restricao ? "warning" : "success"}
          icon={ShieldCheck}
        />
        <SummaryCard
          title="Total comprado"
          value={formatCurrency(cadastro.totalCompras)}
          description={`Ultima compra em ${formatDate(cadastro.ultimaCompra)}.`}
          tone="special"
          icon={Building2}
        />
        <SummaryCard
          title="Contatos"
          value={cadastro.contatos.length.toString()}
          description="Pessoas vinculadas a este cadastro."
          tone="neutral"
          icon={Phone}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <div className="space-y-6">
          <DetailCard title="Dados principais">
            <InfoGrid
              items={[
                ["ID operacional", `#${cadastro.idCliente}`],
                ["Categoria", categoriaLabel[cadastro.categoria]],
                ["Documento", formatDocument(cadastro.documento)],
                ["Tipo pessoa", cadastro.tipoPessoa],
                ["Empresa padrao", cadastro.empresaPadrao],
                ["Vendedor/atendente", cadastro.vendedor],
                ["Pagamento padrao", cadastro.padraoPagamento],
                ["Verificado", cadastro.verificado ? "Sim" : "Nao"]
              ]}
            />
          </DetailCard>

          <DetailCard title="Enderecos">
            {cadastro.enderecos.length ? (
              <div className="space-y-3">
                {cadastro.enderecos.map((endereco) => (
                  <div key={endereco.id} className="flex gap-4 rounded-2xl bg-slate-50 p-4">
                    <span className="mt-1 rounded-2xl bg-[#dff8f6] p-3 text-[#0b7774]">
                      <MapPin className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <p className="font-semibold text-slate-950">
                          {endereco.endereco}, {endereco.numero}
                        </p>
                        <StatusBadge status={endereco.tipo.toUpperCase()} tone="neutral" />
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {endereco.bairro} - {endereco.cidade}/{endereco.uf} - CEP {endereco.cep}
                      </p>
                      {endereco.complemento ? (
                        <p className="mt-1 text-sm text-slate-500">Complemento: {endereco.complemento}</p>
                      ) : null}
                      {endereco.obs ? <p className="mt-1 text-sm text-slate-500">{endereco.obs}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Nenhum endereco cadastrado.</p>
            )}
          </DetailCard>

          <DetailCard title="Observacoes">
            <p className="text-sm leading-6 text-slate-600">{cadastro.observacoes}</p>
          </DetailCard>
        </div>

        <div className="space-y-6">
          <DetailCard title="Contatos">
            <div className="space-y-3">
              {cadastro.contatos.map((contato) => (
                <div key={contato.id} className="rounded-2xl border border-slate-200 p-4">
                  <p className="font-semibold text-slate-950">{contato.nome}</p>
                  <p className="text-sm text-slate-500">{contato.cargo}</p>
                  <div className="mt-3 space-y-1 text-sm text-slate-600">
                    <p className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-[#0f9f9a]" />
                      {contato.whatsapp}
                    </p>
                    <p className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-[#0f9f9a]" />
                      {contato.email}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </DetailCard>

          <DetailCard title="Vinculos comerciais">
            {cadastro.vinculosComerciais.length ? (
              <div className="space-y-2">
                {cadastro.vinculosComerciais.map((vinculo) => (
                  <div key={vinculo.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">{vinculo.nome}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      #{vinculo.idClienteRelacionado} - {formatDocument(vinculo.documento)} - {vinculo.tipoRelacao}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Nenhum cadastro relacionado informado.</p>
            )}
          </DetailCard>

          <DetailCard title="Resumo fiscal e credito">
            <InfoGrid
              items={[
                ["Documento", cadastro.verificado ? "Verificado" : "Pendente de revisao"],
                ["Restricao", cadastro.restricao ? "Sim" : "Nao"],
                ["Risco credito", cadastro.riscoCredito],
                ["Credito disponivel", formatCurrency(cadastro.creditoDisponivel)]
              ]}
            />
          </DetailCard>
        </div>
      </section>
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-2xl bg-slate-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
