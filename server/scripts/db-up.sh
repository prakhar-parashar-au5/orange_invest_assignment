#!/usr/bin/env bash
# Start the local, disposable MySQL 8 for orange-invest. Safe to run any number of times.
#
# Creates (if missing):
#   container  orange-mysql  (mysql:8.0, 127.0.0.1:3306 only, volume orange-mysql-data)
#   databases  orange_invest_dev, orange_invest_test
#   users      orange_app       (all privileges on both databases; the server's normal pool)
#              orange_agent_ro  (SELECT only on both databases; the AI agent's tools)
#
# The passwords below are fixed, dev-only, and match the defaults in src/config.js. The port is bound
# to 127.0.0.1, so nothing outside this machine can reach it. Never reuse them anywhere real.
set -euo pipefail

CONTAINER=orange-mysql
IMAGE=mysql:8.0
VOLUME=orange-mysql-data
ROOT_PASSWORD=orange_root_dev
APP_PASSWORD=orange_app_dev
RO_PASSWORD=orange_agent_ro_dev

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  state=$(docker container inspect -f '{{.State.Status}}' "$CONTAINER")
else
  state=missing
fi
case "$state" in
  running) echo "$CONTAINER already running" ;;
  missing)
    echo "creating $CONTAINER from $IMAGE"
    docker run -d --name "$CONTAINER" \
      -p 127.0.0.1:3306:3306 \
      -v "$VOLUME":/var/lib/mysql \
      -e MYSQL_ROOT_PASSWORD="$ROOT_PASSWORD" \
      "$IMAGE" >/dev/null
    ;;
  *)
    echo "starting existing $CONTAINER (was $state)"
    docker start "$CONTAINER" >/dev/null
    ;;
esac

# The image restarts mysqld once during first-time init, so a ping alone can succeed too early.
# Wait until a real query works as root over TCP.
echo -n "waiting for MySQL"
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" mysql -h127.0.0.1 -uroot -p"$ROOT_PASSWORD" -e 'SELECT 1' >/dev/null 2>&1; then
    echo " ready"
    break
  fi
  echo -n "."
  sleep 1
done
docker exec "$CONTAINER" mysql -h127.0.0.1 -uroot -p"$ROOT_PASSWORD" -e 'SELECT 1' >/dev/null 2>&1 \
  || { echo " timed out" >&2; exit 1; }

docker exec -i "$CONTAINER" mysql -h127.0.0.1 -uroot -p"$ROOT_PASSWORD" 2>/dev/null <<SQL
CREATE DATABASE IF NOT EXISTS orange_invest_dev  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS orange_invest_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'orange_app'@'%' IDENTIFIED BY '$APP_PASSWORD';
GRANT ALL PRIVILEGES ON orange_invest_dev.*  TO 'orange_app'@'%';
GRANT ALL PRIVILEGES ON orange_invest_test.* TO 'orange_app'@'%';

CREATE USER IF NOT EXISTS 'orange_agent_ro'@'%' IDENTIFIED BY '$RO_PASSWORD';
GRANT SELECT ON orange_invest_dev.*  TO 'orange_agent_ro'@'%';
GRANT SELECT ON orange_invest_test.* TO 'orange_agent_ro'@'%';

FLUSH PRIVILEGES;
SQL

echo "databases orange_invest_dev, orange_invest_test and users orange_app, orange_agent_ro are ready on 127.0.0.1:3306"
echo "next: npm run db:init"
