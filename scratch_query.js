const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://vwbtitjlpelrcnsytzqw.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnRpdGpscGVscmNuc3l0enF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NzE5NTEsImV4cCI6MjA2NDU0Nzk1MX0.te1kg9RKJUQ-gBQ7YiXLDk-Ej8JMNcujIzIR-fTGR-o');

async function run() {
  const { data: propostas, error: err1 } = await supabase.from('propostas').select('id_int, id_cliente, id_faturado, status_interno').eq('status_interno', 'APROVADO');
  if (err1) { console.error(err1); return; }

  const clienteIds = [...new Set(propostas.map(p => p.id_faturado || p.id_cliente))];
  const { data: clientes, error: err2 } = await supabase.from('clientes').select('id_cliente, nome, documento').in('id_cliente', clienteIds);
  
  const { data: enderecos, error: err3 } = await supabase.from('enderecos').select('id_cliente, tipo_endereco, cep, endereco, numero, bairro, cidade, uf').in('id_cliente', clienteIds);
  
  const idInts = propostas.map(p => p.id_int);
  const { data: produtos, error: err4 } = await supabase.from('produtos_proposta').select('id_int, id_produto, ncm, cfop').in('id_int', idInts);
  
  const { data: pagamentos, error: err5 } = await supabase.from('pagamentos_v2').select('id_int, status, confirmado').in('id_int', idInts);

  let totais = {
    aprovadas: propostas.length,
    faturado_definido: 0,
    fallback_cliente: 0,
    pagador_sem_nome: 0,
    pagador_sem_doc: 0,
    endereco_incompleto: 0,
    itens_sem_ncm: 0,
    itens_sem_cfop: 0,
    pagamento_pendente: 0,
    pagamento_ok: 0
  };

  let pendenciasList = [];

  for (const p of propostas) {
    const isFallback = !p.id_faturado;
    if (!isFallback) totais.faturado_definido++;
    else totais.fallback_cliente++;

    const pagadorId = p.id_faturado || p.id_cliente;
    const cliOperacional = clientes?.find(c => c.id_cliente === p.id_cliente);
    const pagador = clientes?.find(c => c.id_cliente === pagadorId);
    
    let pendencias = [];

    if (!pagador || !pagador.nome) {
      totais.pagador_sem_nome++;
      pendencias.push('Pagador sem nome');
    }
    if (!pagador || !pagador.documento) {
      totais.pagador_sem_doc++;
      pendencias.push('Pagador sem documento');
    }

    const enders = enderecos?.filter(e => e.id_cliente === pagadorId) || [];
    let principal = enders.find(e => e.tipo_endereco === 'Principal');
    if (!principal) principal = enders[0];
    
    if (!principal || !principal.cep || !principal.endereco || !principal.numero || !principal.bairro || !principal.cidade || !principal.uf) {
      totais.endereco_incompleto++;
      pendencias.push('Endereço do pagador incompleto');
    }

    const prods = produtos?.filter(pr => pr.id_int === p.id_int) || [];
    if (prods.length === 0) {
      pendencias.push('Nenhum produto na proposta');
    }
    if (prods.some(pr => !pr.ncm)) {
      totais.itens_sem_ncm++;
      pendencias.push('Itens sem NCM');
    }
    if (prods.some(pr => !pr.cfop)) {
      totais.itens_sem_cfop++;
      pendencias.push('Itens sem CFOP');
    }

    const pags = pagamentos?.filter(pg => pg.id_int === p.id_int) || [];
    const hasA_RECEBER = pags.some(pg => pg.status === 'A_RECEBER');
    const hasOK = pags.some(pg => pg.status === 'PAID' || (pg.status === 'A_VENCER' && pg.confirmado));

    if (hasA_RECEBER) {
      totais.pagamento_pendente++;
      pendencias.push('Pagamento A_RECEBER');
    }
    if (hasOK) totais.pagamento_ok++;
    if (!hasOK && !hasA_RECEBER) {
       pendencias.push('Sem pagamentos válidos');
    }

    if (pendencias.length > 0 && pendenciasList.length < 30) {
      pendenciasList.push({
        id_int: p.id_int,
        id_cliente: p.id_cliente,
        nome_operacional: cliOperacional?.nome,
        id_faturado: p.id_faturado,
        pagador_id: pagadorId,
        nome_pagador: pagador?.nome,
        documento_pagador: pagador?.documento,
        status_interno: p.status_interno,
        pendencias
      });
    }
  }

  console.log(JSON.stringify({ totais, pendencias: pendenciasList }, null, 2));
}
run();
