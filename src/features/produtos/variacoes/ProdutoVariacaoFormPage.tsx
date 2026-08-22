"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle, Plus, Edit2, Check, X } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { useAppToast } from "@/components/common/AppToast";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  createVariacaoGlobal,
  updateVariacaoGlobal,
  getVariacaoGlobalById,
  createTipoVariacao,
  updateTipoVariacao,
  inativarTipoVariacao
} from "@/features/produtos/services/produto-variacoes.service";
import type { TipoVariacao } from "@/features/produtos/types";

type ProdutoVariacaoFormPageProps = {
  mode: "new" | "edit";
  id?: number; // id_variacao do grupo global
};

const inputClass = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#0f9f9a] focus:bg-white transition";
const labelClass = "text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 block";

// Detectar se o código REF é uma cor hexadecimal
const isHexColor = (ref: string) => /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(ref.trim());

export function ProdutoVariacaoFormPage({ mode, id }: ProdutoVariacaoFormPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();

  // Estados do Grupo Global
  const [nome, setNome] = useState<string>("");
  const [descricao, setDescricao] = useState<string>("");
  const [isAtivo, setIsAtivo] = useState<boolean>(true);

  // Estados das Opções (tipos_variacoes)
  const [opcoes, setOpcoes] = useState<TipoVariacao[]>([]);
  const [editingOpcaoId, setEditingOpcaoId] = useState<string | null>(null);

  // Estados do formulário de adição/edição de opção
  const [opcaoNome, setOpcaoNome] = useState("");
  const [opcaoRef, setOpcaoRef] = useState("");
  const [opcaoPeso, setOpcaoPeso] = useState("");
  const [opcaoVExtra, setOpcaoVExtra] = useState("");
  const [opcaoAtiva, setOpcaoAtiva] = useState(true);

  // Status de carregamento/salvamento
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingOpcao, setIsSavingOpcao] = useState(false);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const [formMessage, setFormMessage] = useState<{ tone: "success" | "danger"; title: string; description: string } | null>(null);

  // Exibir formulário de nova opção
  const [showNewOpcaoForm, setShowNewOpcaoForm] = useState(false);

  const title = mode === "new" ? "Novo Grupo de Variação" : `Editar Grupo de Variação #${id}`;
  const subtitle =
    mode === "new"
      ? "Crie uma nova variação global de produto para disponibilizar no catálogo."
      : "Altere as configurações do grupo global e gerencie as opções disponíveis.";

  const loadData = useCallback(async () => {
    if (mode === "edit" && id) {
      setIsLoading(true);
      try {
        const data = await getVariacaoGlobalById(id);
        if (data) {
          setNome(data.nome);
          setDescricao(data.descricao);
          setIsAtivo(data.is_ativo);
          setOpcoes(data.tipos);
        } else {
          showToast({
            type: "error",
            title: "Grupo de variação não encontrado",
            description: "A variação global solicitada não foi localizada."
          });
          router.push("/produtos/variacoes");
        }
      } catch (err) {
        console.error("Error loading global variation:", err);
        showToast({
          type: "error",
          title: "Erro de conexão",
          description: "Não foi possível carregar as informações da variação global."
        });
      } finally {
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  }, [mode, id, router, showToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  // Salvar Grupo Global (variacoes)
  async function handleSaveGrupo() {
    const errors: string[] = [];
    if (!nome.trim()) errors.push("nome");

    if (errors.length > 0) {
      setErrorFields(errors);
      setFormMessage({
        tone: "danger",
        title: "Campos obrigatórios ausentes",
        description: "Certifique-se de preencher o nome do grupo de variação."
      });
      showToast({
        type: "error",
        title: "Erro de Validação",
        description: "Por favor, preencha todos os campos obrigatórios."
      });
      return;
    }

    setErrorFields([]);
    setFormMessage(null);
    setIsSaving(true);

    try {
      if (mode === "new") {
        const result = await createVariacaoGlobal({
          nome,
          descricao,
          is_ativo: isAtivo
        });

        if (result.success && result.data) {
          showToast({
            type: "success",
            title: "Grupo de variação criado",
            description: "Grupo criado com sucesso. Redirecionando para gerenciar as opções..."
          });
          setTimeout(() => {
            router.push(`/produtos/variacoes/${result.data?.id_variacao}`);
          }, 900);
        } else {
          showToast({
            type: "error",
            title: "Erro ao criar",
            description: result.message
          });
          setFormMessage({
            tone: "danger",
            title: "Falha ao registrar",
            description: result.message
          });
        }
      } else if (mode === "edit" && id) {
        const result = await updateVariacaoGlobal(id, {
          nome,
          descricao,
          is_ativo: isAtivo
        });

        if (result.success) {
          showToast({
            type: "success",
            title: "Grupo de variação atualizado",
            description: "Grupo de variação atualizado com sucesso."
          });
          setFormMessage({
            tone: "success",
            title: "Salvo com sucesso!",
            description: "As alterações do grupo global foram salvas."
          });
          loadData(); // Atualiza
        } else {
          showToast({
            type: "error",
            title: "Erro ao atualizar",
            description: result.message
          });
          setFormMessage({
            tone: "danger",
            title: "Falha ao atualizar",
            description: result.message
          });
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
      console.error("Error during saving operation:", err);
      showToast({
        type: "error",
        title: "Erro Inesperado",
        description: errorMsg || "Não foi possível concluir. Tente novamente."
      });
    } finally {
      setIsSaving(false);
    }
  }

  // --- CRUD Opções (tipos_variacoes) ---

  function clearOpcaoForm() {
    setOpcaoNome("");
    setOpcaoRef("");
    setOpcaoPeso("");
    setOpcaoVExtra("");
    setOpcaoAtiva(true);
    setEditingOpcaoId(null);
  }

  // Iniciar formulário de adição
  function handleAddNewOpcaoClick() {
    clearOpcaoForm();
    setShowNewOpcaoForm(true);
  }

  // Iniciar formulário de edição inline
  function handleEditOpcaoClick(opcao: TipoVariacao) {
    setShowNewOpcaoForm(false);
    setEditingOpcaoId(opcao.id);
    setOpcaoNome(opcao.variacao);
    setOpcaoRef(opcao.ref);
    setOpcaoPeso(opcao.peso.toString());
    setOpcaoVExtra(opcao.v_extra.toString());
    setOpcaoAtiva(opcao.is_ativo);
  }

  // Salvar Opção (criação ou edição)
  async function handleSaveOpcao() {
    if (!opcaoNome.trim()) {
      showToast({
        type: "warning",
        title: "Nome da opção obrigatório",
        description: "Preencha o valor da opção de variação (Ex: Azul royal)."
      });
      return;
    }

    if (!id) return;

    setIsSavingOpcao(true);
    try {
      if (editingOpcaoId) {
        // Modo Edição
        const result = await updateTipoVariacao(editingOpcaoId, {
          variacao: opcaoNome,
          ref: opcaoRef,
          peso: opcaoPeso,
          v_extra: opcaoVExtra,
          is_ativo: opcaoAtiva
        });

        if (result.success) {
          showToast({
            type: "success",
            title: "Opção atualizada",
            description: "A opção de variação foi salva com sucesso."
          });
          clearOpcaoForm();
          loadData(); // Recarrega
        } else {
          showToast({
            type: "error",
            title: "Erro ao atualizar opção",
            description: result.message
          });
        }
      } else {
        // Modo Criação
        const result = await createTipoVariacao({
          id_variacao: id,
          variacao: opcaoNome,
          ref: opcaoRef,
          peso: opcaoPeso,
          v_extra: opcaoVExtra,
          is_ativo: opcaoAtiva
        });

        if (result.success) {
          showToast({
            type: "success",
            title: "Opção adicionada",
            description: "A opção foi adicionada com sucesso ao grupo."
          });
          setShowNewOpcaoForm(false);
          clearOpcaoForm();
          loadData(); // Recarrega
        } else {
          showToast({
            type: "error",
            title: "Erro ao criar opção",
            description: result.message
          });
        }
      }
    } catch (err) {
      console.error("Error saving option:", err);
      showToast({
        type: "error",
        title: "Erro de conexão",
        description: "Não foi possível salvar a opção. Tente novamente."
      });
    } finally {
      setIsSavingOpcao(false);
    }
  }

  // Inativar Opção Lógica (DELETE físico bloqueado)
  async function handleInativarOpcao(opcao: TipoVariacao) {
    const confirmResult = window.confirm(`Deseja realmente inativar a opção "${opcao.variacao}"?`);
    if (!confirmResult) return;

    try {
      const result = await inativarTipoVariacao(opcao.id);
      if (result.success) {
        showToast({
          type: "success",
          title: "Opção inativada",
          description: "A opção foi marcada como inativa."
        });
        loadData();
      } else {
        showToast({
          type: "error",
          title: "Erro ao inativar",
          description: result.message
        });
      }
    } catch (err) {
      console.error("Error inactivating option:", err);
      showToast({
        type: "error",
        title: "Erro ao processar",
        description: "Não foi possível inativar a opção. Tente novamente."
      });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-28 animate-pulse rounded-3xl border border-slate-200 bg-white" />
        <div className="h-80 animate-pulse rounded-3xl border border-slate-200 bg-white" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        context="Produtos / Banco de Variações / Cadastro"
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/produtos/variacoes"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 shadow-sm"
            >
              Cancelar
            </Link>
            <button
              type="button"
              onClick={handleSaveGrupo}
              disabled={isSaving}
              className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-60"
            >
              {isSaving ? "Salvando..." : "Salvar Grupo"}
            </button>
          </div>
        }
      />

      {formMessage ? (
        <div
          className={`rounded-3xl border p-5 flex items-start gap-3 shadow-sm ${
            formMessage.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-950"
          }`}
        >
          {formMessage.tone === "success" ? (
            <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
          )}
          <div>
            <h3 className="font-semibold text-base">{formMessage.title}</h3>
            <p className="mt-1 text-sm leading-6">{formMessage.description}</p>
          </div>
        </div>
      ) : null}

      {/* 1. SEÇÃO: Dados Gerais do Grupo Global */}
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-6 shadow-sm space-y-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">Dados Gerais do Grupo</h2>
          <p className="text-sm text-slate-500">Configure a identificação deste grupo de variação global (ex: Tamanho, Acabamento).</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Nome do Grupo */}
          <div>
            <label className={labelClass} htmlFor="nome">
              Nome do Grupo <span className="text-red-500">*</span>
            </label>
            <input
              id="nome"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setErrorFields(prev => prev.filter(f => f !== "nome"));
              }}
              placeholder="Ex: Cor de fundo, Tamanho, Acabamento"
              className={`${inputClass} ${
                errorFields.includes("nome") ? "border-red-300 bg-red-50" : ""
              }`}
            />
          </div>

          {/* Descrição do Grupo */}
          <div>
            <label className={labelClass} htmlFor="descricao">
              Descrição da Variação
            </label>
            <input
              id="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descreva a utilidade desta variação no catálogo"
              className={inputClass}
            />
          </div>
        </div>

        {/* Toggle Ativo */}
        <div className="border-t border-slate-100 pt-6">
          <label className="flex items-start gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 cursor-pointer hover:bg-slate-100 transition max-w-md">
            <input
              type="checkbox"
              checked={isAtivo}
              onChange={(e) => setIsAtivo(e.target.checked)}
              className="mt-1 h-5 w-5 rounded-md border-slate-300 text-[#0f9f9a] focus:ring-[#0f9f9a]"
            />
            <div>
              <p className="font-semibold text-slate-900 text-sm">Grupo Ativo para Vínculos</p>
              <p className="text-xs text-slate-500 mt-0.5">Se desativado, o grupo continuará existindo mas não poderá ser associado a novos produtos.</p>
            </div>
          </label>
        </div>
      </section>

      {/* 2. SEÇÃO: Opções da Variação (Apenas na edição) */}
      {mode === "edit" && id && (
        <section className="rounded-3xl border border-[#d7e5e8] bg-white p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Opções da Variação</h2>
              <p className="text-sm text-slate-500">Adicione as opções válidas que compõem este grupo (ex: Amarelo, 105 cm).</p>
            </div>
            {!showNewOpcaoForm && !editingOpcaoId && (
              <button
                type="button"
                onClick={handleAddNewOpcaoClick}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#123f61] transition shadow-sm w-fit"
              >
                <Plus className="h-4 w-4" />
                Adicionar Opção
              </button>
            )}
          </div>

          {/* Form inline para Adicionar / Editar Opção */}
          {(showNewOpcaoForm || editingOpcaoId) && (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 space-y-4 animate-fadeIn">
              <h3 className="font-semibold text-slate-950 text-sm">
                {editingOpcaoId ? "Editar Opção" : "Nova Opção"}
              </h3>
              
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                {/* Nome da Opção */}
                <div>
                  <label className={labelClass}>Valor da Opção *</label>
                  <input
                    value={opcaoNome}
                    onChange={(e) => setOpcaoNome(e.target.value)}
                    placeholder="Ex: Azul Royal, 105 cm"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f9f9a]"
                  />
                </div>

                {/* Referência */}
                <div>
                  <label className={labelClass}>
                    Referência (Código / Cor HEX)
                  </label>
                  <div className="flex gap-2 items-center">
                    <input
                      value={opcaoRef}
                      onChange={(e) => setOpcaoRef(e.target.value)}
                      placeholder="Ex: REF-AZ, #FF0000"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f9f9a]"
                    />
                    {isHexColor(opcaoRef) && (
                      <div
                        className="h-9 w-9 rounded-xl border border-slate-300 shadow-inner shrink-0 transition hover:scale-105"
                        style={{ backgroundColor: opcaoRef }}
                        title="Cor HEX detectada"
                      />
                    )}
                  </div>
                </div>

                {/* Peso */}
                <div>
                  <label className={labelClass}>
                    Peso Adicional (em gramas)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={opcaoPeso}
                      onChange={(e) => setOpcaoPeso(e.target.value)}
                      placeholder="Ex: 5, 12.5"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f9f9a]"
                    />
                    <span className="text-xs font-semibold text-slate-400">g</span>
                  </div>
                  {opcaoPeso && !Number.isNaN(Number(opcaoPeso)) && (
                    <p className="text-[10px] text-slate-500 mt-1 font-medium">
                      Preview: +{Number(opcaoPeso)}g
                    </p>
                  )}
                </div>

                {/* Valor Extra */}
                <div>
                  <label className={labelClass}>
                    Valor Adicional (R$)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={opcaoVExtra}
                      onChange={(e) => setOpcaoVExtra(e.target.value)}
                      placeholder="Ex: 1.50, 0"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f9f9a]"
                    />
                  </div>
                  {opcaoVExtra && !Number.isNaN(Number(opcaoVExtra)) && (
                    <p className="text-[10px] text-slate-500 mt-1 font-medium">
                      Preview: +{formatCurrency(Number(opcaoVExtra))}
                    </p>
                  )}
                </div>
              </div>

              {/* Status da Opção */}
              <div className="flex items-center gap-4 border-t border-slate-200/60 pt-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={opcaoAtiva}
                    onChange={(e) => setOpcaoAtiva(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0f9f9a] focus:ring-[#0f9f9a]"
                  />
                  <span className="text-xs font-semibold text-slate-600">Opção Ativa para o Catálogo</span>
                </label>

                {/* Botões de Ação do Form de Opção */}
                <div className="flex gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={clearOpcaoForm}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={isSavingOpcao}
                    onClick={handleSaveOpcao}
                    className="rounded-xl bg-[#0b2f4a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#123f61] transition disabled:opacity-60 flex items-center gap-1"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {isSavingOpcao ? "Salvando..." : "Confirmar Opção"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Listagem de Opções */}
          <div className="overflow-x-auto rounded-3xl border border-slate-200">
            <table className="w-full min-w-[600px] border-collapse text-left text-sm text-slate-500">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5">Opção</th>
                  <th className="px-5 py-3.5">Referência</th>
                  <th className="px-5 py-3.5 text-center">Peso</th>
                  <th className="px-5 py-3.5 text-center">Valor Extra</th>
                  <th className="px-5 py-3.5 text-center">Status</th>
                  <th className="px-5 py-3.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {opcoes.map((op) => (
                  <tr key={op.id} className="hover:bg-slate-50/80 transition-colors">
                    {/* Opção / Valor */}
                    <td className="px-5 py-4 font-semibold text-slate-900">
                      {op.variacao}
                    </td>

                    {/* Referência */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        {isHexColor(op.ref) && (
                          <div
                            className="h-5 w-5 rounded-md border border-slate-300 shadow-sm shrink-0"
                            style={{ backgroundColor: op.ref }}
                          />
                        )}
                        <span className="font-mono text-xs text-slate-600">{op.ref || "-"}</span>
                      </div>
                    </td>

                    {/* Peso */}
                    <td className="px-5 py-4 text-center font-medium text-slate-800">
                      {op.peso > 0 ? `+${op.peso}g` : "0g"}
                    </td>

                    {/* Valor Extra */}
                    <td className="px-5 py-4 text-center font-medium text-slate-800">
                      {op.v_extra > 0 ? `+${formatCurrency(op.v_extra)}` : "-"}
                    </td>

                    {/* Status */}
                    <td className="px-5 py-4 text-center">
                      <StatusBadge status={op.is_ativo ? "ATIVO" : "INATIVO"} />
                    </td>

                    {/* Ações */}
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleEditOpcaoClick(op)}
                          title="Editar"
                          className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        {op.is_ativo && (
                          <button
                            type="button"
                            onClick={() => handleInativarOpcao(op)}
                            title="Inativar"
                            className="p-2 text-red-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {opcoes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400 font-medium">
                      Nenhuma opção ativa cadastrada para este grupo global. Use &quot;Adicionar Opção&quot; para registrar valores.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Comentário Técnico para o desenvolvedor / Maestro */}
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-xs text-slate-500">
            <p className="font-semibold text-slate-600 mb-1">Nota Técnica de Desenvolvimento / Integração:</p>
            <p className="leading-5">
              Estrutura de dados em <code>public.tipos_variacoes</code> está preparada para integração com o <strong>Maestro / Planejamento de Produção</strong>. 
              Futuramente, os valores de <code>ref</code> (códigos operacionais e códigos HEX de cor) e <code>peso</code> (gramas) serão consumidos pela fila de produção de propostas do Maestro. 
              Adicionalmente, o código está preparado para suportar uma coluna de <code>ordem</code> de classificação manual das opções na exibição do catálogo, sem necessidade de alterações DDL de schema imediatas.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
