// Version logicielle stricte du hub et environnement d'exécution. Source unique : logs, /api/me, portail, télémétrie.
export const VERSION = "1.2.0";
export const APP_ENV = process.env.APP_ENV === "production" ? "PRODUCTION" : "PRE-PROD";
export const IS_PROD = APP_ENV === "PRODUCTION";
