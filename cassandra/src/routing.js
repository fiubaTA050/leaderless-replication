import { promises as dns } from 'node:dns';
import cassandra from 'cassandra-driver';

const { Client, policies } = cassandra;

// 172.19.0.4 -> node1 (el DNS de docker resuelve la IP al nombre del container)
async function nodeName(address) {
  const ip = address.split(':')[0];
  const [hostname] = await dns.reverse(ip);
  return hostname.match(/node\d/)[0];
}

async function queryKeys(title, loadBalancing) {
  const client = new Client({
    contactPoints: ['node1', 'node2', 'node3'],
    localDataCenter: 'dc1',
    keyspace: 'routing',
    policies: { loadBalancing },
  });
  await client.connect();
  console.log(`\n${title}`);
  for (const k of ['ana', 'beto', 'carla', 'dani', 'eva', 'fede', 'gabi', 'hugo']) {
    // prepare: true -> el driver conoce la partition key y puede calcular su token
    const result = await client.execute('SELECT v FROM kv WHERE k = ?', [k], { prepare: true });
    const [replica] = client.getReplicas('routing', Buffer.from(k));
    console.log(`k=${k.padEnd(5)}  réplica=${await nodeName(replica.address)}  coordinator=${await nodeName(result.info.queriedHost)}`);
  }
  return client.shutdown();
}

// Default del driver: token-aware, manda cada query a una réplica de la key
await queryKeys('Token-aware (default)', new policies.loadBalancing.DefaultLoadBalancingPolicy({ localDc: 'dc1' }));

// Round robin: cualquier nodo coordina y reenvía la query a la réplica (un salto de red más)
await queryKeys('Round robin', new policies.loadBalancing.DCAwareRoundRobinPolicy('dc1'));
