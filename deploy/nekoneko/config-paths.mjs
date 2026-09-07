import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, join } from 'node:path';

export function validateConfigPaths(homeValue, dataValue) {
  if (!homeValue) throw new Error('A dedicated HOME is required.');
  const home = resolve(homeValue);
  const data = resolve(dataValue || join(home, '.openmausbot'));
  const rel = relative(home, data);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('OMB_DATA_DIR must be inside the dedicated HOME.');
  const marker = join(home, '.nekoneko-guide.json');
  if (lstatSync(home).isSymbolicLink() || !existsSync(marker) || lstatSync(marker).isSymbolicLink() || !lstatSync(marker).isFile() || JSON.parse(readFileSync(marker, 'utf8')).version !== 1) throw new Error('A regular dedicated guide marker is required.');
  for (const target of [data, join(home, '.claude-zai'), join(data, 'config.json'), join(data, 'config.json.before-nekoneko'), join(home, '.claude-zai', 'settings.json')]) {
    let current = home;
    for (const part of relative(home, target).split(sep)) {
      current = join(current, part);
      let stat;
      try { stat = lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat?.isSymbolicLink()) throw new Error('Configuration paths must not contain symlinks.');
    }
  }
  return { home, data };
}
