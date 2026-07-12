#!/bin/sh
set -eu

mkdir -p "${STORAGE_ROOT}/files"
chown node:node "${STORAGE_ROOT}" "${STORAGE_ROOT}/files"

exec gosu node node server.js
