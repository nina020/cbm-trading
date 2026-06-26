export const INTERVALO_VELA = 5;
export const MAX_HISTORIAL_VISIBLE = 30;
export const RATIO_RECOMPENSA = 1.5;
export const FRACCION_RIESGO_STAKE = 0.9;
export const MULTIPLICADOR_DEFAULT = 100;
export const STORAGE_KEY = 'cbm_historial_v1';
export const SIM_STORAGE_KEY = 'cbm_posiciones_simuladas_v1';
export const EXECUTION_STORAGE_KEY = 'cbm_ejecuciones_v2';
export const SIGNAL_CONFIG_STORAGE_KEY = 'cbm_signal_config_v1';
export const STRATEGY_CONFIG_STORAGE_KEY = 'cbm_strategy_config_v1';
export const MARKET_CALIBRATION_STORAGE_KEY = 'cbm_market_calibration_v1';
export const GLOBAL_RISK_STORAGE_KEY = 'cbm_global_risk_v1';
export const ORDER_AUDIT_STORAGE_KEY = 'cbm_order_audit_v1';

export const NOMBRES_SIMBOLOS = {
  BOOM500: 'Boom 500', BOOM600: 'Boom 600', BOOM900: 'Boom 900', BOOM1000: 'Boom 1000',
  CRASH500: 'Crash 500', CRASH600: 'Crash 600', CRASH900: 'Crash 900', CRASH1000: 'Crash 1000',
  stpRNG: 'Step 100', stpRNG2: 'Step 200', stpRNG3: 'Step 300', stpRNG4: 'Step 400', stpRNG5: 'Step 500',
  '1HZ10V': 'Vol 10 (1s)', R_10: 'Vol 10', '1HZ25V': 'Vol 25 (1s)', R_25: 'Vol 25',
  '1HZ50V': 'Vol 50 (1s)', R_50: 'Vol 50', '1HZ75V': 'Vol 75 (1s)', R_75: 'Vol 75',
  '1HZ100V': 'Vol 100 (1s)', R_100: 'Vol 100',
};

export const MERCADOS_ESTABLES = [
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
