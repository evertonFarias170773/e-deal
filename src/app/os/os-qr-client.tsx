"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client da página pública do QR de produção (v2 — multi-status).
 * - Captura o token de ?t= ou #, guarda em memória + sessionStorage e
 *   REMOVE query/fragment da barra de endereço (history.replaceState).
 * - Consulta o estado via POST (token no body) — nunca em URL de request.
 * - Mostra o status atual, destaca o próximo natural e lista os demais
 *   destinos; o motivo é sempre OPCIONAL (registrado quando informado);
 *   ENTREGUE exige confirmação reforçada em 2 toques.
 * - Nunca atualiza status ao abrir a página.
 */

const SESSION_KEY = "osqr-token";

type Destino = {
  status: string;
  tipo: string;
  natural: boolean;
  exige_motivo: boolean;
};

type ConsultaEstado = {
  ok: boolean;
  motivo?: string;
  id_int?: number;
  produto_resumo?: string;
  status_atual?: string;
  forma_entrega?: string;
  destinos?: Destino[];
  proximo_status?: string | null;
};

type TransicaoResultado = {
  ok: boolean;
  motivo?: string;
  status_anterior?: string;
  status_novo?: string;
  status_atual?: string;
  tipo_transicao?: string;
};

const TIPO_LABEL: Record<string, string> = {
  natural: "Próxima etapa",
  retomada: "Retomar etapa",
  pausa: "Pausar etapa",
  retorno: "Retornar etapa",
  salto: "Saltar etapa",
  lateral: "Trocar forma de entrega",
  avanco_entrega: "Definir entrega"
};

const MOTIVO_PLACEHOLDER: Record<string, string> = {
  pausa: "Ex.: aguardando material para continuar",
  retorno: "Ex.: falha detectada, retornando etapa para correção",
  salto: "Ex.: etapa não se aplica a este pedido",
  lateral: "Ex.: cliente optou por outra forma de entrega",
  avanco_entrega: "Ex.: forma de entrega alterada com o cliente"
};

function capturarToken(): string | null {
  if (typeof window === "undefined") return null;
  // Transporte primário: query string (?t=) — sobrevive a leitores de QR que
  // descartam o fragment. Fragment (#) mantido por compatibilidade com PDFs antigos.
  const query = new URLSearchParams(window.location.search).get("t")?.trim() || "";
  const hash = window.location.hash.replace(/^#/, "").trim();
  const capturado = query || hash;
  if (capturado) {
    try {
      window.sessionStorage.setItem(SESSION_KEY, capturado);
    } catch {
      // sessionStorage indisponível — segue só com memória
    }
    // Remove IMEDIATAMENTE query e fragment da barra de endereço
    // (token sai da URL visível/histórico; refresh usa o sessionStorage).
    window.history.replaceState(null, "", window.location.pathname);
    return capturado;
  }
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function OsQrClient() {
  const tokenRef = useRef<string | null>(null);
  const [estado, setEstado] = useState<ConsultaEstado | null>(null);
  const [sucesso, setSucesso] = useState<TransicaoResultado | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Segura a tela de status enquanto o navegador troca de página: sem isso o
  // usuário logado vê a lista de transições piscar antes do boletim abrir.
  const [redirecionando, setRedirecionando] = useState(false);

  // Devolve o estado além de guardá-lo: o efeito de abertura precisa do id_int
  // para decidir o redirecionamento, e ler isso de dentro de um setState seria
  // efeito colateral em updater — o StrictMode chamaria duas vezes.
  const consultar = useCallback(async (tokenAtual: string | null): Promise<ConsultaEstado | null> => {
    if (!tokenAtual) {
      const invalido: ConsultaEstado = { ok: false, motivo: "TOKEN_INVALIDO" };
      setEstado(invalido);
      setCarregando(false);
      return invalido;
    }
    try {
      const response = await fetch("/api/os-qr/consultar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenAtual })
      });
      const data = (await response.json()) as ConsultaEstado;
      setEstado(data);
      return data;
    } catch {
      setAviso("Falha de conexão. Tente novamente.");
      return null;
    } finally {
      setCarregando(false);
    }
  }, []);

  /**
   * Primeira leitura: quem já está logado no ERP (Produção, Admin, Super Admin)
   * vai direto para a edição do boletim; o celular do chão de fábrica, sem
   * sessão, fica na troca rápida de status.
   *
   * As duas chamadas saem juntas: a sessão não depende do token, e serializar
   * atrasaria a tela pública de quem não está logado — que é o caso comum.
   * `replace` em vez de `push`: o Voltar do navegador não deve trazer de volta
   * uma página que só ia redirecionar de novo.
   */
  useEffect(() => {
    tokenRef.current = capturarToken();
    const token = tokenRef.current;

    let cancelado = false;

    async function abrir() {
      const [sessao, dados] = await Promise.all([
        fetch("/api/os-qr/sessao", { cache: "no-store" })
          .then((r) => r.json() as Promise<{ autenticado?: boolean; podeEditar?: boolean }>)
          .catch(() => ({ autenticado: false, podeEditar: false })),
        consultar(token)
      ]);

      if (cancelado || !sessao?.podeEditar) return;
      // Sem id_int não há para onde ir: token inválido ou OS inexistente
      // continua na página pública, que já mostra o motivo.
      if (!dados?.ok || !dados.id_int) return;

      setRedirecionando(true);
      window.location.replace(`/pedidos/boletim?id_int=${dados.id_int}&modo=edicao`);
    }

    void abrir();
    return () => {
      cancelado = true;
    };
  }, [consultar]);

  async function transicionar(destino: Destino, motivo: string) {
    const token = tokenRef.current;
    if (!token || !estado?.ok || !estado.status_atual || enviando) return;
    setEnviando(true);
    setAviso(null);
    setSucesso(null);
    try {
      const response = await fetch("/api/os-qr/transicionar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          statusEsperado: estado.status_atual,
          statusDestino: destino.status,
          motivo: motivo || undefined
        })
      });
      const data = (await response.json()) as TransicaoResultado;
      if (data.ok) {
        setSucesso(data);
      } else if (data.motivo === "RATE_LIMITED") {
        setAviso("Muitas tentativas — aguarde um instante.");
      } else if (data.motivo === "CONFLITO") {
        setAviso("O status mudou em outra tela. A OS foi recarregada — confira antes de continuar.");
      } else if (data.motivo === "DESTINO_INVALIDO") {
        setAviso("Mudança não permitida para esta OS.");
      }
      // Sempre re-consulta para refletir o estado real (sucesso, conflito ou negativa).
      await consultar(token);
    } catch {
      setAviso("Falha de conexão. A ação pode não ter sido aplicada — recarregue.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) {
    return <Cartao titulo="Carregando...">Consultando a OS.</Cartao>;
  }

  if (redirecionando) {
    return <Cartao titulo="Abrindo o boletim...">Você está logado no sistema — abrindo a edição do boletim.</Cartao>;
  }

  return (
    <div className="space-y-4">
      {sucesso?.ok ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 shadow-sm">
          <p className="font-semibold">Status atualizado</p>
          <p className="mt-1">
            [{sucesso.status_anterior}] → [{sucesso.status_novo}]
          </p>
        </div>
      ) : null}

      {aviso ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">{aviso}</div>
      ) : null}

      {estado ? (
        // key remonta o painel quando o estado real da OS muda (pós-transição/
        // conflito), zerando seleção/motivo sem effect de sincronização.
        <EstadoOs
          key={`${estado.status_atual ?? ""}|${estado.motivo ?? ""}`}
          estado={estado}
          enviando={enviando}
          onTransicionar={transicionar}
        />
      ) : null}
    </div>
  );
}

