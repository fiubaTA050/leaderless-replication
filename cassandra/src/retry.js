import cassandra from 'cassandra-driver';
import { createClient } from './client.js';

const client = createClient();

async function scenario(title, retryTimestamp) {
  await client.execute('DELETE FROM kv WHERE k = ?', ['retry']);
  console.log(`\n${title}`);

  // A escribe v1 y recibe un timeout, pero el write quedó aplicado
  const timestamp = cassandra.types.generateTimestamp();
  await client.execute('INSERT INTO kv (k, v) VALUES (?, ?)', ['retry', 'v1 de A'], { timestamp });
  console.log('A: INSERT v1 -> timeout (simulado), pero quedó aplicado');

  await client.execute('INSERT INTO kv (k, v) VALUES (?, ?)', ['retry', 'v2 de B']);
  console.log('B: INSERT v2 -> OK');

  // retryTimestamp undefined: el driver genera un timestamp nuevo
  await client.execute('INSERT INTO kv (k, v) VALUES (?, ?)', ['retry', 'v1 de A'], { timestamp: retryTimestamp(timestamp) });
  console.log('A: retry de v1 -> OK');

  const { rows: [row] } = await client.execute('SELECT v FROM kv WHERE k = ?', ['retry']);
  return console.log(`valor final: ${row.v}`);
}

await scenario('Retry con timestamp nuevo', () => undefined);
await scenario('Retry con el mismo timestamp', (timestamp) => timestamp);

await client.shutdown();
