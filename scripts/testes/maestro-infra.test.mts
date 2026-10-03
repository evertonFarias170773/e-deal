/**
 * Maestro: "como está o banco?" — leitura do painel Saúde da infraestrutura.
 *
 *   src/features/maestro/core/agent/maestro-agent-infra.server.ts
 *   src/features/maestro/core/agent/maestro-agent-tools.ts          (consultar_saude_infra)
 *   src/features/maestro/core/agent/maestro-agent-manual.server.ts  (página restrita)
 *   docs/manual/saude-da-infraestrutura.md
 *
 * NÃO TOCA EM BANCO, EM REDE NEM EM MODELO: a leitura do painel é um falso e o
 * "cliente Supabase" só devolve a linha de usuarios que o teste manda.
 *
 * O QUE PROVA
 *   1. A previsão de espaço: em quantos meses os 100 GB acabam pelo ritmo dos
 *      últimos 30 dias, a data, o tempo até o amarelo e o vermelho, e as pastas
 *      que mais crescem. Casos sem crescimento, sem leitura e limite atingido.
 *   2. A resposta traz o panorama, os cartões com o texto e o formato do painel
 *      (valor, limite, faixas), o horário da leitura em Brasília e a ficha.
 *   3. SÓ ADMINISTRADOR: o administrador recebe a leitura; vendedor, usuário
 *      desconhecido e falha na leitura do usuário recebem SO_ADMINISTRADOR, e a
 *      leitura do painel NEM É CHAMADA.
 *   4. A ficha do manual é restrita: quem não é administrador lê só o aviso.
 *   5. A ficha tem uma seção para cada cartão que a rota monta, com o mesmo
 *      título: título novo na rota sem ficha nova falha aqui.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/maestro-infra.test.mts
 */
import { readFileSync } from "node:fs";
import {
  COMO_RESPONDER_SAUDE,
  FICHA_DA_SAUDE,
  RECUSA_SAUDE_DA_INFRA,
  consultarSaudeDaInfra,
  dataHoraBrasilia,
  definirLeitorDaSaudeDaInfra,
  ehAdministradorDoPainel,
  horaBrasilia,
  montarRespostaDaSaude,
  projetarEspaco,
} from "../../src/features/maestro/core/agent/maestro-agent-infra.server.ts";
import { executeAgentTool } from "../../src/features/maestro/core/agent/maestro-agent-tools.ts";
import {
  TEXTO_DE_PAGINA_RESTRITA,
  carregarManual,
  indiceDoManual,
  interpretarPagina,
  lerPaginasDoManual,
  limparCacheDoManual,
  pedeAlgumaPaginaRestrita,
} from "../../src/features/maestro/core/agent/maestro-agent-manual.server.ts";
import { ROTULO_DO_NIVEL, avaliarNivel, descreverFaixas, LIMITES_SAUDE, type InfraSaude, type MetricaSaude } from "../../src/features/dashboard/infra-saude.ts";

/** Resposta da ferramenta lida como JSON aberto (sem any): chave -> valor de qualquer forma. */
type Json = { [chave: string]: Json } & Array<Json> & string & number & boolean;

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const L = LIMITES_SAUDE;

// ─── Uma leitura de painel completa, no formato que a rota devolve ───────────

function cartao(m: Omit<MetricaSaude, "nivel">): MetricaSaude {
  return { ...m, nivel: avaliarNivel(m.valor, m.sentido, m.amarelo, m.vermelho) };
}

