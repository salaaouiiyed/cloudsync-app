FROM node:18-alpine
WORKDIR /app

# FIX 8: Copier package*.json pour npm install reproductible
COPY package*.json ./
# --production exclut devDependencies (nodemon etc)
RUN npm install --production --legacy-peer-deps

COPY . .

# FIX 9: Créer un user non-root pour la sécurité (bonne pratique Docker)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 5000
CMD ["node", "index.js"]
