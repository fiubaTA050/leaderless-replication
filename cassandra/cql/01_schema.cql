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
