# Replicación leaderless

## Dependencias

- Docker with Compose v2
- Node.js 24

## Secuencia de la clase

| Parte | Branch | Tema |
| --- | --- | --- |
| 1. Bases de datos leaderless | [`main`](https://github.com/fiubaTA050/leaderless-replication/tree/main) | pros, contras, invariantes, coordination avoidance |
| 2. Cassandra | [`1-cassandra-cluster`](https://github.com/fiubaTA050/leaderless-replication/tree/1-cassandra-cluster) | coordinator, consistency levels, timeout ≠ rollback, hints, read repair |
|  | [`2-cassandra-lww`](https://github.com/fiubaTA050/leaderless-replication/tree/2-cassandra-lww) | timestamps, LWW por columna, counters |
|  | [`3-cassandra-tombstones`](https://github.com/fiubaTA050/leaderless-replication/tree/3-cassandra-tombstones) | tombstones, `gc_grace_seconds`, resurrección |
| 3. Riak | [`4-riak-siblings`](https://github.com/fiubaTA050/leaderless-replication/tree/4-riak-siblings) | siblings y dotted version vectors |
| 4. CRDTs | [`5-crdt-lww`](https://github.com/fiubaTA050/leaderless-replication/tree/5-crdt-lww) | join-semilattice, LWW-Register |
|  | [`6-crdt-counters`](https://github.com/fiubaTA050/leaderless-replication/tree/6-crdt-counters) | law testing, G-Counter, PN-Counter |
|  | [`7-crdt-sets`](https://github.com/fiubaTA050/leaderless-replication/tree/7-crdt-sets) | G-Set, 2P-Set, OR-Set, Remove-wins set |

Cada branch agrega su sección a este README.

## Parte 1: bases de datos leaderless

Ya vimos Dynamo: no hay leader, el cliente (o un coordinator) escribe en `N` réplicas y los conflictos se los
devuelve al cliente. Ejemplos de la misma familia: Cassandra, Riak, ScyllaDB, Voldemort (DynamoDB, a pesar del
nombre, usa un leader por partición).

Parámetros de Dynamo que vamos a usar todo el tiempo:

- `N`: cantidad de réplicas de cada key.
- `W`: réplicas que tienen que confirmar un write para responder OK.
- `R`: réplicas que se consultan en un read.
- `R + W > N`: los conjuntos de réplicas del read y del write se intersectan (quorum estricto), así que el read
  ve al menos una réplica con el último write confirmado. No alcanza para tener linearizability.

### Beneficios

- **Menor latencia**: el cliente escribe en las réplicas más cercanas y responde con las primeras `W` que
  confirman. No hay un salto extra hasta un leader que puede estar lejos, y una réplica lenta no frena el write:
  la latencia es la de la `W`-ésima réplica más rápida, no la de una réplica en particular.
- **Más disponibilidad que la replicación con leader**: cualquier réplica acepta reads y writes. Si un nodo
  muere, los demás siguen atendiendo: no hay failover, ni una ventana sin writes mientras se elige otro leader, ni
  riesgo de dos leaders a la vez (split brain).
- **Replicación entre regiones lejanas**: con un leader y replicación sincrónica (la clase anterior), cada write
  espera el round trip a la otra región, de decenas a cientos de ms. Sin leader, cada región confirma con sus
  réplicas locales y replica a las otras en background, y todas las regiones aceptan writes a la vez.
- **Tolerancia a particiones**: si la red se parte, cada lado puede seguir aceptando writes (con un `W` chico) y
  las réplicas se ponen de acuerdo cuando la red vuelve. Disponibilidad antes que consistencia (AP en CAP).
- **Sin cuello de botella en un leader**: los writes se reparten entre todos los nodos (consistent hashing);
  ningún nodo recibe todos los writes.
- **Write a cualquier nodo inmediatamente**: el cliente no necesita saber quién es el leader ni ser redirigido.
- **Latencia y consistencia ajustables por request**: el cliente elige `R` y `W` en cada operación. Un write con
  `W = 1` es rápido pero frágil; uno con `W = N` es lento y falla si una réplica no responde.

### Contras

- **Eventual consistency**: las réplicas pueden diferir durante un tiempo (a veces, indefinidamente).
- **Conflictos**: dos writes concurrentes a la misma key, aceptados por réplicas distintas. Alguien tiene que
  resolverlos: la base (ej: last write wins, que pierde datos) o el cliente (la base le devuelve todas las versiones
  concurrentes).
- **Stale reads**: con `R + W ≤ N`, o mientras una réplica está atrasada, un read puede devolver un valor viejo.
- **Lost updates**: dos clientes hacen read-modify-write sobre el mismo valor y uno pisa al otro.
- **Complejidad operativa**: hints, read repair y anti-entropy (`nodetool repair`) son responsabilidad del
  operador. Si no se hacen, las réplicas divergen o aparecen datos borrados.

### Invariantes que no se pueden garantizar sin coordinación

Dos réplicas aceptan writes de forma independiente y después se combinan. Si cada una por separado respeta el
invariante pero la combinación no, el invariante necesita coordinación (un leader, un lock, consenso).

| Invariante | Ejemplo | Qué pasa sin coordinación |
| --- | --- | --- |
| Uniqueness | username único | dos réplicas aceptan el mismo `username` para dos usuarios distintos |
| Valores acotados | `stock ≥ 0` | stock 1: dos réplicas venden 1 cada una, al combinar queda `-1` |
| Read-modify-write | `saldo = saldo + 10` | dos clientes leen 100 y escriben 110: se pierde un depósito |
| Integridad referencial | toda compra referencia un producto existente | una réplica borra el producto, otra inserta una compra |
| Write skew | al menos un médico de guardia | dos médicos se dan de baja en réplicas distintas, cada una ve al otro de guardia |
| Secuencias | números de factura consecutivos | dos réplicas asignan el mismo número, o quedan huecos |
| ACK durable | "OK = el dato no se pierde" | con `W = 1`, la única réplica que lo tiene muere antes de replicar |
| Delete durable | un delete es para siempre | una réplica que no recibió el delete hace "resucitar" el dato |
| Session guarantees | read-your-writes, monotonic reads | el cliente escribe en una réplica y lee de otra que todavía no lo tiene |

El cliente tiene que trabajar dentro de estos límites. Ejemplos:

- En vez de read-modify-write, operaciones que conmutan: counters de Cassandra (`n = n + 1`), donde dos
  incrementos concurrentes suman los dos.
- Resolución de conflictos propia: la base guarda las versiones concurrentes y el cliente las combina con reglas de
  la aplicación.
- IDs generados sin coordinar (UUID, `timeuuid`) en vez de secuencias.
- Para lo que sí necesita coordinación, pagarla solo ahí: lightweight transactions de Cassandra (`IF NOT EXISTS`,
  Paxos), o mover esa parte a una base con leader.
- Aceptar la violación y compensar después (ej: vender de más y cancelar una compra).

### Coordination avoidance (Bailis et al., VLDB 2014)

Paper: "Coordination Avoidance in Database Systems". Pregunta: ¿cuándo una aplicación puede mantener sus
invariantes sin coordinación entre réplicas?

**Invariant confluence (I-confluence)**: un invariante `I` es I-confluent para un conjunto de transactions si,
partiendo de un estado válido, dos réplicas que ejecutan transactions por separado (cada una quedando en un
estado válido) siempre se pueden combinar (merge) en un estado que también es válido.

- Si es I-confluent: se puede mantener sin coordinación (disponible, escala, baja latencia).
- Si no lo es: cualquier implementación necesita coordinación para alguna ejecución.

Depende del invariante **y** de la operación:

| Invariante | Operación | ¿Sin coordinación? |
| --- | --- | --- |
| `NOT NULL`, `campo = constante` | cualquiera | sí |
| ID único generado por el sistema (UUID) | insert | sí |
| ID único elegido por el usuario (`PRIMARY KEY`, `UNIQUE`) | insert | no |
| `AUTO_INCREMENT` sin huecos | insert | no |
| Foreign key | insert | sí |
| Foreign key | delete (sin cascade) | no |
| Foreign key | cascading delete | sí |
| `x > 0` | increment | sí |
| `x > 0` | decrement | no |
| Índices secundarios, materialized views | cualquiera | sí |

Ejemplo `stock ≥ 0`: reponer stock (increment) nunca lo rompe, sin importar cuántas réplicas lo hagan a la vez.
Vender (decrement) sí: cada réplica ve stock suficiente, pero la suma de las ventas no.

Conclusión del paper: en benchmarks reales (TPC-C) la mayoría de los invariantes son I-confluent, así que solo
una parte chica de las operaciones necesita coordinación.

**Siguiente:** [`1-cassandra-cluster`](https://github.com/fiubaTA050/leaderless-replication/tree/1-cassandra-cluster)
