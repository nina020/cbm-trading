# CBM Trading

Panel web para análisis, simulación, operación en cuenta demo y estructura de cuenta real controlada en Deriv.

## Desarrollo local

1. Copia `.env.example` como `.env`.
2. Configura las credenciales de tu cuenta demo de Deriv.
3. Instala dependencias con `npm ci`.
4. Inicia la aplicación con `npm run dev`.
5. Abre `http://localhost:3000`.

## Variables requeridas

- `DERIV_APP_ID`: identificador de la aplicación Deriv.
- `DERIV_DEMO_TOKEN`: token privado de la cuenta demo de Deriv.
- `DERIV_DEMO_ACCOUNT_ID`: identificador de la cuenta demo.
- `DERIV_REAL_TOKEN`: token privado de la cuenta real de Deriv, solo si usarás modo real controlado.
- `DERIV_REAL_ACCOUNT_ID`: identificador de la cuenta real, solo si usarás modo real controlado.
- `DERIV_TOKEN` y `DERIV_ACCOUNT_ID`: compatibilidad anterior; si no configuras `DERIV_DEMO_*`, se usan como demo.
- `APP_USERNAME`: usuario para proteger el sitio publicado.
- `APP_PASSWORD`: contraseña larga y privada para acceder al sitio.
- `MICROSOFT_CLIENT_ID`: Application (client) ID de Microsoft Entra para SSO.
- `MICROSOFT_CLIENT_SECRET`: Value del client secret de Microsoft Entra.
- `MICROSOFT_TENANT_ID`: Directory (tenant) ID de Microsoft Entra.
- `SESSION_SECRET`: clave larga y privada para firmar sesiones web.
- `MICROSOFT_ALLOWED_EMAILS`: opcional; lista separada por comas para limitar qué correos Microsoft pueden entrar.
- `MICROSOFT_REDIRECT_URI`: opcional; por defecto se usa `/auth/microsoft/callback` sobre el dominio público.
- `PORT`: opcional localmente; el proveedor lo configura en producción.

Nunca guardes el archivo `.env` ni credenciales reales en Git.

## Microsoft SSO

Para iniciar sesión con Microsoft, registra una app en Microsoft Entra ID con
esta redirect URI:

```txt
https://cbm-trading.onrender.com/auth/microsoft/callback
```

Luego configura en Render `MICROSOFT_CLIENT_ID`,
`MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` y `SESSION_SECRET`.
`APP_USERNAME` y `APP_PASSWORD` pueden quedarse como respaldo temporal.

## Verificación

```bash
npm test
npm run check
```

## Despliegue en Render

El archivo `render.yaml` define un servicio web Node.js con HTTPS, PostgreSQL y
comprobación de salud en `/health`.

1. Sube este proyecto a un repositorio privado de GitHub.
2. En Render, crea un Blueprint desde el repositorio.
3. Introduce las variables privadas solicitadas. Las variables reales son opcionales hasta activar cuenta real controlada.
4. Espera a que `/health` indique `{"status":"ok"}`.

## Sincronización entre computadoras

Cuando `DATABASE_URL` está disponible, el servidor crea la tabla `app_state` y
sincroniza estas claves:

- Historial de señales.
- Registro de ejecuciones.
- Posiciones simuladas.
- Calidad de señales.
- Calibraciones por mercado.
- Límites globales de riesgo.

En desarrollo local, si no hay `DATABASE_URL`, se usa `.data/cloud-state.json`
como respaldo.
