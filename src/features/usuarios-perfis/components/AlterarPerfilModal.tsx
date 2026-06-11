import React, { useState } from "react";
import { X, Shield, AlertTriangle, ArrowRight, Database, History } from "lucide-react";
import type { PerfilDoCatalogo, UsuarioComPerfil } from "../types";
import { resolvePerfilEfetivo } from "../utils/resolution";

interface AlterarPerfilModalProps {
  usuario: UsuarioComPerfil;
  perfis: PerfilDoCatalogo[];
  onClose: () => void;
  onSave: (idPerfil: number | null) => Promise<void>;
}

export function AlterarPerfilModal({
  usuario,
  perfis,
  onClose,
  onSave
}: AlterarPerfilModalProps) {
  const [selectedPerfilId, setSelectedPerfilId] = useState<string>(
    usuario.id_perfil != null ? String(usuario.id_perfil) : "fallback"
  );
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Perfil Efetivo Atual
  const perfilAtual = resolvePerfilEfetivo(usuario);

  // Calcular Perfil Efetivo Futuro
  const getPerfilFuturo = () => {
    if (selectedPerfilId === "fallback") {
      // Simula o usuário sem id_perfil para obter o fallback
      const tempUser: UsuarioComPerfil = { ...usuario, id_perfil: null, perfis: null };
      return resolvePerfilEfetivo(tempUser);
    }
    
    const perfilCatalogo = perfis.find(p => String(p.id) === selectedPerfilId);
    if (perfilCatalogo) {
      return {
        slug: perfilCatalogo.slug,
        nome: perfilCatalogo.nome,
        origem: "banco" as const
      };
    }

    return perfilAtual;
  };

  const perfilFuturo = getPerfilFuturo();

  const handleSave = async () => {
    setErrorMsg(null);
    setIsSaving(true);

    const targetIdPerfil = selectedPerfilId === "fallback" ? null : Number(selectedPerfilId);

    // Confirmação explícita detalhada antes do update
    const nomeExibido = usuario.nome_usuario || usuario.email;
    const confirmMessage = `Confirmar alteração de perfil de acesso:\n\n` +
      `O usuário "${nomeExibido}" passará:\n` +
      `De: ${perfilAtual.nome} (${perfilAtual.origem === 'banco' ? 'Perfil do Banco' : 'Fallback Legado'})\n` +
      `Para: ${perfilFuturo.nome} (${perfilFuturo.origem === 'banco' ? 'Perfil do Banco' : 'Fallback Legado'})\n\n` +
      `Deseja prosseguir?`;

    if (!window.confirm(confirmMessage)) {
      setIsSaving(false);
      return;
    }

    // Registrar log no console/devtools para auditoria e homologação
    console.log(`[UsuariosPerfis] Homologação de alteração:`, {
      userId: usuario.user_id,
      usuario: nomeExibido,
      email: usuario.email,
      anterior: {
        id_perfil: usuario.id_perfil,
        slug: perfilAtual.slug,
        nome: perfilAtual.nome,
        origem: perfilAtual.origem
      },
      novo: {
        id_perfil: targetIdPerfil,
        slug: perfilFuturo.slug,
        nome: perfilFuturo.nome,
        origem: perfilFuturo.origem
      },
      timestamp: new Date().toISOString()
    });

    try {
      await onSave(targetIdPerfil);
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMsg(error.message || "Erro desconhecido ao salvar.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div 
        className="w-full max-w-lg overflow-hidden rounded-3xl border shadow-2xl transition-all"
        style={{
          background: "var(--card)",
          borderColor: "var(--border)"
        }}
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b p-5" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <div 
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{
                background: "var(--sidebar-active-bg)",
                color: "var(--sidebar-active-text)"
              }}
            >
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Alterar Perfil de Acesso</h2>
              <p className="text-xs text-muted-foreground">Configurações de segurança do usuário</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-neutral-100 hover:text-foreground dark:hover:bg-neutral-800 transition"
            aria-label="Fechar modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-6 space-y-6">
          {errorMsg && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-4 text-sm text-red-600 dark:text-red-400">
              {errorMsg}
            </div>
          )}

          {/* Dados do Usuário */}
          <div className="rounded-2xl p-4 bg-neutral-50 dark:bg-neutral-900/40 border" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Usuário</p>
            <p className="text-base font-bold text-foreground mt-0.5">{usuario.nome_usuario || "Sem Nome Cadastrado"}</p>
            <p className="text-sm text-muted-foreground">{usuario.email}</p>
          </div>

          {/* Comparativo de Transição */}
          <div className="grid grid-cols-7 items-center gap-2">
            <div className="col-span-3 rounded-2xl border p-4 text-center bg-neutral-50/50 dark:bg-neutral-900/10" style={{ borderColor: "var(--border)" }}>
              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Perfil Atual</p>
              <p className="text-sm font-bold text-foreground truncate">{perfilAtual.nome.replace(" (Fallback)", "")}</p>
              <div className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                style={{
                  background: perfilAtual.origem === "banco" ? "rgba(16, 185, 129, 0.1)" : "rgba(107, 114, 128, 0.1)",
                  color: perfilAtual.origem === "banco" ? "#10b981" : "var(--muted-foreground)"
                }}
              >
                {perfilAtual.origem === "banco" ? (
                  <><Database className="h-3 w-3" /> Banco</>
                ) : (
                  <><History className="h-3 w-3" /> Fallback</>
                )}
              </div>
            </div>
            
            <div className="col-span-1 flex justify-center">
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="col-span-3 rounded-2xl border p-4 text-center bg-neutral-50/50 dark:bg-neutral-900/10" style={{ borderColor: "var(--border)" }}>
              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Perfil Futuro</p>
              <p className="text-sm font-bold text-foreground truncate">{perfilFuturo.nome.replace(" (Fallback)", "")}</p>
              <div className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold animate-pulse"
                style={{
                  background: perfilFuturo.origem === "banco" ? "rgba(59, 130, 246, 0.1)" : "rgba(245, 158, 11, 0.1)",
                  color: perfilFuturo.origem === "banco" ? "#3b82f6" : "#f59e0b"
                }}
              >
                {perfilFuturo.origem === "banco" ? (
                  <><Database className="h-3 w-3" /> Banco</>
                ) : (
                  <><History className="h-3 w-3" /> Fallback</>
                )}
              </div>
            </div>
          </div>

          {/* Seleção do Perfil */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              Selecione o Perfil de Destino
            </label>
            <select
              value={selectedPerfilId}
              onChange={(e) => setSelectedPerfilId(e.target.value)}
              className="w-full rounded-xl border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-transparent text-foreground"
              style={{ borderColor: "var(--border)" }}
              disabled={isSaving || perfis.length === 0}
            >
              <option value="fallback">
                {perfis.length === 0 
                  ? "🔄 Usar Fallback Legado (Nenhum perfil disponível - RLS)" 
                  : "🔄 Usar Fallback Legado (id_perfil = null)"}
              </option>
              {perfis.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  🛡️ {p.nome} ({p.slug})
                </option>
              ))}
            </select>
          </div>

          {perfis.length === 0 && (
            <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/10 p-3.5 text-xs text-red-700 dark:text-red-400 flex items-center gap-2">
              <span>⚠️</span>
              <span>
                <strong>Aviso RLS:</strong> Não há perfis disponíveis no catálogo do banco para seleção. Apenas o modo fallback legado está acessível.
              </span>
            </div>
          )}

          {/* Aviso se escolher Fallback Legado */}
          {selectedPerfilId === "fallback" && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-4 flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700 dark:text-amber-400">
                <p className="font-bold">Atenção: Modo Fallback Legado Ativo</p>
                <p className="mt-1">
                  Ao definir o perfil como nulo, o sistema irá recalcular em runtime os privilégios baseados no e-mail, flags administrativas e no setor cadastrado do usuário.
                </p>
                <p className="mt-1.5 font-bold">
                  Perfil efetivo assumido: <span className="underline">{perfilFuturo.nome}</span>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div 
          className="flex items-center justify-end gap-3 border-t p-5"
          style={{
            background: "var(--sidebar-hover-bg)",
            borderColor: "var(--border)"
          }}
        >
          <button
            onClick={onClose}
            className="rounded-xl border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
            style={{ borderColor: "var(--border)" }}
            disabled={isSaving}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition flex items-center gap-2"
            style={{
              background: "var(--primary)"
            }}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Salvando...
              </>
            ) : (
              "Confirmar Alteração"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
