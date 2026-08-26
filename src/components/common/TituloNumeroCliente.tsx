/**
 * Titulo de cabecalho no formato "N° 21173" + nome do cliente ao lado.
 *
 * Nasceu inline na edicao de proposta (OrcamentoFormPage) e foi extraido em
 * 25/08/2026 para o boletim de OS usar o MESMO titulo, em vez de recriar o
 * visual. Vai no `title` do `PageHeader`, que aceita `ReactNode` exatamente por
 * causa deste caso.
 *
 * O componente cuida so da FORMA. Quem chama monta os dois textos — a regra de
 * "que numero" e "que cliente" e de cada tela: a proposta anexa o id do cliente
 * ao nome, o boletim nao.
 *
 * SEM CLIENTE o retorno e o numero CRU, sem elemento em volta. Isso e
 * proposital e nao pode mudar: era assim antes da extracao, e envolver em um
 * `<span>` alteraria o HTML que a proposta ja renderiza.
 */
export function TituloNumeroCliente({
  numero,
  cliente
}: {
  /** Ja formatado: "N° 21173", "Novo pedido", "Nova OS". */
  numero: string;
  /** Ja formatado: "ACME LTDA - 8469" ou so o nome. Vazio = so o numero. */
  cliente?: string | null;
}) {
  const parteCliente = (cliente ?? "").trim();

  // Sem cliente: so o numero. Nada de separador orfao nem espaco solto — o
  // gap so existe quando ha um segundo bloco para separar.
  if (!parteCliente) return <>{numero}</>;

  // O respiro entre numero e cliente e ESTILO (gap-x-10), nao caractere. Em
  // tela estreita `flex-wrap` joga o bloco do cliente para a linha de baixo
  // INTEIRO, em vez de partir o nome no meio; `gap-y-1` da a folga vertical.
  // O numero fica em destaque por contraste: peso cheio contra o cliente em
  // peso normal e um tom mais suave.
  return (
    <span className="flex flex-wrap items-baseline gap-x-10 gap-y-1">
      <span>{numero}</span>
      <span className="text-xl font-normal opacity-90 md:text-2xl">{parteCliente}</span>
    </span>
  );
}
