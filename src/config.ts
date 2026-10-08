/**
 * Configuration management with environment variable support
 */

export interface Config {
  gallicaBaseUrl: string;
  gallicaSruUrl: string;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  httpTimeout: number;
  httpRetries: number;
  /** Total time budget for one Gallica call, including queueing and retries */
  httpDeadline: number;
  /** Minimum spacing between requests to Gallica (Gallica bans IPs that send bursts) */
  minRequestInterval: number;
  cacheTtl: number;
  defaultMaxRecords: number;
  defaultStartRecord: number;
  iconUrl?: string;
}

/**
 * Default configuration matching Python constants
 */
const DEFAULT_CONFIG: Config = {
  gallicaBaseUrl: 'https://gallica.bnf.fr',
  gallicaSruUrl: 'https://gallica.bnf.fr/SRU',
  logLevel: 'debug', // Default to debug for verbose output
  // Gallica search regularly takes 10-30s from Vercel, so allow one long attempt
  httpTimeout: 45000,
  httpRetries: 1,
  httpDeadline: 55000,
  minRequestInterval: 1000,
  cacheTtl: 10 * 60 * 1000,
  defaultMaxRecords: 10,
  defaultStartRecord: 1,
};

/**
 * Load configuration from environment variables with defaults
 */
export function loadConfig(): Config {
  const logLevel = (process.env.LOG_LEVEL as Config['logLevel']) || DEFAULT_CONFIG.logLevel;
  if (!['error', 'warn', 'info', 'debug'].includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}. Must be one of: error, warn, info, debug`);
  }

  const config = {
    gallicaBaseUrl: process.env.GALLICA_BASE_URL || DEFAULT_CONFIG.gallicaBaseUrl,
    gallicaSruUrl: process.env.GALLICA_SRU_URL || DEFAULT_CONFIG.gallicaSruUrl,
    logLevel,
    httpTimeout: parseInt(process.env.HTTP_TIMEOUT || String(DEFAULT_CONFIG.httpTimeout), 10),
    httpRetries: parseInt(process.env.HTTP_RETRIES || String(DEFAULT_CONFIG.httpRetries), 10),
    httpDeadline: parseInt(process.env.HTTP_DEADLINE || String(DEFAULT_CONFIG.httpDeadline), 10),
    minRequestInterval: parseInt(
      process.env.GALLICA_MIN_INTERVAL_MS || String(DEFAULT_CONFIG.minRequestInterval),
      10
    ),
    cacheTtl: parseInt(process.env.GALLICA_CACHE_TTL_MS || String(DEFAULT_CONFIG.cacheTtl), 10),
    defaultMaxRecords: parseInt(
      process.env.DEFAULT_MAX_RECORDS || String(DEFAULT_CONFIG.defaultMaxRecords),
      10
    ),
    defaultStartRecord: parseInt(
      process.env.DEFAULT_START_RECORD || String(DEFAULT_CONFIG.defaultStartRecord),
      10
    ),
    ...(process.env.MCP_ICON_URL ? { iconUrl: process.env.MCP_ICON_URL } : {}), // Optional: absolute URL to icon, or relative path
  };
  
  // Log configuration on startup (but only if log level allows)
  if (logLevel === 'debug' || logLevel === 'info') {
    console.log('[CONFIG] Configuration loaded:', {
      logLevel: config.logLevel,
      gallicaBaseUrl: config.gallicaBaseUrl,
      gallicaSruUrl: config.gallicaSruUrl,
    });
  }
  
  return config;
}

/**
 * Global configuration instance
 */
export const config = loadConfig();

