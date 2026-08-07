"use client";

import { CalendarDays } from "lucide-react";
import {
  PERIOD_PRESET_LABELS,
  PERIOD_PRESET_VALUES,
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
 */
export function PeriodSelector({ preset, customIni, customFim, onChange }: PeriodSelectorProps) {
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
            value={customIni}
            max={customFim || undefined}
            onChange={(event) => onChange({ preset: "custom", ini: event.target.value })}
            className="rounded-2xl px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            style={inputStyle}
          />
          <span className="text-sm" style={{ color: "var(--primary-foreground)" }}>
            até
          </span>
          <input
            type="date"
            aria-label="Fim do período"
            value={customFim}
            min={customIni || undefined}
            onChange={(event) => onChange({ preset: "custom", fim: event.target.value })}
            className="rounded-2xl px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            style={inputStyle}
          />
        </>
      ) : null}
    </div>
  );
}
