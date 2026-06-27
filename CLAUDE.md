# CLAUDE.md

Guía para agentes (y humanos) que trabajen en este repositorio.

## Qué es

**TuTicket / Secure Ticket** — plataforma académica de boletería Web2.5 sobre Stellar/Soroban.
Frontend React/Vite + backend Express/Prisma + PostgreSQL (Supabase) + contratos Soroban en Stellar Testnet.
Ver `README.md` para el concepto funcional completo y `docs/operations/RUNTIME_DEPLOYMENT.md` para la topología.

## Estructura

- `backend/` — API Express, Prisma, indexador Soroban y scripts operativos.
- `frontend/` — App React + Vite.
- `contracts/` — Smart contracts Soroban (Rust).
- `docs/` — Documentación técnica y operativa.

## Despliegue propio (este fork)

| Capa | Hosting | URL |
| --- | --- | --- |
| Frontend | Vercel | https://tu-ticket-pi.vercel.app |
| Backend/API | Railway (proceso long-lived) | https://tuticket-production.up.railway.app |
| Base de datos | Supabase (PostgreSQL, schema `ticketing`) | proyecto `afzgdipomxycbylsvalw` |
| Blockchain | Stellar Testnet / Soroban | — |

> **Entrar siempre por el alias estable `tu-ticket-pi.vercel.app`.** Las URLs de deploy de Vercel
> con hash (`tu-ticket-<hash>.vercel.app`) cambian en cada despliegue y son rechazadas por CORS.

## Setup local

```bash
# Backend
cd backend
npm install
npm run prisma:generate
npm run dev          # http://localhost:3000

# Frontend (otra terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Requiere crear (no se versionan): `backend/.env` y `frontend/.env`.
Las plantillas están en `backend/.env.example` y `frontend/.env.example`.
**Los valores reales (DB, JWT, organizer, QR) se piden al dueño del repo — nunca se commitean.**

### Variables que necesita el backend (`backend/.env`)
`DATABASE_URL`, `DIRECT_URL` (Supabase: pooler 6543 para la app, sesión 5432 para migraciones),
`CORS_ORIGINS`, `SOROBAN_RPC_URL`, `HORIZON_URL`, `SOROBAN_NETWORK_PASSPHRASE`,
`JWT_SECRET`, `ORGANIZER_SECRET`, `ORGANIZER_PUBLIC`, `QR_SIGNING_SECRET`,
`PUBLIC_BASE_URL`, `ISSUER_HOME_DOMAIN`, `RUN_INDEXER`.

### Variables que necesita el frontend (`frontend/.env`)
`VITE_API_BASE_URL` — apuntar al backend (Railway en prod, `http://localhost:3000` en local).

## Datos de demo

- `npm run refresh:demo-events` (en `backend/`) — crea/actualiza ~30 eventos demo publicados.
- `scripts/create-staff-user.ts` — crea/actualiza un usuario STAFF (configurable por env vars).
- Existen usuarios demo (ADMIN/STAFF/CUSTOMER) en la DB; **las credenciales se comparten en privado**, no van en el repo.

## Notas operativas (¡importantes!)

- **CORS es por coincidencia exacta** (`backend/src/securityPolicy.ts` → `isCorsOriginAllowed`).
  `*` **no** es comodín: hay que listar los orígenes exactos en `CORS_ORIGINS` (separados por coma).
- **`RUN_INDEXER=true` solo en UN entorno** (Railway/producción). En local déjalo en `false`
  para no correr dos indexers contra el mismo Soroban RPC.
- **`ORGANIZER_SECRET` es custodial del backend**: nunca exponerlo ni importarlo en el frontend.
  Está atado a los contratos ya desplegados en Testnet — no regenerarlo a la ligera.
- En Railway el `PORT` lo inyecta la plataforma; el server usa `process.env.PORT || 3000`.
- La DB Supabase es **compartida** por el equipo: cuidado con scripts destructivos.
- `vercel.json` del frontend tiene rewrites/proxy hacia el backend de Railway por URL;
  si cambia el dominio del backend hay que actualizarlo ahí.

## Comprobaciones rápidas

```bash
curl https://tuticket-production.up.railway.app/health        # {"status":"ok",...}
curl https://tuticket-production.up.railway.app/api/events     # lista de eventos
```
