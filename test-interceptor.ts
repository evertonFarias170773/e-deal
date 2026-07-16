import { handleContextContinuation } from './src/features/maestro/core/simple/maestro-v2-context-manager';
import type { MaestroV2Context } from './src/features/maestro/core/simple/maestro-v2-context-manager';

const v2Ctx: MaestroV2Context = {
  version: 2,
  updatedAt: new Date().toISOString(),
  domain: 'orcamento_avulso',
  activeEntities: {},
  pendingActions: [],
  pendingAddressChoice: {
    clientId: 8469,
    addresses: [
      { id: '1', id_cliente: 8469, endereco: 'Rua 1', numero: '1', complemento: '', bairro: '', cep: '111', cidade: 'A', uf: 'AA', tipo_endereco: 'E' },
      { id: '2', id_cliente: 8469, endereco: 'Rua 2', numero: '2', complemento: '', bairro: '', cep: '222', cidade: 'B', uf: 'BB', tipo_endereco: 'E' },
    ]
  }
};

const continuation1 = handleContextContinuation("1", v2Ctx, { clientInternalId: 8469 } as any);
console.log("Continuation for '1':", JSON.stringify(continuation1, null, 2));

const continuationEsseMesmo = handleContextContinuation("esse mesmo", v2Ctx, { clientInternalId: 8469 } as any);
console.log("Continuation for 'esse mesmo':", JSON.stringify(continuationEsseMesmo, null, 2));

const isChoosing = /^(?:use|escolho|escolha|pode usar|quero)?\s*(?:o\s*|endere[cç]o\s*)?(\d+)\b/i.exec("1");
console.log("isChoosing match:", isChoosing);
