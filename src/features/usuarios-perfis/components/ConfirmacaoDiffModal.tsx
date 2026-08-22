import React from "react";
import { X, Check, ShieldCheck, Trash2, Plus } from "lucide-react";

interface ConfirmacaoDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  originalPermissoes: string[];
  editedPermissoes: string[];
  perfilNome: string;
  isSaving: boolean;
}

export function ConfirmacaoDiffModal({
  isOpen,
  onClose,
  onConfirm,
  originalPermissoes,
  editedPermissoes,
  perfilNome,
  isSaving
}: ConfirmacaoDiffModalProps) {
  if (!isOpen) return null;

  const adicionadas = editedPermissoes.filter((p) => !originalPermissoes.includes(p));
  const removidas = originalPermissoes.filter((p) => !editedPermissoes.includes(p));
  const temAlteracoes = adicionadas.length > 0 || removidas.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
      <div 
        className="w-full max-w-xl rounded-3xl border shadow-xl flex flex-col max-h-[85vh] transition-all transform scale-100 bg-white animate-in fade-in duration-200"
        style={{ borderColor: "var(--border)" }}
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b p-5" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Confirmar Alterações</h2>
              <p className="text-xs text-muted-foreground">Perfil: {perfilNome}</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="rounded-full p-1.5 text-muted-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-6 overflow-y-auto space-y-4 text-sm text-foreground">
          {!temAlteracoes ? (
            <p className="text-neutral-500 font-semibold text-center py-4">
              Nenhuma alteração de permissão foi detectada.
            </p>
          ) : (
            <>
              <p className="text-muted-foreground font-semibold">
                Revise as alterações de permissões antes de salvar:
              </p>

              {adicionadas.length > 0 && (
                <div className="rounded-2xl border border-green-200 bg-green-50/50 dark:border-green-900/30 dark:bg-green-950/10 p-4 space-y-2">
                  <h3 className="font-bold text-green-800 dark:text-green-400 flex items-center gap-1.5">
                    <Plus className="h-4 w-4" /> Adicionadas ({adicionadas.length})
                  </h3>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs text-green-700 dark:text-green-500 font-semibold list-inside list-disc">
                    {adicionadas.map((p) => (
                      <li key={p} className="truncate">{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {removidas.length > 0 && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50/50 dark:border-rose-900/30 dark:bg-rose-950/10 p-4 space-y-2">
                  <h3 className="font-bold text-rose-800 dark:text-rose-400 flex items-center gap-1.5">
                    <Trash2 className="h-4 w-4" /> Removidas ({removidas.length})
                  </h3>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs text-rose-700 dark:text-rose-500 font-semibold list-inside list-disc">
                    {removidas.map((p) => (
                      <li key={p} className="truncate">{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé */}
        <div className="border-t p-5 flex items-center justify-end gap-3" style={{ borderColor: "var(--border)", background: "var(--card-footer, #fafafa)" }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border px-4 py-2.5 text-sm font-semibold text-neutral-600 dark:text-neutral-300 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
            style={{ borderColor: "var(--border)" }}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!temAlteracoes || isSaving}
            onClick={onConfirm}
            className={`rounded-2xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm flex items-center gap-1.5 transition ${
              !temAlteracoes || isSaving
                ? "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
            }`}
          >
            {isSaving ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Salvando...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Confirmar e Gravar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
