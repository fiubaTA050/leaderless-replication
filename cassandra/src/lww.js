import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, formatWritetime } from './client.js';

// A tiene el reloj adelantado 1 minuto, B tiene la hora correcta
const a = createClient(60_000);
const b = createClient(0);

await b.execute('TRUNCATE users');

console.log('1. A (reloj +60s): UPDATE name = Ana');
await a.execute('UPDATE users SET name = ? WHERE id = ?', ['Ana', 'u1']);

await sleep(1000);

console.log('2. B (1s después): INSERT name = Beto, email = beto@mail.com');
await b.execute('INSERT INTO users (id, name, email) VALUES (?, ?, ?)', ['u1', 'Beto', 'beto@mail.com']);

const { rows: [row] } = await b.execute(
  'SELECT name, WRITETIME(name) AS name_ts, email, WRITETIME(email) AS email_ts FROM users WHERE id = ?',
  ['u1'],
);
console.log(`\nAhora: ${formatWritetime(Date.now() * 1000)}`);
console.table({
  name: { valor: row.name, writetime: formatWritetime(row.name_ts) },
  email: { valor: row.email, writetime: formatWritetime(row.email_ts) },
});

await a.shutdown();
await b.shutdown();
