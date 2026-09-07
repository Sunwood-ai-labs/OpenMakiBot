export function guideSettings(env = process.env) {
  const integer = (name, fallback, min, max) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
    return value;
  };
  const model = env.OMB_GLM_MODEL || 'glm-5.3';
  if (!/^[a-zA-Z0-9._/-]+$/.test(model)) throw new Error('Invalid OMB_GLM_MODEL.');
  const baseUrl = new URL(env.OMB_ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic');
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error('OMB_ANTHROPIC_BASE_URL must be an HTTPS endpoint without credentials.');
  return {
    model, baseUrl: baseUrl.href.replace(/\/$/, ''),
    port: integer('OMB_PORT', 31799, 1, 65535),
    turnTimeout: integer('OMB_TURN_TIMEOUT_MINUTES', 20, 1, 120),
  };
}
