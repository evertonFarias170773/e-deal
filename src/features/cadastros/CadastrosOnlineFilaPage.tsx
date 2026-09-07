"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAppToast } from "@/components/common/AppToast";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatDocument } from "@/lib/formatters/document";
import { MeuLinkCadastro } from "@/features/cadastros/components/MeuLinkCadastro";
import {
  desfazerCadastroOnline,
  listarCadastrosOnline,
  recusarCadastroOnline,
  type CadastroOnlineItem,
  type CadastroOnlineStatus
} from "@/features/cadastros/services/cadastros-online.service";

/**
 * Fila do cadastro online.
 *
 * Mostra TUDO o que caiu por link de atendente, inclusive o que foi aprovado
 * automaticamente — que hoje e a regra, nao a excecao. A coluna que diz quem
 * decidiu distingue os dois casos: `aprovado_por` nulo significa que ninguem
 * olhou, foi o proprio envio que virou cliente.
 *
 * Sem restricao de perfil, por decisao do dono: qualquer perfil com sessao ve a
 * fila inteira, de qualquer vendedor.
 */

const FILTROS: Array<{ chave: "TODOS" | CadastroOnlineStatus; rotulo: string }> = [
  { chave: "TODOS", rotulo: "Todos" },
  { chave: "APROVADO", rotulo: "Aprovados" },
  { chave: "PENDENTE", rotulo: "Pendentes" },
  { chave: "RECUSADO", rotulo: "Recusados" }
];

type Decisao =
  | { tipo: "RECUSAR"; item: CadastroOnlineItem }
  | { tipo: "DESFAZER"; item: CadastroOnlineItem };

export function CadastrosOnlineFilaPage() {
  const { user } = useAuth();
  const { showToast } = useAppToast();

  const [itens, setItens] = useState<CadastroOnlineItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<"TODOS" | CadastroOnlineStatus>("TODOS");
  const [decisao, setDecisao] = useState<Decisao | null>(null);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Recarga manual, usada depois de recusar ou desfazer.
  const carregar = useCallback(async () => {
    const resultado = await listarCadastrosOnline();
    setItens(resultado.itens);
    setErro(resultado.errorMessage ?? "");
    setCarregando(false);
  }, []);

  // Carga inicial no padrao dos outros hooks desta feature: IIFE assincrona com
  // guarda de montagem. Chamar `carregar()` direto no corpo do efeito e recusado
  // pela regra react-hooks/set-state-in-effect — setState sincrono em efeito
  // dispara render em cascata.
  useEffect(() => {
    let ativo = true;

    void (async () => {
      const resultado = await listarCadastrosOnline();
      if (!ativo) return;
      setItens(resultado.itens);
      setErro(resultado.errorMessage ?? "");
      setCarregando(false);
    })();

    return () => {
      ativo = false;
    };
  }, []);

  const visiveis = useMemo(
    () => (filtro === "TODOS" ? itens : itens.filter((item) => item.status === filtro)),
    [itens, filtro]
  );

  const contagem = useMemo(
    () => ({
      aprovados: itens.filter((i) => i.status === "APROVADO").length,
      pendentes: itens.filter((i) => i.status === "PENDENTE").length,
      recusados: itens.filter((i) => i.status === "RECUSADO").length
    }),
    [itens]
  );

  async function confirmarDecisao() {
    if (!decisao) return;
    setSalvando(true);

    const decididoPor = user?.id ?? null;
    const resultado =
      decisao.tipo === "DESFAZER" && decisao.item.idClienteGerado
        ? await desfazerCadastroOnline(
            decisao.item.id,
            decisao.item.idClienteGerado,
            motivo,
            decididoPor
          )
        : await recusarCadastroOnline(decisao.item.id, motivo, decididoPor);

    setSalvando(false);

    if (!resultado.success) {
      showToast({
        type: "error",
        title: "Não foi possível concluir",
        description: resultado.errorMessage ?? "Tente de novo."
      });
      return;
    }

    showToast({
      type: "success",
      title: decisao.tipo === "DESFAZER" ? "Cadastro desfeito" : "Envio recusado",
      description:
        decisao.tipo === "DESFAZER"
          ? `O cliente ${decisao.item.idClienteGerado} ficou inativo na base.`
          : "O envio foi marcado como recusado."
    });
    setDecisao(null);
    setMotivo("");
    void carregar();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recebidos pelo link"
        subtitle="Cadastros enviados pelos clientes através do link do atendente. A aprovação é automática — aqui você confere, recusa ou desfaz."
        context="Cadastros"
      />

      <MeuLinkCadastro />

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((opcao) => (
          <button
            key={opcao.chave}
            type="button"
            onClick={() => setFiltro(opcao.chave)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              filtro === opcao.chave
                ? "border-[#0b2f4a] bg-[#0b2f4a] text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {opcao.rotulo}
            {opcao.chave === "APROVADO" ? ` (${contagem.aprovados})` : null}
            {opcao.chave === "PENDENTE" ? ` (${contagem.pendentes})` : null}
            {opcao.chave === "RECUSADO" ? ` (${contagem.recusados})` : null}
          </button>
        ))}
      </div>

      {erro ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {erro}
        </p>
      ) : null}

      {carregando ? (
        <LoadingSkeleton variant="cards" rows={3} />
      ) : visiveis.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
          Nenhum cadastro recebido por link até agora.
        </p>
      ) : (
        <ul className="space-y-3">
          {visiveis.map((item) => (
            <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{item.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDocument(item.documento)} · {item.tipoPessoa === "FISICA" ? "CPF" : "CNPJ"}
                    {item.fantasia ? ` · ${item.fantasia}` : ""}
                  </p>
                </div>
                <Selo item={item} />
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs text-slate-600 sm:grid-cols-2">
                <Linha rotulo="Veio do link de" valor={item.nomeVendedor || "—"} />
                <Linha rotulo="Recebido em" valor={formatarData(item.criadoEm)} />
                <Linha rotulo="Contato" valor={[item.email, item.whatsapp, item.telefoneFixo].filter(Boolean).join(" · ") || "—"} />
                <Linha
                  rotulo="Endereço"
                  valor={
                    [item.endereco, item.numero, item.bairro, item.cidade, item.uf]
                      .filter(Boolean)
                      .join(", ") || "—"
                  }
                />
                <Linha
                  rotulo="Cliente criado"
                  valor={item.idClienteGerado ? `#${item.idClienteGerado}` : "—"}
                />
                <Linha rotulo="Consentimento" valor={`${formatarData(item.consentimentoEm)} · versão ${item.consentimentoVersao}`} />
                {item.motivoRecusa ? <Linha rotulo="Motivo" valor={item.motivoRecusa} /> : null}
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                {item.status === "APROVADO" && item.idClienteGerado ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDecisao({ tipo: "DESFAZER", item });
                      setMotivo("");
                    }}
                    className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
                  >
                    Desfazer cadastro
                  </button>
                ) : null}
                {item.status === "PENDENTE" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDecisao({ tipo: "RECUSAR", item });
                      setMotivo("");
                    }}
                    className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
                  >
                    Recusar envio
                  </button>
                ) : null}
                {item.idClienteGerado ? (
                  <a
                    href={`/cadastros/${item.idClienteGerado}`}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Abrir cadastro
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {decisao ? (
        <ModalDecisao
          decisao={decisao}
          motivo={motivo}
          aoMudarMotivo={setMotivo}
          salvando={salvando}
          aoCancelar={() => {
            setDecisao(null);
            setMotivo("");
          }}
          aoConfirmar={confirmarDecisao}
        />
      ) : null}
    </div>
  );
}

