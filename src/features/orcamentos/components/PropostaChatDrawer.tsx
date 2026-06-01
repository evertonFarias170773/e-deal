import { useEffect, useState } from "react";
import { X, Paperclip } from "lucide-react";
import { PropostaChatPanel } from "./PropostaChatPanel";
import { type PropostaChatResumo } from "@/features/orcamentos/services/orcamentos.service";

interface PropostaChatDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  idInt: number;
  clienteNome?: string | null;
  idCliente?: string | number | null;
  tituloContexto?: string;
  // Slots for future indicators/badges
  headerBadge?: React.ReactNode;
  headerActions?: React.ReactNode;
  onMessagesUpdated?: (summary: PropostaChatResumo) => void;
}

export function PropostaChatDrawer({
  open,
  onOpenChange,
  idInt,
  clienteNome,
  idCliente,
  tituloContexto = "Chat interno",
  headerBadge,
  headerActions,
  onMessagesUpdated
}: PropostaChatDrawerProps) {
  const [localResumo, setLocalResumo] = useState<{
    total_mensagens: number;
    total_anexos: number;
    has_pendente: boolean;
    has_recusado: boolean;
  }>({
    total_mensagens: 0,
    total_anexos: 0,
    has_pendente: false,
    has_recusado: false
  });



  // ESC key listener to close drawer
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // Lock scroll of background page when drawer is open
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  if (!open) return null;

  const displayClienteNome = clienteNome || "Cliente não cadastrado";

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950/60 p-0 transition-opacity flex justify-end"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      {/* CSS Animation for smooth slide-in */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}} />

      {/* Drawer content sliding from the right */}
      <div
        className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col z-[80] relative"
        style={{
          animation: 'slideInRight 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4 shrink-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {headerBadge ? (
                headerBadge
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                    {tituloContexto}
                    {localResumo.total_mensagens > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-[#0b2f4a] px-1.5 py-0.5 text-[9px] font-extrabold text-white leading-none">
                        {localResumo.total_mensagens}
                      </span>
                    )}
                  </span>
                  
                  {localResumo.total_anexos > 0 && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200" title={`${localResumo.total_anexos} anexo(s)`}>
                      <Paperclip className="h-3 w-3 text-slate-500" />
                      {localResumo.total_anexos}
                    </span>
                  )}

                  {localResumo.has_recusado && (
                    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 border border-red-200">
                      Recusado
                    </span>
                  )}

                  {localResumo.has_pendente && (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                      Pendência
                    </span>
                  )}
                </div>
              )}
              <h2 className="text-base font-bold text-slate-950 shrink-0">
                Proposta #{idInt}
              </h2>
            </div>
            <p className="text-xs font-medium text-slate-500 truncate max-w-[280px]" title={displayClienteNome}>
              {displayClienteNome}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition"
              title="Fechar chat"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Panel wrapper */}
        <div className="flex-1 min-h-0">
          <PropostaChatPanel
            key={idInt} // Force unmount/remount when proposal changes to ensure absolute state cleanup
            idInt={idInt}
            clienteNome={clienteNome}
            idCliente={idCliente}
            showHeader={false}
            className="h-full border-none shadow-none rounded-none"
            onMessagesUpdated={(summary) => {
              setLocalResumo({
                total_mensagens: summary.total_mensagens,
                total_anexos: summary.total_anexos,
                has_pendente: summary.has_pendente,
                has_recusado: summary.has_recusado
              });
              onMessagesUpdated?.(summary);
            }}
          />
        </div>
      </div>
    </div>
  );
}

