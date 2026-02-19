import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

interface NoNukeConfig {
  max_deleted_functions?: number;
  max_structural_change_lines?: number;
  max_structural_change_percent?: number;
}

interface SanityConfig {
  tools?: string[];
  max_retries?: number;
  timeout_seconds?: number;
}

interface RiskConfig {
  protected_paths?: string[];
}

interface ClineShieldConfig {
  'no-nuke'?: NoNukeConfig;
  sanity?: SanityConfig;
  risk?: RiskConfig;
}

const CONFIG_FILE = '.cline-shield.yml';

/**
 * Loads .cline-shield.yml from the workspace root and sets env vars for hooks.
 * Safe to call even if the file does not exist — returns early without error.
 */
export function loadConfig(workspaceRoot: string): void {
  const configPath = path.join(workspaceRoot, CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    console.log(`ClineShield: no ${CONFIG_FILE} found, using hook defaults`);
    return;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(raw) as ClineShieldConfig;

    if (!config || typeof config !== 'object') {
      console.warn(`ClineShield: ${CONFIG_FILE} is empty or invalid, using hook defaults`);
      return;
    }

    const noNuke = config['no-nuke'];
    if (noNuke) {
      if (noNuke.max_deleted_functions !== undefined) {
        process.env.CLINESHIELD_MAX_FUNCTIONS = String(noNuke.max_deleted_functions);
      }
      if (noNuke.max_structural_change_lines !== undefined) {
        process.env.CLINESHIELD_MIN_LINES = String(noNuke.max_structural_change_lines);
      }
      if (noNuke.max_structural_change_percent !== undefined) {
        process.env.CLINESHIELD_MAX_CHANGE = String(noNuke.max_structural_change_percent);
      }
    }

    const sanity = config.sanity;
    if (sanity) {
      if (Array.isArray(sanity.tools) && sanity.tools.length > 0) {
        process.env.CLINESHIELD_TOOLS = sanity.tools.join(' ');
      }
      if (sanity.max_retries !== undefined) {
        process.env.CLINESHIELD_MAX_RETRIES = String(sanity.max_retries);
      }
      if (sanity.timeout_seconds !== undefined) {
        process.env.CLINESHIELD_TIMEOUT = String(sanity.timeout_seconds);
      }
    }

    const risk = config.risk;
    if (risk) {
      if (Array.isArray(risk.protected_paths) && risk.protected_paths.length > 0) {
        process.env.CLINESHIELD_PROTECTED_PATHS = risk.protected_paths.join(':');
      } else if (risk.protected_paths !== undefined) {
        // Explicitly empty list — disable the protected path rule
        process.env.CLINESHIELD_PROTECTED_PATHS = 'none';
      }
    }

    console.log(`ClineShield: config loaded from ${CONFIG_FILE}`);
    console.log(`  no-nuke  → MAX_FUNCTIONS=${process.env.CLINESHIELD_MAX_FUNCTIONS ?? '(default)'}`);
    console.log(`             MIN_LINES=${process.env.CLINESHIELD_MIN_LINES ?? '(default)'}`);
    console.log(`             MAX_CHANGE=${process.env.CLINESHIELD_MAX_CHANGE ?? '(default)'}`);
    console.log(`  sanity   → TOOLS=${process.env.CLINESHIELD_TOOLS ?? '(default)'}`);
    console.log(`             MAX_RETRIES=${process.env.CLINESHIELD_MAX_RETRIES ?? '(default)'}`);
    console.log(`             TIMEOUT=${process.env.CLINESHIELD_TIMEOUT ?? '(default)'}`);
    console.log(`  risk     → PROTECTED_PATHS=${process.env.CLINESHIELD_PROTECTED_PATHS ?? '(default)'}`);
  } catch (err) {
    console.error(`ClineShield: failed to parse ${CONFIG_FILE} — ${(err as Error).message}`);
    console.error('ClineShield: using hook defaults');
  }
}
