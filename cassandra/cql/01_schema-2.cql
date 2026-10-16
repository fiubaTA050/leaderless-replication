CREATE KEYSPACE IF NOT EXISTS demo2
  WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 2};

CREATE TABLE IF NOT EXISTS demo2.kv (
  k text PRIMARY KEY,
  v text
);

