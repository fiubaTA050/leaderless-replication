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

### Branch `1-cassandra-cluster`: coordinator, consistency levels, hints y read repair

```bash
git checkout 1-cassandra-cluster
cd cassandra
npm install
docker compose up -d --wait
docker exec cassandra-node1-1 cqlsh -f /cql/01_schema.cql
```

#### Arquitectura

**Cluster**: los nodos forman un **ring** de tokens. El hash (Murmur3) de la partition key da un token, y cada nodo
es dueño de uno o más rangos del ring (`num_tokens`: 16 por default). Las réplicas de una key son el dueño de su
rango y los nodos siguientes en el ring, hasta completar el RF. No hay nodos especiales: todos coordinan y todos son
réplicas.

En este cluster cada nodo tiene 1 token fijo (`initial_token` en `docker-compose.yml`), repartidos en 3 partes
iguales. Si los 3 nodos arrancan a la vez y eligen sus tokens solos, a veces dos eligen los mismos, y el ring queda
con 2 nodos (`nodetool status` muestra 2): los logs dicen "have the same token ... Ignoring".

**LSM tree** (log-structured merge tree): los writes van a memoria y se bajan a disco en archivos ordenados que
nunca se modifican; en background se combinan (merge). Writes rápidos (solo escrituras secuenciales) a cambio de
reads que miran varios archivos. Lo usan Cassandra, RocksDB, LevelDB y HBase.

**Nodo**: cada réplica guarda los datos en un LSM tree:

