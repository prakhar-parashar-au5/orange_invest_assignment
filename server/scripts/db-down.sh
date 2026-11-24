#!/usr/bin/env bash
# Stop the local MySQL container. Data stays in the orange-mysql-data volume.
# To wipe everything: docker rm -f orange-mysql && docker volume rm orange-mysql-data
set -euo pipefail

if docker container inspect orange-mysql >/dev/null 2>&1; then
  docker stop orange-mysql >/dev/null
  echo "orange-mysql stopped (data kept in volume orange-mysql-data)"
else
  echo "orange-mysql does not exist; nothing to stop"
fi