function leitura(parcial: { storageBytes?: number | null; bytes30d?: number | null; buckets?: InfraSaude["buckets"]; avisos?: string[]; memoriaLivre?: number | null } = {}): InfraSaude {
  const storage = parcial.storageBytes === undefined ? 31.3 * GB : parcial.storageBytes;
  const ritmo = parcial.bytes30d === undefined ? 9.3 * GB : parcial.bytes30d;
  const memoria = parcial.memoriaLivre === undefined ? 15 : parcial.memoriaLivre;
  return {
    geradoEm: "2026-10-03T12:41:30.000Z", // 09:41 em Brasília
    validoAte: "2026-10-03T12:51:30.000Z",
    metricas: [
      cartao({ chave: "memoria", titulo: "Memória livre", explicacao: "Quanto da memória do servidor do banco ainda está sobrando. Com pouca memória, as telas ficam lentas.", unidade: "pct", valor: memoria, limite: 100, sentido: "abaixo", amarelo: L.memoriaLivrePct.amarelo, vermelho: L.memoriaLivrePct.vermelho }),
      cartao({ chave: "swap", titulo: "Memória de emergência em atividade", explicacao: "Mostra se o servidor está, agora, passando dados da memória para o disco e de volta, o que deixa as telas lentas. Ocupação alta sozinha não é problema: o servidor guarda ali coisas paradas.", unidade: "taxa", valor: 150 * 1024, limite: null, sentido: "acima", amarelo: L.swapAtividadeBytesPorSegundo.amarelo, vermelho: L.swapAtividadeBytesPorSegundo.vermelho, detalhe: "Ocupação: 61% de 1,0 GB. Informação de apoio, não define a cor." }),
      cartao({ chave: "conexoes", titulo: "Conexões abertas no banco", explicacao: "Quantos programas estão conectados ao banco agora. Se chegar ao máximo, novos acessos são recusados.", unidade: "contagem", valor: 32, limite: 60, sentido: "acima", amarelo: 40, vermelho: 50 }),
      cartao({ chave: "storage", titulo: "Arquivos guardados", explicacao: "Soma de artes, PDFs, instaladores e anexos deste sistema. Os 100 GB do plano valem para a conta toda.", unidade: "bytes", valor: storage, limite: L.storage.limite, sentido: "acima", amarelo: L.storage.amarelo, vermelho: L.storage.vermelho }),
      cartao({ chave: "storage30d", titulo: "Arquivos novos em 30 dias", explicacao: "Quanto os arquivos cresceram no último mês. É o ritmo que diz quando os 100 GB acabam.", unidade: "bytes", valor: ritmo, limite: null, sentido: "acima", amarelo: L.storage30d.amarelo, vermelho: L.storage30d.vermelho }),
      cartao({ chave: "historico", titulo: "Histórico de alterações do mês", explicacao: "Registro de quem mudou o quê. Correções em massa fazem este número saltar de uma vez.", unidade: "bytes", valor: 320 * MB, limite: null, sentido: "acima", amarelo: L.historicoMes.amarelo, vermelho: L.historicoMes.vermelho }),
      cartao({ chave: "cache", titulo: "Leituras atendidas pela memória", explicacao: "Quanto das consultas o banco responde sem ir ao disco. Abaixo de 99% as telas começam a pesar.", unidade: "pct", valor: null, limite: 100, sentido: "abaixo", amarelo: L.cacheHitPct.amarelo, vermelho: L.cacheHitPct.vermelho }),
    ],
    buckets: parcial.buckets ?? [
      { bucket: "agent-releases", publico: true, arquivos: 344, bytes: 23.22 * GB, bytes30d: 4.62 * GB },
      { bucket: "artes", publico: true, arquivos: 4426, bytes: 4.31 * GB, bytes30d: 3.01 * GB },
      { bucket: "chat-ideal", publico: true, arquivos: 517, bytes: 0.98 * GB, bytes30d: 0.82 * GB },
      { bucket: "relatorios", publico: false, arquivos: 465, bytes: 0.02 * GB, bytes30d: 0 },
    ],
    historicoMeses: [{ mes: "2026-09", bytes: 250 * MB }, { mes: "2026-10", bytes: 320 * MB }],
    avisos: parcial.avisos ?? [],
  };
}

const AGORA = new Date("2026-10-03T12:41:30.000Z");