![Write path y read path de Cassandra: el write va al commit log (disco) y al memtable (RAM); el memtable se baja con un flush a SSTables en disco, que la compaction junta en uno; el read busca en el memtable y en los SSTables.](https://www.scylladb.com/wp-content/uploads/cassandra-memtable-diagram.png)

Diagrama: [ScyllaDB](https://www.scylladb.com/glossary/cassandra-memtable/). La flecha del commit log al memtable es
el replay al reiniciar el proceso, no parte de cada write.

- **Commitlog**: cada write se agrega al final de un archivo. Solo se usa para reconstruir el memtable si el
  proceso se reinicia.
- **Memtable**: el write también va a una tabla en memoria, ordenada por clave, y ahí la réplica responde. No lee
  nada antes de escribir ni modifica archivos.
- **Flush**: cuando el memtable se llena (o con `nodetool flush`), se escribe entero como un **SSTable** (Sorted
  String Table): un archivo ordenado e **inmutable**. Esa parte del commitlog ya no hace falta.
- **Read**: busca la key en el memtable y en los SSTables (un bloom filter descarta los que seguro no la tienen) y
  combina celda por celda: gana el timestamp mayor.
- **Compaction**: en background junta varios SSTables en uno nuevo, se queda con la versión más nueva de cada
  celda y descarta lo que quedó tapado. Es el único momento en que se elimina algo del disco.

Como los SSTables son inmutables, un `DELETE` no puede borrar el dato: escribe un **tombstone**, una marca de
borrado con su timestamp que tapa al dato.

**Merkle tree** (hash tree): cada hoja es el hash de un pedazo de los datos y cada nodo interno, el hash de sus
hijos. En Cassandra cada hoja es un subrango de tokens y se hashean sus particiones (keys, valores, timestamps y
tombstones). Sirve para comparar dos copias grandes mandando poco: si las raíces coinciden son iguales; si no, se
baja solo por las ramas distintas. Lo usan Dynamo, Cassandra y Riak para anti-entropy, Git y BitTorrent.

**Anti-entropy** (`nodetool repair`): el operador lo corre en un nodo, y para cada rango de tokens de ese nodo:

1. Le pide a cada réplica del rango un **Merkle tree**: la réplica lee todos sus SSTables del rango (validation
   compaction), calcula un hash por subrango (hojas) y hashes de hashes hasta la raíz.
2. Compara los árboles de a pares desde la raíz: si dos hashes son iguales, ese subárbol es idéntico y no lo
   mira más; si difieren, baja hasta las hojas.
3. Las réplicas se mandan (streaming) los datos de las hojas que difieren, en las dos direcciones.
4. Cada réplica agrega lo recibido como SSTables nuevos. No hay que elegir un ganador: el read y la compaction
   resuelven por LWW, como con cualquier write.
5. Con incremental repair (default sin `-full`), marca los SSTables como reparados para no volver a validarlos.

#### 1. Cualquier nodo coordina

No hay leader: el nodo que recibe la query es el **coordinator** de esa query. Calcula el token de la partition
key, manda el write a todas las réplicas y responde cuando confirmaron tantas como pide el consistency level.

```bash
docker exec cassandra-node1-1 cqlsh -e "CONSISTENCY QUORUM; INSERT INTO demo.kv (k, v) VALUES ('a', 'escrito desde node1');"
docker exec cassandra-node3-1 cqlsh -e "CONSISTENCY QUORUM; SELECT * FROM demo.kv WHERE k = 'a';"
```

Réplicas de una key (con RF 3 son los 3 nodos):

```bash
docker exec cassandra-node1-1 nodetool getendpoints demo kv a
```

Consistency levels más usados (con RF 3):

| CL | Réplicas que tienen que responder |
| --- | --- |
| `ONE` | 1 |
| `QUORUM` | 2 (`RF / 2 + 1`) |
| `ALL` | 3 |
| `ANY` | 1, o un hint en el coordinator (solo writes) |

Con `QUORUM` en reads y writes, `R + W > N`.

#### 2. Token-aware routing

Si el coordinator no es réplica, reenvía la query: un salto de red más. El driver conoce el ring (tokens de cada
nodo) y manda cada query directamente a una réplica. El keyspace `routing` tiene RF 1 para que se vea: cada key
vive en un solo nodo.

```bash
docker compose run --rm client node src/routing.js
```

Con la policy default (token-aware) `coordinator` siempre es la réplica. Con round robin, no.

#### 3. Timeout ≠ rollback

El consistency level **no** hace atómico al write: decide cuándo se responde al cliente, no si el write se
aplica. Las réplicas que lo recibieron lo aplican aunque no se llegue al consistency level, y no hay rollback.

`docker pause` congela node2 y node3: el proceso no responde pero gossip todavía no lo detectó (los ve `UN`).
En la misma línea, antes de que gossip los marque como caídos:

```bash
docker pause cassandra-node2-1 cassandra-node3-1 && docker exec cassandra-node1-1 cqlsh -e "CONSISTENCY QUORUM; INSERT INTO demo.kv (k, v) VALUES ('b', 'write con timeout');"
```

`WriteTimeout: ... received only 1 responses`: el cliente recibe un error. Pero node1 lo aplicó (lo leemos en el
paso 4: mientras gossip vea a node2 y node3 vivos, un read con `ONE` en node1 puede ir a una réplica congelada y dar
`ReadTimeout`).

Además node1 guardó un **hint** para node2 y node3: cuando vuelvan, se los manda. El write "fallido" se va a
propagar a todas las réplicas. Para el cliente, un timeout significa "no sé": puede estar en 0, 1 o 3 réplicas.

¿Qué promete Cassandra?

- Si el write responde OK con CL `X`, está en al menos `X` réplicas (en el commitlog de cada una, que no
  necesariamente llegó al disco: ver abajo).
- Si responde error, no promete nada: puede quedar aplicado en algunas réplicas y propagarse después.
- Retry: el cliente puede reintentar, y el write tiene que ser idempotente (mismo valor y mismo
  timestamp).

¿Qué pasa si una réplica muere antes de escribir en disco? Cada réplica agrega el write al **commitlog** y al
**memtable**, y responde. Con el default (`commitlog_sync: periodic`, `commitlog_sync_period: 10000ms`) responde
**antes** del fsync:

- Si muere solo el proceso (crash, OOM, `kill -9`): el commitlog ya está en el page cache del sistema operativo,
  que lo escribe igual. Al reiniciar, Cassandra hace replay del commitlog y reconstruye el memtable. No se pierde
  nada.
- Si muere la máquina (corte de luz, kernel panic): esa réplica puede perder hasta ~10s de writes que ya
  confirmó.

En el cluster:

- Con `QUORUM` (RF 3) el write está en 2 réplicas. Si una lo pierde, queda atrasada hasta un read repair o un
  `nodetool repair` (no hay hint: había respondido OK). Para perderlo se tienen que caer 2 máquinas en la misma
  ventana; por eso las réplicas van en racks o zonas distintas.
- Con `ONE`, si la única réplica que lo tenía se apaga antes del fsync y las otras no lo recibieron (caídas o con
  timeout), el write se pierde aunque respondió OK: el ACK durable de `main`.
- `commitlog_sync: batch` (o `group`) hace fsync antes de responder: más durable en cada nodo, más latencia. En
  general es más barato subir el CL: la durabilidad viene de tener copias en máquinas independientes.

`docker rm -f` y `docker pause` solo matan o congelan el proceso (el page cache de la VM de Docker sigue), así que
en estas demos no se pierden writes confirmados.

¿Cuándo el coordinator considera que una réplica falló?

- **Down según gossip** (antes de mandar): si no hay suficientes réplicas vivas para el CL, responde
  `Unavailable` y no escribe nada (paso 4).
- **Timeout**: la réplica no responde en `write_request_timeout` (2s).
- **Dropped mutations**: la réplica está sobrecargada y descarta el write que esperó demasiado en la cola
  (`nodetool tpstats`, sección "Dropped"). Para el coordinator es un timeout.

¿El coordinator reintenta? Solo con **hinted handoff**: guarda el write en un archivo local y lo reenvía cuando
gossip ve a la réplica viva otra vez. Límites:

- Solo para réplicas caídas menos de `max_hint_window` (3 horas por default). Después deja de guardar hints.
- Los hints están en el disco del coordinator: si el coordinator muere y no vuelve, se pierden.
- Un hint **no cuenta** para el consistency level (quorum estricto, no sloppy quorum como Dynamo). Excepción:
  `ANY`, donde alcanza con el hint (el dato no se puede leer hasta que se entregue).

#### 4. Unavailable: gossip ya sabe que están caídos

Repetir hasta ver `DN` en node2 y node3 (~10-20s):

```bash
docker exec cassandra-node1-1 nodetool status
```

```bash
docker exec cassandra-node1-1 cqlsh -e "CONSISTENCY QUORUM; INSERT INTO demo.kv (k, v) VALUES ('c', 'unavailable');"
docker exec cassandra-node1-1 cqlsh -e "CONSISTENCY ONE; SELECT * FROM demo.kv WHERE k IN ('b', 'c');"
```

`Unavailable ... alive_replicas: 1`: no escribió nada, falla antes de intentar (`c` no está). En cambio `b`, el
write con timeout del paso 3, está en node1 (ahora node1 es la única réplica viva, así que el read es local). Con
`ONE` sí escribe y guarda hints:

```bash
docker exec cassandra-node1-1 cqlsh -e "CONSISTENCY ONE; INSERT INTO demo.kv (k, v) VALUES ('d', 'con ONE');"
docker exec cassandra-node1-1 nodetool listpendinghints
```

```bash
docker unpause cassandra-node2-1 cassandra-node3-1
```

node1 entrega los hints entre 10 y 30 segundos después (los revisa periódicamente, no en el momento en que el
nodo vuelve). Repetir hasta ver dos líneas `Finished hinted handoff ... to endpoint`, una por la IP de node2 y otra
por la de node3:

```bash
docker logs cassandra-node1-1 2>&1 | grep "Finished hinted handoff"
```

Un `SELECT` con `ONE` en node2 no sirve para comprobarlo: el coordinator no siempre se lee a sí mismo (elige la
réplica que viene respondiendo más rápido), y node1 ya tiene `b` y `d`.

#### 5. Read repair

Read repair: cuando un read consulta varias réplicas y las respuestas difieren, el coordinator devuelve el valor
más nuevo y se lo escribe a las réplicas atrasadas.

Sin hints en node1, node3 se pierde un write:

```bash
docker exec cassandra-node1-1 nodetool disablehandoff
docker pause cassandra-node3-1
```

Esperar `DN` en node3 (`nodetool status`), y escribir:

```bash
docker exec cassandra-node1-1 cqlsh -e "CONSISTENCY QUORUM; INSERT INTO demo.kv (k, v) VALUES ('e', 'node3 no lo tiene');"
docker unpause cassandra-node3-1
```

Read con `ALL` (consulta a las 3 réplicas, así que seguro incluye a node3):

```bash
docker exec cassandra-node3-1 cqlsh -e "CONSISTENCY ALL; TRACING ON; SELECT * FROM demo.kv WHERE k = 'e';" | grep -iE ' e \||digest|repair'
```

El trace muestra `Digest mismatch` (las réplicas difieren) y `Sending read-repair-mutation to Full(/IP de node3...)`
(le escribe el valor a node3). El mismo read otra vez ya no muestra `Digest mismatch`: las 3 réplicas coinciden.

```bash
docker exec cassandra-node3-1 cqlsh -e "CONSISTENCY ALL; TRACING ON; SELECT * FROM demo.kv WHERE k = 'e';" | grep -iE ' e \||digest|repair'
docker exec cassandra-node1-1 nodetool enablehandoff
```

En Cassandra (desde 4.0) el read repair es **blocking** y solo entre las réplicas que consultó el read. Con
`QUORUM` el coordinator elige 2 réplicas (no necesariamente él mismo): si elige las 2 que ya tenían el dato, node3
sigue atrasada. Con `ONE` no hay read repair. Por lo mismo, un read con `ONE` en node3 no sirve para ver qué tiene
node3: puede responderlo otra réplica.

```bash
docker compose down -v
cd ..
```

#### Gossip y anti-entropy

**Gossip** propaga solo membership y estado del cluster, **no datos**: cada segundo cada nodo intercambia con 1 a
3 nodos qué nodos conoce, sus tokens, versión del schema, carga y un heartbeat. Un failure detector **phi
accrual** calcula, según el intervalo entre heartbeats, qué tan probable es que un nodo esté caído; cuando
supera `phi_convict_threshold` lo marca `DN` (los ~10-20s del paso 4). Los datos van del coordinator a las
réplicas directamente.

**Anti-entropy** es `nodetool repair` (pasos en [Arquitectura](#arquitectura)). No es automático (en
Cassandra 5): lo programa el operador (cron, Cassandra Reaper), y tiene que correr al menos cada
`gc_grace_seconds`: cuánto tiempo se guardan los tombstones de los deletes, default 10 días.

¿Cuándo un valor puede quedar viejo indefinidamente en una réplica?

- La réplica estuvo caída más que `max_hint_window`, o el coordinator murió con los hints, o los hints estaban
  deshabilitados.
- El dato no se vuelve a leer, o se lee con `ONE`, o con `QUORUM` sin consultar a esa réplica (no hay read
  repair).
- Nadie corre `nodetool repair`.

#### ¿Cuánto tarda `nodetool repair`?

Un **full repair** (`nodetool repair -full`) es proporcional a **todos los datos** de cada nodo, no a lo que
difiere: cada réplica tiene que leer todo su rango para armar el Merkle tree (validation compaction). Después
solo transfiere los rangos distintos, pero cada hoja del árbol cubre muchas particiones: una partición distinta
hace transferir la hoja completa (overstreaming), peor cuanto más datos por nodo.

La lectura está limitada por `compaction_throughput` (default 64 MiB/s) y compite con las compactions normales y
con el tráfico de la aplicación. Orden de magnitud para un ciclo completo con `-pr` (cada nodo repara su rango
primario, de a un nodo por vez), con `N` nodos, `D` datos por nodo y RF 3: `N × D / (3 × 64 MiB/s)`.

| Nodos | Datos por nodo | Ciclo de full repair |
| --- | --- | --- |
| 6 | 500 GB | ~4 horas |
| 12 | 2 TB | ~1,5 días |
| 60 | 4 TB | ~14 días: más que `gc_grace_seconds` |

Es un mínimo: en la práctica es más lento, y si un nodo se cae durante el repair, las sesiones de sus rangos
fallan y hay que repetirlas.

¿Cuándo es imposible correrlo una vez cada `gc_grace_seconds`? Cuando el ciclo completo (con reintentos y sin
saturar el cluster) tarda más que `gc_grace_seconds`: muchos nodos con varios TB cada uno, o un cluster que no
tiene capacidad libre para leer todo sin afectar la latencia. También si un nodo está caído más de
`gc_grace_seconds`: no se puede reparar, hay que reemplazarlo.

Qué se hace:

- **Incremental repair** (default de `nodetool repair` sin `-full`): marca los SSTables reparados y solo valida
  los nuevos, así que cuesta proporcional a lo escrito desde el último repair, no al total. Igual se corre un full
  repair cada tanto.
- **Subrange repair** (Cassandra Reaper): divide el ring en segmentos chicos que se pueden pausar, reintentar y
  correr en paralelo sobre réplicas distintas.
- **Nodos más chicos** (más nodos con menos datos): el límite de datos por nodo es en gran parte por repair y
  streaming.
- **Subir `gc_grace_seconds`**: da más tiempo, pero los tombstones duran más (reads más lentos, más disco).
- **Evitar deletes**: datos con TTL que expiran juntos (`TimeWindowCompactionStrategy` elimina SSTables completos)
  o tablas append-only.

**Siguiente:** [`2-cassandra-lww`](https://github.com/fiubaTA050/leaderless-replication/tree/2-cassandra-lww)
