/**
 * Prepostagem na TELA: o segundo clique na mesma sessao abre a confirmacao (21/10/2026).
 *
 * Renderiza o DespacharModal REAL num navegador (Playwright), com o servidor e os Correios SIMULADOS: a rota
 * `/api/expedicao/correios/prepostagem` e respondida pelo proprio teste, usando a MESMA funcao de decisao
 * (`decidirGeracaoPrepostagem`) que o servidor usa. Nenhuma requisicao sai da maquina; nada e gerado.
 *
 *   # 1) o pacote da tela (esbuild via npx; usa scratch/prova-prepostagem/*)
 *   npx --yes esbuild scratch/prova-prepostagem/harness.tsx --bundle --outfile=scratch/prova-prepostagem/bundle.js \
 *     --jsx=automatic --tsconfig=scratch/prova-prepostagem/tsconfig.json --loader:.json=json \
 *     --define:process.env.NODE_ENV='"development"'
 *   # 2) o teste
 *   node --experimental-strip-types scripts/testes/prepostagem-regeracao-tela.test.mts
 *
 * O harness fica em `scratch/` (ignorado pelo git): sem ele o teste avisa e termina sem falhar.
 */
import { existsSync, readFileSync } from "node:fs";
import { decidirGeracaoPrepostagem } from "../../src/features/expedicao/lib/regeracao-prepostagem.ts";

if (!existsSync("scratch/prova-prepostagem/bundle.js")) {
  console.log("sem scratch/prova-prepostagem/bundle.js: monte o pacote (ver o topo deste arquivo). Nada foi testado.");
  process.exit(0);
}
const { chromium } = await import("playwright");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

const vm = JSON.parse(readFileSync("scratch/prova-prepostagem/vm.json", "utf8"));
const html = readFileSync("scratch/prova-prepostagem/index.html", "utf8");
const bundle = readFileSync("scratch/prova-prepostagem/bundle.js", "utf8");

type Servidor = { codigoGravado: string | null; geradas: number; corpos: Array<Record<string, unknown>>; atrasoMs: number };

async function abrir(browser: Awaited<ReturnType<typeof chromium.launch>>, servidor: Servidor) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url === "http://prova.local/") return route.fulfill({ status: 200, contentType: "text/html", body: html });
    if (url === "http://prova.local/bundle.js") return route.fulfill({ status: 200, contentType: "application/javascript", body: bundle });
    if (url.includes("cdn.tailwindcss.com")) return route.continue();
    if (url.endsWith("/api/expedicao/correios/status")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configurado: true }) });
    if (url.includes("/api/expedicao/etiqueta/previa")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, vm }) });
    if (url.endsWith("/api/expedicao/correios/prepostagem") && req.method() === "POST") {
      const corpo = JSON.parse(req.postData() ?? "{}") as { substituir?: boolean; codigo_visto?: string };
      servidor.corpos.push(corpo);
      if (servidor.atrasoMs) await new Promise((r) => setTimeout(r, servidor.atrasoMs));
      const decisao = decidirGeracaoPrepostagem({
        exp: servidor.codigoGravado ? { correios_codigo_objeto: servidor.codigoGravado } : null,
        substituir: corpo.substituir === true,
        codigoVisto: corpo.codigo_visto
      });
      if (decisao.acao === "recusar") {
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, code: decisao.code, message: decisao.message, codigoAtual: decisao.codigoAtual }) });
      }
      servidor.geradas++;
      servidor.codigoGravado = `AE00000000${servidor.geradas}BR`;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, codigoObjeto: servidor.codigoGravado }) });
    }
    if (url.startsWith("http://prova.local/api/")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: false, message: "simulado" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  if (process.env.DEBUG_TELA) page.on("console", (m) => console.log("  [console]", m.type(), m.text().slice(0, 200)));
  if (process.env.DEBUG_TELA) page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
  await page.goto("http://prova.local/");
  await page.getByRole("button", { name: "Gerar prepostagem SEDEX" }).waitFor({ timeout: 30000 });
  // espera a previa carregar (o botao fica habilitado quando nao faltam dados)
  await page.waitForTimeout(1500);
  return page;
}

const dialogo = (page: Awaited<ReturnType<typeof abrir>>) => page.getByRole("dialog").filter({ hasText: "Gerar outra prepostagem?" });
const botaoSedex = (page: Awaited<ReturnType<typeof abrir>>) => page.getByRole("button", { name: /Gerar prepostagem SEDEX|Gerando/ }).first();

