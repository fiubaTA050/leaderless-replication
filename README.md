# Replicación leaderless

Dependencias y secuencia completa de la clase: [`main`](https://github.com/fiubaTA050/leaderless-replication/tree/main).

## Parte 4: CRDTs

### Branch `7-crdt-sets`: sets

```bash
git checkout 7-crdt-sets
cd crdt
npm install
npm test
```

Todos pasan `testCrdtLaws`. Lo que cambia entre ellos es la semántica cuando un add y
un remove del mismo elemento son concurrentes, y eso las leyes no lo ven: el OR-Set y el Remove-wins set cumplen las
mismas leyes y dan respuestas opuestas. Por eso cada archivo de `test/` tiene, después de las leyes, tests comunes
de la semántica.

| CRDT | Archivo | Updates | Add y remove concurrentes | ¿Se puede volver a agregar? |
| --- | --- | --- | --- | --- |
| G-Set | `src/gset.ts` | `add(e)` | no hay remove | - |
| 2P-Set | `src/twopset.ts` | `add(e)`, `remove(e)` | gana remove | no |
| OR-Set | `src/orset.ts` | `add(e, replicaId)`, `remove(e)` | gana add | sí |
| Remove-wins set | `src/rwset.ts` | `add(e, replicaId)`, `remove(e, replicaId)` | gana remove | sí |

Todos son clases que implementan `Crdt` (`join`, `value` y `equals`) con un `static bottom`; `value()` devuelve el
`Set` de elementos presentes.

#### G-Set

Solo agrega. Orden `⊆`, join: unión (el semilattice del diagrama de `5-crdt-lww`).

#### 2P-Set

Dos G-Sets: `added` y `removed` (tombstones). Está si está en `added` y no en `removed`. Un remove es para
siempre: un elemento borrado no se puede volver a agregar. Los tombstones no se pueden eliminar sin coordinación
(una réplica que no vio el remove lo haría volver: la resurrección de `3-cassandra-tombstones`).

#### OR-Set (add wins)

Cada add crea un **tag** único; los tags son determinísticos, `${replicaId}:${n}`, con `n` uno más que el último
que usó esa réplica para ese elemento. Un remove agrega a `removes` solo los tags que **observó**. Un elemento
está si tiene algún tag de add que no está en `removes`.

Con add y remove concurrentes, el add creó un tag que el remove no vio, así que el elemento queda: gana add.

![OR-Set, gana add: Node B recibe Xbox de Node A; después, a la vez, Node A borra Xbox y Node B lo agrega. El remove de Node A solo observó nodeA:1, así que nodeB:1 sigue vivo y los dos nodos quedan con {Xbox}.](img/orset-add-wins.svg)

Se puede volver a agregar: cada add crea un tag nuevo, que ningún remove anterior observó.

![OR-Set, volver a agregar: Node A agrega Xbox, lo borra y lo vuelve a agregar. El remove canceló nodeA:1; el segundo add crea un tag nuevo, nodeA:2, que está vivo.](img/orset-readd.svg)

Los tags borrados también son tombstones y crecen (hay versiones optimizadas que los reemplazan por version
vectors).

Un tag `(replicaId, n)` es un **dot**, como en los dotted version vectors de Riak: identifica un evento, y un remove
cancela exactamente los dots que observó. Por eso los tags no se pueden repetir nunca.

#### Remove-wins set

Simétrico al OR-Set: el remove también crea un tag.

- add: crea un tag de add y cancela (tombstone) los tags de remove que observó.
- remove: crea un tag de remove y cancela los tags de add que observó.
- Está si tiene un tag de add vivo y ningún tag de remove vivo.

Con add y remove concurrentes, ninguno canceló el tag del otro: queda un tag de remove vivo y gana remove. En orden
causal funciona como un set normal. Sirve cuando el remove es lo seguro (ej: revocar un permiso).

![Remove-wins set: Node A agrega x e y y propaga; después Node A borra x mientras Node B agrega x. Al propagar, los dos nodos quedan con {y}: gana remove, porque el add no canceló el tag nodeA:2.](img/rwset.svg)

### Edición de texto: Operational Transformation y CRDTs

Editar el mismo texto desde varios lugares, incluso offline, tiene un problema propio: las operaciones usan
posiciones, y una edición concurrente las cambia. Texto `abc`: A inserta `X` en la posición 1 (`aXbc`) y, a la vez,
B borra la posición 2 (la `c`). Si A aplica el delete de B tal cual, borra la `b`.

- **Operational Transformation (OT)**: transforma cada operación remota contra las concurrentes que ya se
  aplicaron: el delete de la posición 2 pasa a ser de la posición 3. Google Docs usa OT: cada cambio va del editor
  al servidor y de ahí a los demás editores, que lo transforman ([Google, 2010](https://drive.googleblog.com/2010/09/whats-different-about-new-google-docs_22.html)). En general OT necesita
  un servidor que defina el orden de las operaciones.
- **CRDTs de secuencias** (RGA, YATA en Yjs, Automerge): cada carácter tiene un id único y las operaciones apuntan a
  ids, no a posiciones, así que conmutan sin transformarlas y no hace falta un servidor central.

Las dos permiten editar offline y sincronizar después.

### CRDTs en producción

- **League of Legends (Riot Games)**: el chat guarda las listas de amigos y los datos de cada jugador como CRDTs en
  Riak, para unos 70 millones de jugadores.
  [Chat Service Architecture: Persistence](https://technology.riotgames.com/news/chat-service-architecture-persistence)
- **Redis Enterprise Active-Active**: una base repartida en varias regiones donde todas aceptan writes; los
  conflictos se resuelven solo con CRDTs.
  [Active-Active geo-distributed Redis](https://redis.io/docs/latest/operate/rs/databases/active-active/)
- **Yjs y Automerge**: librerías open source de CRDTs para aplicaciones colaborativas (texto, listas, mapas, JSON).
  [Yjs](https://yjs.dev/), [Automerge](https://automerge.org/)
- **Figma**: el multiplayer está inspirado en CRDTs, sin ser un CRDT puro: cada propiedad de cada objeto se resuelve
  por separado, y gana el último valor que recibe el servidor.
  [How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)

### Referencias

CRDTs:

- Shapiro, Preguiça, Baquero, Zawirski. [Conflict-free Replicated Data Types](https://inria.hal.science/inria-00609399).
  SSS 2011. El paper corto: definición de strong eventual consistency y de CRDTs state-based y op-based.
- Bieniusa et al. [An optimized conflict-free replicated set](https://arxiv.org/abs/1210.3368). 2012. OR-Set sin
  tombstones (ORSWOT).
- Almeida, Baquero. [Scalable Eventually Consistent Counters over Unreliable Networks](https://arxiv.org/abs/1307.3207).
  2013. Handoff counters.
- [crdt.tech](https://crdt.tech/): papers, implementaciones y charlas sobre CRDTs.
- Kleppmann, Wiggins, van Hardenberg, McGranaghan. [Local-first software: You own your data, in spite of the
  cloud](https://www.inkandswitch.com/essay/local-first/). Onward! 2019. Aplicaciones que funcionan offline y
  sincronizan con CRDTs.

Clocks y causalidad:

- Preguiça, Baquero, Almeida, Fonte, Gonçalves. [Dotted Version Vectors: Logical Clocks for Optimistic
  Replication](https://arxiv.org/abs/1011.5808). 2010.
- Baquero. [Version Vectors are not Vector Clocks](https://haslab.wordpress.com/2011/07/08/version-vectors-are-not-vector-clocks/).
  2011. Vector clocks ordenan eventos (ej: entrega causal de mensajes); version vectors ordenan estados de réplicas
  (datos replicados, como en Riak).

Edición de texto:

- Ellis, Gibbs. [Concurrency Control in Groupware Systems](https://doi.org/10.1145/67544.66963). SIGMOD 1989. El
  paper original de Operational Transformation.
- [Operational transformation](https://en.wikipedia.org/wiki/Operational_transformation) (Wikipedia): resumen del
  algoritmo y de sus variantes.
- Day-Richter (Google). [What's different about the new Google Docs: Conflict resolution](https://drive.googleblog.com/2010/09/whats-different-about-new-google-docs_22.html). 2010. Cómo
  Google Docs usa OT.
- Kleppmann, Beresford. [A Conflict-Free Replicated JSON Datatype](https://arxiv.org/abs/1608.03960). 2017. El CRDT
  de documentos JSON (con texto, listas y mapas) en el que se basa Automerge.
- [Automerge](https://automerge.org/): librería de CRDTs para documentos JSON y texto colaborativo.

Bases leaderless:

- Bailis, Fekete, Franklin, Ghodsi, Hellerstein, Stoica. [Coordination Avoidance in Database
  Systems](https://www.vldb.org/pvldb/vol8/p185-bailis.pdf). PVLDB 8(3), 2014.
- Kleppmann. [Designing Data-Intensive Applications](https://dataintensive.net/). Capítulo 5: replicación
  leaderless.

Cassandra:

- [Dynamo](https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html): ring, consistency levels,
  hints.
- [Repair](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/repair.html).
- [Tombstones](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/tombstones.html).

Riak (KV 2.2.3):

- [Causal Context](https://docs.riak.com/riak/kv/2.2.3/learn/concepts/causal-context/index.html): vector clocks,
  dotted version vectors y sibling explosion.
- [Conflict Resolution](https://docs.riak.com/riak/kv/2.2.3/developing/usage/conflict-resolution/index.html).

Herramientas:

- [fast-check](https://fast-check.dev/): property-based testing para JavaScript y TypeScript.
