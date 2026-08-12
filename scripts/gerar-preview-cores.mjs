/**
 * Gera `public.producao_cores.preview_base64` a partir de `pdf_base64`.
 *
 * POR QUE ESTE SCRIPT EXISTE
 *   `pdf_base64` guarda PDF e a tela precisa de imagem (<img>). Postgres nao
 *   rasteriza PDF, entao nao da para fazer isso em trigger/function no banco: a
 *   conversao precisa de um renderizador. Aqui ela roda no Chromium do
 *   Playwright (ja instalado como devDependency) com pdf.js carregado de CDN —
 *   nenhuma dependencia nova entra na aplicacao.
 *
 * QUANDO RODAR
 *   Sempre que uma cor/padrao novo for cadastrado direto no Supabase com PDF —
 *   a aplicacao so le `producao_cores`, nunca escreve, entao nada preenche a
 *   previa sozinho. Sem previa, a cor nao aparece no card do modelo (aba
 *   Pedido) nem no PDF do boletim.
 *
 * COMO RODAR (na raiz do projeto)
 *   node scripts/gerar-preview-cores.mjs                    # lista o que falta
 *   node scripts/gerar-preview-cores.mjs --aplicar          # converte o que falta
 *   node scripts/gerar-preview-cores.mjs --aplicar --nome "Verde Agua"
 *
 *   `--nome` reconverte uma cor especifica mesmo que ja tenha previa. Use
 *   quando trocar o PDF de uma cor: a previa e um snapshot e nao acompanha.
 *
 * PARAMETROS
 *   Pagina 1, largura alvo 1400px, JPEG qualidade 0,85, fundo branco — os
 *   mesmos do lote inicial, para as previas ficarem uniformes.
 *
 * CREDENCIAIS
 *   Le NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY do .env.local
 *   (a policy "Permitir escrita de cores para anon" ja cobre a escrita).
 *   Escreve SOMENTE a coluna preview_base64; pdf_base64 nunca e tocado.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Resolvido a partir do arquivo, nao do diretorio atual: o script funciona
// mesmo chamado de fora da raiz do projeto.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), quiet: true });

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const CHAVE_SUPABASE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL_SUPABASE || !CHAVE_SUPABASE) {
  console.error("Faltou NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local.");
  process.exit(1);
}

const APLICAR = process.argv.includes("--aplicar");
const indiceNome = process.argv.indexOf("--nome");
const NOME = indiceNome >= 0 ? process.argv[indiceNome + 1] : null;

const LARGURA_ALVO = 1400;
const QUALIDADE_JPEG = 0.85;
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build";

const supabase = createClient(URL_SUPABASE, CHAVE_SUPABASE, { auth: { persistSession: false } });

const consulta = supabase
  .from("producao_cores")
  .select("id, name, pdf_base64")
  .not("pdf_base64", "is", null);

// Sem --nome, converte apenas quem ainda nao tem previa.
const { data: cores, error } = NOME
  ? await consulta.eq("name", NOME)
  : await consulta.is("preview_base64", null);

if (error) {
  console.error("Erro ao ler producao_cores:", error.message);
  process.exit(1);
}

if (!cores?.length) {
  console.log(NOME ? `Nenhuma cor com PDF chamada "${NOME}".` : "Nada a fazer: toda cor com PDF ja tem previa.");
  process.exit(0);
}

console.log(`Cores a converter (${cores.length}): ${cores.map((cor) => cor.name).join(", ")}`);

if (!APLICAR) {
  console.log("\nSimulacao — rode de novo com --aplicar para gravar.");
  process.exit(0);
}

// Import tardio: a simulacao nao precisa subir o Chromium (e o carregamento do
// Playwright deixava um handle aberto que sujava a saida do processo).
const { chromium } = await import("playwright");
const navegador = await chromium.launch();
const pagina = await navegador.newPage();
pagina.on("console", (msg) => msg.type() === "error" && console.error("  [chromium]", msg.text()));

await pagina.setContent("<!doctype html><meta charset=\"utf-8\"><body></body>");
await pagina.addScriptTag({ url: `${PDFJS}/pdf.min.js` });
await pagina.waitForFunction(() => Boolean(window.pdfjsLib), null, { timeout: 30000 });

let convertidas = 0;
let falhas = 0;

for (const cor of cores) {
  process.stdout.write(`- ${cor.name} ... `);
  try {
    const jpeg = await pagina.evaluate(
      async ({ dataUri, larguraAlvo, qualidade, workerSrc }) => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

        const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
        const binario = atob(base64);
        const bytes = new Uint8Array(binario.length);
        for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);

        const documento = await window.pdfjsLib.getDocument({ data: bytes }).promise;
        const primeiraPagina = await documento.getPage(1);

        const original = primeiraPagina.getViewport({ scale: 1 });
        const viewport = primeiraPagina.getViewport({ scale: larguraAlvo / original.width });

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const contexto = canvas.getContext("2d");

        // JPEG nao tem transparencia e o PDF costuma vir sem fundo proprio.
        contexto.fillStyle = "#ffffff";
        contexto.fillRect(0, 0, canvas.width, canvas.height);

        await primeiraPagina.render({ canvasContext: contexto, viewport }).promise;
        return canvas.toDataURL("image/jpeg", qualidade);
      },
      {
        dataUri: cor.pdf_base64,
        larguraAlvo: LARGURA_ALVO,
        qualidade: QUALIDADE_JPEG,
        workerSrc: `${PDFJS}/pdf.worker.min.js`
      }
    );

    if (!jpeg?.startsWith("data:image/jpeg;base64,")) {
      throw new Error("o retorno nao e um JPEG Data URI");
    }

    const { error: erroUpdate } = await supabase
      .from("producao_cores")
      .update({ preview_base64: jpeg })
      .eq("id", cor.id);

    if (erroUpdate) throw new Error(erroUpdate.message);

    console.log(`ok (${Math.round(jpeg.length / 1024)} KB)`);
    convertidas += 1;
  } catch (erro) {
    console.log(`FALHOU — ${erro.message}`);
    falhas += 1;
  }
}

await navegador.close();
console.log(`\nConvertidas: ${convertidas} | Falhas: ${falhas}`);
process.exit(falhas === 0 ? 0 : 1);
