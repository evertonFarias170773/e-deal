"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ATRASO_PADRAO_MS = 400;

/** Devolve o valor só depois de ele parar de mudar pelo tempo informado. */
export function useDebouncedValue<T>(valor: T, atrasoMs: number = ATRASO_PADRAO_MS): T {
  const [valorAtrasado, setValorAtrasado] = useState(valor);

  useEffect(() => {
    const temporizador = setTimeout(() => setValorAtrasado(valor), atrasoMs);
    return () => clearTimeout(temporizador);
  }, [valor, atrasoMs]);

  return valorAtrasado;
}

/**
 * Campo de busca ligado à URL.
 *
 * O que o usuário digita aparece na hora (estado local), mas só é gravado na URL —
 * e, com isso, na consulta — depois da pausa. Quando o valor da URL muda por fora
 * (voltar/avançar do navegador, "Limpar filtros" ou um link aberto do zero), o campo
 * acompanha; digitação em curso não é sobrescrita, porque só sincronizamos quando a
 * URL difere do último valor que nós mesmos gravamos.
 */
export function useDebouncedInput(
  valorNaUrl: string,
  aoConfirmar: (valor: string) => void,
  atrasoMs: number = ATRASO_PADRAO_MS
): [string, (valor: string) => void] {
  const [valorDigitado, setValorDigitado] = useState(valorNaUrl);
  const ultimoConfirmadoRef = useRef(valorNaUrl);
  const aoConfirmarRef = useRef(aoConfirmar);

  useEffect(() => {
    aoConfirmarRef.current = aoConfirmar;
  }, [aoConfirmar]);

  useEffect(() => {
    if (valorNaUrl !== ultimoConfirmadoRef.current) {
      ultimoConfirmadoRef.current = valorNaUrl;
      setValorDigitado(valorNaUrl);
    }
  }, [valorNaUrl]);

  useEffect(() => {
    if (valorDigitado === ultimoConfirmadoRef.current) return;

    const temporizador = setTimeout(() => {
      ultimoConfirmadoRef.current = valorDigitado;
      aoConfirmarRef.current(valorDigitado);
    }, atrasoMs);

    return () => clearTimeout(temporizador);
  }, [valorDigitado, atrasoMs]);

  const alterar = useCallback((valor: string) => {
    setValorDigitado(valor);
  }, []);

  return [valorDigitado, alterar];
}
