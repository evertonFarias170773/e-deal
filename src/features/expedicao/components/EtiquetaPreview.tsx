"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { EtiquetaViewModel } from "../services/etiqueta-viewmodel.service";
import {
  ETIQUETA_ALTURA_PT,
  ETIQUETA_LARGURA_PT,
  ETIQUETA_PADDING_PT,
  apresentacaoEtiqueta
} from "../lib/etiqueta-apresentacao";

/**
 * PREVIA DA ETIQUETA 10x15 EM HTML — o mesmo desenho do PDF, na tela (04/09/2026).
 *
 * O QUE E, E O QUE NAO E
 *   E uma REPRESENTACAO do `EtiquetaPdfDocument`, para o expedidor ver como o
 *   papel vai sair enquanto preenche o despacho. NAO substitui o PDF: o artefato
 *   impresso continua sendo gerado pela rota, com `@react-pdf/renderer`.
 *
 * COMO GARANTE QUE E IGUAL AO PAPEL
 *   - Os DADOS vem do mesmo view model (`montarEtiquetaViewModel`), servido em
 *     JSON pela rota `/api/expedicao/etiqueta/previa`;
 *   - as REGRAS DE CONTEUDO (corte da observacao, cidade/UF, linha do telefone,
 *     "A DEFINIR", "—") vem de `lib/etiqueta-apresentacao.ts`, o mesmo modulo
 *     que o PDF importa;
 *   - o DESENHO espelha bloco a bloco os `styles` do PDF, em pontos: a etiqueta
 *     e montada no tamanho NATIVO (283,46 x 425,2 pt, 1 pt = 1 px) e escalada
 *     por `transform` para a largura disponivel — as proporcoes sao as do
 *     papel em qualquer largura de tela.
 *
 *   O que NAO da para compartilhar e a marcacao: `View`/`Text` do react-pdf
 *   nao renderizam no DOM. Por isso os estilos abaixo REPETEM os do PDF, um a
 *   um e na mesma ordem. Mudou la, muda aqui — e a lista de estilos e curta de
 *   proposito para essa conferencia caber num olhar.
 *
 * DOIS MODOS, UM DESENHO (04/09/2026)
 *   `modo="10X15"`    a previa do papel, como descrito acima.
 *   `modo="CORREIOS"` a CONFERENCIA da prepostagem: o MESMO enquadramento, a
 *                     mesma hierarquia e a mesma tipografia, porque o que se
 *                     confere e o pedido inteiro. O que muda e o AVISO — o
 *                     rotulo impresso e o oficial dos Correios, gerado por
 *                     eles, e este painel nao o imita —, o remetente (o nome
 *                     REAL do cadastro, porque a prepostagem nao aplica a
 *                     regra "DSEG BRASIL" do 8469), o rodape (PESO no lugar
 *                     do QR, porque peso vai na prepostagem e o QR nao) e a
 *                     marca "SO NO ERP" nos campos que a prepostagem nao
 *                     transmite: nota fiscal, volumes e observacoes.
 *
 * SEMPRE PAPEL BRANCO, TEXTO PRETO: e a previa de uma etiqueta termica, nao um
 * card do ERP. Nao segue o tema escuro. O cabecalho e o rodape do modo
 * CORREIOS, que sao chrome do ERP, seguem o tema.
 */

export type ModoPrevia = "10X15" | "CORREIOS";

const ALTURA_MOLDURA = ETIQUETA_ALTURA_PT - 2 * ETIQUETA_PADDING_PT;

/** Helvetica e a fonte padrao do react-pdf; Arial e a equivalente metrica no Windows. */
const FONTE = "Helvetica, Arial, sans-serif";

