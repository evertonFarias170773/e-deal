"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  PERIOD_PRESET_LABELS,
  PERIOD_PRESET_VALUES,
  ehDataDoPeriodo,
  type PeriodPreset
} from "@/lib/period";

type PeriodSelectorProps = {
  preset: PeriodPreset;
  /** Início/fim do período personalizado (YYYY-MM-DD); usados só em "custom". */
  customIni: string;
  customFim: string;
  onChange: (valor: { preset: PeriodPreset; ini?: string; fim?: string }) => void;
};

const inputStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  color: "var(--foreground)"
} as const;

/**
 * Seletor global de período do Dashboard: presets + intervalo personalizado.
 * Componente controlado — o dono do estado (URL) decide como persistir.
 *
 * Personalizado (05/11/2026): as duas datas são um rascunho local e só valem no
 * "Aplicar" (ou Enter). Antes cada tecla e cada clique no calendário gravava na
 * URL e recarregava a tela; o meio da digitação (ano "0026") virava período, e
 * apagar um campo fazia as duas datas voltarem ao mês atual. Também não há mais
 * trava de mínimo/máximo entre os campos: início depois do fim só desabilita o
 * Aplicar, com aviso.
 */
export function PeriodSelector({ preset, customIni, customFim, onChange }: PeriodSelectorProps) {
  const [rascunhoIni, setRascunhoIni] = useState(customIni);
  const [rascunhoFim, setRascunhoFim] = useState(customFim);
  const [aplicado, setAplicado] = useState({ ini: customIni, fim: customFim });

  // Quando o período aplicado muda (Aplicar, link, voltar do navegador), o rascunho acompanha.
  if (aplicado.ini !== customIni || aplicado.fim !== customFim) {
    setAplicado({ ini: customIni, fim: customFim });
    setRascunhoIni(customIni);
    setRascunhoFim(customFim);
  }

  const datasValidas = ehDataDoPeriodo(rascunhoIni) && ehDataDoPeriodo(rascunhoFim);
  const ordemInvertida = datasValidas && rascunhoIni > rascunhoFim;
  const mudou = rascunhoIni !== customIni || rascunhoFim !== customFim;
  const podeAplicar = datasValidas && !ordemInvertida && mudou;

  const aplicar = () => {
    if (podeAplicar) onChange({ preset: "custom", ini: rascunhoIni, fim: rascunhoFim });
  };

  const aoTeclar = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      aplicar();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="dashboard-periodo">
        Período de análise
      </label>
      <span
        className="hidden rounded-2xl p-2.5 sm:inline-flex"
        style={{ background: "var(--card)", color: "var(--muted)", border: "1px solid var(--border)" }}
      >
        <CalendarDays className="h-4 w-4" />
      </span>
      <select
        id="dashboard-periodo"
        value={preset}
        onChange={(event) => onChange({ preset: event.target.value as PeriodPreset })}
        className="rounded-2xl px-3 py-2.5 text-sm font-medium shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        style={inputStyle}
      >
        {PERIOD_PRESET_VALUES.map((valor) => (
          <option key={valor} value={valor}>
            {PERIOD_PRESET_LABELS[valor]}
          </option>
        ))}
      </select>
      {preset === "custom" ? (
        <>
          <input
            type="date"
            aria-label="Início do período"
            value={rascunhoIni}
            onChange={(event) => setRascunhoIni(event.target.value)}
            onKeyDown={aoTeclar}
            className="rounded-2xl px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            style={inputStyle}
          />
          <span className="text-sm" style={{ color: "var(--primary-foreground)" }}>
            até
          </span>
          <input
            type="date"
            aria-label="Fim do período"
            value={rascunhoFim}
            onChange={(event) => setRascunhoFim(event.target.value)}
            onKeyDown={aoTeclar}
            className="rounded-2xl px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={aplicar}
            disabled={!podeAplicar}
            className="rounded-2xl px-4 py-2 text-sm font-semibold shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "var(--accent)", color: "var(--primary-foreground)", border: "1px solid var(--accent)" }}
          >
            Aplicar
          </button>
          {ordemInvertida ? (
            <span role="alert" className="text-xs font-medium" style={{ color: "var(--primary-foreground)" }}>
              A data inicial é depois da final.
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
