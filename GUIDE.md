# 🚀 Foolproof Launch Guide: CloudSync Pro

If you are seeing "Cross-Origin Request Blocked" or "Network Error", follow this guide exactly. These errors happen because the browser blocks requests when security configurations don't match.

## 1. Clean Start (Important)
Before starting, ensure no old containers or volumes are interfering.
```bash
# Stop everything and remove old data
docker-compose down -v
```

## 2. Configuration Check
I have already fixed these in the code, but here is what was changed to fix your error:
- **Backend**: Set to `bearer-only: true`. This prevents the backend from trying to "redirect" your API calls to a login page, which was causing the CORS block.
- **Keycloak**: Web Origins is now strictly `http://localhost:3000`.
- **Frontend**: Fixed the initialization logic to prevent multiple Keycloak instances.

## 3. Launching
```bash
# Build and start
docker-compose up --build
```

## 4. How to Verify it's Working
1. Open **Chrome or Firefox** (Private/Incognito mode is best for testing).
2. Go to `http://localhost:3000`.
3. You will be redirected to Keycloak.
4. **Login as Admin**:
   - Username: `admin-user`
   - Password: `password123`
5. You should see the dashboard and be able to **Create Projects**.

## 5. Troubleshooting "Network Error"
If you still see "Network Error" in the console:
1. **Check Backend**: Open `http://localhost:5000/healthz`. If it says "OK", the backend is fine.
2. **Check Keycloak**: Open `http://localhost:8080`. If the page loads, Keycloak is fine.
3. **Browser Cache**: Clear your browser cache or try a different browser. Sometimes the browser "remembers" a CORS failure and keeps blocking it until restarted.

## 6. Architecture Note
- **Frontend (3000)** -> Requests Token from **Keycloak (8080)**.
- **Frontend (3000)** -> Sends Token to **Backend (5000)**.
- **Backend (5000)** -> Validates Token with **Keycloak (8080)** internally.

The browser only allows this if **Keycloak** and **Backend** explicitly permit `http://localhost:3000` in their headers. This is now fully configured.
