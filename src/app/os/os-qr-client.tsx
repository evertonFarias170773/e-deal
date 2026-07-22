"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Client da página pública do QR de produção.
 * - Captura o token do fragment (#), guarda em memória + sessionStorage e
 *   REMOVE o fragmento da barra de endereço (history.replaceState).
 * - Consulta o estado via POST (token no body) — nunca em URL de request.
 * - Um único botão avança exatamente uma etapa; nunca atualiza ao abrir.
 */

const SESSION_KEY = "osqr-token";

type ConsultaEstado = {
  ok: boolean;
  motivo?: string;
  id_int?: number;
  produto_resumo?: string;
  status_atual?: string;
  proximo_status?: string;
};

type AvancoResultado = {
  ok: boolean;
  motivo?: string;
  status_anterior?: string;
  status_novo?: string;
  status_atual?: string;
};

function capturarToken(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "").trim();
  if (hash) {
    try {
      window.sessionStorage.setItem(SESSION_KEY, hash);
    } catch {
      // sessionStorage indisponível — segue só com memória
    }
    // Remove o fragmento da barra de endereço (token sai da URL visível/histórico)
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return hash;
  }
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function OsQrClient() {
  const [token, setToken] = useState<string | null>(null);
  const [estado, setEstado] = useState<ConsultaEstado | null>(null);
  const [sucesso, setSucesso] = useState<AvancoResultado | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erroRede, setErroRede] = useState<string | null>(null);

  const consultar = useCallback(async (tokenAtual: string) => {
    setErroRede(null);
    try {
      const response = await fetch("/api/os-qr/consultar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenAtual })
      });
      const data = (await response.json()) as ConsultaEstado;
      setEstado(data);
    } catch {
      setErroRede("Falha de conexão. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const capturado = capturarToken();
    setToken(capturado);
    if (!capturado) {
      setEstado({ ok: false, motivo: "TOKEN_INVALIDO" });
      setCarregando(false);
      return;
    }
    void consultar(capturado);
  }, [consultar]);

  async function avancar() {
    if (!token || !estado?.ok || !estado.status_atual || enviando) return;
    setEnviando(true);
    setErroRede(null);
    try {
      const response = await fetch("/api/os-qr/avancar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, statusEsperado: estado.status_atual })
      });
      const data = (await response.json()) as AvancoResultado;
      if (data.ok) {
        setSucesso(data);
      } else if (data.motivo === "RATE_LIMITED") {
        setErroRede("Muitas tentativas — aguarde um instante.");
      }
      // Sempre re-consulta para refletir o estado real (sucesso, conflito ou negativa).
      await consultar(token);
    } catch {
      setErroRede("Falha de conexão. A ação pode não ter sido aplicada — recarregue.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) {
    return <Cartao titulo="Carregando...">Consultando a OS.</Cartao>;
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

      {erroRede ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">{erroRede}</div>
      ) : null}

      {estado ? <EstadoOs estado={estado} enviando={enviando} onAvancar={avancar} /> : null}
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
  onAvancar
}: {
  estado: ConsultaEstado;
  enviando: boolean;
  onAvancar: () => void;
}) {
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
            <p className="mt-2 font-medium text-emerald-700">Fluxo de produção concluído.</p>
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
      default:
        return <Cartao titulo="QR Code inválido">Verifique se o QR pertence a uma OS ativa.</Cartao>;
    }
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
      <button
        type="button"
        onClick={onAvancar}
        disabled={enviando}
        className="mt-6 w-full rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {enviando ? "Atualizando..." : `Avançar para ${estado.proximo_status}`}
      </button>
      <p className="mt-3 text-center text-xs text-slate-400">
        A etapa avança somente ao tocar no botão.
      </p>
    </div>
  );
}
