"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Mail, Phone, UserPlus, Pencil, X } from "lucide-react";
import type { CadastroContato } from "@/features/cadastros/types";
import { createCadastroContatos, updateCadastroContato } from "@/features/cadastros/services/cadastros.service";
import { formatPhoneBR } from "@/lib/formatters/phone";
import {
  arteJaEnviada,
  faltasDoComprador,
  situacaoDoComprador,
  type SituacaoDoComprador,
} from "@/features/orcamentos/lib/comprador-da-arte";
import { carregarCompradorDaArte, gravarCompradorDaProposta } from "@/features/orcamentos/services/comprador-da-arte.service";

/**
 * Comprador da aba Artes (06/11/2026). O hook lê os contatos do cliente, a
 * escolha gravada na proposta e o status da arte; o card mostra o Comprador ao
 * lado do "Enviar para arte", deixa escolher entre vários e abre o cadastro
 * rápido (cargo fixo Comprador) sem sair da aba. Regra em lib/comprador-da-arte.
 */

export type CompradorDaArte = {
  carregando: boolean;
  erro: string | null;
  situacao: SituacaoDoComprador<CadastroContato>;
  idGravado: string | null;
  jaEnviada: boolean;
  escolher: (idContato: string) => Promise<{ ok: boolean; erro?: string }>;
  /** Grava na proposta o Comprador da tela (o único, já escolhido) se ainda não estiver gravado. */
  gravarEscolhaSeFaltar: () => Promise<{ ok: boolean; erro?: string }>;
  contatoGravado: (contato: CadastroContato) => Promise<{ ok: boolean; erro?: string }>;
};

export function useCompradorDaArte(idInt: number | null, idCliente: string | null): CompradorDaArte {
  // `carregadoPara` = a chave (proposta + cliente) da última leitura; difere da atual enquanto carrega.
  const chave = `${idInt ?? ""}|${idCliente ?? ""}`;
  const [carregadoPara, setCarregadoPara] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [contatos, setContatos] = useState<CadastroContato[]>([]);
  const [idGravado, setIdGravado] = useState<string | null>(null);
  const [statusArte, setStatusArte] = useState<string | null>(null);
  const carregando = Boolean(idInt) && carregadoPara !== chave;

  useEffect(() => {
    let vivo = true;
    if (!idInt) return;
    carregarCompradorDaArte(idInt, idCliente).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setContatos(r.dados.contatos);
        setIdGravado(r.dados.idGravado);
        setStatusArte(r.dados.statusArte);
        setErro(null);
      } else {
        setErro(r.erro);
      }
      setCarregadoPara(`${idInt}|${idCliente ?? ""}`);
    });
    return () => {
      vivo = false;
    };
  }, [idInt, idCliente]);

  const situacao = useMemo(() => situacaoDoComprador(contatos, idGravado), [contatos, idGravado]);

  const escolher = useCallback(
    async (idContato: string) => {
      if (!idInt) return { ok: false, erro: "Salve a proposta antes." };
      const r = await gravarCompradorDaProposta(idInt, idContato);
      if (!r.ok) return { ok: false, erro: r.erro };
      setIdGravado(idContato);
      return { ok: true };
    },
    [idInt]
  );

  const gravarEscolhaSeFaltar = useCallback(async () => {
    const id = situacao.escolhido?.id;
    if (!id || id === idGravado) return { ok: true };
    return escolher(id);
  }, [situacao.escolhido, idGravado, escolher]);

  const contatoGravado = useCallback(
    async (contato: CadastroContato) => {
      setContatos((lista) => {
        const existe = lista.some((c) => c.id === contato.id);
        return existe ? lista.map((c) => (c.id === contato.id ? contato : c)) : [...lista, contato];
      });
      return escolher(contato.id);
    },
    [escolher]
  );

  return {
    carregando,
    erro,
    situacao,
    idGravado,
    jaEnviada: arteJaEnviada(statusArte),
    escolher,
    gravarEscolhaSeFaltar,
    contatoGravado,
  };
}

type Rascunho = { id: string | null; nome: string; whatsapp: string; email: string };

