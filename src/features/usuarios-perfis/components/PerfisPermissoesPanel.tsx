import React, { useEffect, useState, useMemo } from "react";
import { Shield, ShieldAlert, ChevronDown, ChevronUp, Save, Info, Lock } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { listPerfisDoCatalogo, updatePermissoesPerfil } from "../services/usuarios-perfis.service";
import type { PerfilDoCatalogo } from "../types";
import { ConfirmacaoDiffModal } from "./ConfirmacaoDiffModal";
import { useSessionState } from "@/hooks/useSessionState";
import { CATALOGO_PERMISSOES } from "../catalogo-permissoes";

/**
 * Quais grupos do catálogo estão recolhidos. É preferência visual de quem está
 * editando — não descreve perfil nem permissão, então não entra na URL.
 */
const CHAVE_GRUPOS_RECOLHIDOS = "ui:/configuracoes/perfis:grupos-recolhidos";

/** Identidade estável: o hook usa este valor enquanto a sessão estiver vazia. */
const GRUPOS_RECOLHIDOS_INICIAIS: Record<string, boolean> = {};


const CHAVES_DO_CATALOGO: ReadonlySet<string> = new Set(
  Object.values(CATALOGO_PERMISSOES).flatMap((grupo) => grupo.map((p) => p.key))
);

/**
 * Permissoes gravadas no perfil que esta tela nao conhece (fora do catalogo).
 *
 * Existem porque permissao nova costuma nascer por migration antes de entrar
 * aqui — foi assim com `propostas.editar_faturado` (13/08/2026). Ate 01/10/2026
 * o salvar filtrava pelo catalogo e APAGAVA essas chaves sem avisar: a janela
 * de confirmacao comparava duas listas que ainda as continham, entao a perda
 * nem aparecia no diff. Agora elas sao preservadas e mostradas, somente leitura.
 */
export function permissoesForaDoCatalogo(permissoes: readonly string[] | null | undefined): string[] {
  const vistas = new Set<string>();
  for (const bruta of permissoes ?? []) {
    const chave = String(bruta).trim();
    if (chave !== "" && chave !== "*" && !CHAVES_DO_CATALOGO.has(chave)) vistas.add(chave);
  }
  return Array.from(vistas);
}

/**
 * O que vai para o banco ao salvar um perfil comum: o que esta marcado no
 * catalogo MAIS o que o perfil ja tinha fora do catalogo. Nunca `*`.
 */
export function montarPermissoesParaSalvar(
  editadas: readonly string[],
  originaisDoPerfil: readonly string[] | null | undefined
): string[] {
  const preservadas = permissoesForaDoCatalogo(originaisDoPerfil);
  const doCatalogo = editadas.map((p) => p.trim()).filter((p) => p !== "" && p !== "*" && CHAVES_DO_CATALOGO.has(p));
  return Array.from(new Set([...doCatalogo, ...preservadas]));
}

