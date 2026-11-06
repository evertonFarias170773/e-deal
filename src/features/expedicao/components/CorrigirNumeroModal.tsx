"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { updateCadastroContato } from "@/features/cadastros/services/cadastros.service";

/**
 * "Corrigir número" do aviso pedido pronto (06/11/2026).
 *
 * Abre com o WhatsApp do contato do pedido, relido do cadastro na hora. Salva em
 * contatos.whats pela mesma gravação do cadastro do cliente
 * (updateCadastroContato), com nome, cargo e e-mail como estão. Depois relê
 * para conferir que gravou. Só aparece para quem tem cadastros.edit (ou ADM).
 */
type ContatoLido = { id: number; nome_contato: string | null; cargo: string | null; whats: string | null; e_mail: string | null };

export function CorrigirNumeroModal({
  idContato,
  numeroEnviado,
  onSalvo,
  onClose
}: {
  idContato: number;
  numeroEnviado: string;
  onSalvo: (whats: string) => void;
  onClose: () => void;
}) {
  const [contato, setContato] = useState<ContatoLido | null>(null);
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setErro("Supabase não configurado.");
        return;
      }
      const { data, error } = await supabase
        .from("contatos")
        .select("id, nome_contato, cargo, whats, e_mail")
        .eq("id", idContato)
        .maybeSingle();
      if (!vivo) return;
      if (error || !data) {
        setErro("Não foi possível ler o contato do pedido.");
        return;
      }
      setContato(data as ContatoLido);
      setValor((data as ContatoLido).whats ?? "");
    })();
    return () => {
      vivo = false;
    };
  }, [idContato]);

  async function salvar() {
    if (!contato || salvando) return;
    const novo = valor.trim();
    const digitos = novo.replace(/\D/g, "");
    if (!/^[+\d\s().-]+$/.test(novo) || digitos.length < 10 || digitos.length > 13) {
      setErro("Digite o WhatsApp com DDD (só números, espaço, parênteses, hífen ou +).");
      return;
    }
    if (novo === (contato.whats ?? "").trim()) {
      setErro("O número está igual ao do cadastro. Mude antes de salvar.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const r = await updateCadastroContato(String(contato.id), {
      nome_contato: contato.nome_contato ?? "",
      cargo: contato.cargo,
      whats: novo,
      e_mail: contato.e_mail
    });
    if (!r.success) {
      setSalvando(false);
      setErro(r.errorMessage || "Não foi possível salvar o número.");
      return;
    }
    // Confere que gravou (UPDATE sem linha não dá erro).
    const supabase = getSupabaseClient();
    const { data } = supabase
      ? await supabase.from("contatos").select("whats").eq("id", contato.id).maybeSingle()
      : { data: null };
    setSalvando(false);
    if ((data?.whats ?? "").trim() !== novo) {
      setErro("O cadastro não confirmou a gravação. Confira o contato no cadastro do cliente.");
      return;
    }
    onSalvo(novo);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Corrigir número"
      onClick={() => {
        if (!salvando) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-3xl bg-white text-left shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Corrigir número</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            aria-label="Fechar"
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 p-6 text-sm text-slate-700 dark:text-slate-300">
          <p>
            O ChatGuru não encontrou <span className="font-semibold">{numeroEnviado}</span>. Corrija o WhatsApp do contato
            {contato?.nome_contato ? <> <span className="font-semibold">{contato.nome_contato}</span></> : null} no cadastro e
            depois use Reenviar.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">WhatsApp do contato</span>
            <input
              name="whats-contato"
              value={valor}
              disabled={!contato || salvando}
              onChange={(e) => setValor(e.target.value)}
              inputMode="tel"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400">A gravação vai para o cadastro do cliente, como no cadastro.</p>
          {erro && <p className="rounded-2xl bg-red-50 p-3 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">{erro}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={!contato || salvando}
            className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950"
          >
            {salvando ? "Salvando..." : "Salvar número"}
          </button>
        </div>
      </div>
    </div>
  );
}
