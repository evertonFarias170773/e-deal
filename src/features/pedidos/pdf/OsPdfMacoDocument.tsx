import { Document } from "@react-pdf/renderer";

import { OsPdfPaginaBoletim } from "./OsPdfDocument";
import type { OsPdfViewModel } from "../services/os-viewmodel.service";

/**
 * O MAÇO: um documento só, um setor por página, na ordem dos setores.
 *
 * POR QUE ELE EXISTE
 *   Até 09/2026 imprimir um pedido de dois setores baixava dois arquivos. O
 *   download foi escolhido porque abrir N abas é bloqueado pelo navegador depois
 *   da primeira — mas quem imprime não quer arquivo, quer o documento na tela e
 *   o botão de imprimir. Um documento só resolve as duas pontas: uma aba, e a
 *   bancada recebe o maço na ordem certa.
 *
 * NÃO HÁ TEMPLATE NOVO AQUI. Cada página é a MESMA `OsPdfPaginaBoletim` do PDF
 * de setor único — este arquivo só a repete dentro de um `<Document>`. Qualquer
 * mudança no boletim continua tendo um lugar só.
 *
 * SEM NUMERAÇÃO DE PÁGINA, por decisão do dono em 08/09/2026. `pageNumber` e
 * `totalPages` do @react-pdf/renderer contam o documento inteiro, e não há
 * contador por seção: o boletim do PVC diria "Página 1 de 5" contando as páginas
 * do TEXTIL que aquela bancada nunca vai ver. Sem numeração é melhor do que uma
 * numeração que mente.
 *
 * A ORDEM É A QUE CHEGA. Quem monta a lista decide — hoje é a ordem dos setores
 * do pedido, e a rota preserva a ordem dos uuids recebidos.
 */
export interface OsPdfMacoDocumentProps {
  /** Um item por setor, na ordem em que devem sair. */
  paginas: { vm: OsPdfViewModel; qrDataUrl: string | null }[];
  logoDataUrl: string | null;
}

export function OsPdfMacoDocument({ paginas, logoDataUrl }: OsPdfMacoDocumentProps) {
  const primeiro = paginas[0]?.vm;

  return (
    <Document
      title={primeiro ? `OS ${primeiro.idInt}` : "OS"}
      author={primeiro?.empresa.nome}
      subject="Boletim de Producao / Ordem de Servico"
    >
      {paginas.map((p, i) => (
        <OsPdfPaginaBoletim
          key={p.vm.boletim.id ?? i}
          vm={p.vm}
          qrDataUrl={p.qrDataUrl}
          logoDataUrl={logoDataUrl}
          numerarPaginas={false}
        />
      ))}
    </Document>
  );
}
