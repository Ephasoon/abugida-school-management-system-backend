#!/usr/bin/env bash
# srv.sh start|stop — test server on :3100 against the scratch DB, tracked by PID file.
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; WS="$(cygpath -m "$S")"   # this tests/ folder (bash path, Windows path)
P=$S/server.winpid
if [ "$1" = stop ]; then
  [ -f $P ] && powershell -NoProfile -Command "Stop-Process -Id $(cat $P) -ErrorAction SilentlyContinue" ; rm -f $P; exit 0
fi
PORT=3100 $S/guard.sh node -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); require('./src/server.js')" "$WS/server.winpid" > $S/server.log 2>&1 &
for i in $(seq 1 30); do curl -s localhost:3100/health >/dev/null && { echo "server up, pid $(cat $P)"; exit 0; }; sleep 0.3; done
echo "server failed:"; tail -5 $S/server.log; exit 1
