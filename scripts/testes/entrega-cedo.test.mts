/**
 * O aviso de entrega marcada cedo demais — a janela de 12 horas.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/entrega-cedo.test.mts
 *
 * Existe porque o valor do aviso está no ESCOPO: avisar onde não deve o
 * transforma em ruído diário, e ruído diário vira clique automático — que é
 * exatamente o hábito que ele veio combater.
 *
 * SÓ LEITURA na parte do banco; roda sem `PERMITIR_ESCRITA`.
 */
import { config as carregarEnv } from "dotenv";
import {
  avisoEntregaCedoDemais,
  HORAS_ENTREGA_SUSPEITA
} from "../../src/features/expedicao/lib/entrega-cedo.ts";
import type { PedidoExpedicao } from "../../src/features/expedicao/types.ts";

carregarEnv({ path: ".env.local", quiet: true });

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

const AGORA = new Date("2026-09-06T18:00:00Z").getTime();
const hAtras = (h: number) => new Date(AGORA - h * 3600_000).toISOString();

/** O mínimo que a função lê; o resto do pedido não participa da decisão. */
function pedido(tipoFrete: string, dataDespacho: string | null): PedidoExpedicao {
  return {
    idInt: 1,
    tipoFrete,
    expedicao: dataDespacho === null ? null : { dataDespacho }
  } as unknown as PedidoExpedicao;
}

// ── 1. Correios dentro da janela: avisa ─────────────────────────────────────
checar("Correios ha 1h avisa", typeof avisoEntregaCedoDemais(pedido("CORREIOS", hAtras(1)), AGORA), "string");
checar("Correios ha 11h59 ainda avisa",
  typeof avisoEntregaCedoDemais(pedido("CORREIOS", hAtras(11.98)), AGORA), "string");
checar("Correios ha 7 segundos avisa — o caso do 20943",
  typeof avisoEntregaCedoDemais(pedido("CORREIOS", new Date(AGORA - 7000).toISOString()), AGORA), "string");

// ── 2. A borda das 12 horas ─────────────────────────────────────────────────
checar("a janela e de 12 horas", HORAS_ENTREGA_SUSPEITA, 12);
checar("exatamente 12h NAO avisa", avisoEntregaCedoDemais(pedido("CORREIOS", hAtras(12)), AGORA), null);
checar("13h NAO avisa", avisoEntregaCedoDemais(pedido("CORREIOS", hAtras(13)), AGORA), null);
checar("4 dias NAO avisa", avisoEntregaCedoDemais(pedido("CORREIOS", hAtras(96)), AGORA), null);

// ── 3. ESCOPO: so Correios ──────────────────────────────────────────────────
// Retirada nem chega nesta funcao (passa por `confirmarRetirada`), mas a guarda
// existe: se um dia alguem reaproveitar o ponto, o escopo continua fechado.
for (const tipo of ["RETIRA_BALCAO", "TRANSPORTADORA", "MOTOBOY", "SEM_CUSTO", "INDEFINIDO"]) {
  checar(`${tipo} recem-despachado NAO avisa`, avisoEntregaCedoDemais(pedido(tipo, hAtras(0.1)), AGORA), null);
}

// ── 4. Sem data de despacho, sem aviso ──────────────────────────────────────
// Nao ha de quando contar as 12 horas, e inventar um ponto de partida seria pior
// que calar.
checar("Correios sem expedicao NAO avisa", avisoEntregaCedoDemais(pedido("CORREIOS", null), AGORA), null);
checar("Correios com data invalida NAO avisa",
  avisoEntregaCedoDemais(pedido("CORREIOS", "nao-e-data"), AGORA), null);
// Relogio da maquina atrasado nao e entrega cedo demais.
checar("despacho no futuro NAO avisa",
  avisoEntregaCedoDemais(pedido("CORREIOS", hAtras(-2)), AGORA), null);

// ── 5. O TEXTO E ESPECIFICO — nao um "tem certeza?" ─────────────────────────
const texto = avisoEntregaCedoDemais(pedido("CORREIOS", hAtras(2.5)), AGORA) ?? "";
checar("diz quanto tempo faz", texto.includes("2h30"), true);
checar("diz que o normal e demorar mais", texto.includes("costuma levar mais que isso"), true);
checar("diz que confirmar registra assim mesmo", texto.includes("fica registrada assim mesmo"), true);
checar("nao e um tem certeza generico", texto.toLowerCase().includes("tem certeza"), false);
checar("minutos aparecem quando e menos de uma hora",
  (avisoEntregaCedoDemais(pedido("CORREIOS", hAtras(0.75)), AGORA) ?? "").includes("45 min"), true);

// ── 6. Contra a base real: quantos avisariam AGORA ──────────────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.log("\n(pulando a parte do banco: .env.local sem chaves)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const { listarPainelExpedicao } = await import("../../src/features/expedicao/services/expedicao.service.ts");
  const pedidos = await listarPainelExpedicao();
  const emTransito = pedidos.filter((p) => p.etapa === "EM_TRANSITO");
  const agora = Date.now();

  console.log(`\nEM TRANSITO no painel: ${emTransito.length}`);
  for (const p of emTransito) {
    const aviso = avisoEntregaCedoDemais(p, agora);
    console.log(`   #${p.idInt} ${p.tipoFrete.padEnd(14)} ${aviso ? "AVISA" : "sem aviso"}`);
  }
  const avisariam = emTransito.filter((p) => avisoEntregaCedoDemais(p, agora) !== null);
  checar(
    "nenhum aviso fora dos Correios na base real",
    avisariam.every((p) => p.tipoFrete === "CORREIOS"),
    true
  );
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