// ─── 1. Previsão de espaço ───────────────────────────────────────────────────
{
  const p = projetarEspaco(leitura(), AGORA);
  checar("projeção: situação e números do painel", [p.situacao, p.usado, p.limite_do_plano, p.livre, p.ritmo_dos_ultimos_30_dias], ["projetado", "31,3 GB", "100,0 GB", "68,7 GB", "9,3 GB"]);
  checar("projeção: 68,7 GB livres ÷ 9,3 GB por mês = 7,4 meses", p.meses_ate_encher, 7.4);
  checar("projeção: o mês em que acaba, por extenso", p.previsao_do_mes, "maio de 2027");
  checar("projeção: tempo até o amarelo (60 GB) e o vermelho (80 GB)", [p.meses_ate_o_amarelo, p.meses_ate_o_vermelho], ["3,1 meses", "5,2 meses"]);
  checar("projeção: a frase pronta", p.leitura,
    "No ritmo dos últimos 30 dias (9,3 GB por mês), os 100,0 GB do plano acabam em cerca de 7,4 meses, por volta de maio de 2027. Hoje há 31,3 GB usados e 68,7 GB livres.");
  checar("projeção: três ressalvas, incluindo a conta toda", [p.ressalvas.length, p.ressalvas.some((r) => r.includes("conta toda"))], [3, true]);

  checar("pastas que mais crescem: ordem, parte do crescimento e tamanho atual",
    p.pastas_que_mais_crescem.map((x) => [x.pasta, x.novos_em_30_dias, x.parte_do_crescimento, x.tamanho_atual, x.aberta]),
    [["agent-releases", "4,6 GB", "55%", "23,2 GB", true], ["artes", "3,0 GB", "36%", "4,3 GB", true], ["chat-ideal", "840 MB", "10%", "1004 MB", true]]);

  const passouDoAmarelo = projetarEspaco(leitura({ storageBytes: 65 * GB }), AGORA);
  checar("acima do amarelo: 'já passou'; o vermelho ainda tem tempo", [passouDoAmarelo.meses_ate_o_amarelo, passouDoAmarelo.meses_ate_o_vermelho], ["já passou", "1,6 meses"]);

  const parado = projetarEspaco(leitura({ bytes30d: 0 }), AGORA);
  checar("sem crescimento em 30 dias: não projeta", [parado.situacao, parado.meses_ate_encher, parado.previsao_do_mes], ["sem_crescimento", null, null]);
  checar("sem crescimento: a frase diz que não dá para projetar", parado.leitura.includes("não dá para projetar"), true);

  const cheio = projetarEspaco(leitura({ storageBytes: 101 * GB }), AGORA);
  checar("limite atingido", [cheio.situacao, cheio.livre, cheio.meses_ate_encher], ["limite_atingido", "0 KB", null]);

  const semLeitura = projetarEspaco(leitura({ storageBytes: null }), AGORA);
  checar("sem leitura dos arquivos: não inventa", [semLeitura.situacao, semLeitura.meses_ate_encher, semLeitura.usado], ["sem_leitura", null, null]);

  checar("pasta sem arquivo novo não entra na lista de quem cresce",
    projetarEspaco(leitura({ buckets: [{ bucket: "parada", publico: false, arquivos: 3, bytes: GB, bytes30d: 0 }] }), AGORA).pastas_que_mais_crescem, []);
  const muitas = Array.from({ length: 9 }, (_, i) => ({ bucket: `p${i}`, publico: false, arquivos: 1, bytes: GB, bytes30d: (9 - i) * 100 * MB }));
  checar("no máximo 5 pastas que crescem", projetarEspaco(leitura({ buckets: muitas }), AGORA).pastas_que_mais_crescem.length, 5);
}

