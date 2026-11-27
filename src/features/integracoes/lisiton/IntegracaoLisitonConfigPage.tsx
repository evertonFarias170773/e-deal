"use client";

/**
 * Configurações > Integração Lisiton (27/11/2026).
 *
 * A empresa em que nascem os pedidos criados pela API da Lisiton
 * (POST /api/v1/lisiton/pedidos). Leitura de `integracao_lisiton_config`;
 * gravação só pela função do banco `lisiton_config_definir_empresa`, que confere
 * a permissão "Configurar Integrações" (config.integracoes) ou ADM. Vale para os
 * pedidos criados DEPOIS da troca; os já criados ficam como estão.
 */
import { useCallback, useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/formatters/date";
import { EMPRESAS_RECEBEDORAS_FIXAS } from "@/features/cobrancas/cobrancas-utils";

type Config = { id_empresa: number; atualizado_por_nome: string | null; atualizado_em: string | null };

export function IntegracaoLisitonConfigPage() {
  const { showToast } = useAppToast();
  const [config, setConfig] = useState<Config | null>(null);
  const [escolhida, setEscolhida] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const ler = useCallback(async (): Promise<Config | null> => {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client
      .from("integracao_lisiton_config")
      .select("id_empresa, atualizado_por_nome, atualizado_em")
      .eq("id", true)
      .maybeSingle<Config>();
    return error || !data ? null : data;
  }, []);

  const aplicar = useCallback((data: Config | null) => {
    if (!data) {
      setErro("Não foi possível ler a configuração da integração.");
      return;
    }
    setErro(null);
    setConfig(data);
    setEscolhida(Number(data.id_empresa));
  }, []);

  const carregar = useCallback(async () => aplicar(await ler()), [aplicar, ler]);

  useEffect(() => {
    let vivo = true;
    void ler().then((data) => {
      if (vivo) aplicar(data);
    });
    return () => {
      vivo = false;
    };
  }, [ler, aplicar]);

  async function salvar() {
    if (escolhida === null || !config || escolhida === Number(config.id_empresa)) return;
    const client = getSupabaseClient();
    if (!client) return;
    setSalvando(true);
    const { error } = await client.rpc("lisiton_config_definir_empresa", { p_id_empresa: escolhida });
    setSalvando(false);
    if (error) {
      showToast({
        type: "error",
        title: "Empresa não trocada",
        description: /PERM/.test(error.message) ? "Você não tem a permissão Configurar Integrações." : error.message
      });
      return;
    }
    showToast({ type: "success", title: "Empresa da integração trocada", description: "Vale para os próximos pedidos da Lisiton." });
    await carregar();
  }

  const atual = EMPRESAS_RECEBEDORAS_FIXAS.find((e) => e.id === Number(config?.id_empresa));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-3 border-b pb-5" style={{ borderColor: "var(--border)" }}>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-foreground dark:bg-neutral-900">
          <Cpu className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Integração Lisiton</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Empresa em que nascem os pedidos que o sistema da Lisiton cria pela API (cliente 8469).
          </p>
        </div>
      </div>

      {erro ? (
        <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{erro}</p>
      ) : !config ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <div className="space-y-4 rounded-3xl border p-6" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm">
            Empresa atual: <strong>{atual?.labelCurta ?? `#${config.id_empresa}`}</strong>
            {config.atualizado_em ? (
              <span className="text-muted-foreground">
                {" "}
                (definida em {formatDateTime(config.atualizado_em)}
                {config.atualizado_por_nome ? ` por ${config.atualizado_por_nome}` : ""})
              </span>
            ) : null}
          </p>
          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-muted-foreground">Empresa dos próximos pedidos</legend>
            {EMPRESAS_RECEBEDORAS_FIXAS.map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="empresa-lisiton" checked={escolhida === e.id} disabled={salvando} onChange={() => setEscolhida(e.id)} />
                {e.labelCurta} <span className="text-xs text-muted-foreground">({e.nome})</span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            A troca vale para os pedidos criados depois dela. Os pedidos já criados continuam na empresa em que nasceram.
          </p>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando || escolhida === null || escolhida === Number(config.id_empresa)}
            className="rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {salvando ? "Salvando..." : "Salvar empresa"}
          </button>
        </div>
      )}
    </div>
  );
}
