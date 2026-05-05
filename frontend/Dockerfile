FROM node:18-alpine AS build
WORKDIR /app
ENV NODE_OPTIONS=--openssl-legacy-provider
ENV CI=false
COPY package*.json ./
RUN npm install --force --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:stable-alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf


RUN mkdir -p /usr/share/nginx/html && \
    echo "window._env_ = {};" > /usr/share/nginx/html/env-config.js && \
    chmod 666 /usr/share/nginx/html/env-config.js

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
