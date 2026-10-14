import cassandra from 'cassandra-driver';

const { Client, policies } = cassandra;

// Cliente con el reloj corrido offsetMs: el driver genera el timestamp de cada write con su reloj
export function createClient(offsetMs = 0) {
  const timestampGeneration = new policies.timestampGeneration.MonotonicTimestampGenerator();
  timestampGeneration.getDate = () => Date.now() + offsetMs;
  return new Client({
    contactPoints: ['node1', 'node2', 'node3'],
    localDataCenter: 'dc1',
    keyspace: 'demo',
    policies: { timestampGeneration },
    queryOptions: { consistency: cassandra.types.consistencies.quorum, prepare: true },
  });
}

// WRITETIME está en microsegundos
export function formatWritetime(micros) {
  return new Date(Number(micros) / 1000).toISOString().slice(11, 23);
}
