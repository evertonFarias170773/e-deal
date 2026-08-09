-- producao_cores.preview_base64 — prévia rasterizada da cor do papel
--
-- O QUE E
--   JPEG da primeira pagina de producao_cores.pdf_base64, em Data URI
--   (`data:image/jpeg;base64,...`), usado como previa da cor do papel no card
--   do modelo (aba Pedido das propostas).
--
-- POR QUE
--   pdf_base64 guarda PDF, apesar do nome. PDF nao renderiza em <img>, entao a
--   previa dependia de <embed> e do visualizador embutido do navegador. Isso
--   trazia tres problemas:
--     1. navegador movel nao tem visualizador embutido — a previa simplesmente
--        nao aparecia;
--     2. o visualizador desenha a pagina sobre um fundo escuro proprio, que
--        nenhum CSS externo alcanca;
--     3. peso: as linhas vao de 72 KB a 3,7 MB, baixadas inteiras so para
--        mostrar uma miniatura.
--   Com o JPEG, a previa e um <img> comum: funciona em qualquer dispositivo,
--   aceita object-fit e pesa entre 2 KB e 289 KB (~1,2 MB no total, contra
--   ~14 MB dos PDFs).
--
-- COMO E GERADO
--   Rasterizacao da pagina 1 com pdf.js, largura alvo 1400px, JPEG qualidade
--   0,85, fundo branco. O script fica fora do repositorio (ferramenta pontual,
--   nao codigo da aplicacao) e usa apenas o Chromium do Playwright — nenhuma
--   dependencia nova entrou no projeto.
--
-- MANUTENCAO — ATENCAO
--   Esta coluna e um SNAPSHOT. Trocar o PDF de uma cor NAO regenera o JPEG
--   automaticamente: e preciso rodar a conversao de novo para aquela cor.
--   Enquanto isso nao acontece, a previa mostra a imagem antiga.
--
-- ORIGEM PRESERVADA
--   pdf_base64 continua intacto e segue sendo a fonte. Nada e apagado, nenhuma
--   regra de producao ou de arte muda, e o cadastro de cores nao e alterado
--   pela aplicacao — a previa e somente leitura na aba Pedido.
--
-- ANTES DE APLICAR — verificacao (somente leitura)
--
--     select count(*) filter (where pdf_base64 is not null) as com_pdf,
--            count(*) as total,
--            pg_size_pretty(sum(length(pdf_base64))::bigint) as peso_pdfs
--     from public.producao_cores;
--
-- DEPOIS DE APLICAR
--
--     select name,
--            (preview_base64 is not null) as tem_preview,
--            round(length(preview_base64)/1024.0) as kb
--     from public.producao_cores
--     where pdf_base64 is not null
--     order by name;

alter table public.producao_cores
  add column if not exists preview_base64 text;

comment on column public.producao_cores.preview_base64 is
  'JPEG (Data URI) da primeira pagina de pdf_base64, usado como previa da cor do papel na aba Pedido. Snapshot: trocar o PDF exige regerar esta coluna. pdf_base64 continua sendo a fonte.';
