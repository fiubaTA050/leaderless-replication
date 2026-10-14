-- RF 3: con 3 nodos, cada nodo tiene una copia de todo
CREATE KEYSPACE IF NOT EXISTS demo
  WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 3};

CREATE TABLE IF NOT EXISTS demo.kv (
  k text PRIMARY KEY,
  v text
);

-- RF 1: cada key vive en un solo nodo (para ver el token-aware routing)
CREATE KEYSPACE IF NOT EXISTS routing
  WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1};

CREATE TABLE IF NOT EXISTS routing.kv (
  k text PRIMARY KEY,
  v text
);

-- 2-cassandra-lww: LWW por columna
CREATE TABLE IF NOT EXISTS demo.users (
  id text PRIMARY KEY,
  name text,
  email text
);

-- 2-cassandra-lww: counters (no son LWW)
CREATE TABLE IF NOT EXISTS demo.likes (
  post text PRIMARY KEY,
  n counter
);

-- 3-cassandra-tombstones: gc_grace_seconds de 60s (default: 10 días) para ver la resurrección en clase
CREATE TABLE IF NOT EXISTS demo.carts (
  id text PRIMARY KEY,
  item text
) WITH gc_grace_seconds = 60;
