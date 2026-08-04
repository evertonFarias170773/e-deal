/**
 * maestro-cep-resolver.server.ts
 *
 * Helper server-side para resolução de informações de CEP via ViaCEP.
 * Implementa timeout de 2 segundos e diferencia CEP inexistente de indisponibilidade do serviço.
 */

export interface CepResolverResult {
  valido: boolean;
  cidade?: string;
  uf?: string;
  /** Bairro do ViaCEP (aditivo — usado no layout 📌 bairro | cidade/UF do agente) */
  bairro?: string;
  erroType?: 'inexistente' | 'indisponivel' | 'formato';
  mensagem?: string;
}

/**
 * Consulta o ViaCEP para resolver a localidade e UF de um CEP com timeout de 2 segundos.
 *
 * @param cep CEP a ser consultado
 * @param timeoutMs Timeout máximo em milissegundos (padrão 2000)
 */
export async function resolverCepViaCep(cep: string, timeoutMs = 2000): Promise<CepResolverResult> {
  const cleanCep = cep.replace(/\D/g, '');
  if (cleanCep.length !== 8) {
    return { valido: false, erroType: 'formato', mensagem: 'Formato de CEP inválido.' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { 
        valido: false, 
        erroType: 'indisponivel', 
        mensagem: `O serviço de consulta de CEP está temporariamente indisponível (HTTP ${response.status}).` 
      };
    }

    const data = await response.json();
    if (data && data.erro) {
      return { 
        valido: false, 
        erroType: 'inexistente', 
        mensagem: `O CEP ${cep} não foi localizado.` 
      };
    }

    return {
      valido: true,
      cidade: data.localidade,
      uf: data.uf,
      bairro: typeof data.bairro === 'string' && data.bairro.trim() ? data.bairro.trim() : undefined,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const e = err instanceof Error ? err : null;
    const isTimeout = e?.name === 'AbortError';
    return {
      valido: false,
      erroType: 'indisponivel',
      mensagem: isTimeout
        ? 'Timeout na consulta do CEP.'
        : (e?.message || 'Erro de conexão no serviço de CEP.')
    };
  }
}

export interface CepMatch {
  cep: string;
  rawText: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Extrai um CEP estruturado da query com base em preposições/marcadores inequívocos de destino ou CEP.
 * Também aceita CEP solto contendo pontuação rígida de CEP.
 * Respeita a precedência de cliente (ignora se precedido de termos como 'cliente', 'cli', etc.).
 */
export function extrairCepDaQueryEstruturado(query: string): CepMatch | null {
  const norm = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. Procurar por indicador de destino + número de 8 dígitos (com ou sem pontuação)
  const destRegex = /\b(para\s+o\s+cep|para\s+cep|pra\s+o\s+cep|pra\s+cep|pro\s+o\s+cep|pro\s+cep|para\s+o|para\s+a|para|pra|pro|destino|entrega|cep\s*:?)\s*(\d{2}\.?\d{3}-?\d{3}|\d{8})\b/gi;
  let match = destRegex.exec(norm);
  if (match) {
    const rawText = query.substring(match.index, destRegex.lastIndex);
    const cepNum = match[2].replace(/\D/g, '');
    if (cepNum.length === 8) {
      // Ignora se precedido de termos de cliente
      const textBefore = norm.substring(0, match.index);
      const isClientPreceded = /\b(cliente|cli|cadastro|id_cliente|id)\s*:?\s*$/i.test(textBefore);
      if (!isClientPreceded) {
        return { 
          cep: cepNum, 
          rawText, 
          startIndex: match.index, 
          endIndex: destRegex.lastIndex 
        };
      }
    }
  }

  // 2. Fallback: CEP solto com pontuação rígida de CEP (ex: "96810-400" ou "96.810-400")
  const strictCepRegex = /\b(\d{2}\.\d{3}-\d{3}|\d{5}-\d{3})\b/g;
  match = strictCepRegex.exec(norm);
  if (match) {
    const rawText = query.substring(match.index, strictCepRegex.lastIndex);
    const cepNum = match[1].replace(/\D/g, '');
    if (cepNum.length === 8) {
      const textBefore = norm.substring(0, match.index);
      const isClientPreceded = /\b(cliente|cli|cadastro|id_cliente|id)\s*:?\s*$/i.test(textBefore);
      if (!isClientPreceded) {
        return { 
          cep: cepNum, 
          rawText, 
          startIndex: match.index, 
          endIndex: strictCepRegex.lastIndex 
        };
      }
    }
  }

  return null;
}