const st = {
  pagina: {
    width: ETIQUETA_LARGURA_PT,
    height: ETIQUETA_ALTURA_PT,
    padding: ETIQUETA_PADDING_PT,
    boxSizing: "border-box",
    fontFamily: FONTE,
    color: "#000000",
    background: "#ffffff",
    lineHeight: 1.15,
    transformOrigin: "top left"
  },
  moldura: {
    height: ALTURA_MOLDURA,
    boxSizing: "border-box",
    border: "2px solid #000000",
    borderRadius: 8,
    padding: "7px 10px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column"
  },
  rotulo: { fontSize: 7, fontWeight: 700, letterSpacing: 0.6 },
  regua: { borderBottom: "1.5px solid #000000", margin: "3.5px 0" },

  pedidoLinha: { display: "flex", flexDirection: "row", alignItems: "flex-start" },
  pedidoColuna: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
  pedidoNumero: { fontSize: 36, fontWeight: 700, letterSpacing: -1, whiteSpace: "nowrap" },

  destBloco: { maxHeight: 80, overflow: "hidden" },
  destNome: { fontSize: 12, fontWeight: 700, marginTop: 1.5 },
  destLinha: { fontSize: 10, marginTop: 1.2 },

  grande: { fontSize: 18, fontWeight: 700, marginTop: 1 },
  envio: { fontSize: 12.5, fontWeight: 700, marginTop: 2 },

  obsTexto: {
    fontSize: 9,
    fontWeight: 700,
    marginTop: 2,
    lineHeight: 1.2,
    maxHeight: 24,
    overflow: "hidden"
  },

  remLinha: { fontSize: 9, marginTop: 1.2 },

  espacador: { flexGrow: 1 },

  rodape: { display: "flex", flexDirection: "row", alignItems: "flex-end", flexShrink: 0 },
  rodapeColuna: { display: "flex", flexDirection: "column" },
  qr: { width: 40, height: 40, marginTop: 2, display: "block" },
  dataValor: { fontSize: 15, fontWeight: 700, marginTop: 2 },
  volumeValor: { fontSize: 26, fontWeight: 700, textAlign: "right" },

  /**
   * SO NO MODO CORREIOS: a marca "SO NO ERP" ao lado do rotulo e o valor em
   * cinza. Nao existem no PDF — sao o unico desenho que a conferencia
   * acrescenta ao papel, e servem para o olho separar o que os Correios
   * recebem do que fica so aqui.
   */
  tagErp: {
    display: "inline-block",
    marginLeft: 3,
    padding: "0 2px",
    border: "0.75px solid #000000",
    borderRadius: 2,
    fontSize: 5.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    lineHeight: 1.3,
    verticalAlign: "middle"
  },
  valorErp: { color: "#555555" }
} satisfies Record<string, CSSProperties>;

