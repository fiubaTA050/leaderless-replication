#!/bin/bash
# Dos clientes (X e Y) escriben alternados en la misma key. Cada uno manda el vclock que recibió en la
# respuesta de su propio write anterior (nunca lee lo que escribió el otro).
# Se compara el bucket type "vclocks" (vector clocks) con "siblings" (dotted version vectors).

# put <url> <vclock> <valor>: imprime el vclock de la respuesta
put() {
  if [ -n "$2" ]; then
    curl -s -D - -o /dev/null -XPUT "$1?returnbody=true" -H 'content-type: text/plain' -H "X-Riak-Vclock: $2" -d "$3" | awk '/X-Riak-Vclock/ {print $2}' | tr -d '\r'
  else
    curl -s -D - -o /dev/null -XPUT "$1?returnbody=true" -H 'content-type: text/plain' -d "$3" | awk '/X-Riak-Vclock/ {print $2}' | tr -d '\r'
  fi
}

# key nueva en cada ejecución
KEY=explosion-$(date +%s)

for TYPE in vclocks siblings; do
  URL=localhost:8098/types/$TYPE/buckets/carts/keys/$KEY
  VCLOCK_X=""
  VCLOCK_Y=""
  for i in 1 2 3 4 5; do
    VCLOCK_X=$(put "$URL" "$VCLOCK_X" "x$i")
    VCLOCK_Y=$(put "$URL" "$VCLOCK_Y" "y$i")
    echo "$TYPE, ronda $i, siblings: $(curl -s "$URL" -H 'Accept: multipart/mixed' | tr -d '\r' | grep -E '^[xy][0-9]' | sort | tr '\n' ' ')"
  done
done