interface ArtesCompradorCardProps {
  comprador: CompradorDaArte;
  idCliente: string | null;
  podeEditarContato: boolean;
  /** Avisa a proposta do contato gravado, para a lista de contatos da aba Geral. */
  onContatoDoClienteGravado?: (contato: CadastroContato) => void;
  onAviso: (tipo: "success" | "error" | "warning", titulo: string, descricao?: string) => void;
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400";

export function ArtesCompradorCard({ comprador, idCliente, podeEditarContato, onContatoDoClienteGravado, onAviso }: ArtesCompradorCardProps) {
  const { carregando, erro, situacao, jaEnviada } = comprador;
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [gravando, setGravando] = useState(false);
  const clienteCadastrado = Boolean(idCliente && /^\d+$/.test(idCliente));

  const abrirNovo = () => setRascunho({ id: null, nome: "", whatsapp: "", email: "" });
  const abrirCompletar = (c: CadastroContato) => setRascunho({ id: c.id, nome: c.nome, whatsapp: c.whatsapp, email: c.email });

  const faltasDoRascunho = rascunho ? faltasDoComprador(rascunho) : [];

  const gravarRascunho = async () => {
    if (!rascunho || !clienteCadastrado) return;
    if (faltasDoRascunho.length > 0) {
      onAviso("warning", "Comprador incompleto", `Preencha ${faltasDoRascunho.join(", ")}.`);
      return;
    }
    setGravando(true);
    try {
      const dados = {
        nome_contato: rascunho.nome.trim(),
        cargo: "Comprador",
        whats: rascunho.whatsapp.trim(),
        e_mail: rascunho.email.trim(),
      };
      let id = rascunho.id;
      if (id) {
        const r = await updateCadastroContato(id, dados);
        if (!r.success) throw new Error(r.errorMessage || "Falha ao atualizar o contato.");
      } else {
        const r = await createCadastroContatos([{ id_cliente: Number(idCliente), ...dados }]);
        id = r.success ? r.ids?.[0] ?? null : null;
        if (!id) throw new Error((!r.success && r.errorMessage) || "Falha ao gravar o contato.");
      }
      const contato: CadastroContato = {
        id,
        nome: dados.nome_contato,
        cargo: "Comprador",
        whatsapp: dados.whats,
        email: dados.e_mail,
        ativo: true,
      };
      onContatoDoClienteGravado?.(contato);
      const escolha = await comprador.contatoGravado(contato);
      if (!escolha.ok) {
        onAviso("error", "Contato gravado, mas não ficou escolhido na proposta", escolha.erro);
      } else {
        onAviso("success", rascunho.id ? "Comprador atualizado no cadastro" : "Comprador adicionado ao cliente");
      }
      setRascunho(null);
    } catch (e) {
      onAviso("error", "Não foi possível gravar o Comprador", e instanceof Error ? e.message : undefined);
    } finally {
      setGravando(false);
    }
  };

  const escolhido = situacao.escolhido;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-800">Comprador do cliente</p>
          <p className="text-xs text-slate-500">Quem recebe a arte. Sem um Comprador com nome, fone e e-mail o pedido não vai para arte.</p>
        </div>
        {podeEditarContato && clienteCadastrado && !rascunho && (
          <button
            type="button"
            onClick={abrirNovo}
            className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
          >
            <UserPlus size={14} /> Adicionar Comprador
          </button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {carregando ? (
          <p className="text-sm text-slate-500">Carregando contatos do cliente...</p>
        ) : erro ? (
          <p className="text-sm text-red-600">{erro}</p>
        ) : !clienteCadastrado ? (
          <p className="text-sm text-amber-700">Proposta sem cliente cadastrado: não há Comprador para escolher.</p>
        ) : (
          <>
            {situacao.compradores.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Comprador que recebe a arte</span>
                <select
                  value={escolhido?.id ?? ""}
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    const r = await comprador.escolher(e.target.value);
                    if (!r.ok) onAviso("error", "Não foi possível gravar a escolha", r.erro);
                  }}
                  className={inputClass}
                >
                  <option value="">Escolha o Comprador</option>
                  {situacao.compradores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome || "(sem nome)"}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {escolhido && (
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-800">{escolhido.nome || "(sem nome)"}</p>
                <p className="mt-1 flex items-center gap-1.5 text-slate-600">
                  <Phone size={13} /> {escolhido.whatsapp.trim() ? formatPhoneBR(escolhido.whatsapp) : <span className="text-amber-700">sem fone</span>}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-slate-600">
                  <Mail size={13} /> {escolhido.email.trim() || <span className="text-amber-700">sem e-mail</span>}
                </p>
                {situacao.faltas.length > 0 && podeEditarContato && !rascunho && (
                  <button
                    type="button"
                    onClick={() => abrirCompletar(escolhido)}
                    className="mt-2 flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:underline"
                  >
                    <Pencil size={12} /> Completar {situacao.faltas.join(" e ")}
                  </button>
                )}
              </div>
            )}

            {situacao.aviso && !jaEnviada && (
              <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {situacao.aviso}
              </p>
            )}
            {situacao.liberado && !jaEnviada && (
              <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 size={14} /> Comprador pronto para o envio.
              </p>
            )}
            {jaEnviada && (
              <p className="text-xs text-slate-500">Pedido já enviado para arte: a exigência do Comprador vale só para o primeiro envio.</p>
            )}
            {!podeEditarContato && !situacao.liberado && (
              <p className="text-xs text-slate-500">Sem permissão para editar contatos do cliente (Editar Cadastros). Peça a quem tem para completar o Comprador.</p>
            )}
          </>
        )}

        {rascunho && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold text-indigo-800">
                {rascunho.id ? "Completar Comprador" : "Novo Comprador"} <span className="font-normal text-slate-500">· cargo Comprador</span>
              </p>
              <button type="button" onClick={() => setRascunho(null)} className="text-slate-400 hover:text-slate-600" aria-label="Fechar">
                <X size={14} />
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                placeholder="Nome"
                value={rascunho.nome}
                onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                className={inputClass}
              />
              <input
                placeholder="WhatsApp com DDD"
                value={rascunho.whatsapp}
                onChange={(e) => setRascunho({ ...rascunho, whatsapp: e.target.value })}
                className={inputClass}
              />
              <input
                placeholder="E-mail"
                type="email"
                value={rascunho.email}
                onChange={(e) => setRascunho({ ...rascunho, email: e.target.value })}
                className={inputClass}
              />
            </div>
            {faltasDoRascunho.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-500">Falta: {faltasDoRascunho.join(", ")}.</p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setRascunho(null)} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                Cancelar
              </button>
              <button
                type="button"
                disabled={gravando || faltasDoRascunho.length > 0}
                onClick={gravarRascunho}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {gravando ? "Gravando..." : "Gravar no cliente"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
