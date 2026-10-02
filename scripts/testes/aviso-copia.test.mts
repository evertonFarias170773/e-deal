/**
 * Testes do aviso que a proposta mostra quando é cópia ("Duplicar proposta").
 *
 *   node --experimental-strip-types scripts/testes/aviso-copia.test.mts
 *
 * O aviso não pode prometer o que a cópia não trouxe: cópia anterior à fase 1
 * de `copiar_proposta_v2` não levou cabeçalho, e cópia sem modelo marcado não
 * levou modelo. Rode depois de mexer em src/features/orcamentos/lib/aviso-copia.ts.
 */
import {
  COPIA_LEVA_CABECALHO_DESDE,
  contarModelosCopiados,
  copiaLevouCabecalho,
  montarAvisoDaCopia
} from "../../src/features/orcamentos/lib/aviso-copia.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

// — Corte: só a cópia feita pela função nova levou o cabeçalho —
checar("corte: copia de setembro nao levou", copiaLevouCabecalho("2026-09-14T11:24:32.14493+00:00"), false);
checar("corte: um segundo antes nao levou", copiaLevouCabecalho("2026-10-02T17:59:59+00:00"), false);
checar("corte: no instante da funcao nova, levou", copiaLevouCabecalho(COPIA_LEVA_CABECALHO_DESDE), true);
checar("corte: copia de depois levou", copiaLevouCabecalho("2026-10-03T12:00:00+00:00"), true);
checar("corte: horario de Brasilia e convertido", copiaLevouCabecalho("2026-10-02T15:30:00-03:00"), true);
checar("corte: data vazia nunca vira aviso", copiaLevouCabecalho(null), false);
checar("corte: data ilegivel nunca vira aviso", copiaLevouCabecalho("ontem"), false);

// — Modelos: conta só os que carregam a marca gravada pela cópia —
checar(
  "modelos: conta a marca e ignora o resto",
  contarModelosCopiados(["Cópia do pedido #21778", "  Cópia do pedido #21778  ", "arte nova", null, undefined, ""]),
  2
);
checar("modelos: marca seguida de texto do boletim ainda conta", contarModelosCopiados(["Cópia do pedido #21778 - trocar logo"]), 1);
checar("modelos: marca no meio do texto nao conta", contarModelosCopiados(["ver Cópia do pedido #21778"]), 0);
checar("modelos: sem numero nao conta", contarModelosCopiados(["Cópia do pedido #"]), 0);
checar("modelos: lista vazia", contarModelosCopiados([]), 0);

// — Texto: CIF (ou sem modalidade) pede cotacao nova —
const cif = montarAvisoDaCopia({ idIntOrigem: 21778, modalidade: "CIF", avulsa: false, modelosCopiados: 0 });
checar("cif: titulo com o numero da original", cif.titulo, "Cópia da proposta #21778");
checar("cif: tres linhas, sem falar de modelo", cif.linhas.length, 3);
checar("cif: pede cotacao nova", cif.linhas[1], "O frete não foi copiado: escolha a cotação de novo.");
checar(
  "sem modalidade: mesma linha do CIF",
  montarAvisoDaCopia({ idIntOrigem: 1, modalidade: null, avulsa: false, modelosCopiados: 0 }).linhas[1],
  "O frete não foi copiado: escolha a cotação de novo."
);

// — Texto: Retira e FOB falam da declaracao que veio —
checar(
  "retira: avisa que a modalidade veio",
  montarAvisoDaCopia({ idIntOrigem: 1, modalidade: "RETIRA", avulsa: false, modelosCopiados: 0 }).linhas[1].startsWith("A modalidade Retira veio da original."),
  true
);
checar(
  "fob: avisa da transportadora",
  montarAvisoDaCopia({ idIntOrigem: 1, modalidade: "FOB", avulsa: false, modelosCopiados: 0 }).linhas[1],
  "A modalidade FOB e a transportadora vieram da original. Confira quem vai retirar."
);

// — Texto: avulsa nao tem produto nem cotacao —
const avulsa = montarAvisoDaCopia({ idIntOrigem: 22740, modalidade: "CIF", avulsa: true, modelosCopiados: 0 });
checar("avulsa: duas linhas, sem a de preco", avulsa.linhas.length, 2);
checar("avulsa: pede o frete de novo", avulsa.linhas[1], "O frete não foi copiado: informe o valor de novo.");

// — Texto: modelos copiados entram por ultimo, com singular e plural —
const comModelos = montarAvisoDaCopia({ idIntOrigem: 21778, modalidade: "RETIRA", avulsa: false, modelosCopiados: 21 });
checar("modelos: quarta linha", comModelos.linhas.length, 4);
checar(
  "modelos: plural e aviso de numeracao repetida",
  comModelos.linhas[3],
  "21 modelos vieram com a mesma numeração da original e com a arte pendente. Confira a numeração na aba Pedido: se for o mesmo evento, ela vai se repetir."
);
checar(
  "modelos: singular",
  montarAvisoDaCopia({ idIntOrigem: 1, modalidade: "CIF", avulsa: false, modelosCopiados: 1 }).linhas[3].startsWith("1 modelo veio com a mesma numeração"),
  true
);

// — Original apagada: o titulo nao inventa numero —
checar(
  "sem origem: titulo generico",
  montarAvisoDaCopia({ idIntOrigem: null, modalidade: "CIF", avulsa: false, modelosCopiados: 0 }).titulo,
  "Esta proposta é uma cópia"
);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
