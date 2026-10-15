// Loads the plugin entry the way Cline's git install does (root deps only, .ts via jiti)
// and checks it exports an AgentPlugin. Run from the repo root in CI.
import plugin from '../src/plugin/index';

if (plugin?.name !== 'clineshield' || typeof plugin.hooks?.beforeTool !== 'function') {
  console.error('plugin did not load as an AgentPlugin');
  process.exit(1);
}
console.log('plugin loaded with root dependencies only');
