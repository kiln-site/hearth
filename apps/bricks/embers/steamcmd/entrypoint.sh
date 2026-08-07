#!/usr/bin/env bash
set -Eeuo pipefail

: "${KILN_STEAM_APP_ID:?KILN_STEAM_APP_ID is required}"
: "${KILN_STEAM_EXECUTABLE:?KILN_STEAM_EXECUTABLE is required}"

install_directory="${KILN_STEAM_INSTALL_DIR:-/server}"
steamcmd_directory="${install_directory}/.steamcmd"
executable="${install_directory}/${KILN_STEAM_EXECUTABLE#/}"
first_install=false
installation_marker="${KILN_INSTALLATION_MARKER:-}"
if [[ -n "${installation_marker}" && ! "${installation_marker}" =~ ^\.kiln-[a-zA-Z0-9._-]{1,58}$ ]]; then
  echo "[Kiln Ember] KILN_INSTALLATION_MARKER must be a reserved .kiln-* filename" >&2
  exit 64
fi
installation_marker_path="${install_directory}/${installation_marker}"

mkdir -p "${install_directory}" "${install_directory}/steamapps" \
  "${install_directory}/.steam/sdk32" "${install_directory}/.steam/sdk64"
if [[ -n "${installation_marker}" ]]; then
  rm -f -- "${installation_marker_path}"
fi

if [[ ! -x "${steamcmd_directory}/steamcmd.sh" ]]; then
  echo "[Kiln Ember] provisioning SteamCMD"
  mkdir -p "${steamcmd_directory}"
  cp -a /opt/steamcmd/. "${steamcmd_directory}/"
fi

if [[ ! -e "${executable}" ]]; then
  first_install=true
  echo "[Kiln Ember] installing Steam app ${KILN_STEAM_APP_ID}"
else
  echo "[Kiln Ember] checking Steam app ${KILN_STEAM_APP_ID} for updates"
fi

steam_arguments=(
  +@sSteamCmdForcePlatformType linux
  +@sSteamCmdForcePlatformBitness 64
  +force_install_dir "${install_directory}"
  +login "${KILN_STEAM_LOGIN:-anonymous}"
  +app_update "${KILN_STEAM_APP_ID}"
)
if [[ "${first_install}" == "true" || "${KILN_STEAM_VALIDATE:-false}" == "true" ]]; then
  steam_arguments+=(validate)
fi
steam_arguments+=(+quit)

(cd "${steamcmd_directory}" && ./steamcmd.sh "${steam_arguments[@]}")

if [[ -f "${steamcmd_directory}/linux32/steamclient.so" ]]; then
  cp -f "${steamcmd_directory}/linux32/steamclient.so" "${install_directory}/.steam/sdk32/steamclient.so"
fi
if [[ -f "${steamcmd_directory}/linux64/steamclient.so" ]]; then
  cp -f "${steamcmd_directory}/linux64/steamclient.so" "${install_directory}/.steam/sdk64/steamclient.so"
fi

if [[ ! -e "${executable}" ]]; then
  echo "[Kiln Ember] configured executable was not installed: ${KILN_STEAM_EXECUTABLE}" >&2
  exit 70
fi

if [[ -n "${installation_marker}" ]]; then
  touch -- "${installation_marker_path}"
fi

read -r -a server_args <<< "${KILN_SERVER_ARGS:-}"
echo "[Kiln Ember] starting Steam app ${KILN_STEAM_APP_ID}"
cd "${install_directory}"
exec "${executable}" "${server_args[@]}"
