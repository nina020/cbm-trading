// Duración de cada vela en segundos. 15s da señales más estables que 5s
// porque cada punto del MA/RSI representa 15 segundos reales de mercado,
// no un tick individual (que en mercados rápidos puede ser menos de 1 segundo).
export const INTERVALO_VELA = 15;

// Número de VELAS (no ticks) que se usan para el MA y el RSI.
// Con INTERVALO_VELA = 15s y VELAS_PARA_SENAL = 14:
//   → cada señal resume 14 × 15s = 3.5 minutos de mercado (RSI estándar)
export const VELAS_PARA_SENAL = 14;
export const RATIO_RECOMPENSA = 2.0;
// Distancias de salida en desviaciones estándar de la ventana de ticks.
// TP debe ser SL * RATIO_RECOMPENSA para conservar el ratio riesgo/recompensa.
export const SL_DESVIACIONES = 3;
export const TP_DESVIACIONES = SL_DESVIACIONES * RATIO_RECOMPENSA;
export const FRACCION_RIESGO_STAKE = 0.25;
// Distancia mínima al MA (en desviaciones) para que un movimiento sea señal real y no ruido.
export const FILTRO_RUIDO_DESVIACIONES = 0.5;
// Periodo de la EMA larga usada para determinar la tendencia general del mercado.
// El ebook de Billy Chacón usa la EMA 200 como filtro de dirección (Módulo 2, tema 19).
export const PERIODO_EMA = 200;
export const MULTIPLICADOR_DEFAULT = 100;
export const EXECUTION_STORAGE_KEY = 'cbm_ejecuciones_v2';
export const SIGNAL_CONFIG_STORAGE_KEY = 'cbm_signal_config_v1';
export const STRATEGY_CONFIG_STORAGE_KEY = 'cbm_strategy_config_v1';
export const GLOBAL_RISK_STORAGE_KEY = 'cbm_global_risk_v2';
export const ORDER_AUDIT_STORAGE_KEY = 'cbm_order_audit_v1';

export const NOMBRES_SIMBOLOS = {
  BOOM300N: 'Boom 300',
  BOOM500: 'Boom 500', BOOM600: 'Boom 600', BOOM900: 'Boom 900', BOOM1000: 'Boom 1000',
  CRASH500: 'Crash 500', CRASH600: 'Crash 600', CRASH900: 'Crash 900', CRASH1000: 'Crash 1000',
  stpRNG: 'Step 100', stpRNG2: 'Step 200', stpRNG3: 'Step 300', stpRNG4: 'Step 400', stpRNG5: 'Step 500',
  '1HZ10V': 'Vol 10 (1s)', R_10: 'Vol 10', '1HZ25V': 'Vol 25 (1s)', R_25: 'Vol 25',
  '1HZ50V': 'Vol 50 (1s)', R_50: 'Vol 50', '1HZ75V': 'Vol 75 (1s)', R_75: 'Vol 75',
  '1HZ100V': 'Vol 100 (1s)', R_100: 'Vol 100',
};

export const MERCADOS_ESTABLES = [
  { id: 'BOOM300N', nombre: 'Boom 300', perfil: 'media' },
  { id: 'BOOM1000', nombre: 'Boom 1000', perfil: 'estable' },
  { id: 'CRASH1000', nombre: 'Crash 1000', perfil: 'estable' },
  { id: 'stpRNG', nombre: 'Step 100', perfil: 'estable' },
  { id: 'stpRNG2', nombre: 'Step 200', perfil: 'estable' },
  { id: 'stpRNG3', nombre: 'Step 300', perfil: 'estable' },
  { id: 'stpRNG4', nombre: 'Step 400', perfil: 'estable' },
  { id: 'stpRNG5', nombre: 'Step 500', perfil: 'estable' },
  { id: '1HZ10V', nombre: 'Vol 10 (1s)', perfil: 'estable' },
  { id: 'R_10', nombre: 'Vol 10', perfil: 'estable' },
  { id: '1HZ25V', nombre: 'Vol 25 (1s)', perfil: 'estable' },
  { id: 'R_25', nombre: 'Vol 25', perfil: 'estable' },
];

export const TEMAS = {
  dark: { bg: '#1e222d', text: '#9598a1', grid: '#2a2e39', border: '#2a2e39' },
  light: { bg: '#ffffff', text: '#6b7280', grid: '#e0e3eb', border: '#e0e3eb' },
};
