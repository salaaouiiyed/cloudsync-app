# =============================================================================
# STAGE 1 — BUILD
# =============================================================================
FROM node:18-bullseye-slim AS build
WORKDIR /app

# Ensure clean build environment
ENV CI=false
ENV GENERATE_SOURCEMAP=false
ENV REACT_APP_API_URL=

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies with flags to handle version conflicts
RUN npm install --force --legacy-peer-deps

# Copy source files
COPY . .

# Perform the build
RUN npm run build

# =============================================================================
# STAGE 2 — NGINX PRODUCTION
# =============================================================================
FROM nginx:stable-alpine

# Copy the built assets from the build stage
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# env.sh is executed automatically by nginx:alpine BEFORE starting nginx
COPY env.sh /docker-entrypoint.d/10-env-config.sh
RUN chmod +x /docker-entrypoint.d/10-env-config.sh

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
