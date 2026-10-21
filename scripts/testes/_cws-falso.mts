/**
 * Substituto de `@/lib/correios/cws` para testar a rota de prepostagem SEM falar com os Correios.
 * Conta quantas vezes `criarPrepostagem` foi chamada e devolve um codigo novo a cada chamada.
 */
export const correiosFalso = {
  chamadas: [] as unknown[],
  proximo: 1,
  falhar: null as Error | null,
  zerar() {
    this.chamadas = [];
    this.proximo = 1;
    this.falhar = null;
  }
};

export function correiosConfigurado() {
  return true;
}

export async function criarPrepostagem(input: unknown) {
  correiosFalso.chamadas.push(input);
  if (correiosFalso.falhar) throw correiosFalso.falhar;
  const n = correiosFalso.proximo++;
  return { id: `PRfalso${n}`, codigoObjeto: `AE00000000${n}BR` };
}
