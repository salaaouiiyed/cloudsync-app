# =============================================================================
# STAGE 1 — BUILD (aucune variable Keycloak baked-in)
# La config est injectée 100% au runtime par env.sh via le ConfigMap AKS
# =============================================================================
FROM node:16-alpine AS build
WORKDIR /app

# On s'assure que NODE_OPTIONS est vide pour éviter l'erreur openssl-legacy-provider sur Node 16
ENV NODE_OPTIONS=""
# CI=false est CRUCIAL pour que react-scripts ignore les warnings lors du build
ENV CI=false
ENV GENERATE_SOURCEMAP=false
# API_URL vide = chemin relatif -> nginx proxy /api/ -> backend (service K8s)
ENV REACT_APP_API_URL=

COPY package*.json ./
# On force la suppression de NODE_OPTIONS au moment du RUN pour être certain
RUN unset NODE_OPTIONS && npm install --legacy-peer-deps

COPY . .
# Build de l'application React en forçant CI=false pour ignorer les warnings
RUN unset NODE_OPTIONS && CI=false npm run build

# =============================================================================
# STAGE 2 — NGINX PRODUCTION
# =============================================================================
FROM nginx:stable-alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# env.sh est executé automatiquement par nginx:alpine AVANT de lancer nginx
COPY env.sh /docker-entrypoint.d/10-env-config.sh
RUN chmod +x /docker-entrypoint.d/10-env-config.sh

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
