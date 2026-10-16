# Replicación leaderless

Dependencias y secuencia completa de la clase: [`main`](https://github.com/fiubaTA050/leaderless-replication/tree/main).

## Parte 2: Cassandra

Cluster de 3 nodos (`cassandra/docker-compose.yml`), keyspace `demo` con RF 3: cada nodo tiene una copia de
todo.

Comandos comunes (desde `cassandra/`):

```bash
# prender el cluster (~1 min): --wait espera el healthcheck de los 3 nodos
docker compose up -d --wait

# estado del cluster según gossip: UN = Up Normal, DN = Down Normal
docker exec cassandra-node1-1 nodetool status

# IP de cada container (nodetool muestra IPs)
docker network inspect cassandra_default --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}'

# cqlsh contra un nodo (ese nodo es el coordinator)
docker exec -it cassandra-node1-1 cqlsh

# UI web (DbGate) para ver los datos: http://localhost:3000
```

DbGate muestra los keyspaces, las tablas y sus filas, y tiene una consola CQL (ej: `SELECT k, v, WRITETIME(v) FROM
demo.kv`). Lee a través de `node1` como coordinator: muestra el valor ya reconciliado, no lo que guarda cada réplica,
y si `node1` está caído no se conecta.

### Branch `2-cassandra-lww`: last write wins por columna

Cada celda (fila + columna) guarda su valor y un **timestamp** (microsegundos). Cuando dos réplicas tienen
valores distintos, gana el timestamp más alto: last write wins (LWW). No hay siblings ni merge: el otro valor se
pierde sin error. Con timestamps iguales, gana el delete, y si no hay delete, el valor mayor (comparando bytes).

¿Quién pone el timestamp?

- El **cliente**: el driver lo genera con su reloj (`MonotonicTimestampGenerator` en Node, nunca repite ni
  retrocede dentro del mismo proceso) y lo manda con la query.
- El **coordinator**, si el cliente no manda uno, con su propio reloj (mismos problemas de drift, ver abajo).
- La aplicación, explícito: `USING TIMESTAMP` en CQL o la opción `timestamp` del driver.

Con timestamps del cliente, "último" significa "el reloj más adelantado", no el último en llegar.

```bash
git checkout 2-cassandra-lww
cd cassandra
npm install
docker compose up -d --wait
docker exec cassandra-node1-1 cqlsh -f /cql/01_schema.cql
```

#### 1. Clock drift: gana el write más viejo

`src/lww.js`: dos clientes Node, A con el reloj adelantado 1 minuto (un `MonotonicTimestampGenerator` con
`getDate` corrido). A escribe primero, B escribe 1 segundo después.

```bash
docker compose run --rm client node src/lww.js
```

| Columna | A (reloj +60s) escribe primero | B escribe 1s después | Resultado |
| --- | --- | --- | --- |
| `name` | `Ana` | `Beto` | `Ana`: el write más viejo gana porque su timestamp está en el futuro |
| `email` | | `beto@mail.com` | `beto@mail.com` |

- B pierde su `name` sin enterarse: el `INSERT` respondió OK.
- `WRITETIME(name)` está 1 minuto en el futuro: hasta que pase ese minuto, nadie con el reloj bien puede pisar
  `name` (ni borrarlo).
- La fila queda `Ana` / `beto@mail.com`: una combinación que ningún cliente escribió.

LWW por columna en vez de por fila **reduce** lo que se pierde (el `email` de B sobrevive), pero produce filas que
mezclan columnas de writes distintos. Con LWW por fila se perdía todo el write de B.

Aunque los relojes estén sincronizados con NTP, siempre hay algunos milisegundos de diferencia: dos writes
concurrentes de clientes distintos se ordenan por reloj, no por causalidad.

Y eso es en el mejor caso. El timestamp sale del reloj de una máquina, y Cassandra no valida cuánto drift tiene
(acepta timestamps en el futuro). Fallas comunes que producen segundos o más de diferencia, tanto en los servicios
que escriben como en los nodos del cluster:

- **NTP no funciona en un host** (firewall que bloquea el puerto 123, daemon caído, sin red): el reloj sigue solo
  con el cristal de cuarzo, que se desvía decenas de ppm (20 ppm ≈ 1,7 s por día). Nadie lo nota durante semanas.
- **Leap second**: algunos hosts repiten un segundo (el reloj vuelve atrás), otros lo reparten durante horas
  (leap smear, como Google o AWS). En una flota mezclada hay hasta 1 s de diferencia, y los writes de ese segundo
  repetido pueden quedar con timestamps menores que writes anteriores.
- **Corrección de NTP con step**: si el offset es grande (más de 128 ms en `ntpd`), NTP salta el reloj de golpe,
  también hacia atrás. Los writes posteriores al salto pierden contra los anteriores.
- **VMs y containers**: una VM pausada, migrada en vivo o con snapshot queda con el reloj congelado y después salta.
  Los containers usan el reloj del host: un host mal configurado afecta a todos sus containers.
- **Arranque con reloj incorrecto**: batería del RTC agotada (el equipo arranca en 1970 o en otra fecha) o una VM
  que arranca antes de sincronizar NTP. Los writes de esos primeros segundos tienen cualquier timestamp.
- **Servidor NTP equivocado**: un upstream mal configurado adelanta a toda la flota a la vez; al corregirlo, todos
  los writes nuevos pierden contra los que se hicieron con la hora adelantada.

Un reloj adelantado `X` gana contra todos durante `X` (y sus valores no se pueden pisar ni borrar en ese tiempo);
uno atrasado pierde sus writes sin error.

¿Y si el cliente no manda timestamp? Lo pone el coordinator con su reloj, y cada write puede ir a un coordinator
distinto: los mismos problemas, ahora entre los nodos del cluster. Además, dos writes seguidos del mismo servicio a
coordinators distintos pueden quedar desordenados; con timestamps del cliente, `MonotonicTimestampGenerator` lo
evita dentro de un mismo proceso (no entre procesos). Mover el timestamp al cluster no elimina el problema: cambia
qué relojes hay que cuidar.

Y aunque el cliente mande el timestamp, los nodos usan su propio reloj para el TTL y para `gc_grace_seconds` (el
momento del delete y del vencimiento lo pone el coordinator; cada réplica decide con su reloj cuándo ya pasó). Un
nodo adelantado expira datos con TTL antes que los demás, y puede eliminar tombstones antes de tiempo: si otra
réplica todavía tiene el dato viejo, el dato borrado vuelve a aparecer.

Qué se hace:

- Cuidar los relojes de todos los hosts que generan timestamps (servicios o nodos): NTP/chrony con varias fuentes,
  la misma política de leap second en toda la flota, y alertas sobre el offset.
- No depender del orden de writes concurrentes: counters (paso 3) o lightweight transactions (`IF`, Paxos) para
  lo que necesita un orden.

#### 2. Retries idempotentes: mismo timestamp

Viene de la clase anterior: después de un timeout el cliente no sabe si el write se aplicó (`1-cassandra-cluster`),
así que reintenta. En Cassandra, para que el retry sea idempotente tiene que reusar **el mismo timestamp**.

- Los retries del propio driver (retry policy, speculative executions) reusan el timestamp de la primera
  ejecución, y solo se hacen si la query está marcada como idempotente (`isIdempotent: true`).
- Un retry de la aplicación (llamar a `execute` otra vez) genera un timestamp nuevo, salvo que la aplicación pase
  `timestamp` explícito.

```bash
docker compose run --rm client node src/retry.js
```

A escribe `v1` (timeout simulado: quedó aplicado), B escribe `v2`, A reintenta `v1`:

- Timestamp nuevo: el retry pisa a `v2`. Lost update de B.
- Mismo timestamp: el retry no cambia nada, queda `v2`.

#### 3. Counters: la excepción a LWW

Los counters no son LWW: cada réplica lleva su parte del contador y se combinan sumando. Solo se pueden
incrementar o decrementar.

```bash
docker exec cassandra-node1-1 cqlsh -e "UPDATE demo.likes SET n = n + 1 WHERE post = 'p1'; UPDATE demo.likes SET n = n + 1 WHERE post = 'p1'; SELECT * FROM demo.likes;"
docker exec cassandra-node1-1 cqlsh -e "UPDATE demo.likes SET n = 5 WHERE post = 'p1';"
docker exec cassandra-node1-1 cqlsh -e "UPDATE demo.likes USING TIMESTAMP 1 SET n = n + 1 WHERE post = 'p1';"
```

- Concurrentes no se pisan: dos `n = n + 1` en coordinators distintos suman 2. Por eso se usan en vez de
  read-modify-write (`main`).
- **No son idempotentes**: no hay timestamp que identifique el incremento. Si un `n = n + 1` da timeout y se
  reintenta, puede contar dos veces. Un counter de Cassandra no sirve para algo que tiene que ser exacto (ej:
  saldo). El driver no los reintenta, porque no están marcados como idempotentes.

**Cómo se guardan**: la celda de un counter no guarda un número sino un **counter context**: una lista de
**shards**, uno por cada nodo que alguna vez lideró un incremento, con `(id del nodo, clock, count)`.

Un `n = n + 5`:

1. El coordinator manda el delta (`+5`) a una sola réplica, el **leader** (si el coordinator es réplica, él
   mismo).
2. El leader toma un lock sobre ese counter, lee el valor actual de **su** shard (del counter cache o de los
   SSTables) y calcula el nuevo: `count + 5`, `clock + 1`. Es el único write de Cassandra que lee antes de
   escribir.
3. Escribe su shard nuevo (commitlog + memtable) y lo replica a las otras réplicas como un write normal: lo que
   viaja es el valor absoluto de su shard, no el delta.

Merge (en un read, repair o compaction): para cada nodo se queda con el shard de clock mayor, y el valor del counter
es la suma de los `count` de todos los shards (`count` puede ser negativo, así que también decrementa). Como para
cada nodo gana siempre la misma versión, reenviar un shard (hints, read repair, repair) es idempotente; lo que no es idempotente es el delta del cliente: si el leader ya aplicó el `+5` y la respuesta se
perdió, un retry vuelve al paso 2 y suma otra vez.

Costos y restricciones:

- Lock y read antes del write: más lentos que un write normal (`counter_write_request_timeout`, 5s).
- Una tabla con counters solo puede tener counters (además de la primary key), y no admiten TTL.
- Borrar un counter es para siempre: incrementarlo después de un delete tiene resultado indefinido.

```bash
docker compose down -v
cd ..
```

**Siguiente:** [`3-cassandra-tombstones`](https://github.com/fiubaTA050/leaderless-replication/tree/3-cassandra-tombstones)
