import React, { useState, useEffect, useMemo } from "react";
import { 
  Users, 
  Database, 
  History, 
  Search, 
  Filter, 
  UserCog, 
  RefreshCw 
} from "lucide-react";
import type { PerfilDoCatalogo, UsuarioComPerfil, FiltrosUsuariosPerfis } from "../types";
import { listUsuariosComPerfil, listPerfisDoCatalogo, updatePerfilUsuario } from "../services/usuarios-perfis.service";
import { resolvePerfilEfetivo } from "../utils/resolution";
import { AlterarPerfilModal } from "./AlterarPerfilModal";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
import { codecs } from "@/lib/url-state";

/** Origem do perfil. Vazio significa "todas", e por isso não vai para a URL. */
const ORIGEM_FILTROS = ["", "banco", "fallback"] as const;

export function UsuariosPerfisList() {
  const { user } = useAuth();
  const [usuarios, setUsuarios] = useState<UsuarioComPerfil[]>([]);
  const [perfis, setPerfis] = useState<PerfilDoCatalogo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canEdit =
    user?.isSuperAdmin ||
    user?.isAdmin ||
    hasPermissao(user, "admin.usuarios.edit");

  // Estados do Modal
  const [selectedUser, setSelectedUser] = useState<UsuarioComPerfil | null>(null);

  // Filtros na URL: sobrevivem ao F5, ao histórico do navegador e a um link
  // copiado. O usuário selecionado continua local — é um detalhe de edição, não
  // uma descrição do que está sendo visto.
  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "" },
      // O catálogo de perfis vem do banco, então não há enum fechado aqui.
      perfil: { codec: codecs.texto(), default: "" },
      origem: { codec: codecs.enumOf(ORIGEM_FILTROS), default: "" as const }
    }),
    []
  );
  const { filters, setFilter } = useUrlFilters(filtrosSchema);

  // A busca responde a cada tecla; a URL só é gravada depois da pausa.
  const [busca, definirBusca] = useDebouncedInput(filters.q, (valor) => setFilter("q", valor));

  const filtros: FiltrosUsuariosPerfis = {
    busca,
    // Slug que não existe no catálogo cai em "todos os perfis" assim que o
    // catálogo chega — em vez de deixar o select em branco e a lista vazia.
    perfilSlug:
      filters.perfil !== "" && perfis.length > 0 && !perfis.some((p) => p.slug === filters.perfil)
        ? ""
        : filters.perfil,
    origem: filters.origem
  };

  // Trigger para recarregar dados do useEffect de forma compatível com o linter
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const { showToast } = useAppToast();


  // useEffect que gerencia o carregamento de dados via IIFE assíncrona
  useEffect(() => {
    let active = true;
    
    void (async () => {
      if (refreshTrigger > 0) setIsRefreshing(true);
      else setIsLoading(true);
      setErrorMsg(null);

      try {
        const [usersData, profilesData] = await Promise.all([
          listUsuariosComPerfil(),
          listPerfisDoCatalogo()
        ]);

        if (!active) return;

        // Enriquecer dados dos usuários em lote no client-side para evitar reprocessamento
        const enrichedUsers = usersData.map(user => {
          const efetivo = resolvePerfilEfetivo(user);
          return {
            ...user,
            perfilEfetivoSlug: efetivo.slug,
            perfilEfetivoNome: efetivo.nome.replace(" (Fallback)", ""),
            origemPerfil: efetivo.origem
          };
        });

        setUsuarios(enrichedUsers);
        setPerfis(profilesData);
      } catch (err: unknown) {
        if (!active) return;
        const error = err as Error;
        setErrorMsg(error.message || "Erro desconhecido ao carregar os dados.");
        showToast({
          title: "Erro de Conexão",
          description: "Não foi possível carregar as informações do Supabase.",
          type: "error"
        });
      } finally {
        if (active) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [refreshTrigger, showToast]);


  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Lógica de Salvamento
  const handleSavePerfil = async (idPerfil: number | null) => {
    if (!selectedUser) return;

    try {
      // Gravação segura no service (whitelist id_perfil)
      await updatePerfilUsuario(selectedUser.user_id, idPerfil);
      
      showToast({
        title: "Perfil Atualizado",
        description: `O perfil do usuário foi alterado com sucesso no banco.`,
        type: "success"
      });

      setSelectedUser(null);
      // Recarregar os dados incrementando a trigger
      setRefreshTrigger(prev => prev + 1);
    } catch (err: unknown) {
      const error = err as Error;
      console.error("[UsuariosPerfisList] Erro no fluxo de salvamento:", error);
      showToast({
        title: "Erro ao Salvar",
        description: error.message || "Ocorreu um erro ao atualizar o perfil.",
        type: "error"
      });
      throw error;
    }
  };


  // Filtragem e Ordenação Client-Side
  const filteredAndSortedUsers = usuarios
    .filter(user => {
      // 1. Busca textual com fallback
      const nomeVal = (user.nome_usuario || "").toLowerCase();
      const emailVal = (user.email || "").toLowerCase();
      const buscaVal = filtros.busca.toLowerCase();
      
      const matchBusca = !filtros.busca || nomeVal.includes(buscaVal) || emailVal.includes(buscaVal);

      // 2. Filtro por Perfil
      const matchPerfil = !filtros.perfilSlug || user.perfilEfetivoSlug === filtros.perfilSlug;

      // 3. Filtro por Origem
      const matchOrigem = !filtros.origem || user.origemPerfil === filtros.origem;

      return matchBusca && matchPerfil && matchOrigem;
    })
    .sort((a, b) => {
      // Ordenação inteligente: nome_usuario com fallback para email (evita nulos)
      const nomeA = (a.nome_usuario || a.email || "").toLowerCase();
      const nomeB = (b.nome_usuario || b.email || "").toLowerCase();
      return nomeA.localeCompare(nomeB);
    });

  // Estatísticas superiores (Summary Cards)
  const totalUsuarios = usuarios.length;
  const totalBanco = usuarios.filter(u => u.origemPerfil === "banco").length;
  const totalFallback = usuarios.filter(u => u.origemPerfil === "fallback").length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Loading Skeletons */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-28 animate-pulse rounded-3xl bg-neutral-100 dark:bg-neutral-900 border" style={{ borderColor: "var(--border)" }} />
          ))}
        </div>
        <div className="h-[400px] animate-pulse rounded-3xl bg-neutral-100 dark:bg-neutral-900 border" style={{ borderColor: "var(--border)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Botão flutuante ou indicador de Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Gestão de Perfis de Usuários</h2>
          <p className="text-xs text-muted-foreground">Vincule perfis oficiais e audite fallbacks de privilégios</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex h-9 w-9 items-center justify-center rounded-xl border transition hover:bg-neutral-100 dark:hover:bg-neutral-800 text-foreground"
          style={{ borderColor: "var(--border)" }}
          title="Recarregar dados"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 p-4 text-sm text-red-600 dark:text-red-400">
          Ocorreu um erro ao carregar os dados reais: {errorMsg}
        </div>
      )}

      {/* 🚀 SummaryCards superiores */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Card 1: Total */}
        <div 
          className="rounded-3xl border p-5 flex items-center justify-between shadow-xs"
          style={{ borderColor: "var(--border)", background: "var(--card, white)" }}
        >
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total de Usuários</p>
            <p className="text-3xl font-bold text-foreground mt-1">{totalUsuarios}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-50 dark:bg-neutral-900 text-foreground">
            <Users className="h-6 w-6" />
          </div>
        </div>

        {/* Card 2: Perfis do Banco */}
        <div 
          className="rounded-3xl border p-5 flex items-center justify-between shadow-xs"
          style={{ borderColor: "var(--border)", background: "var(--card, white)" }}
        >
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Perfis do Banco</p>
            <p className="text-3xl font-bold text-foreground mt-1" style={{ color: "#3b82f6" }}>{totalBanco}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/20 text-blue-500">
            <Database className="h-6 w-6" />
          </div>
        </div>

        {/* Card 3: Fallbacks Legados */}
        <div 
          className="rounded-3xl border p-5 flex items-center justify-between shadow-xs"
          style={{ borderColor: "var(--border)", background: "var(--card, white)" }}
        >
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fallback Legado</p>
            <p className="text-3xl font-bold text-foreground mt-1" style={{ color: "#f59e0b" }}>{totalFallback}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-950/20 text-amber-500">
            <History className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* 🔍 Filtros */}
      <div 
        className="rounded-3xl border p-5 shadow-xs space-y-4"
        style={{ borderColor: "var(--border)", background: "var(--card, white)" }}
      >
        <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: "var(--border)" }}>
          <Filter className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold text-foreground">Filtros de Busca</h3>
        </div>
        
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Busca por text */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nome ou e-mail..."
              value={filtros.busca}
              onChange={(e) => definirBusca(e.target.value)}
              className="w-full rounded-xl border pl-10 pr-4 py-2.5 text-sm bg-transparent text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </div>

          {/* Filtro por Perfil */}
          <select
            value={filtros.perfilSlug}
            onChange={(e) => setFilter("perfil", e.target.value)}
            className="w-full rounded-xl border px-3 py-2.5 text-sm bg-transparent text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ borderColor: "var(--border)" }}
            disabled={perfis.length === 0}
          >
            <option value="">
              {perfis.length === 0 ? "Nenhum perfil carregado (Erro RLS)" : "Todos os Perfis"}
            </option>
            {perfis.map(p => (
              <option key={p.id} value={p.slug}>{p.nome}</option>
            ))}
          </select>

          {/* Filtro por Origem */}
          <select
            value={filtros.origem}
            onChange={(e) => setFilter("origem", e.target.value as (typeof ORIGEM_FILTROS)[number])}
            className="w-full rounded-xl border px-3 py-2.5 text-sm bg-transparent text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">Todas as Origens</option>
            <option value="banco">Apenas Perfil do Banco</option>
            <option value="fallback">Apenas Fallback Legado</option>
          </select>
        </div>

        {perfis.length === 0 && !isLoading && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <span>⚠️</span>
            <span>
              <strong>Atenção:</strong> Nenhum perfil foi carregado do catálogo do banco. Se você está logado, isso pode indicar que a Row Level Security (RLS) da tabela <code>public.perfis</code> está bloqueando a leitura para o seu nível de acesso.
            </span>
          </div>
        )}
      </div>

      {/* 📋 Tabela/Grid de Usuários */}
      <div 
        className="overflow-hidden rounded-3xl border shadow-xs"
        style={{ borderColor: "var(--border)", background: "var(--card, white)" }}
      >
        {filteredAndSortedUsers.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            Nenhum usuário localizado com os filtros selecionados.
          </div>
        ) : (
          <>
            {/* Desktop View */}
            <div className="hidden lg:block overflow-x-auto">
              {/* table-fixed + colgroup: nenhuma coluna monopoliza o espaço; o
                  e-mail cede largura e trunca, mantendo Perfil/Origem/Ações inteiras. */}
              <table className="w-full min-w-[1080px] table-fixed text-left border-collapse">
                <colgroup>
                  <col style={{ width: canEdit ? "20%" : "24%" }} />
                  <col style={{ width: canEdit ? "21%" : "25%" }} />
                  <col style={{ width: canEdit ? "11%" : "13%" }} />
                  <col style={{ width: canEdit ? "18%" : "20%" }} />
                  <col style={{ width: canEdit ? "15%" : "18%" }} />
                  {canEdit && <col style={{ width: "15%" }} />}
                </colgroup>
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)", background: "var(--sidebar-hover-bg)" }}>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Usuário</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">E-mail</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Setor</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Perfil Efetivo</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase whitespace-nowrap">Origem</th>
                    {canEdit && <th className="px-3 py-4 text-xs font-bold text-muted-foreground uppercase text-center">Ações</th>}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {filteredAndSortedUsers.map((user) => (
                    <tr 
                      key={user.user_id} 
                      className="hover:bg-neutral-50/20 dark:hover:bg-neutral-900/10 transition-colors"
                    >
                      <td className="p-4 text-sm font-semibold text-foreground truncate" title={user.nome_usuario || undefined}>
                        {user.nome_usuario || <span className="italic text-muted-foreground">Sem Nome</span>}
                      </td>
                      <td className="p-4 text-sm text-muted-foreground font-mono truncate" title={user.email}>
                        {user.email}
                      </td>
                      <td className="p-4 text-sm text-foreground">
                        <span className="inline-block max-w-full truncate align-middle rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-1 text-xs" title={user.setor || "N/A"}>
                          {user.setor || "N/A"}
                        </span>
                      </td>
                      <td className="p-4 text-sm">
                        <span className="inline-flex max-w-full truncate rounded-full px-2.5 py-0.5 text-xs font-bold"
                          style={{
                            background: user.origemPerfil === "banco" ? "rgba(59, 130, 246, 0.1)" : "rgba(107, 114, 128, 0.1)",
                            color: user.origemPerfil === "banco" ? "#3b82f6" : "var(--muted-foreground)"
                          }}
                          title={user.perfilEfetivoNome}
                        >
                          {user.perfilEfetivoNome}
                        </span>
                      </td>
                      <td className="p-4 text-sm">
                        {/* Destaque Visual Forte conforme solicitado */}
                        {user.origemPerfil === "banco" ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            <Database className="h-3 w-3 shrink-0" /> Perfil do Banco
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                            <History className="h-3 w-3 shrink-0" /> Fallback Legado
                          </span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-4 text-center">
                          <button
                            onClick={() => setSelectedUser(user)}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 text-foreground transition"
                            style={{ borderColor: "var(--border)" }}
                          >
                            <UserCog className="h-3.5 w-3.5" />
                            Alterar Perfil
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile View */}
            <div className="lg:hidden divide-y" style={{ borderColor: "var(--border)" }}>
              {filteredAndSortedUsers.map((user) => (
                <div key={user.user_id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        {user.nome_usuario || <span className="italic text-muted-foreground">Sem Nome</span>}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">{user.email}</p>
                    </div>
                    
                    {/* Destaque Visual Origem no Mobile */}
                    {user.origemPerfil === "banco" ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <Database className="h-2.5 w-2.5" /> Banco
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        <History className="h-2.5 w-2.5" /> Fallback
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Setor:</span>
                      <span className="ml-1 rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[10px] text-foreground font-medium">
                        {user.setor || "N/A"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Perfil:</span>
                      <span className="ml-1 text-foreground font-semibold">
                        {user.perfilEfetivoNome}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                    <span className="text-[10px] text-muted-foreground">Empresa #{user.id_empresa || 1}</span>
                    {canEdit && (
                      <button
                        onClick={() => setSelectedUser(user)}
                        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 text-foreground transition"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <UserCog className="h-3.5 w-3.5" />
                        Alterar Perfil
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Modal de Alteração de Perfil */}
      {selectedUser && (
        <AlterarPerfilModal
          usuario={selectedUser}
          perfis={perfis}
          onClose={() => setSelectedUser(null)}
          onSave={handleSavePerfil}
        />
      )}
    </div>
  );
}