export function PerfisPermissoesPanel() {
  const { user } = useAuth();
  const { showToast } = useAppToast();

  const [perfis, setPerfis] = useState<PerfilDoCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [perfilSelecionado, setPerfilSelecionado] = useState<PerfilDoCatalogo | null>(null);
  const [editedPermissoes, setEditedPermissoes] = useState<string[]>([]);
  // Grupos recolhidos ficam na sessão: sobrevivem ao F5 e à ida e volta entre
  // rotas, mas não viajam em um link copiado nem afetam perfil ou permissões.
  const [collapsedGroups, setCollapsedGroups] = useSessionState(
    CHAVE_GRUPOS_RECOLHIDOS,
    GRUPOS_RECOLHIDOS_INICIAIS
  );
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Carregar perfis do Supabase
  const fetchPerfis = async () => {
    try {
      const data = await listPerfisDoCatalogo();
      setPerfis(data);
      if (data.length > 0) {
        // Preservar seleção atual se existir, senão selecionar o primeiro
        const currentSelectedId = perfilSelecionado?.id;
        const matching = currentSelectedId ? data.find((p) => p.id === currentSelectedId) : null;
        const nextSelected = matching || data[0];
        setPerfilSelecionado(nextSelected);
        setEditedPermissoes(nextSelected.permissoes);
      }
    } catch (err) {
      console.error("[PerfisPermissoesPanel] Erro ao carregar perfis:", err);
      showToast({
        type: "error",
        title: "Falha ao carregar perfis",
        description: "Não foi possível carregar os perfis. Tente novamente."
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPerfis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectPerfil = (perfil: PerfilDoCatalogo) => {
    setPerfilSelecionado(perfil);
    setEditedPermissoes(perfil.permissoes);
  };

  const toggleAccordion = (group: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [group]: !prev[group]
    }));
  };

  const handleCheckboxChange = (permKey: string, checked: boolean) => {
    if (!perfilSelecionado || perfilSelecionado.slug === "super_admin") return;

    // 🔒 Proteção: Bloquear auto-desmarcação de admin.usuarios.edit do próprio perfil conectado
    const isSelfProfile = user && user.id_perfil === perfilSelecionado.id;
    if (isSelfProfile && permKey === "admin.usuarios.edit" && !checked) {
      showToast({
        type: "warning",
        title: "Ação bloqueada",
        description: "Você não pode remover a permissão admin.usuarios.edit do seu próprio perfil para evitar auto-bloqueio."
      });
      return;
    }

    if (checked) {
      setEditedPermissoes((prev) => Array.from(new Set([...prev, permKey])));
    } else {
      setEditedPermissoes((prev) => prev.filter((p) => p !== permKey));
    }
  };

  const handleGroupSelection = (groupName: string, selectAll: boolean) => {
    if (!perfilSelecionado || perfilSelecionado.slug === "super_admin") return;

    const groupPerms = CATALOGO_PERMISSOES[groupName].map((p) => p.key);
    const isSelfProfile = user && user.id_perfil === perfilSelecionado.id;

    setEditedPermissoes((prev) => {
      let updated = [...prev];
      if (selectAll) {
        const toAdd = groupPerms.filter((k) => !updated.includes(k));
        updated.push(...toAdd);
      } else {
        updated = updated.filter((k) => {
          if (groupPerms.includes(k)) {
            // Se for auto-bloqueio, impede
            if (isSelfProfile && k === "admin.usuarios.edit") {
              showToast({
                type: "warning",
                title: "Ação bloqueada",
                description: "Você não pode remover a permissão admin.usuarios.edit do seu próprio perfil para evitar auto-bloqueio."
              });
              return true; // mantém
            }
            return false; // remove
          }
          return true; // mantém as outras
        });
      }
      return Array.from(new Set(updated));
    });
  };

  const isSelected = (permKey: string) => {
    if (perfilSelecionado?.slug === "super_admin") {
      return true; // Super admin tem todas as permissões e wildcard implícito
    }
    return editedPermissoes.includes(permKey);
  };

  const handleOpenConfirmacao = () => {
    if (!perfilSelecionado) return;
    setIsDiffModalOpen(true);
  };

  const handleSave = async () => {
    if (!perfilSelecionado) return;
    setIsSaving(true);
    try {
      // Higienizar e filtrar permissões
      const isSuperAdmin = perfilSelecionado.slug === "super_admin";
      let finalPerms: string[] = [];

      if (isSuperAdmin) {
        finalPerms = ["*"];
      } else {
        // Marcadas no catalogo + as que o perfil ja tinha fora dele (preservadas).
        finalPerms = montarPermissoesParaSalvar(editedPermissoes, perfilSelecionado.permissoes);
      }

      await updatePermissoesPerfil(perfilSelecionado.id, finalPerms);

      showToast({
        type: "success",
        title: "Permissões salvas",
        description: "As alterações de permissões foram gravadas com sucesso."
      });

      setIsDiffModalOpen(false);
      await fetchPerfis();
    } catch (err: unknown) {
      console.error("[Erro RLS/Database] Falha ao executar updatePermissoesPerfil:", err);
      const errorMessage = err instanceof Error ? err.message : "Não foi possível salvar as permissões. Tente novamente.";
      
      showToast({
        type: "error",
        title: "Não foi possível salvar",
        description: errorMessage.includes("Nenhuma linha foi alterada") 
          ? "Não foi possível salvar: permissão de atualização bloqueada ou perfil não encontrado."
          : errorMessage
      });
    } finally {
      setIsSaving(false);
    }
  };

  const foraDoCatalogo = useMemo(
    () => (perfilSelecionado?.slug === "super_admin" ? [] : permissoesForaDoCatalogo(perfilSelecionado?.permissoes)),
    [perfilSelecionado]
  );

  const totalPermissoesExibidas = useMemo(() => {
    if (perfilSelecionado?.slug === "super_admin") return "Acesso Total (*)";
    return `${editedPermissoes.length} ativas`;
  }, [perfilSelecionado, editedPermissoes]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent mx-auto" />
          <p className="text-sm text-slate-500 font-semibold">Carregando catálogo de perfis...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr] items-start text-foreground">
      {/* Coluna Esquerda: Listagem de Perfis */}
      <div className="space-y-4">
        <div className="rounded-3xl border p-4 bg-white space-y-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-bold text-neutral-500 uppercase tracking-wider px-2">
            Perfis de Acesso
          </h2>
          <div className="flex flex-col gap-1.5">
            {perfis.map((p) => {
              const active = perfilSelecionado?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPerfil(p)}
                  className={`w-full text-left p-3.5 rounded-2xl transition flex flex-col gap-1.5 ${
                    active
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400 font-semibold"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-bold truncate">{p.nome}</span>
                    <span className={`text-[9px] font-bold rounded px-1 py-0.5 border ${
                      active 
                        ? "bg-blue-100 border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300"
                        : "bg-slate-50 border-slate-200 text-slate-600 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-400"
                    }`}>
                      {p.slug}
                    </span>
                  </div>
                  <span className="text-xs opacity-85">
                    {p.slug === "super_admin" ? "Acesso total" : `${p.permissoes.length} permissões`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Coluna Direita: Editor de Permissões */}
      {perfilSelecionado && (
        <div className="rounded-3xl border bg-white flex flex-col shadow-sm" style={{ borderColor: "var(--border)" }}>
          {/* Cabeçalho do Editor */}
          <div className="border-b p-6 space-y-4" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">{perfilSelecionado.nome}</h2>
                  <span className="rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    slug: {perfilSelecionado.slug}
                  </span>
                </div>
                {perfilSelecionado.descricao && (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {perfilSelecionado.descricao}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-sm font-semibold bg-neutral-50 border rounded-2xl px-3.5 py-1.5">
                <Shield className="h-4 w-4 text-blue-600" />
                <span>{totalPermissoesExibidas}</span>
              </div>
            </div>

            {perfilSelecionado.slug === "super_admin" && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 flex gap-3 text-sm text-blue-800 leading-relaxed font-semibold">
                <Info className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
                <p>
                  O perfil <strong>Super Administrador</strong> possui acesso total e irrestrito ao sistema (`*`). 
                  Sua edição é travada pelo sistema por motivos de segurança e para evitar a perda do acesso root.
                </p>
              </div>
            )}
          </div>

          {/* Acordeões de Permissões */}
          <div className="p-6 space-y-4">
            {Object.entries(CATALOGO_PERMISSOES).map(([groupName, permissions]) => {
              const isCollapsed = collapsedGroups[groupName];
              return (
                <div key={groupName} className="rounded-2xl border bg-neutral-50/20" style={{ borderColor: "var(--border)" }}>
                  <div className="w-full flex items-center justify-between p-4 border-b border-transparent hover:border-slate-100 transition-colors">
                    <button
                      type="button"
                      onClick={() => toggleAccordion(groupName)}
                      className="flex-1 flex items-center justify-start gap-2 font-bold text-sm select-none"
                    >
                      <span>{groupName}</span>
                      {isCollapsed ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronUp className="h-4 w-4 text-slate-400" />}
                    </button>
                    {!isCollapsed && perfilSelecionado?.slug !== "super_admin" && (
                      <div className="flex items-center gap-3">
                        <button 
                          type="button" 
                          onClick={() => handleGroupSelection(groupName, true)}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition"
                        >
                          Marcar todas
                        </button>
                        <button 
                          type="button" 
                          onClick={() => handleGroupSelection(groupName, false)}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-700 transition"
                        >
                          Desmarcar
                        </button>
                      </div>
                    )}
                  </div>

                  {!isCollapsed && (
                    <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
                      {groupName === "Banco de Variações" && (
                        <p className="text-xs text-slate-500 mb-4 px-2">
                          Permissões para gerenciar o banco global de opções reutilizáveis dos produtos, como tamanhos, cores, acabamentos, chips, fundos e extras.
                        </p>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                      {permissions.map((perm) => {
                        const checked = isSelected(perm.key);
                        const isSuperAdmin = perfilSelecionado.slug === "super_admin";
                        const isSelfProfile = Boolean(user && user.id_perfil === perfilSelecionado.id);
                        const isSelfAdminEditLock = Boolean(isSelfProfile && perm.key === "admin.usuarios.edit");
                        const disabled = isSuperAdmin || isSelfAdminEditLock;

                        return (
                          <label
                            key={perm.key}
                            className={`relative border rounded-2xl p-4 flex items-start gap-3 select-none cursor-pointer transition-all ${
                              checked
                                ? "bg-white border-blue-200 dark:border-blue-900/50 shadow-sm"
                                : "bg-neutral-50/30 hover:bg-white border-slate-100"
                            } ${disabled ? "opacity-80 cursor-not-allowed" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) => handleCheckboxChange(perm.key, e.target.checked)}
                              className="h-4.5 w-4.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer disabled:cursor-not-allowed shrink-0"
                            />
                            <div className="space-y-1 pr-6">
                              <span className="text-sm font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                                {perm.label}
                                {perm.critica && (
                                  <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 uppercase">
                                    <ShieldAlert className="h-2.5 w-2.5" /> Crítica
                                  </span>
                                )}
                              </span>
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                {perm.desc}
                              </p>
                              <code className="inline-block text-[10px] bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-500 select-all">
                                {perm.key}
                              </code>
                            </div>
                            {disabled && (
                              <Lock className="absolute top-4 right-4 h-3.5 w-3.5 text-neutral-400 shrink-0" />
                            )}
                          </label>
                        );
                      })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {foraDoCatalogo.length > 0 && (
            <div className="px-6 pb-6">
              <section
                aria-label="Permissões fora do catálogo"
                className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-900/10"
              >
                <h3 className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-200">
                  <Lock className="h-4 w-4" />
                  Permissões fora do catálogo
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                  Estão gravadas neste perfil, mas esta tela não as conhece. Não dá para marcar nem desmarcar aqui:
                  elas são mantidas ao salvar. Para tirar ou explicar alguma, fale com o DEV.
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {foraDoCatalogo.map((chave) => (
                    <li key={chave}>
                      <code
                        data-fora-do-catalogo={chave}
                        className="inline-block rounded-md border border-amber-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-700 select-all dark:border-amber-900/50 dark:bg-slate-900 dark:text-slate-200"
                      >
                        {chave}
                      </code>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {/* Rodapé do Editor */}
          <div className="border-t p-6 flex items-center justify-end gap-3" style={{ borderColor: "var(--border)", background: "var(--card-footer, #fafafa)" }}>
            <button
              type="button"
              disabled={perfilSelecionado.slug === "super_admin"}
              onClick={handleOpenConfirmacao}
              className={`rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-sm flex items-center gap-2 transition ${
                perfilSelecionado.slug === "super_admin"
                  ? "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
              }`}
            >
              <Save className="h-4 w-4" />
              Salvar Alterações
            </button>
          </div>
        </div>
      )}

      {/* Modal de Confirmação & Diff */}
      {perfilSelecionado && (
        <ConfirmacaoDiffModal
          isOpen={isDiffModalOpen}
          onClose={() => setIsDiffModalOpen(false)}
          onConfirm={() => void handleSave()}
          originalPermissoes={perfilSelecionado.permissoes}
          editedPermissoes={editedPermissoes}
          perfilNome={perfilSelecionado.nome}
          isSaving={isSaving}
        />
      )}
      {/* Botão Salvar Flutuante (Sticky) */}
      {perfilSelecionado && perfilSelecionado.slug !== "super_admin" && (
        <div className="fixed bottom-24 right-6 md:right-8 z-40">
          <button
            type="button"
            onClick={handleOpenConfirmacao}
            className="rounded-full bg-blue-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/30 flex items-center gap-2 hover:bg-blue-700 hover:-translate-y-1 hover:shadow-xl transition-all"
          >
            <Save className="h-4.5 w-4.5" />
            Salvar
          </button>
        </div>
      )}
    </div>
  );
}
