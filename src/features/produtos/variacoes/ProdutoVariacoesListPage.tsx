"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, ShieldCheck, HelpCircle } from "lucide-react";
import { ActionsMenu, type ActionMenuItem } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  listVariacoesGlobais,
  inativarVariacaoGlobal,
  checkVariacaoGlobalVinculos,
  type VariacaoGlobalJoin
} from "@/features/produtos/services/produto-variacoes.service";

type StatusFilter = "TODOS" | "ATIVOS" | "INATIVOS";

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function ProdutoVariacoesListPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [variacoes, setVariacoes] = useState<VariacaoGlobalJoin[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filtros
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("TODOS");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedVariacoes = await listVariacoesGlobais();
      setVariacoes(loadedVariacoes);
    } catch (err) {
      console.error("Failed to load global variation list:", err);
      showToast({
        type: "error",
        title: "Erro ao carregar dados",
        description: "Não foi possível carregar as variações globais."
      });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const filteredVariacoes = useMemo(() => {
    return variacoes.filter((variacao) => {
      // 1. Busca por texto (nome ou descrição)
      const searchNormalized = normalize(search.trim());
      let matchesSearch = true;
      if (searchNormalized) {
        const searchPool = [
          variacao.nome,
          variacao.descricao,
          variacao.id_variacao.toString()
        ].map(normalize).join(" ");
        matchesSearch = searchPool.includes(searchNormalized);
      }

      // 2. Filtro de Status
      const matchesStatus =
        statusFilter === "TODOS" ||
        (statusFilter === "ATIVOS" && variacao.is_ativo) ||
        (statusFilter === "INATIVOS" && !variacao.is_ativo);

      return matchesSearch && matchesStatus;
    });
  }, [variacoes, search, statusFilter]);

  const activeFilters = useMemo(() => {
    return [
      search ? `Busca: ${search}` : null,
      statusFilter !== "TODOS" ? `Status: ${statusFilter === "ATIVOS" ? "Ativos" : "Inativos"}` : null
    ].filter(Boolean) as string[];
  }, [search, statusFilter]);

  function clearFilters() {
    setSearch("");
    setStatusFilter("TODOS");
  }

  async function handleInativar(variacao: VariacaoGlobalJoin) {
    if (!variacao.is_ativo) {
      showToast({
        type: "info",
        title: "Variação já está inativa",
        description: "Esta variação global já se encontra inativa."
      });
      return;
    }

    try {
      // 1. Verificar se possui vínculos em produto_variacoes antes de inativar
      const hasVinculos = await checkVariacaoGlobalVinculos(variacao.id_variacao);
      if (hasVinculos) {
        const confirmResult = window.confirm(
          "Esta variação já está vinculada a produtos e pode impactar propostas futuras. Deseja realmente inativá-la?"
        );
        if (!confirmResult) return;
      } else {
        const confirmResult = window.confirm(`Deseja realmente inativar a variação global "${variacao.nome}"?`);
        if (!confirmResult) return;
      }

      const result = await inativarVariacaoGlobal(variacao.id_variacao);
      if (result.success) {
        showToast({
          type: "success",
          title: "Variação inativada",
          description: "O grupo de variação foi inativado com sucesso."
        });
        loadData(); // Atualiza a lista
      } else {
        showToast({
          type: "error",
          title: "Erro ao inativar",
          description: result.message
        });
      }
    } catch (err) {
      console.error("Error during inativar global variation:", err);
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: "Ocorreu um erro ao processar a solicitação."
      });
    }
  }

  function getActions(variacao: VariacaoGlobalJoin) {
    const actions: ActionMenuItem[] = [
      {
        label: "Editar variação / opções",
        onClick: () => router.push(`/produtos/variacoes/${variacao.id_variacao}`)
      }
    ];

    if (variacao.is_ativo) {
      actions.push({
        label: "Inativar variação",
        destructive: true,
        onClick: () => handleInativar(variacao)
      });
    }

    return actions;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Banco Global de Variações"
        subtitle="Gerencie os grupos de variações (como tamanho, cor, espessura) e suas opções disponíveis para os produtos."
        context="Produtos / Banco de Variações"
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push("/produtos")}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Voltar ao catálogo
            </button>
            <button
              type="button"
              onClick={() => router.push("/produtos/variacoes/nova")}
              className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61]"
            >
              + Nova variação
            </button>
          </div>
        }
      />

      {/* Alerta de Deleção Bloqueada */}
      <div className="rounded-3xl border border-teal-200 bg-teal-50 p-5 text-teal-900 shadow-sm">
        <div className="flex gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-teal-600 mt-0.5" />
          <div>
            <h2 className="font-semibold text-teal-950">Gerenciamento Seguro de Variações</h2>
            <p className="mt-1 text-sm text-teal-800">
              A exclusão física de variações globais e opções de tipos é permanentemente bloqueada. Para remover do catálogo ativo, utilize a <strong>inativação lógica</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* Seção de Filtros */}
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[2fr_1.2fr_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por ID, nome ou descrição do grupo de variação"
            />
          </label>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none w-full"
          >
            <option value="TODOS">Todos os status</option>
            <option value="ATIVOS">Apenas ativos</option>
            <option value="INATIVOS">Apenas inativos</option>
          </select>

          <button
            type="button"
            onClick={clearFilters}
            className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 w-full md:w-auto"
          >
            Limpar filtros
          </button>
        </div>

        {activeFilters.length ? (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {activeFilters.map((filter) => (
              <span
                key={filter}
                className="shrink-0 rounded-full bg-[#dff8f6] px-3 py-1 text-xs font-semibold text-[#0b7774]"
              >
                {filter}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {/* Lista Principal */}
      <ResponsiveList<VariacaoGlobalJoin>
        items={filteredVariacoes}
        getKey={(v) => String(v.id_variacao)}
        isLoading={isLoading}
        emptyTitle="Nenhuma variação global encontrada"
        emptyDescription="Não há grupos de variações globais registradas para a busca atual. Crie uma nova variação para começar."
        columns={[
          {
            header: "ID",
            cell: (v) => <span className="text-slate-500 font-mono text-xs">#{v.id_variacao}</span>
          },
          {
            header: "Grupo de Variação",
            cell: (v) => (
              <div className="flex flex-col">
                <span className="font-semibold text-slate-900">{v.nome}</span>
                <span className="text-xs text-slate-500 line-clamp-1">{v.descricao || "Sem descrição"}</span>
              </div>
            )
          },
          {
            header: "Opções Ativas",
            cell: (v) => (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {v.opcoesCount} opções
              </span>
            ),
            align: "center"
          },
          {
            header: "Status",
            cell: (v) => (
              <StatusBadge
                status={v.is_ativo ? "ATIVO" : "INATIVO"}
              />
            ),
            align: "center"
          },
          {
            header: "Ações",
            cell: (v) => <ActionsMenu items={getActions(v)} />,
            align: "right"
          }
        ]}
        renderCard={(v) => (
          <article key={v.id_variacao} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500 font-mono">ID: #{v.id_variacao}</p>
                <h3 className="mt-1 font-bold text-slate-950 text-base">{v.nome}</h3>
              </div>
              <StatusBadge status={v.is_ativo ? "ATIVO" : "INATIVO"} />
            </div>

            <div className="text-sm text-slate-600">
              <p className="text-xs uppercase tracking-wide font-semibold text-slate-400">Descrição</p>
              <p className="text-slate-700 mt-0.5">{v.descricao || "Nenhuma descrição informada."}</p>
            </div>

            <div className="border-t border-slate-100 pt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 font-medium">
                {v.opcoesCount} opções ativas cadastradas
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push(`/produtos/variacoes/${v.id_variacao}`)}
                  className="rounded-2xl bg-[#0b2f4a] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#123f61]"
                >
                  Editar/Opções
                </button>
                {v.is_ativo && (
                  <button
                    type="button"
                    onClick={() => handleInativar(v)}
                    className="rounded-2xl border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-xs font-semibold hover:bg-red-100 transition"
                  >
                    Inativar
                  </button>
                )}
              </div>
            </div>
          </article>
        )}
      />

      {!isLoading ? (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-slate-500" />
          <p>
            Exibindo {filteredVariacoes.length} variações globais carregadas diretamente do banco de dados ERP.
          </p>
        </section>
      ) : null}
    </div>
  );
}
