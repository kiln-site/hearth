#!/usr/bin/env sh

set -eu

compose() {
  docker compose -f compose.yaml -f compose.dev.yaml "$@"
}

wait_for_service() {
  service="$1"
  attempts=0
  max_attempts=90

  while [ "$attempts" -lt "$max_attempts" ]; do
    container_id="$(compose ps --quiet "$service")"

    if [ -n "$container_id" ]; then
      status="$(
        docker inspect \
          --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
          "$container_id"
      )"

      case "$status" in
        healthy | running)
          echo "$service is ready."
          return 0
          ;;
        exited | dead)
          echo "$service stopped before becoming ready." >&2
          compose logs --tail 80 "$service" >&2
          return 1
          ;;
      esac
    fi

    attempts=$((attempts + 1))
    sleep 2
  done

  echo "Timed out waiting for $service to become ready." >&2
  compose logs --tail 80 "$service" >&2
  return 1
}

for service in cache mysql relay hearth; do
  if [ -z "$(compose ps --quiet "$service")" ]; then
    echo "The development stack is not running; starting it without tearing it down."
    compose up --detach --wait hearth
    exit 0
  fi
done

echo "Restarting Relay without recreating the development stack..."
compose restart relay
wait_for_service relay

echo "Restarting Hearth without recreating the development stack..."
compose restart hearth
wait_for_service hearth

echo "The development stack is refreshed and healthy."