// ─── 2. A resposta da ferramenta ─────────────────────────────────────────────
{
  const r = montarRespostaDaSaude(leitura(), AGORA) as Json;
  checar("horário da leitura em Brasília (data e hora) e até quando vale", [r.lido_em, r.relida_depois_das], ["03/10/2026 às 09:41", "09:51"]);
  checar("panorama: vermelho pelo histórico, amarelo pela memória e pelo ritmo, 'Sem leitura' pelo cache",
    [r.panorama.situacao_geral, r.panorama.cartoes, r.panorama.agir_agora, r.panorama.atencao, r.panorama.sem_leitura, r.panorama.tudo_certo],
    ["Agir agora", 7, ["Histórico de alterações do mês"], ["Memória livre", "Memória de emergência em atividade", "Arquivos novos em 30 dias"], ["Leituras atendidas pela memória"], 2]);

  const porId = Object.fromEntries((r.cartoes as Array<Record<string, unknown>>).map((c) => [c.id, c]));
  checar("cartão em %: valor e faixa como no painel, sem 'de <limite>'", [porId.memoria.valor, porId.memoria.situacao, porId.memoria.faixas, "limite" in porId.memoria],
    ["15,0%", "Atenção", "Amarelo abaixo de 25,0% · vermelho abaixo de 10,0%", false]);
  checar("cartão de taxa (swap): valor com /s, sem 'de <limite>', faixa em /s e a linha de apoio do painel",
    [porId.swap.valor, "limite" in porId.swap, porId.swap.faixas, porId.swap.situacao, porId.swap.detalhe_do_painel],
    ["150 KB/s", false, "Amarelo acima de 100 KB/s · vermelho acima de 1 MB/s", "Atenção", "Ocupação: 61% de 1,0 GB. Informação de apoio, não define a cor."]);
  checar("cartão em contagem: 'de 60'", [porId.conexoes.valor, porId.conexoes.limite, porId.conexoes.faixas], ["32", "de 60", "Amarelo acima de 40 · vermelho acima de 50"]);
  checar("cartão em bytes com limite: 'de 100,0 GB'", [porId.storage.valor, porId.storage.limite], ["31,3 GB", "de 100,0 GB"]);
  checar("cartão sem limite fixo", [porId.storage30d.valor, porId.storage30d.limite], ["9,3 GB", "sem limite fixo"]);
  checar("cartão sem leitura: traço, sem inventar", [porId.cache.valor, porId.cache.situacao], ["—", "Sem leitura"]);
  checar("o texto do painel vai junto, palavra por palavra", porId.memoria.explicacao_do_painel,
    "Quanto da memória do servidor do banco ainda está sobrando. Com pouca memória, as telas ficam lentas.");
  checar("rótulos dos selos", ROTULO_DO_NIVEL, { ok: "Tudo certo", atencao: "Atenção", critico: "Agir agora", indisponivel: "Sem leitura" });

  const texto = JSON.stringify(r);
  checar("nenhum valor bruto em bytes vai ao modelo (ele só copia o formatado)", /\d{9,}/.test(texto), false);
  checar("aponta a ficha e manda ler no mesmo turno", [r.ficha_do_manual, String(r.como_responder).includes(FICHA_DA_SAUDE)], [FICHA_DA_SAUDE, true]);
  checar("histórico por mês e pastas, no formato do painel",
    [r.historico_de_alteracoes_por_mes, r.onde_estao_os_arquivos[0]],
    [[{ mes: "09/26", tamanho: "250 MB" }, { mes: "10/26", tamanho: "320 MB" }], { pasta: "agent-releases", aberta: true, arquivos: "344", tamanho: "23,2 GB", novos_em_30_dias: "4,6 GB" }]);

  const comAviso = montarRespostaDaSaude(leitura({ avisos: ["Não foi possível ler memória, disco, processador, conexões e Realtime agora."] }), AGORA) as Json;
  checar("aviso do painel é repassado", comAviso.avisos_do_painel, ["Não foi possível ler memória, disco, processador, conexões e Realtime agora."]);

  const so_amarelo = montarRespostaDaSaude(
    { ...leitura(), metricas: leitura().metricas.filter((m) => m.chave === "memoria" || m.chave === "conexoes") },
    AGORA,
  ) as Json;
  checar("sem vermelho, o panorama geral é o amarelo", [so_amarelo.panorama.situacao_geral, so_amarelo.panorama.atencao, so_amarelo.panorama.tudo_certo], ["Atenção", ["Memória livre"], 1]);
  const tudo_certo = montarRespostaDaSaude(
    { ...leitura({ memoriaLivre: 60 }), metricas: leitura({ memoriaLivre: 60 }).metricas.filter((m) => m.chave === "memoria") },
    AGORA,
  ) as Json;
  checar("tudo verde: panorama 'Tudo certo'", [tudo_certo.panorama.situacao_geral, tudo_certo.panorama.tudo_certo], ["Tudo certo", 1]);
  const sem_nada = montarRespostaDaSaude({ ...leitura(), metricas: leitura().metricas.filter((m) => m.chave === "cache") }, AGORA) as Json;
  checar("só cartão sem leitura: panorama 'Sem leitura'", sem_nada.panorama.situacao_geral, "Sem leitura");

  checar("faixa 'acima de' do painel", descreverFaixas({ sentido: "acima", amarelo: 70, vermelho: 85, unidade: "pct" }), "Amarelo acima de 70,0% · vermelho acima de 85,0%");
  checar("data e hora em Brasília (UTC-3)", [dataHoraBrasilia("2026-10-03T02:05:00.000Z"), horaBrasilia("2026-10-03T02:05:00.000Z")], ["02/10/2026 às 23:05", "23:05"]);
}

