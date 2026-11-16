"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import {
  enviarOrcamentoChatGuru,
  gravarTextoDoBox,
  liberarOrcamentoChatGuru,
  prepararOrcamentoChatGuru,
  textoComparavel,
  type EnvioDoOrcamento,
  type PreparoOrcamento
} from "@/features/orcamentos/services/orcamento-chatguru.client";

/**
 * Botão "Enviar pelo ChatGuru" do box 9 (14/11/2026). Manda o diálogo "Orçamento
 * Whatsapp" com o texto gravado do box 9 para cada conversa de Contatos do pedido.
 * Com alteração não salva, não envia: pede para salvar antes. Sem alteração e com
 * o texto gravado diferente do box (proposta paga, onde o Salvar responde "Nada
 * para salvar", ou salva antes de 14/11), o Confirmar envio grava só
 * propostas.texto_whatsapp com o texto do box 9 e envia (16/11/2026). Primeiro mostra as conversas e o que seria recusado; o envio
 * só sai na confirmação, e o resultado aparece por conversa.
 */

type Props = {
  /** Número da proposta salva; nulo na proposta nova. */
  idInt: number | null;
  /** Texto do box 9 na tela, para conferir com o gravado. */
  textoDoBox: string;
  alteracoesNaoSalvas: boolean;
};

export const SALVE_ANTES =
  "Há alterações não salvas. Salve a proposta antes de enviar, para o cliente não receber o texto antigo.";
export const TEXTO_SERA_GRAVADO =
  "O texto gravado na proposta é diferente do box 9. Ao confirmar, o texto do box 9 é gravado na proposta (só o texto do WhatsApp) e enviado.";

