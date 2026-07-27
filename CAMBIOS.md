# Registro de cambios

Este archivo lleva el control de los ajustes que se han hecho al proyecto,
explicados en lenguaje simple.

## 1. RSI con suavizado de Wilder (estándar de la industria)

**Por qué:** el RSI anterior promediaba todas las subidas/bajadas por igual.
El estándar real (TradingView, MetaTrader) le da más peso a los datos recientes
usando el "suavizado de Wilder", lo que da valores más precisos y comparables
con otras plataformas.

**Archivos:** `trading/strategy.js`, `trading/marketScanner.js`, `app.js`

## 2. Señales menos estrictas para detectar más oportunidades

**Por qué:** el umbral mínimo de calidad bajó de 70 a 65 y las confirmaciones
requeridas de 3 a 2. Esto permite que señales "moderadas" también activen
operaciones, no solo las "fuertes".

**Archivos:** `trading/signalScorer.js`

## 3. Filtro de ruido (señales más estrictas en el origen)

**Por qué:** antes, cualquier cruce mínimo de la media móvil contaba como señal.
Ahora el precio debe alejarse al menos medio desvío estándar de la media antes
de que el sistema lo considere una tendencia real. Filtra la "basura" sin
subir el umbral de calidad.

**Archivos:** `trading/strategy.js`, `config.js`

## 4. Detección de Soporte y Resistencia ← NUEVO

**Por qué:** el ebook "Trading desde Cero" de Billy Chacón dedica varios
capítulos a soporte y resistencia como los filtros más importantes antes de
entrar a una operación. La app no los tenía implementados, lo que significaba
que podía señalar "BUY" justo cuando el precio golpeaba una resistencia fuerte
(exactamente el peor momento para comprar según el libro).

**Qué hace ahora:**
- Detecta automáticamente los máximos y mínimos locales (pivots) del historial
  de precios reciente para identificar zonas donde el precio ha rebotado antes.
- Si el sistema detecta una señal BUY pero el precio ya está a menos del 1%
  de una resistencia, la señal se cancela (WAIT) porque comprar ahí tiene alta
  probabilidad de fracasar.
- Si detecta SELL pero el precio está a menos del 1% de un soporte, también
  cancela (mismo razonamiento inverso).
- Cuando la señal sí se ejecuta, incluye los niveles de soporte y resistencia
  detectados para contexto.

**Archivos:** `trading/strategy.js` (nueva función `detectarSoporteResistencia`),
`trading/marketScanner.js`, `app.js`

**Resultado de pruebas:** 55/55 pasaron (42 originales + 13 nuevas).