// ─── 3. Só administrador ─────────────────────────────────────────────────────

/** "Cliente Supabase" que devolve a linha de usuarios combinada e anota as leituras. */
function bancoDeUsuarios(linha: Record<string, unknown> | null, erro = false) {
  const lidas: string[] = [];
  const cliente = {
    from(tabela: string) {
      lidas.push(tabela);
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => (erro ? { data: null, error: { message: "falhou" } } : { data: linha, error: null }),
      };
      return b;
    },
  };
  return { cliente: cliente as never, lidas };
}

const ctxDe = (cliente: never) => ({
  supabase: cliente,
  userId: "00000000-0000-0000-0000-000000000001",
  state: { activeClient: null, resolvedClientIds: new Set<number>(), pendingClientCandidates: null, pendingWriteAction: null, currentTurnId: "t1" },
});

{
  let leituras = 0;
  definirLeitorDaSaudeDaInfra(async () => {
    leituras++;
    return leitura();
  });

  const admin = bancoDeUsuarios({ is_admin: true, is_super_adm: false });
  const r = await executeAgentTool("consultar_saude_infra", {}, ctxDe(admin.cliente));
  checar("administrador recebe a leitura", [r.ok, (r.result as Record<string, unknown>)?.found, (r.result as Json)?.panorama?.cartoes, leituras], [true, true, 7, 1]);
  checar("o sanitizador não estraga o retorno (textos e horário intactos)",
    [(r.result as Json).lido_em, (r.result as Json).espaco.previsao_do_mes === undefined, (r.result as Json).cartoes[0].explicacao_do_painel.startsWith("Quanto da memória")],
    ["03/10/2026 às 09:41", false, true]);

  const superAdm = bancoDeUsuarios({ is_admin: false, is_super_adm: true });
  checar("super administrador recebe", (await executeAgentTool("consultar_saude_infra", {}, ctxDe(superAdm.cliente))).ok, true);

  leituras = 0;
  const vendedor = bancoDeUsuarios({ is_admin: false, is_super_adm: false });
  const negada = await executeAgentTool("consultar_saude_infra", {}, ctxDe(vendedor.cliente));
  checar("vendedor: recusado, sem dado", [negada.ok, negada.result, String(negada.error).startsWith("SO_ADMINISTRADOR")], [false, undefined, true]);
  checar("vendedor: a leitura do painel nem é chamada", leituras, 0);
  checar("a recusa manda dizer 'restrita a administradores' e proíbe número", [negada.error?.includes("restrita a administradores"), negada.error?.includes("Não dê número")], [true, true]);
  checar("a recusa é o texto fixo", negada.error, RECUSA_SAUDE_DA_INFRA);

  const desconhecido = bancoDeUsuarios(null);
  checar("usuário que não está em usuarios: recusado", (await executeAgentTool("consultar_saude_infra", {}, ctxDe(desconhecido.cliente))).ok, false);
  const comErro = bancoDeUsuarios({ is_admin: true }, true);
  checar("falha ao ler o usuário NUNCA vira acesso", (await executeAgentTool("consultar_saude_infra", {}, ctxDe(comErro.cliente))).ok, false);
  checar("a função de acesso responde o mesmo", [await ehAdministradorDoPainel(admin.cliente, "x"), await ehAdministradorDoPainel(vendedor.cliente, "x"), await ehAdministradorDoPainel(comErro.cliente, "x")], [true, false, false]);

  // Falha na leitura do painel: o administrador é avisado, sem número inventado.
  definirLeitorDaSaudeDaInfra(async () => {
    throw new Error("rede");
  });
  const falhou = await executeAgentTool("consultar_saude_infra", {}, ctxDe(admin.cliente));
  checar("leitura que falha: found=false e orientação, sem número", [falhou.ok, (falhou.result as Record<string, unknown>).found, (falhou.result as Record<string, unknown>).motivo, /\d/.test(String((falhou.result as Record<string, unknown>).orientacao))], [true, false, "LEITURA_FALHOU", false]);
  // Sem leitor falso a leitura é a real; sem a chave do servidor ela falha avisando.
  definirLeitorDaSaudeDaInfra(null);
  const guardado = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY];
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  checar("sem o ambiente do servidor: falha avisada, sem número", (await consultarSaudeDaInfra()).motivo, "LEITURA_FALHOU");
  if (guardado[0] !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = guardado[0];
  if (guardado[1] !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = guardado[1];
}

// ─── 4. A ficha do manual é restrita ─────────────────────────────────────────
{
  limparCacheDoManual();
  const pagina = carregarManual().find((p) => p.slug === FICHA_DA_SAUDE);
  checar("a ficha existe no manual", pagina?.titulo, "Saúde da infraestrutura");
  checar("a ficha declara 'Acesso: somente administradores'", pagina?.somenteAdministradores, true);
  checar("as outras fichas continuam abertas", carregarManual().filter((p) => p.slug !== FICHA_DA_SAUDE).every((p) => p.somenteAdministradores === false), true);
  checar("a linha de acesso é lida com ou sem acento", [
    interpretarPagina("x", "# X\n\n> **Acesso:** Somente administradores\n").somenteAdministradores,
    interpretarPagina("x", "# X\n\n> **Acesso:** todos os perfis\n").somenteAdministradores,
    interpretarPagina("x", "# X\n\nSem linha de acesso\n").somenteAdministradores,
  ], [true, false, false]);

  checar("o índice do prompt avisa que a página é só de administradores", indiceDoManual().split("\n").find((l) => l.startsWith(`- ${FICHA_DA_SAUDE} `))?.includes("SÓ ADMINISTRADORES"), true);
  checar("pedir a ficha é pedir uma página restrita; pedir a Carteira não", [pedeAlgumaPaginaRestrita([FICHA_DA_SAUDE]), pedeAlgumaPaginaRestrita(["carteira"]), pedeAlgumaPaginaRestrita(["Saúde da infraestrutura"])], [true, false, true]);

  const fechada = lerPaginasDoManual([FICHA_DA_SAUDE]);
  checar("sem permissão (padrão): só o aviso, marcado como restrito", [fechada.encontradas[0].restrita, fechada.encontradas[0].conteudo], [true, TEXTO_DE_PAGINA_RESTRITA]);
  checar("sem permissão: nada da ficha vaza", ["Agir agora", "Carga do processador", "Disco do banco", "desenvolvedor"].some((t) => fechada.encontradas[0].conteudo.includes(t)), false);
  const aberta = lerPaginasDoManual([FICHA_DA_SAUDE], { podeVerRestritas: true });
  checar("administrador lê a ficha inteira", [aberta.encontradas[0].restrita, aberta.encontradas[0].conteudo.includes("Agir agora")], [undefined, true]);
  checar("página comum não é afetada pela restrição", lerPaginasDoManual(["carteira"]).encontradas[0].restrita, undefined);

  // Pelo executor, com o perfil de cada um.
  const vendedor = bancoDeUsuarios({ is_admin: false, is_super_adm: false, id_perfil: null });
  const lidaPorVendedor = await executeAgentTool("consultar_manual", { paginas: [FICHA_DA_SAUDE] }, ctxDe(vendedor.cliente));
  checar("consultar_manual: vendedor recebe só o aviso", [lidaPorVendedor.ok, (lidaPorVendedor.result as Json).paginas[0].conteudo], [true, TEXTO_DE_PAGINA_RESTRITA]);
  const admin = bancoDeUsuarios({ is_admin: true, is_super_adm: false, id_perfil: null });
  const lidaPorAdmin = await executeAgentTool("consultar_manual", { paginas: [FICHA_DA_SAUDE] }, ctxDe(admin.cliente));
  checar("consultar_manual: administrador recebe a ficha", (lidaPorAdmin.result as Json).paginas[0].conteudo.includes("Agir agora"), true);
  const instrucaoVendedor = String((lidaPorVendedor.result as Json).como_usar);
  checar("consultar_manual: para o vendedor a instrução é recusar, sem explicar nada",
    [instrucaoVendedor.startsWith("PÁGINA RESTRITA A ADMINISTRADORES"), instrucaoVendedor.includes("NÃO explique"), instrucaoVendedor.includes("OBRIGATÓRIO: uma frase dizendo se quem_pergunta PODE")], [true, true, false]);
  const instrucaoAdmin = String((lidaPorAdmin.result as Json).como_usar);
  checar("consultar_manual: para o administrador some a frase de permissão e o resto da regra continua",
    [instrucaoAdmin.includes("NÃO escreva frase sobre permissão"), instrucaoAdmin.includes("OBRIGATÓRIO: uma frase dizendo se quem_pergunta PODE"), instrucaoAdmin.includes("Responda SOMENTE com o que está nas páginas")], [true, false, true]);
  const comum = await executeAgentTool("consultar_manual", { paginas: ["carteira"] }, ctxDe(vendedor.cliente));
  checar("consultar_manual: página comum mantém a frase de permissão", String((comum.result as Json).como_usar).includes("OBRIGATÓRIO: uma frase dizendo se quem_pergunta PODE"), true);
  checar("consultar_manual: página comum não consulta o administrador (nenhuma leitura de usuarios extra além do perfil)", (comum.result as Json).paginas[0].restrita, undefined);
}

// ─── 5. A ficha cobre cada cartão da rota ────────────────────────────────────
{
  const titulos = [...readFileSync("src/features/dashboard/infra-saude.server.ts", "utf8").matchAll(/titulo:\s*"([^"]+)"/g)].map((m) => m[1]);
  const ficha = readFileSync("docs/manual/saude-da-infraestrutura.md", "utf8").replace(/\r\n/g, "\n");
  checar("o painel monta 10 cartões", titulos.length, 10);
  for (const t of titulos) checar(`a ficha tem a seção do cartão "${t}"`, ficha.includes(`### ${t}\n`), true);
  const fonteDoPainel = readFileSync("src/features/dashboard/infra-saude.server.ts", "utf8");
  for (const aviso of ["Não foi possível ler memória, disco, processador, conexões e Realtime agora.", "Não foi possível ler o tamanho do banco, o histórico e os arquivos agora."]) {
    checar(`o aviso "${aviso.slice(0, 40)}..." está no painel e na ficha, igual`, [fonteDoPainel.includes(aviso), ficha.includes(aviso)], [true, true]);
  }
  const painel = readFileSync("src/features/dashboard/sections/InfraSaudeSection.tsx", "utf8");
  checar("o painel e o Maestro usam as MESMAS definições de selo e de faixas", [painel.includes("ROTULO_DO_NIVEL"), painel.includes("descreverFaixas(m)"), !/rotulo: "/.test(painel)], [true, true, true]);
  const rotaTexto = readFileSync("src/app/api/admin/infra-saude/route.ts", "utf8");
  checar("a rota lê pelo módulo compartilhado (o mesmo do Maestro)", [rotaTexto.includes("lerSaudeDaInfra"), rotaTexto.includes("async function montar")], [true, false]);
  checar("a ficha cita os mesmos selos", ["Tudo certo", "Atenção", "Agir agora", "Sem leitura"].every((s) => ficha.includes(`**${s}**`)), true);
  const readme = readFileSync("docs/manual/README.md", "utf8");
  checar("o README do manual lista a ficha", readme.includes("(saude-da-infraestrutura.md)"), true);
  checar("a ficha segue o modelo: revisão, caminho, endereço e acesso", [
    /> \*\*Última revisão:\*\* \d{2}\/\d{2}\/\d{4}/.test(ficha),
    ficha.includes("> **Caminho no menu:**"),
    ficha.includes("> **Endereço:** `/dashboard`"),
    ficha.includes("> **Acesso:** somente administradores"),
  ], [true, true, true, true]);
}

checar("a instrução de resposta manda citar o horário e não inventar", [COMO_RESPONDER_SAUDE.includes("horário da leitura"), COMO_RESPONDER_SAUDE.includes("não invente causa")], [true, true]);
checar("a instrução manda resumir o que está certo, sem frase de permissão, sem recarregar e sem oferta", [
  COMO_RESPONDER_SAUDE.includes('NÃO liste um por um os cartões em "Tudo certo"'),
  COMO_RESPONDER_SAUDE.includes("NÃO escreva frase sobre permissão"),
  COMO_RESPONDER_SAUDE.includes("NÃO mande recarregar"),
  COMO_RESPONDER_SAUDE.includes("NÃO termine com oferta"),
], [true, true, true, true]);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
