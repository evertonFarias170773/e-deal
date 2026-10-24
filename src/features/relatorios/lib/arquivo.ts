/** Salva um arquivo gerado no navegador (PDF, por exemplo). */
export function baixarBlob(nomeArquivo: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Abre a janela de impressão para um PDF já gerado: carrega o arquivo num quadro escondido e
 * chama a impressão dele. Se o navegador não deixar imprimir pelo quadro, abre o PDF em outra
 * aba, onde o visualizador tem o botão de imprimir.
 */
export function imprimirPdf(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const quadro = document.createElement("iframe");
  quadro.style.position = "fixed";
  quadro.style.width = "0";
  quadro.style.height = "0";
  quadro.style.border = "0";
  quadro.setAttribute("aria-hidden", "true");

  const limpar = () => {
    setTimeout(() => {
      quadro.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };

  quadro.onload = () => {
    try {
      quadro.contentWindow?.focus();
      quadro.contentWindow?.print();
      limpar();
    } catch {
      window.open(url, "_blank");
      limpar();
    }
  };
  quadro.src = url;
  document.body.appendChild(quadro);
}