function quando(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function resultadoDoEnvio(e: EnvioDoOrcamento): { texto: string; tom: "ok" | "erro" | "alerta" } {
  if (e.recusa) return { texto: e.recusa, tom: "erro" };
  const estado = e.aviso?.estado;
  if (estado === "executado") return { texto: "Enviado: diálogo executado no ChatGuru.", tom: "ok" };
  if (estado === "falhou") return { texto: `Não enviado. ${e.motivo_chatguru || "O ChatGuru recusou o envio."}`, tom: "erro" };
  return {
    texto: "Sem confirmação do ChatGuru. Confira a conversa no ChatGuru: ela fica travada até o ADM usar Liberar número aqui no box 9.",
    tom: "alerta"
  };
}

const TOM = {
  ok: "text-emerald-700 dark:text-emerald-300",
  erro: "text-red-700 dark:text-red-300",
  alerta: "text-amber-700 dark:text-amber-300"
} as const;

export function EnviarOrcamentoChatGuru({ idInt, textoDoBox, alteracoesNaoSalvas }: Props) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [preparo, setPreparo] = useState<PreparoOrcamento | null>(null);
  const [envios, setEnvios] = useState<EnvioDoOrcamento[] | null>(null);
  const [liberando, setLiberando] = useState<{ seq: number; resposta: "enviada" | "nao_enviada" } | null>(null);

  async function abrir() {
    setEnvios(null);
    setLiberando(null);
    if (!idInt) {
      setAberto(false);
      setAviso("Salve a proposta antes de enviar pelo ChatGuru.");
      return;
    }
    if (alteracoesNaoSalvas) {
      setAberto(false);
      setAviso(SALVE_ANTES);
      return;
    }
    setAviso(null);
    setAberto(true);
    setCarregando(true);
    const r = await prepararOrcamentoChatGuru(idInt);
    setCarregando(false);
    setPreparo(r);
  }

  async function enviar() {
    if (!idInt || enviando) return;
    // Alteração pendente: continua pedindo para salvar (nada é gravado nem enviado).
    if (alteracoesNaoSalvas) {
      setPreparo((p) => ({ ...(p ?? { ok: false }), bloqueio: SALVE_ANTES }));
      return;
    }
    setEnviando(true);
    // Sem alteração, o box 9 é o texto certo: grava só texto_whatsapp antes de enviar.
    if (textoDiferente) {
      const g = await gravarTextoDoBox(idInt, textoDoBox);
      if (!g.ok) {
        setEnviando(false);
        setPreparo((p) => ({ ...(p ?? { ok: false }), bloqueio: g.mensagem ?? "Não foi possível gravar o texto do box 9." }));
        return;
      }
      setPreparo((p) => (p ? { ...p, texto: textoDoBox } : p));
    }
    const r = await enviarOrcamentoChatGuru(idInt);
    setEnviando(false);
    if (!r.ok) {
      setPreparo((p) => ({ ...(p ?? { ok: false }), bloqueio: r.mensagem ?? "Não foi possível enviar." }));
      return;
    }
    setEnvios(r.envios ?? []);
  }

  async function liberar() {
    if (!idInt || !liberando) return;
    const r = await liberarOrcamentoChatGuru(idInt, liberando.seq, liberando.resposta);
    setLiberando(null);
    if (!r.ok) {
      setAviso(r.mensagem ?? "Não foi possível liberar a conversa.");
      return;
    }
    setAviso(null);
    await abrir();
  }

  const textoDiferente =
    Boolean(preparo?.ok && preparo.texto) && textoComparavel(textoDoBox) !== textoComparavel(preparo?.texto);
  const conversas = preparo?.conversas ?? [];
  const livres = conversas.filter((c) => !c.bloqueio);
  const bloqueioGeral = !preparo ? null : !preparo.ok ? preparo.mensagem ?? "Não foi possível preparar o envio." : preparo.bloqueio ?? null;
  const podeEnviar = !carregando && !enviando && !bloqueioGeral && !alteracoesNaoSalvas && livres.length > 0 && !envios;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={abrir}
        disabled={carregando || enviando}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[#0b2f4a] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-300 dark:bg-transparent dark:text-sky-200 dark:hover:bg-slate-800"
      >
        <Send className="h-4 w-4" />
        Enviar pelo ChatGuru
      </button>

      {aviso && <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">{aviso}</p>}

      {aberto && (
        <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <p className="font-semibold">Orçamento pelo WhatsApp (diálogo Orçamento Whatsapp)</p>
          {carregando && <p className="text-xs text-slate-500 dark:text-slate-400">Conferindo as conversas…</p>}

          {!carregando && bloqueioGeral && <p className={`text-xs font-semibold ${TOM.erro}`}>{bloqueioGeral}</p>}
          {!carregando && alteracoesNaoSalvas && <p className={`text-xs font-semibold ${TOM.erro}`}>{SALVE_ANTES}</p>}
          {!carregando && !alteracoesNaoSalvas && textoDiferente && !envios && (
            <p className={`text-xs font-semibold ${TOM.alerta}`}>{TEXTO_SERA_GRAVADO}</p>
          )}

          {!carregando && conversas.length > 0 && (
            <ul className="space-y-1.5">
              {conversas.map((c) => {
                const r = envios?.find((e) => e.chat_id === c.chat_id);
                const res = r ? resultadoDoEnvio(r) : null;
                return (
                  <li key={c.chat_id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
                    <p className="font-semibold">{c.nome}</p>
                    {res ? (
                      <p className={`text-xs font-semibold ${TOM[res.tom]}`}>{res.texto}</p>
                    ) : c.bloqueio ? (
                      <p className={`text-xs ${TOM.erro}`}>{c.bloqueio}</p>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">Pronta para receber.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!carregando && (preparo?.travados ?? []).length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-700 dark:bg-amber-950/40">
              {(preparo?.travados ?? []).map((t) => (
                <div key={t.seq}>
                  <p className={TOM.alerta}>
                    Orçamento sem confirmação do ChatGuru para {t.nome} ({quando(t.criado_em)}). A conversa fica travada para novos envios.
                  </p>
                  {preparo?.pode_liberar &&
                    (liberando?.seq === t.seq ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-semibold">
                          Você conferiu no ChatGuru que a mensagem {liberando.resposta === "enviada" ? "chegou" : "não chegou"}?
                        </span>
                        <button type="button" onClick={liberar} className="rounded-lg bg-[#0b2f4a] px-2 py-1 font-semibold text-white">
                          Confirmar
                        </button>
                        <button type="button" onClick={() => setLiberando(null)} className="rounded-lg border border-slate-300 px-2 py-1">
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-2">
                        <span className="font-semibold">Liberar número:</span>
                        <button type="button" onClick={() => setLiberando({ seq: t.seq, resposta: "enviada" })} className="rounded-lg border border-slate-300 px-2 py-1">
                          Chegou no WhatsApp
                        </button>
                        <button type="button" onClick={() => setLiberando({ seq: t.seq, resposta: "nao_enviada" })} className="rounded-lg border border-slate-300 px-2 py-1">
                          Não chegou
                        </button>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!envios && (
              <button
                type="button"
                onClick={enviar}
                disabled={!podeEnviar}
                className="rounded-xl bg-[#0b2f4a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#082236] disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
              >
                {enviando ? "Enviando…" : `Confirmar envio para ${livres.length} ${livres.length === 1 ? "conversa" : "conversas"}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setAberto(false);
                setPreparo(null);
                setEnvios(null);
              }}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-600"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
