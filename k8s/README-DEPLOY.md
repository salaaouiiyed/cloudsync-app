# Déploiement AKS — CloudSync Pro

## Prérequis
- Azure CLI connecté (`az login`)
- kubectl configuré sur votre cluster AKS
- Azure Container Registry (ACR) configuré

## Étapes

### 1. Remplacer les placeholders
Dans tous les fichiers `k8s/`, remplacer :
- `<INGRESS_PUBLIC_IP>` → IP publique de votre Application Gateway (AGIC)
- `<ACR_NAME>` → nom de votre Azure Container Registry

```bash
# Récupérer l'IP de l'Ingress après premier déploiement
kubectl get ingress -n cloudsync
```

### 2. Builder et pousser les images

```bash
# Frontend (pas de build ARGs Keycloak — config au runtime)
docker build -t <ACR_NAME>.azurecr.io/cloudsync-frontend:latest ./frontend
docker push <ACR_NAME>.azurecr.io/cloudsync-frontend:latest

# Backend
docker build -t <ACR_NAME>.azurecr.io/cloudsync-backend:latest ./backend
docker push <ACR_NAME>.azurecr.io/cloudsync-backend:latest
```

### 3. Créer le ConfigMap Keycloak realm

```bash
kubectl create configmap keycloak-realm-config \
  --from-file=realm.json=./keycloak/realm-export.json \
  -n cloudsync
```

### 4. Appliquer les manifests

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/frontend-configmap.yaml   # <-- éditer l'IP d'abord
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/keycloak-deployment.yaml
kubectl apply -f k8s/ingress.yaml
```

### 5. Changer l'IP Keycloak sans rebuild

```bash
# Modifier le ConfigMap
kubectl edit configmap frontend-env-config -n cloudsync

# Redémarrer les Pods (env.sh regénère env-config.js avec la nouvelle IP)
kubectl rollout restart deployment/frontend -n cloudsync
```

## Comment ça marche

```
kubectl apply ConfigMap  →  Pod démarre  →  env.sh s'exécute
                             nginx lit les env vars du Pod
                             génère /html/env-config.js
                             nginx démarre
                             Browser charge env-config.js
                             window._env_.REACT_APP_KEYCLOAK_URL = "http://<INGRESS_IP>/auth"
                             React initialise Keycloak avec la bonne URL ✓
```
