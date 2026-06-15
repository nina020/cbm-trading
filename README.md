# CBM Trading

Panel web para análisis, simulación y operación en cuenta demo de Deriv.

## Desarrollo local

1. Copia `.env.example` como `.env`.
2. Configura las credenciales de tu cuenta demo de Deriv.
3. Instala dependencias con `npm ci`.
4. Inicia la aplicación con `npm run dev`.
5. Abre `http://localhost:3000`.

## Variables requeridas

- `DERIV_TOKEN`: token privado de Deriv.
- `DERIV_APP_ID`: identificador de la aplicación Deriv.
- `DERIV_ACCOUNT_ID`: identificador de la cuenta demo.
- `APP_USERNAME`: usuario para proteger el sitio publicado.
- `APP_PASSWORD`: contraseña larga y privada para acceder al sitio.
- `PORT`: opcional localmente; el proveedor lo configura en producción.

Nunca guardes el archivo `.env` ni credenciales reales en Git.

## Verificación

```bash
npm test
npm run check
```

## Despliegue en Render

El archivo `render.yaml` define un servicio web Node.js con HTTPS y comprobación
de salud en `/health`.

1. Sube este proyecto a un repositorio privado de GitHub.
2. En Render, crea un Blueprint desde el repositorio.
3. Introduce las cinco variables privadas solicitadas.
4. Espera a que `/health` indique `{"status":"ok"}`.

El historial y la configuración del navegador todavía son locales a cada
computadora. Su sincronización corresponde a la siguiente fase con usuarios y
base de datos.
