/**
 * QR do boletim/OS traz só o número do pedido (09/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/qr-do-boletim.test.mts
 *
 * O QUE PROVA
 *   1. O conteúdo do QR é exatamente os dígitos do `id_int`: sem prefixo, sem
 *      link, sem espaço, sem quebra de linha. Número inválido não gera QR.
 *   2. Com as opções da rota o código sai na versão 1 (21 × 21), em modo
 *      numérico, correção H e zona de silêncio de 4 módulos — para 3, 5 e 7
 *      dígitos.
 *   3. A rota de impressão usa essa função e não monta mais link nem token.
 *   4. As rotas públicas `/api/os-qr/*` seguem aceitando SÓ o token: nenhuma lê
 *      número de pedido do corpo, e nenhuma conhece o QR novo.
 *
 * Sem banco e sem rede. A leitura do QR no PDF rasterizado (jsQR, 150 dpi) é a
 * prova de scratch/qr-boletim-*, fora da suíte por depender de biblioteca que o
 * projeto não tem.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { OPCOES_QR_DO_BOLETIM, conteudoQrDoBoletim } from "../../src/features/pedidos/lib/qr-do-boletim.ts";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");
const QRCode = createRequire(import.meta.url)("qrcode");

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

// ── 1. Conteúdo ─────────────────────────────────────────────────────────────
checar("23380 vira 23380", conteudoQrDoBoletim(23380), "23380");
checar("número curto", conteudoQrDoBoletim(987), "987");
checar("número longo", conteudoQrDoBoletim(1234567), "1234567");
checar("texto com espaço e quebra de linha sai limpo", conteudoQrDoBoletim(" 23380\n"), "23380");
checar("zero à esquerda não entra", conteudoQrDoBoletim("023380"), "23380");
for (const id of [23380, 987, 1234567, "23380"]) {
  checar(`só dígitos (${JSON.stringify(id)})`, /^[0-9]+$/.test(conteudoQrDoBoletim(id) ?? ""), true);
}
checar(
  "número inválido não gera QR",
  [0, -5, 1.5, Number.NaN, null, undefined, "", "abc", "23380-A", "https://x/pedidos/boletim?id_int=23380"].map(conteudoQrDoBoletim),
  [null, null, null, null, null, null, null, null, null, null]
);

// ── 2. O código gerado ──────────────────────────────────────────────────────
checar("opções da rota", OPCOES_QR_DO_BOLETIM, {
  errorCorrectionLevel: "H",
  margin: 4,
  scale: 16,
  color: { dark: "#000000", light: "#ffffff" }
});
for (const id of [987, 23380, 1234567]) {
  const qr = QRCode.create(conteudoQrDoBoletim(id), OPCOES_QR_DO_BOLETIM);
  checar(`#${id}: versão 1, 21 módulos`, [qr.version, qr.modules.size], [1, 21]);
  checar(`#${id}: um segmento numérico com os dígitos`, qr.segments.map((s: { mode: { id: string }; data: string }) => [s.mode.id, s.data]), [["Numeric", String(id)]]);
  checar(`#${id}: correção H`, qr.errorCorrectionLevel.bit, 2);
}

// ── 3. A rota de impressão ──────────────────────────────────────────────────
const rota = readFileSync(path.join(RAIZ, "src/app/api/pedidos/imprimir-os/route.ts"), "utf8");
checar("rota usa conteudoQrDoBoletim(idInt)", rota.includes("conteudoQrDoBoletim(idInt)"), true);
checar("rota gera com OPCOES_QR_DO_BOLETIM", rota.includes("QRCode.toDataURL(qrConteudo, OPCOES_QR_DO_BOLETIM)"), true);
checar("rota tem um único QRCode.toDataURL", rota.split("QRCode.toDataURL(").length - 1, 1);
checar("rota não monta mais o link do boletim", rota.includes("/pedidos/boletim?id_int="), false);
checar("rota não monta mais o link público", rota.includes("/os?t="), false);
checar("rota não emite mais token do QR público", /os-qr-token|obterOuEmitirTokenOsQr|osQrFlagAtiva/.test(rota), false);

// ── 4. Rotas públicas do QR intactas ────────────────────────────────────────
for (const nome of ["consultar", "avancar", "transicionar"]) {
  const fonte = readFileSync(path.join(RAIZ, `src/app/api/os-qr/${nome}/route.ts`), "utf8");
  checar(`os-qr/${nome}: lê o token do corpo`, fonte.includes('typeof body?.token === "string"'), true);
  checar(`os-qr/${nome}: chama a função com p_token`, fonte.includes("p_token: token"), true);
  checar(`os-qr/${nome}: não lê número de pedido do corpo`, /body\??\.(id_int|idInt|numero|pedido)/.test(fonte), false);
  checar(`os-qr/${nome}: não conhece o QR novo`, fonte.includes("qr-do-boletim"), false);
}

if (falhas > 0) {
  console.log(`\n${falhas} verificacao(oes) falharam.`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