const browser = await chromium.launch({ headless: true });
try {
  // ── A. a mesma sessao: gerar, clicar de novo, confirmar
  console.log("== A. mesma sessao ==");
  {
    const servidor: Servidor = { codigoGravado: null, geradas: 0, corpos: [], atrasoMs: 0 };
    const page = await abrir(browser, servidor);
    const habilitado = await botaoSedex(page).isEnabled();
    confere("o botao SEDEX esta habilitado ao abrir (dados completos)", habilitado);

    await botaoSedex(page).click();
    await page.getByText(/Prepostagem já gerada \(AE000000001BR\)/).waitFor({ timeout: 10000 });
    confere("primeira geracao: UMA chamada, sem substituir (como antes)", servidor.corpos.length === 1 && servidor.corpos[0].substituir === undefined, servidor.corpos);
    confere("o aviso da conferencia mostra o codigo gerado", await page.getByText(/Prepostagem já gerada \(AE000000001BR\)/).isVisible());
    await page.screenshot({ path: "scratch/prova-prepostagem/1-gerada.png", fullPage: true });

    await botaoSedex(page).click();
    await dialogo(page).waitFor({ timeout: 10000 });
    confere("SEGUNDO clique na mesma sessao: abre a confirmacao", await dialogo(page).isVisible());
    confere("a confirmacao mostra o codigo atual (o gerado agora)", (await dialogo(page).textContent())?.includes("AE000000001BR") === true);
    confere("e NAO chamou o servidor de novo", servidor.corpos.length === 1 && servidor.geradas === 1, servidor.corpos.length);
    await page.screenshot({ path: "scratch/prova-prepostagem/2-confirmacao.png", fullPage: true });

    await dialogo(page).getByRole("button", { name: "Cancelar" }).click();
    confere("Cancelar: nada e gerado", servidor.corpos.length === 1 && servidor.geradas === 1);

    await botaoSedex(page).click();
    await dialogo(page).waitFor({ timeout: 10000 });
    await dialogo(page).getByRole("button", { name: "Gerar SEDEX" }).click();
    await page.getByText(/Prepostagem já gerada \(AE000000002BR\)/).waitFor({ timeout: 10000 });
    confere("confirmar: manda substituir e o codigo que o usuario viu", servidor.corpos.length === 2 && servidor.corpos[1].substituir === true && servidor.corpos[1].codigo_visto === "AE000000001BR", servidor.corpos);
    confere("e o servidor gerou a segunda (so agora)", servidor.geradas === 2);

    await botaoSedex(page).click();
    await dialogo(page).waitFor({ timeout: 10000 });
    const texto = (await dialogo(page).textContent()) ?? "";
    confere("terceiro clique: confirmacao de novo, com o codigo atual e o que sai do registro", texto.includes("AE000000002BR") && texto.includes("AE000000001BR"), texto.slice(0, 300));
    await page.screenshot({ path: "scratch/prova-prepostagem/3-terceira.png", fullPage: true });
    await page.close();
  }

  // ── B. aba obsoleta: o servidor ja tem prepostagem que a tela nao conhecia
  console.log("== B. a tela nao conhecia a prepostagem ==");
  {
    const servidor: Servidor = { codigoGravado: "AE055259112BR", geradas: 0, corpos: [], atrasoMs: 0 };
    const page = await abrir(browser, servidor);
    await botaoSedex(page).click();
    await dialogo(page).waitFor({ timeout: 10000 });
    confere("o servidor recusou (409) e NADA foi gerado", servidor.corpos.length === 1 && servidor.geradas === 0, servidor.corpos);
    confere("a tela abre a confirmacao com o codigo que o servidor informou", (await dialogo(page).textContent())?.includes("AE055259112BR") === true);
    await page.screenshot({ path: "scratch/prova-prepostagem/4-aba-obsoleta.png", fullPage: true });
    await dialogo(page).getByRole("button", { name: "Gerar SEDEX" }).click();
    await page.getByText(/Prepostagem já gerada \(AE000000001BR\)/).waitFor({ timeout: 10000 });
    confere("confirmando, manda o codigo informado pelo servidor e gera", servidor.corpos[1]?.substituir === true && servidor.corpos[1]?.codigo_visto === "AE055259112BR" && servidor.geradas === 1, servidor.corpos);
    await page.close();
  }

  // ── C. clique duplo enquanto gera
  console.log("== C. duplo clique ==");
  {
    const servidor: Servidor = { codigoGravado: null, geradas: 0, corpos: [], atrasoMs: 800 };
    const page = await abrir(browser, servidor);
    const sedex = botaoSedex(page);
    await sedex.click({ noWaitAfter: true });
    await sedex.click({ noWaitAfter: true, force: true, timeout: 2000 }).catch(() => undefined);
    await page.getByRole("button", { name: "Gerando..." }).waitFor({ timeout: 5000 });
    confere("enquanto gera, SEDEX e PAC ficam desabilitados", (await page.getByRole("button", { name: "Gerando..." }).isDisabled()) && (await page.getByRole("button", { name: "PAC", exact: true }).isDisabled()));
    await page.getByText(/Prepostagem já gerada \(AE000000001BR\)/).waitFor({ timeout: 10000 });
    confere("dois cliques seguidos geram UMA prepostagem so", servidor.corpos.length === 1 && servidor.geradas === 1, servidor.corpos);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
