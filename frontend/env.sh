#!/bin/sh
# =============================================================================
# RUNTIME CONFIG INJECTION — AKS / Azure Kubernetes Service
# Exécuté automatiquement par nginx:alpine au démarrage du container
# Les valeurs viennent du ConfigMap Kubernetes (envFrom ou env:)
# =============================================================================
set -e

TARGET=/usr/share/nginx/html/env-config.js

cat > "$TARGET" <<JSEOF
/* AUTO-GENERATED at container start by env.sh — do not edit */
window._env_ = {
  REACT_APP_KEYCLOAK_URL:       "${REACT_APP_KEYCLOAK_URL}",
  REACT_APP_KEYCLOAK_REALM:     "${REACT_APP_KEYCLOAK_REALM}",
  REACT_APP_KEYCLOAK_CLIENT_ID: "${REACT_APP_KEYCLOAK_CLIENT_ID}",
  REACT_APP_API_URL:            "${REACT_APP_API_URL}"
};
JSEOF

echo "[env.sh] env-config.js generated with:"
echo "  KEYCLOAK_URL  = ${REACT_APP_KEYCLOAK_URL}"
echo "  KEYCLOAK_REALM= ${REACT_APP_KEYCLOAK_REALM}"
echo "  API_URL       = ${REACT_APP_API_URL}"
