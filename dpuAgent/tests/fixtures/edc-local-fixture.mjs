export function createEdcLocalFixture() {
  const negotiations = new Map();
  const transfers = new Map();
  const calls = [];
  const catalog = {
    '@id': 'catalog:provider',
    'dcat:dataset': [
      { '@id': 'asset-public', 'dct:title': 'Public fixture asset', 'dct:hasVersion': '1' },
      { '@id': 'asset-protected', 'dct:title': 'Protected fixture asset', 'dct:hasVersion': '1', 'odrl:hasPolicy': { '@id': 'offer-protected', permission: [{ action: 'use' }] } }
    ]
  };
  const fetchImplementation = async (url, init = {}) => {
    const target = new URL(String(url));
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: target.pathname, method: init.method || 'GET', body });
    if (target.pathname === '/control/catalog') return Response.json(catalog);
    if (target.pathname === '/control/negotiations' && init.method === 'POST') {
      const operation = { '@id': `neg-${negotiations.size + 1}`, state: 'REQUESTED' };
      negotiations.set(operation['@id'], { ...operation, state: 'FINALIZED', contractAgreementId: 'agreement-protected' });
      return Response.json(operation);
    }
    if (target.pathname.startsWith('/control/negotiations/')) {
      return Response.json(negotiations.get(target.pathname.split('/').pop()) || { state: 'ERROR' });
    }
    if (target.pathname === '/data/transfers' && init.method === 'POST') {
      if (body?.contractId !== 'agreement-protected') return Response.json({ error: 'agreement required' }, { status: 403 });
      const operation = { '@id': `transfer-${transfers.size + 1}`, state: 'STARTED' };
      transfers.set(operation['@id'], {
        ...operation,
        state: 'COMPLETED',
        dataAddress: { endpoint: 'http://edc.fixture/data/download/asset-protected', fileName: 'protected.csv', authorization: 'Bearer fixture-transfer-token' }
      });
      return Response.json(operation);
    }
    if (target.pathname.startsWith('/data/transfers/')) {
      return Response.json(transfers.get(target.pathname.split('/').pop()) || { state: 'ERROR' });
    }
    if (target.pathname === '/data/download/asset-protected') return new Response('x,y\n1,2\n', { status: 200 });
    return Response.json({ error: 'not found' }, { status: 404 });
  };
  return {
    provider: { participantId: 'fixture-provider', catalog },
    consumer: { participantId: 'fixture-consumer' },
    controlPlane: { path: '/control' },
    dataPlane: { path: '/data' },
    source: {
      id: 'edc-local', endpoint: 'http://edc.fixture',
      settings: { participantId: 'fixture-consumer', catalogPath: '/control/catalog', negotiationsPath: '/control/negotiations', transfersPath: '/data/transfers' }
    },
    fetchImplementation,
    calls
  };
}