function Selo({ item }: { item: CadastroOnlineItem }) {
  const automatico = item.status === "APROVADO" && item.aprovadoPor === null;
  const cores: Record<CadastroOnlineStatus, string> = {
    APROVADO: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    PENDENTE: "bg-amber-50 text-amber-700 ring-amber-200",
    RECUSADO: "bg-slate-100 text-slate-600 ring-slate-200"
  };
  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ring-1 ${cores[item.status]}`}>
      {item.status === "APROVADO" ? (automatico ? "Aprovado automaticamente" : "Aprovado") : null}
      {item.status === "PENDENTE" ? "Pendente" : null}
      {item.status === "RECUSADO" ? "Recusado" : null}
    </span>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{rotulo}</dt>
      <dd className="truncate text-slate-700">{valor}</dd>
    </div>
  );
}

/**
 * O texto do "desfazer" e a parte mais importante desta tela.
 *
 * Desfazer NAO e apagar. Quem clica precisa saber, ANTES, exatamente o que fica
 * para tras — senao vai supor que voltou ao estado anterior e descobrir depois
 * que o numero foi consumido e que o endereco continua na base.
 */
function ModalDecisao({
  decisao,
  motivo,
  aoMudarMotivo,
  salvando,
  aoCancelar,
  aoConfirmar
}: {
  decisao: Decisao;
  motivo: string;
  aoMudarMotivo: (valor: string) => void;
  salvando: boolean;
  aoCancelar: () => void;
  aoConfirmar: () => void;
}) {
  const desfazendo = decisao.tipo === "DESFAZER";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900">
          {desfazendo ? "Desfazer este cadastro?" : "Recusar este envio?"}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {decisao.item.nome} — {formatDocument(decisao.item.documento)}
        </p>

        {desfazendo ? (
          <div className="mt-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">O que acontece</p>
            <p>
              O cliente <strong>#{decisao.item.idClienteGerado}</strong> fica <strong>inativo</strong>{" "}
              na base e some da lista de ativos. O envio passa para recusado.
            </p>
            <p className="font-semibold">O que isto NÃO desfaz</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                O cliente <strong>continua existindo</strong> na base — apenas inativo. Nada é
                apagado.
              </li>
              <li>
                O número <strong>#{decisao.item.idClienteGerado}</strong> fica{" "}
                <strong>consumido para sempre</strong>. Ele não volta para a numeração e não será
                reaproveitado por outro cadastro.
              </li>
              <li>
                O <strong>endereço e o contato</strong> criados junto{" "}
                <strong>permanecem</strong> vinculados a esse número.
              </li>
              <li>
                O registro deste envio, com o consentimento e a data, <strong>continua na fila</strong>.
              </li>
            </ul>
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            Nenhum cliente foi criado para este envio. Ele será marcado como recusado e continuará na
            fila, com o motivo.
          </p>
        )}

        <label htmlFor="motivo" className="mt-4 block text-sm font-medium text-slate-700">
          Motivo {desfazendo ? "(recomendado)" : "(opcional)"}
        </label>
        <textarea
          id="motivo"
          rows={3}
          value={motivo}
          onChange={(evento) => aoMudarMotivo(evento.target.value)}
          placeholder="Ex.: cliente enviou dados de outra empresa por engano"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#0b2f4a]"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={aoCancelar}
            disabled={salvando}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={aoConfirmar}
            disabled={salvando}
            className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
          >
            {salvando ? "Aplicando…" : desfazendo ? "Desfazer cadastro" : "Recusar envio"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatarData(valor: string): string {
  if (!valor) return "—";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "—";
  return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
