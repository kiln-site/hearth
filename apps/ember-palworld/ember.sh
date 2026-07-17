#!/usr/bin/env bash
set -Eeuo pipefail

cd /server

if [[ "${KILN_VERSION:-latest}" != "latest" ]]; then
  echo "[Kiln Ember] Palworld supports the latest Steam build only" >&2
  exit 64
fi

steamcmd_directory="/server/.steamcmd"
steamcmd="${steamcmd_directory}/linux64/steamcmd"
server="/server/Pal/Binaries/Linux/PalServer-Linux-Shipping"
first_install=false

if [[ ! -x "${steamcmd_directory}/steamcmd.sh" ]]; then
  echo "[Kiln Ember] provisioning SteamCMD"
  mkdir -p "${steamcmd_directory}"
  cp -a /opt/steamcmd/. "${steamcmd_directory}/"
fi

if [[ ! -x "${steamcmd}" ]]; then
  echo "[Kiln Ember] updating SteamCMD runtime"
  if ! (cd "${steamcmd_directory}" && ./steamcmd.sh +quit); then
    if [[ ! -x "${steamcmd}" ]]; then
      echo "[Kiln Ember] SteamCMD bootstrap failed" >&2
      exit 70
    fi
    echo "[Kiln Ember] continuing with the installed 64-bit SteamCMD client"
  fi
fi

if [[ ! -x "${server}" ]]; then
  first_install=true
  echo "[Kiln Ember] installing Palworld dedicated server"
else
  echo "[Kiln Ember] checking for Palworld updates"
fi

export HOME=/server
mkdir -p /server/steamapps /server/.steam/sdk32 /server/.steam/sdk64

steam_arguments=(
  +@sSteamCmdForcePlatformType linux
  +@sSteamCmdForcePlatformBitness 64
  +force_install_dir /server
  +login anonymous
  +app_update 2394010
)
if [[ "${first_install}" == "true" ]]; then
  steam_arguments+=(validate)
fi
steam_arguments+=(+quit)

(cd "${steamcmd_directory}" && ./linux64/steamcmd "${steam_arguments[@]}")

cp -f "${steamcmd_directory}/linux32/steamclient.so" /server/.steam/sdk32/steamclient.so
cp -f "${steamcmd_directory}/linux64/steamclient.so" /server/.steam/sdk64/steamclient.so

settings="/server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"
if [[ ! -f "${settings}" && -f /server/DefaultPalWorldSettings.ini ]]; then
  echo "[Kiln Ember] creating default Palworld settings"
  mkdir -p "$(dirname "${settings}")"
  cp /server/DefaultPalWorldSettings.ini "${settings}"
fi

read -r -a extra_server_args <<< "${KILN_SERVER_ARGS:-}"

echo "[Kiln Ember] starting Palworld ${KILN_VERSION:-latest} on UDP 8211"
exec "${server}" \
  Pal \
  -publiclobby \
  -useperfthreads \
  -NoAsyncLoadingThread \
  -UseMultithreadForDS \
  -port=8211 \
  -publicport=8211 \
  "${extra_server_args[@]}"
