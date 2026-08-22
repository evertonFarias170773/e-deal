"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeCheck, Bot, Clock, Eye, Package, Scale, ShieldCheck } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { ConfirmarAcaoModal } from "@/features/expedicao/components/ConfirmarAcaoModal";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { inativarProdutoReal } from "@/features/produtos/services/produtos.service";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SummaryCard } from "@/components/common/SummaryCard";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatWeightFromGrams } from "@/lib/formatters/weight";
import type { Produto } from "@/features/produtos/types";

type ProdutoDetailPageProps = {
  produto: Produto;
};

export function ProdutoDetailPage({ produto: produtoInicial }: ProdutoDetailPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [openOptionsVariationId, setOpenOptionsVariationId] = useState<number | null>(null);

  /**
   * O produto vive em estado local a partir do prop porque a inativacao
   * (21/08/2026) precisa refletir na hora. So o campo `ativo` e reescrito: o
   * retorno de `updateProdutoReal` nao traz fotos nem variacoes (mapeia a linha
   * sem as relacoes), entao substituir o objeto inteiro apagaria a galeria e a
   * lista de variacoes da tela.
   */
  const [produto, setProduto] = useState(produtoInicial);
  const { user } = useAuth();
  const podeCriar = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "produtos.create");
  const [confirmandoInativar, setConfirmandoInativar] = useState(false);
  const [inativando, setInativando] = useState(false);

  const fotoPrincipal = produto.fotos.find((foto) => foto.principal) ?? produto.fotos[0];

  async function confirmarInativacao() {
    if (inativando) return;
    setInativando(true);
    const resultado = await inativarProdutoReal(produto.id_produto);
    setInativando(false);

    if (!resultado.success) {
      showToast({ type: "error", title: "Nao foi possivel inativar", description: resultado.message });
      return;
    }

    setConfirmandoInativar(false);
    setProduto((atual) => ({ ...atual, ativo: false }));
    showToast({
      type: "success",
      title: "Produto inativado",
      description: `#${produto.id_produto} ${produto.nomeReal} saiu do catalogo ativo.`
    });
  }

  function showMockAction(title: string) {
    showToast({
      type: "info",
      title,
      description: "Acao mockada para validacao visual. Nenhum backend real foi acionado."
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/produtos"
          className="inline-flex items-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-3 py-2 text-sm font-semibold text-[#0b2f4a] shadow-sm transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para produtos
        </Link>
      </div>

      <PageHeader
        title={produto.nomeReal}
        subtitle={`Produto #${produto.id_produto} - ${produto.categoria} - ${produto.formato}`}
        context="Detalhe do produto"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={produto.ativo ? "ATIVO" : "INATIVO"} tone={produto.ativo ? "success" : "neutral"} />
            {produto.is_estoque ? <StatusBadge status="PRATELEIRA" tone="info" /> : null}
            {produto.is_variacao ? <StatusBadge status="COM VARIACOES" tone="special" /> : null}
            <ActionsMenu
              items={[
                { label: "Editar produto", onClick: () => router.push(`/produtos/${produto.id_produto}/editar`) },
                { label: "Gerenciar fotos", onClick: () => router.push(`/produtos/${produto.id_produto}/editar#fotos`) },
                { label: "Gerenciar variacoes", onClick: () => router.push(`/produtos/${produto.id_produto}/editar#variacoes`) },
                { label: "Testar no Maestro", onClick: () => showMockAction("Teste no Maestro") },
                // Duplicar CRIA produto: pede `produtos.create`, nao `produtos.edit`.
                ...(podeCriar
                  ? [
                      {
                        label: "Duplicar produto",
                        onClick: () => router.push(`/produtos/novo?duplicarDe=${produto.id_produto}`)
                      }
                    ]
                  : []),
                // Produto ja inativo nao reoferece a acao: o UPDATE repetido
                // devolveria "sucesso" sem mudar nada.
                ...(produto.ativo
                  ? [
                      {
                        label: "Inativar produto",
                        destructive: true,
                        onClick: () => setConfirmandoInativar(true)
                      }
                    ]
                  : [])
              ]}
            />
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Valor unitario" value={formatCurrency(produto.valorUnt)} description="Base para calculo de propostas." tone="success" icon={BadgeCheck} />
        <SummaryCard title="Valor fixo" value={formatCurrency(produto.valorFixo)} description="Setup ou valor minimo do produto." tone="info" icon={Package} />
        <SummaryCard title="Prazo" value={produto.prazo} description="Prazo comercial usado em orcamentos." tone="warning" icon={Clock} />
        <SummaryCard title="Peso" value={formatWeightFromGrams(produto.peso)} description="Base futura para calculo de frete." tone="neutral" icon={Scale} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <DetailCard title="Resumo visual">
          {fotoPrincipal ? (
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
              <img src={fotoPrincipal.imagensURL} alt={produto.nomeReal} className="h-72 w-full object-cover" />
            </div>
          ) : (
            <div className="flex h-72 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 text-sm font-semibold text-slate-500">
              Produto sem foto cadastrada
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge status={produto.categoria} tone="neutral" />
            <StatusBadge status={produto.nivelSeg.toUpperCase()} tone={produto.nivelSeg === "alto" || produto.nivelSeg === "antifraude" ? "success" : "info"} />
            {produto.fotos.length ? <StatusBadge status={`${produto.fotos.length} FOTOS`} tone="special" /> : <StatusBadge status="SEM FOTO" tone="warning" />}
          </div>
        </DetailCard>

        <div className="space-y-6">
          <DetailCard title="Dados comerciais">
            <InfoGrid
              items={[
                ["Codigo operacional", `#${produto.id_produto}`],
                ["Produto", produto.nomeReal],
                ["Categoria", produto.categoria],
                ["Formato", produto.formato],
                ["Custo interno", formatCurrency(produto.valor_custo)],
                ["Produto de prateleira", produto.is_estoque ? "Sim" : "Nao"],
                ["Possui variacoes", produto.is_variacao ? "Sim" : "Nao"],
                ["Status", produto.ativo ? "Ativo" : "Inativo"]
              ]}
            />
          </DetailCard>

          <DetailCard title="Uso no Maestro">
            <div className="rounded-3xl border border-[#d7e5e8] bg-[#f7fbfb] p-4">
              <div className="flex gap-3">
                <span className="rounded-2xl bg-[#dff8f6] p-3 text-[#0b7774]">
                  <Bot className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold text-slate-950">Reconhecimento por apelidos</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {produto.apelidos.length
                      ? `Se o vendedor digitar termos como ${produto.apelidos.slice(0, 3).map((apelido) => `"${apelido}"`).join(", ")}, o Maestro pode sugerir ${produto.nomeReal} e usar prazo, fotos, variacoes e valores cadastrados.`
                      : "Este produto ainda não possui apelidos cadastrados para apoio ao Maestro."}
                  </p>
                </div>
              </div>
            </div>
          </DetailCard>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <DetailCard title="Descricao">
          <p className="text-sm leading-6 text-slate-600">{produto.descricao}</p>
          <div className="mt-4 rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Frase consultiva</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{produto.fraseCons}</p>
          </div>
        </DetailCard>

        <DetailCard title="Personalizacao e seguranca">
          <div className="flex gap-3 rounded-2xl bg-slate-50 p-4">
            <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-[#0f9f9a]" />
            <div>
              <p className="font-semibold text-slate-950">Nivel de seguranca: {produto.nivelSeg}</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">{produto.personalizacao}</p>
            </div>
          </div>
        </DetailCard>
      </section>

      <DetailCard title="Dados fiscais">
        <InfoGrid
          items={[
            ["NCM", formatOptional(produto.ncm)],
            ["Descrição NCM", formatOptional(produto.descri_ncm)],
            ["CEST", formatOptional(produto.cest)],
            ["Origem", formatOptional(produto.origem)],
            ["Código origem", produto.cod_origem === null ? "Não informado" : produto.cod_origem.toString()],
            ["Código de barras", formatOptional(produto.cod_bar)],
            ["Unidade medida", formatOptional(produto.und_medida)],
            ["CFOP interno", formatOptional(produto.cfop_interno)],
            ["CFOP interestadual", formatOptional(produto.cfop_interestadual)],
            ["Unidade comercial", formatOptional(produto.unidade_comercial)],
            ["Unidade tributável", formatOptional(produto.unidade_tributavel)],
            ["ICMS origem", formatOptional(produto.icms_origem)],
            ["ICMS CST", formatOptional(produto.icms_situacao_tributaria)],
            ["PIS CST", formatOptional(produto.pis_situacao_tributaria)],
            ["COFINS CST", formatOptional(produto.cofins_situacao_tributaria)],
            ["Benefício fiscal", formatOptional(produto.cod_beneficio)]
          ]}
        />
        {produto.informacoes_fiscais ? (
          <div className="mt-4 rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Informações fiscais</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">{produto.informacoes_fiscais}</p>
          </div>
        ) : null}
      </DetailCard>

      <DetailCard title="Fotos do produto">
        {produto.fotos.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {produto.fotos.map((foto) => (
              <div key={foto.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                <img src={foto.imagensURL} alt={foto.nomeProduto} className="h-40 w-full object-cover" />
                <div className="p-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{foto.nomeProduto}</p>
                  {foto.principal ? <StatusBadge status="PRINCIPAL" tone="success" /> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Sem fotos cadastradas para este produto.</p>
        )}
      </DetailCard>

      <DetailCard title="Variações do produto">
        {produto.variacoes.length ? (
          <div className="space-y-3">
            {produto.variacoes.map((variacao) => (
              <div key={variacao.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_140px_140px_120px_auto] lg:items-start">
                  <div>
                    <p className="font-semibold text-slate-950">{variacao.variacao.nome}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{variacao.variacao.descricao}</p>
                  </div>
                  <StatusBadge status={variacao.is_obrigatorio ? "OBRIGATORIA" : "OPCIONAL"} tone={variacao.is_obrigatorio ? "warning" : "neutral"} />
                  <StatusBadge status={variacao.is_multiplo ? "MULTIPLA" : "UNICA"} tone="info" />
                  <div className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                    {variacao.tipos.length} opções
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenOptionsVariationId((current) =>
                        current === variacao.id_variacao ? null : variacao.id_variacao
                      )
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Eye className="h-4 w-4" />
                    {openOptionsVariationId === variacao.id_variacao ? "Ocultar opções" : "Ver opções"}
                  </button>
                </div>
                {openOptionsVariationId === variacao.id_variacao ? (
                  <div className="mt-4 rounded-3xl border border-[#d7e5e8] bg-white p-4">
                    <p className="mb-3 text-sm font-semibold text-slate-900">
                      Opções/modelos de {variacao.variacao.nome}
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {variacao.tipos.map((tipo) => (
                        <div key={tipo.id} className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
                          <p className="font-semibold text-slate-950">{tipo.variacao}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Valor extra {formatCurrency(tipo.v_extra)} | peso {formatWeightFromGrams(tipo.peso, { mode: "g" })} | ref {tipo.ref}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Nenhuma variação vinculada a este produto.</p>
        )}
      </DetailCard>

      <DetailCard title="Apelidos usados pelo Maestro">
        <div className="flex flex-wrap gap-2">
          {produto.apelidos.map((apelido) => (
            <span key={apelido} className="rounded-full bg-[#dff8f6] px-3 py-1 text-xs font-semibold text-[#0b7774]">
              {apelido}
            </span>
          ))}
        </div>
      </DetailCard>

      {confirmandoInativar ? (
        <ConfirmarAcaoModal
          titulo="Inativar produto"
          descricao={`#${produto.id_produto} ${produto.nomeReal} deixa de aparecer no seletor de produtos do Orcamento e na busca da NF-e.`}
          detalhe="Pedidos e propostas ja existentes nao mudam. Para reativar, use Editar produto e marque Ativo."
          rotuloConfirmar="Inativar"
          salvando={inativando}
          onConfirmar={() => void confirmarInativacao()}
          onClose={() => {
            if (!inativando) setConfirmandoInativar(false);
          }}
        />
      ) : null}
    </div>
  );
}

function formatOptional(value: string) {
  return value || "Não informado";
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