export function EtiquetaPreview({
  vm,
  qrDataUrl,
  modo = "10X15",
  objetoTransmitido = null
}: {
  vm: EtiquetaViewModel;
  qrDataUrl: string | null;
  modo?: ModoPrevia;
  /** Modo CORREIOS: codigo do objeto (ou id da prepostagem) que JA existe; null = nada transmitido ainda. */
  objetoTransmitido?: string | null;
}) {
  const quadro = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);

  // A etiqueta e desenhada no tamanho nativo e escalada para a largura do
  // quadro — assim os tamanhos de fonte guardam a proporcao exata do papel.
  useEffect(() => {
    const el = quadro.current;
    if (!el) return;
    const medir = () => setEscala(el.clientWidth > 0 ? el.clientWidth / ETIQUETA_LARGURA_PT : 1);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  const a = apresentacaoEtiqueta(vm);
  const volumes = Math.max(1, vm.volumes);
  const correios = modo === "CORREIOS";
  const soErp = correios ? <span style={st.tagErp}>SÓ NO ERP</span> : null;
  const valorErp = correios ? st.valorErp : undefined;
  // A prepostagem nao aplica a regra do 8469: o rotulo oficial sai com o nome
  // real da empresa, e e isso que se confere.
  const remetenteNome = correios ? vm.remetente.nomeCadastro : vm.remetente.nome;

  return (
    <div>
      {correios ? (
        <div className="mb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                Conferência da prepostagem dos Correios
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Os dados abaixo são os que o ERP envia aos Correios. A etiqueta impressa é o rótulo oficial deles,
                com desenho próprio — não esta tela.
              </p>
            </div>
            <span className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:border-slate-600 dark:text-slate-300">
              Não é a etiqueta
            </span>
          </div>
          {objetoTransmitido ? (
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Prepostagem já gerada ({objetoTransmitido}): nome, endereço e telefone do destinatário já foram
              transmitidos e congelaram do lado dos Correios. Alterar aqui não muda o rótulo oficial — para
              corrigir, gere outra prepostagem.
            </p>
          ) : null}
        </div>
      ) : null}

      <div ref={quadro} style={{ width: "100%", height: ETIQUETA_ALTURA_PT * escala, overflow: "hidden" }}>
        <div
          style={{ ...st.pagina, transform: `scale(${escala})` }}
          aria-label={
            correios
              ? `Conferência da prepostagem do pedido ${vm.idInt}`
              : `Prévia da etiqueta do pedido ${vm.idInt}`
          }
        >
          <div style={st.moldura}>
            {/* PEDIDO e NOTA FISCAL lado a lado — mesma linha do PDF. */}
            <div style={st.pedidoLinha}>
              <div style={st.pedidoColuna}>
                <div style={st.rotulo}>PEDIDO:</div>
                <div style={st.pedidoNumero}>{vm.idInt}</div>
              </div>
              <div style={{ ...st.pedidoColuna, textAlign: "right" }}>
                <div style={st.rotulo}>NOTA FISCAL:{soErp}</div>
                <div style={{ ...st.pedidoNumero, ...valorErp }}>{a.nfExibida}</div>
              </div>
            </div>
            <div style={st.regua} />

            <div style={st.destBloco}>
              <div style={st.rotulo}>DESTINATÁRIO:</div>
              <div style={st.destNome}>{vm.destinatario.nome}</div>
              {vm.destinatario.recebedor ? <div style={st.destLinha}>A/C: {vm.destinatario.recebedor}</div> : null}
              {vm.destinatario.endereco ? <div style={st.destLinha}>{vm.destinatario.endereco}</div> : null}
              {vm.destinatario.bairro ? <div style={st.destLinha}>BAIRRO: {vm.destinatario.bairro}</div> : null}
              {a.telefoneLinha ? (
                <div style={st.destLinha}>{a.telefoneLinha}</div>
              ) : correios ? (
                <div style={{ ...st.destLinha, ...st.valorErp }}>Fone: — (sem telefone válido; a prepostagem vai sem contato)</div>
              ) : null}
            </div>
            <div style={st.regua} />

            <div>
              <div style={st.rotulo}>CEP:</div>
              <div style={st.grande}>{a.cepExibido}</div>
            </div>
            <div style={st.regua} />

            <div>
              <div style={st.rotulo}>CIDADE/UF:</div>
              <div style={st.grande}>{a.cidadeUfLinha}</div>
            </div>
            <div style={st.regua} />

            <div>
              <div style={st.rotulo}>FORMA DE ENVIO:</div>
              <div style={st.envio}>{a.transportadoraExibida}</div>
            </div>
            <div style={st.regua} />

            {a.observacaoImpressa ? (
              <>
                <div>
                  <div style={st.rotulo}>OBSERVAÇÕES:{soErp}</div>
                  <div style={{ ...st.obsTexto, ...valorErp }}>{a.observacaoImpressa}</div>
                </div>
                <div style={st.regua} />
              </>
            ) : null}

            <div>
              <div style={st.rotulo}>REMETENTE:</div>
              <div style={st.remLinha}>{remetenteNome}</div>
              {vm.remetente.logradouro ? <div style={st.remLinha}>{vm.remetente.logradouro}</div> : null}
              {vm.remetente.bairroCidadeUf ? <div style={st.remLinha}>{vm.remetente.bairroCidadeUf}</div> : null}
            </div>

            <div style={st.espacador} />

            <div style={st.rodape}>
              <div style={{ ...st.rodapeColuna, width: 60 }}>
                {correios ? (
                  <>
                    <div style={st.rotulo}>PESO:</div>
                    {/* Sem peso em nenhuma fonte a rota manda 300 g — os Correios recusam peso ausente. */}
                    <div style={st.dataValor}>{vm.pesoKg ? `${vm.pesoKg} kg` : "300 g"}</div>
                  </>
                ) : (
                  <>
                    <div style={st.rotulo}>SITE:</div>
                    {/* Data URL gerada no servidor pela mesma biblioteca do PDF —
                        `next/image` nao acrescenta nada a um QR de 40pt inline. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {qrDataUrl ? <img src={qrDataUrl} alt="" style={st.qr} /> : null}
                  </>
                )}
              </div>
              <div style={{ ...st.rodapeColuna, flexGrow: 1, alignItems: "center" }}>
                <div style={st.rotulo}>DATA DE ENVIO:</div>
                <div style={st.dataValor}>{vm.dataEnvio}</div>
              </div>
              <div style={{ ...st.rodapeColuna, width: 62, alignItems: "flex-end" }}>
                <div style={st.rotulo}>VOLUME:{soErp}</div>
                <div style={{ ...st.volumeValor, ...valorErp }}>1/{volumes}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {correios ? (
        <p className="mt-2 text-[11px] text-slate-500">
          Vai na prepostagem: destinatário, endereço, CEP, cidade/UF, telefone, remetente e peso. Pedido, nota
          fiscal, volumes e observações ficam no ERP e na declaração de conteúdo — os Correios não os recebem, e o
          rótulo oficial não os imprime.
        </p>
      ) : null}
    </div>
  );
}
