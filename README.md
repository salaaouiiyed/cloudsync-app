# CloudSync Pro — Multi-Tenant

## Démarrage rapide

```bash
docker-compose up --build
```

Attendre ~2 minutes que Keycloak démarre, puis ouvrir http://localhost:3000

## Utilisateurs de test

| Username       | Password     | Rôle        | Tenant       |
|----------------|--------------|-------------|--------------|
| super-admin    | password123  | super_admin | platform     |
| admin-user     | password123  | admin       | tenant-alpha |
| standard-user  | password123  | user        | tenant-alpha |

## Services

| Service    | URL                      |
|------------|--------------------------|
| Frontend   | http://localhost:3000    |
| Backend    | http://localhost:5000    |
| Keycloak   | http://localhost:8080    |

## Commandes utiles

```bash
# Voir les logs
docker-compose logs -f

# Voir les logs d'un seul service
docker-compose logs -f backend

# Redémarrer sans reconstruire
docker-compose restart

# Tout nettoyer (supprime les données MongoDB!)
docker-compose down -v
```

## Architecture

- Le **frontend** (React) tourne sur le port 3000 via nginx
- Toutes les requêtes `/api/*` sont proxifiées par nginx vers le backend (port 5000 interne)
- L'**authentification** passe par Keycloak (port 8080)
- Le **tenantId** de chaque utilisateur est défini dans ses attributs Keycloak (`tenant_id`)
