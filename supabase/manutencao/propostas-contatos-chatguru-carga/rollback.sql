-- Desfaz só a carga (as linhas que ela gravou), sem tocar em escolhas feitas pela tela depois.
delete from public.propostas_contatos_chatguru
where escolhido_por_nome = 'Carga 14/11/2026 (conversa já escolhida na proposta)';
-- Para desfazer a tabela inteira: drop table public.propostas_contatos_chatguru;