function Cartao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-base font-bold text-slate-900">{titulo}</h1>
      <div className="mt-2 text-sm text-slate-600">{children}</div>
    </div>
  );
}

function EstadoOs({
  estado,
  enviando,
  onTransicionar
}: {
  estado: ConsultaEstado;
  enviando: boolean;
  onTransicionar: (destino: Destino, motivo: string) => void;
}) {
  const [selecionado, setSelecionado] = useState<Destino | null>(null);
  const [motivo, setMotivo] = useState("");
  const [armadoEntregue, setArmadoEntregue] = useState(false);
  const [mostrarOutros, setMostrarOutros] = useState(false);

  if (!estado.ok) {
    switch (estado.motivo) {
      case "TOKEN_REVOGADO":
        return <Cartao titulo="QR substituído">Este QR foi substituído. Solicite a via mais recente da OS.</Cartao>;
      case "CANCELADA":
        return <Cartao titulo={`OS #${estado.id_int ?? ""}`}>OS cancelada.</Cartao>;
      case "FINALIZADO":
        return (
          <Cartao titulo={`OS #${estado.id_int ?? ""}`}>
            {estado.produto_resumo ? <p>{estado.produto_resumo}</p> : null}
            <p className="mt-2">
              Status: <span className="font-semibold">{estado.status_atual}</span>
            </p>
            <p className="mt-2 font-medium text-emerald-700">Entrega concluída. Alterações somente pelo ERP.</p>
          </Cartao>
        );
      case "FORA_DO_FLUXO":
        return (
          <Cartao titulo={`OS #${estado.id_int ?? ""}`}>
            {estado.produto_resumo ? <p>{estado.produto_resumo}</p> : null}
            <p className="mt-2">
              Status: <span className="font-semibold">{estado.status_atual}</span>
            </p>
            <p className="mt-2">Etapa controlada pelo ERP.</p>
          </Cartao>
        );
      case "INDISPONIVEL":
        return <Cartao titulo="Serviço indisponível">Acompanhamento por QR Code desativado no momento.</Cartao>;
      case "ERRO_INTERNO":
        return <Cartao titulo="Erro no servidor">Não foi possível consultar a OS. Tente novamente em instantes.</Cartao>;
      case "RATE_LIMITED":
        return <Cartao titulo="Muitas tentativas">Aguarde um instante e recarregue a página.</Cartao>;
      case "TOKEN_INVALIDO":
      default:
        return <Cartao titulo="QR Code inválido">Verifique se o QR pertence a uma OS ativa.</Cartao>;
    }
  }

  const destinos = estado.destinos || [];
  const naturais = destinos.filter((d) => d.natural);
  // EXPEDICAO com forma de entrega indefinida: nenhum natural — os dois avanços
  // de entrega (sem motivo) aparecem em destaque, sem rótulo de "próxima etapa".
  const avancosEntrega = naturais.length === 0 ? destinos.filter((d) => d.tipo === "avanco_entrega" && !d.exige_motivo) : [];
  const destaqueKeys = new Set([...naturais, ...avancosEntrega].map((d) => d.status));
  const outros = destinos.filter((d) => !destaqueKeys.has(d.status));

  const isEntregue = selecionado?.status === "ENTREGUE";

  function confirmar() {
    if (!selecionado || enviando) return;
    if (isEntregue && !armadoEntregue) {
      // Confirmação reforçada: primeiro toque arma, segundo confirma.
      setArmadoEntregue(true);
      return;
    }
    onTransicionar(selecionado, motivo.trim());
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ordem de Serviço</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">OS #{estado.id_int}</h1>
      {estado.produto_resumo ? <p className="mt-2 text-sm text-slate-600">{estado.produto_resumo}</p> : null}
      <p className="mt-4 text-sm text-slate-600">
        Status atual:{" "}
        <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800">{estado.status_atual}</span>
      </p>

      {selecionado === null ? (
        <>
          {naturais.length > 0 ? (
            <div className="mt-6 space-y-2">
              {naturais.map((d) => (
                <button
                  key={d.status}
                  type="button"
                  onClick={() => setSelecionado(d)}
                  disabled={enviando}
                  className="w-full rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {d.tipo === "retomada" ? `Retomar: ${d.status}` : `Avançar para ${d.status}`}
                </button>
              ))}
            </div>
          ) : null}

          {avancosEntrega.length > 0 ? (
            <div className="mt-6 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Definir entrega</p>
              {avancosEntrega.map((d) => (
                <button
                  key={d.status}
                  type="button"
                  onClick={() => setSelecionado(d)}
                  disabled={enviando}
                  className="w-full rounded-2xl border border-emerald-600 bg-white px-4 py-3.5 text-sm font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-50 disabled:opacity-60"
                >
                  {d.status}
                </button>
              ))}
            </div>
          ) : null}

          {outros.length > 0 ? (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setMostrarOutros((v) => !v)}
                className="text-xs font-semibold uppercase tracking-wide text-slate-500 underline decoration-dotted underline-offset-4"
              >
                {mostrarOutros ? "Ocultar outros status" : `Outros status (${outros.length})`}
              </button>
              {mostrarOutros ? (
                <div className="mt-3 space-y-2">
                  {outros.map((d) => (
                    <button
                      key={d.status}
                      type="button"
                      onClick={() => setSelecionado(d)}
                      disabled={enviando}
                      className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                    >
                      <span>{d.status}</span>
                      <span className="ml-3 shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                        {TIPO_LABEL[d.tipo] || d.tipo}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="mt-4 text-center text-xs text-slate-400">O status só muda ao confirmar.</p>
        </>
      ) : (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-700">
            <span className="font-semibold">{estado.status_atual}</span>
            {" → "}
            <span className="font-semibold">{selecionado.status}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{TIPO_LABEL[selecionado.tipo] || selecionado.tipo}</p>

          <div className="mt-3">
            <label htmlFor="osqr-motivo" className="text-xs font-semibold text-slate-600">
              Motivo (opcional)
            </label>
            <textarea
              id="osqr-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder={MOTIVO_PLACEHOLDER[selecionado.tipo] || "Se quiser, registre uma observação"}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-800 outline-none focus:border-slate-500"
            />
          </div>

          {isEntregue ? (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-800">
              Entrega é etapa final: depois de confirmada, este QR não permite novas mudanças.
              {armadoEntregue ? " Toque novamente para confirmar." : ""}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSelecionado(null);
                setMotivo("");
                setArmadoEntregue(false);
              }}
              disabled={enviando}
              className="w-1/3 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={enviando}
              className={`w-2/3 rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-sm transition disabled:opacity-60 ${
                isEntregue && armadoEntregue ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {enviando
                ? "Atualizando..."
                : isEntregue
                  ? armadoEntregue
                    ? "Confirmar ENTREGUE agora"
                    : "Confirmar entrega"
                  : `Confirmar ${selecionado.status}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
