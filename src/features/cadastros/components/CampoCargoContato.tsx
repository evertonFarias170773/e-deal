"use client";

import { CARGOS_DO_CONTATO, normalizarCargoContato } from "@/features/cadastros/lib/cargo-contato";

/**
 * Campo Cargo do contato (06/11/2026): lista com Comprador e Financeiro, ou
 * vazio. Usado em todo lugar que cria ou edita contato — cadastro do cliente e
 * as janelas de contato da proposta. Valor antigo fora da lista aparece já
 * convertido pela mesma regra da gravação (lib/cargo-contato).
 */
export function CampoCargoContato({
  value,
  onChange,
  className,
  disabled = false,
  id
}: {
  value: string | null | undefined;
  onChange: (cargo: string) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={normalizarCargoContato(value) ?? ""}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={className}
    >
      <option value="">Sem cargo</option>
      {CARGOS_DO_CONTATO.map((cargo) => (
        <option key={cargo} value={cargo}>
          {cargo}
        </option>
      ))}
    </select>
  );
}
