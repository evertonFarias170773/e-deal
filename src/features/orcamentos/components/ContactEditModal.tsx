import React from "react";
import { X } from "lucide-react";

type ContactDraft = {
  nome: string;
  cargo: string;
  whatsapp: string;
  email: string;
};

type ContactEditModalProps = {
  draft: ContactDraft;
  onChange: (draft: ContactDraft) => void;
  onClose: () => void;
  onSave: () => void;
};

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]";

export function ContactEditModal({ draft, onChange, onClose, onSave }: ContactEditModalProps) {
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-slate-950">Editar contato (Modo Local)</h2>
          <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition">
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Nome *</label>
            <input
              value={draft.nome}
              onChange={(e) => onChange({ ...draft, nome: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Cargo</label>
            <input
              value={draft.cargo}
              onChange={(e) => onChange({ ...draft, cargo: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">WhatsApp / Telefone *</label>
            <input
              value={draft.whatsapp}
              onChange={(e) => onChange({ ...draft, whatsapp: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">E-mail</label>
            <input
              value={draft.email}
              onChange={(e) => onChange({ ...draft, email: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 p-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white hover:bg-[#123f61] transition"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
