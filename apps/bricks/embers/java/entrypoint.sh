#!/usr/bin/env bash
set -Eeuo pipefail

cd /server

: "${KILN_ARTIFACT_URL:?KILN_ARTIFACT_URL is required}"
: "${KILN_ARTIFACT_FILE:?KILN_ARTIFACT_FILE is required}"

installation_marker="${KILN_INSTALLATION_MARKER:-}"
if [[ -n "${installation_marker}" && ! "${installation_marker}" =~ ^\.kiln-[a-zA-Z0-9._-]{1,58}$ ]]; then
  echo "[Kiln Ember] KILN_INSTALLATION_MARKER must be a reserved .kiln-* filename" >&2
  exit 64
fi
if [[ -n "${installation_marker}" ]]; then
  rm -f -- "${installation_marker}"
fi

if [[ ! -s "${KILN_ARTIFACT_FILE}" ]]; then
  temporary=".${KILN_ARTIFACT_FILE}.download"
  echo "[Kiln Ember] downloading ${KILN_IMPLEMENTATION:-server} ${KILN_VERSION:-unknown}"
  if curl --fail --location --no-progress-meter --retry 2 --retry-all-errors \
    --connect-timeout 15 --max-time 300 \
    --output "${temporary}" "${KILN_ARTIFACT_URL}"; then
    mv -- "${temporary}" "${KILN_ARTIFACT_FILE}"
  else
    status=$?
    rm -f -- "${temporary}"
    echo "[Kiln Ember] failed to download ${KILN_IMPLEMENTATION:-server} ${KILN_VERSION:-unknown} after 3 attempts. Server startup failed. Swap to a different Brick in Startup, or contact support if this keeps happening." >&2
    exit "${status}"
  fi
fi

if [[ -n "${KILN_ARTIFACT_SHA256:-}" ]]; then
  printf '%s  %s\n' "${KILN_ARTIFACT_SHA256}" "${KILN_ARTIFACT_FILE}" | sha256sum --check --status
fi

if [[ "${KILN_SERVER_KIND:-minecraft}" == "minecraft" ]]; then
  printf 'eula=true\n' > eula.txt
  if [[ ! -f server.properties ]]; then
    printf '%s\n' \
      'server-port=25565' \
      'online-mode=false' \
      'motd=Kiln managed server' \
      'enable-rcon=false' > server.properties
  fi
fi

if [[ -n "${installation_marker}" ]]; then
  touch -- "${installation_marker}"
fi

read -r -a extra_java_args <<< "${KILN_JAVA_ARGS:-}"
read -r -a server_args <<< "${KILN_SERVER_ARGS:---nogui}"
java_memory_args=(-Xms"${MIN_RAM:-512M}")
if [[ -n "${MAX_RAM:-}" ]]; then
  java_memory_args+=(-Xmx"${MAX_RAM}")
else
  java_memory_args+=("-XX:MaxRAMPercentage=${KILN_JAVA_MAX_RAM_PERCENTAGE:-75.0}")
fi

echo "[Kiln Ember] starting ${KILN_IMPLEMENTATION:-server} ${KILN_VERSION:-unknown} with Java $(java -version 2>&1 | head -1)"
exec java \
  "${java_memory_args[@]}" \
  "${extra_java_args[@]}" \
  -jar "${KILN_ARTIFACT_FILE}" \
  "${server_args[@]}"
