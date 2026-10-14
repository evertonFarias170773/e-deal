/**
 * Documento da nota aberto na mesma origem, com nome legível (14/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nome-documento-fiscal.test.mts
 *
 * O "Abrir PDF" do Histórico abria a URL do Storage, sem nome de arquivo, e o
 * botão de baixar do visualizador não salvava a NFS-e 138 (NFS-23733-001).
 *
 * O QUE PROVA
 *   1. O nome legível de NF-e e NFS-e, PDF e XML, com e sem número e pedido.
 *   2. Só os dois arquivos de uma nota passam como caminho.
 *   3. Nome fora do formato vira um nome neutro (nada de aspas ou barras no cabeçalho).
 *   4. O token sai da URL assinada e só passa se tiver forma de JWT.
 *   5. O endereço de abrir é relativo, na rota do Vibe.
 */
import {
  caminhoDoDocumento,
  enderecoParaAbrir,
  nomeDoDocumentoFiscal,
  nomeSeguro,
  tokenDaUrlAssinada,
  tokenDeAssinaturaValido
} from "../../src/lib/fiscal/nome-documento.ts";
import { nomeDoArquivoNfse } from "../../src/features/nfse/lib/regras-emissao.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

// ── 1. Nome legível ──────────────────────────────────────────────────────────
checar("NFS-e 138, PDF",
  nomeDoDocumentoFiscal({ modelo: "nfse", numero: "138", idInt: 23733, ref: "NFS-23733-001", tipo: "pdf" }),
  "NFS-e-138-Pedido-23733.pdf");
checar("NFS-e 138, XML",
  nomeDoDocumentoFiscal({ modelo: "nfse", numero: 138, idInt: 23733, ref: "NFS-23733-001", tipo: "xml" }),
  "NFS-e-138-Pedido-23733.xml");
checar("mesmo nome que a janela Gerar NFS-e ja usava",
  nomeDoDocumentoFiscal({ modelo: "nfse", numero: "138", idInt: 23733, ref: "NFS-23733-001", tipo: "pdf" }),
  nomeDoArquivoNfse({ numeroNfse: "138", idInt: 23733, ref: "NFS-23733-001", tipo: "pdf" }));
checar("NF-e com numero", nomeDoDocumentoFiscal({ modelo: "nfe", numero: "1002", idInt: 20370, ref: "NFE-20370-002", tipo: "pdf" }),
  "NF-e-1002-Pedido-20370.pdf");
checar("sem numero vai a ref", nomeDoDocumentoFiscal({ modelo: "nfe", numero: null, idInt: null, ref: "NFE-20370-002", tipo: "xml" }),
  "NF-e-NFE-20370-002.xml");

// ── 2. Caminho ───────────────────────────────────────────────────────────────
checar("caminhos validos",
  [caminhoDoDocumento("NFS-23733-001/danfe.pdf"), caminhoDoDocumento("NFE-21869-001/nfe.xml")],
  [{ caminho: "NFS-23733-001/danfe.pdf", tipo: "pdf" }, { caminho: "NFE-21869-001/nfe.xml", tipo: "xml" }]);
checar("caminhos recusados",
  ["../segredo/danfe.pdf", "NFS-1/../x/danfe.pdf", "NFS-23733-001/outro.pdf", "nfs-23733-001/danfe.pdf", "NFS-23733-001/danfe.pdf?x=1", "", null]
    .map((c) => caminhoDoDocumento(c)),
  [null, null, null, null, null, null, null]);

// ── 3. Nome seguro ───────────────────────────────────────────────────────────
checar("nome bom passa", nomeSeguro("NFS-e-138-Pedido-23733.pdf", "pdf"), "NFS-e-138-Pedido-23733.pdf");
checar("nome com aspas, barra ou extensao trocada vira neutro",
  [nomeSeguro('a".pdf', "pdf"), nomeSeguro("../x.pdf", "pdf"), nomeSeguro("NFS-e-138.xml", "pdf"), nomeSeguro(null, "xml")],
  ["documento.pdf", "documento.pdf", "documento.pdf", "documento.xml"]);

// ── 4. Token ─────────────────────────────────────────────────────────────────
const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJ4In0.abc_DEF-123";
checar("token da URL assinada",
  tokenDaUrlAssinada(`https://x.supabase.co/storage/v1/object/sign/nfe-documentos/NFS-23733-001/danfe.pdf?token=${jwt}`), jwt);
checar("tokens recusados",
  [tokenDeAssinaturaValido("abc"), tokenDeAssinaturaValido("a.b.c&x=1"), tokenDeAssinaturaValido(null), tokenDaUrlAssinada("nao e url")],
  [false, false, false, null]);

// ── 5. Endereço de abrir ─────────────────────────────────────────────────────
const endereco = enderecoParaAbrir("NFS-23733-001/danfe.pdf", jwt, "NFS-e-138-Pedido-23733.pdf");
const lido = new URL(endereco, "https://vibe.exemplo");
checar("endereco relativo na rota do Vibe", [endereco.startsWith("/api/fiscal/documento-nota?"), lido.searchParams.get("c"), lido.searchParams.get("t"), lido.searchParams.get("n")],
  [true, "NFS-23733-001/danfe.pdf", jwt, "NFS-e-138-Pedido-23733.pdf"]);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
