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

# UI web (Reaper): agregar el cluster una vez y abrir http://localhost:8080/webui
curl -X POST "localhost:8080/cluster?seedHost=node1&jmxPort=7199"
```

Reaper muestra los nodos agrupados por datacenter y rack (en rojo los caídos, según gossip) y permite correr
repairs (anti-entropy) desde la UI.

### Branch `3-cassandra-tombstones`: tombstones y resurrección

Un `DELETE` no borra: escribe un **tombstone**, una celda (o fila, o partición) marcada como borrada con su
timestamp. Es un write más, se replica igual que cualquier write y gana por LWW contra valores más viejos. Si el
`DELETE` borrara el dato, una réplica que no recibió el delete no podría distinguir "borrado" de "nunca lo tuve",
y el read repair volvería a copiar el valor viejo.

Los tombstones se guardan al menos `gc_grace_seconds` (default: 10 días). Después, la compaction los puede
eliminar (junto con los datos que tapan). Es un "TTL implícito" del delete: pasado ese tiempo, el delete se olvida.
Los datos con TTL también se convierten en tombstones cuando expiran.

Costo operativo: un read que recorre muchos tombstones es lento (warning a partir de 1000 por query, error a partir
de 100000). Por eso Cassandra no es buena para colas o tablas con muchos deletes.

```bash
git checkout 3-cassandra-tombstones
cd cassandra
docker compose up -d --wait
docker exec cassandra-node1-1 cqlsh -f /cql/01_schema.cql
```

La tabla `demo.carts` tiene `gc_grace_seconds = 60` para no esperar 10 días.

#### 1. node3 no recibe el delete

```bash
docker exec cassandra-node1-1 cqlsh -e "CONSISTENCY ALL; INSERT INTO demo.carts (id, item) VALUES ('ana', 'leche');"
docker exec cassandra-node1-1 nodetool disablehandoff
docker pause cassandra-node3-1
```

Esperar `DN` en node3 (`docker exec cassandra-node1-1 nodetool status`), y borrar:

```bash
docker exec cassandra-node1-1 cqlsh -e "CONSISTENCY QUORUM; DELETE FROM demo.carts WHERE id = 'ana';"
```

El tombstone en el disco de node1 (`flush` pasa el memtable a un SSTable):

```bash
docker exec cassandra-node1-1 nodetool flush demo carts
docker exec cassandra-node1-1 sh -c '/opt/cassandra/tools/bin/sstabledump /var/lib/cassandra/data/demo/carts-*/*Data.db' 2>/dev/null
```

`deletion_info` con `marked_deleted` (timestamp del delete) y `rows: []`.

#### 2. Pasa `gc_grace_seconds` y la compaction elimina el tombstone

Esperar 60 segundos desde el `DELETE`, y compactar en node1 y node2:

```bash
docker exec cassandra-node1-1 nodetool flush demo carts
docker exec cassandra-node1-1 nodetool compact demo carts
docker exec cassandra-node2-1 nodetool flush demo carts
docker exec cassandra-node2-1 nodetool compact demo carts
docker exec cassandra-node1-1 sh -c 'ls /var/lib/cassandra/data/demo/carts-*/'
```

No quedan archivos `*Data.db`: ni el dato ni el tombstone. node1 y node2 no saben que `ana` existió.

#### 3. node3 vuelve: resurrección

```bash
docker unpause cassandra-node3-1
```

Esperar `UN` en node3, y leer:

```bash
docker exec cassandra-node1-1 cqlsh -e "CONSISTENCY ALL; SELECT * FROM demo.carts WHERE id = 'ana';"
docker exec cassandra-node2-1 cqlsh -e "CONSISTENCY ONE; SELECT * FROM demo.carts WHERE id = 'ana';"
docker exec cassandra-node1-1 nodetool enablehandoff
```

`leche` volvió: node3 tiene el valor, nadie tiene un tombstone que lo tape, y el read repair lo copia a node1 y
node2. El delete se perdió aunque respondió OK con `QUORUM`.

Si node3 hubiera vuelto antes de que pasaran los 60s (o con un `nodetool repair` antes de compactar), el
tombstone le hubiera llegado y el dato quedaría borrado.

```bash
docker compose down -v
cd ..
```

#### Cómo se evita

- Correr `nodetool repair` en todos los nodos al menos una vez cada `gc_grace_seconds`: así toda réplica recibe
  los tombstones antes de que se puedan eliminar. Cuánto tarda y cuándo no alcanza:
  [`1-cassandra-cluster`](https://github.com/fiubaTA050/leaderless-replication/tree/1-cassandra-cluster#cuánto-tarda-nodetool-repair).
- Hints no alcanzan: `max_hint_window` (3 horas) es mucho menor que `gc_grace_seconds` (10 días), y con un
  coordinator caído se pierden.
- Un nodo caído más de `gc_grace_seconds` no se vuelve a prender con sus datos: se borra y se reemplaza (recibe
  los datos de las otras réplicas).
- `only_purge_repaired_tombstones: true` (opción de compaction): solo elimina tombstones que pasaron por un repair.

**Siguiente:** [`4-riak-siblings`](https://github.com/fiubaTA050/leaderless-replication/tree/4-riak-siblings)
