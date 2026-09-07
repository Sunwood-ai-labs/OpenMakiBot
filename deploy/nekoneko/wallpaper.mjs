import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const contained = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/** Apply the supplied role's existing wallpaper to its recorded guide desktop.
 * Caller obtains a fresh GET /api/bots/:id/local-computer response as status.
 * No API requests, model calls, image edits or global image mutations occur here.
 */
export async function applyWallpaper({ container, role, status, root = process.env.HOME, assetDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wallpapers'), podman = 'podman' }) {
  if (!root || !['sora', 'kinako'].includes(role)) throw new Error('Wallpaper requires a dedicated root and sora/kinako role.');
  root = path.resolve(root);
  const marker = path.join(root, '.nekoneko-guide.json');
  if ((await fs.lstat(marker)).isSymbolicLink() || JSON.parse(await fs.readFile(marker, 'utf8')).version !== 1) throw new Error('Dedicated guide marker required for wallpaper.');
  const manifestFile = path.join(root, 'nekoneko-team.json');
  if ((await fs.lstat(manifestFile)).isSymbolicLink()) throw new Error('Team manifest must not be a symlink.');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const bot = manifest.bots?.[role];
  if (!bot?.id || !/^[a-zA-Z0-9-]+$/.test(bot.id)) throw new Error('Recorded role bot is required.');
  const expected = `openmausbot-computer-${createHash('sha256').update(bot.id).digest('hex').slice(0, 16)}`;
  if (container !== expected || container !== bot.container || !status?.managed || status.container !== 'running' || status.container_name !== container || status.workspace_path !== bot.workspace || !contained(root, bot.workspace)) throw new Error('Wallpaper target must match the recorded, managed guide desktop.');
  if (!contained(await fs.realpath(root), await fs.realpath(bot.workspace))) throw new Error('Wallpaper workspace escapes guide root.');
  const source = path.join(assetDir, `${role}.png`);
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('Wallpaper asset must be a regular PNG file.');
  const png = await fs.readFile(source);
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid wallpaper PNG.');
  const call = async args => (await exec(podman, args, { timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();
  const inspected = JSON.parse(await call(['inspect', container]))[0];
  const labels = inspected.Config?.Labels || {};
  const mount = inspected.Mounts?.find(item => item.Destination === '/home/cua/workspace');
  if (inspected.Name.replace(/^\//, '') !== container || !labels['com.openmausbot.local-vm'] || mount?.Source !== bot.workspace) throw new Error('Live container identity or workspace does not match guide manifest.');
  const temporary = `/tmp/nekoneko-wallpaper-${role}.png`;
  const destination = `/home/cua/.local/share/backgrounds/nekoneko-${role}.png`;
  await call(['cp', source, `${container}:${temporary}`]);
  await call(['exec', '--user', 'root', container, 'chmod', '644', temporary]);
  await call(['exec', '--user', 'cua', container, 'mkdir', '-p', '/home/cua/.local/share/backgrounds']);
  await call(['exec', '--user', 'cua', container, 'install', '-m', '644', temporary, destination]);
  const gui = ['exec', '--user', 'cua', '--env', 'DISPLAY=:1', '--env', 'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus', container];
  const properties = (await call([...gui, 'xfconf-query', '-c', 'xfce4-desktop', '-l'])).split('\n').map(item => item.trim()).filter(item => /^\/backdrop\/screen\d+\/monitor[^/]+\/workspace\d+\/last-image$/.test(item));
  if (!properties.length) throw new Error('No XFCE backdrop properties found. Wait for the desktop to initialize.');
  for (const property of properties) {
    await call([...gui, 'xfconf-query', '-c', 'xfce4-desktop', '-p', property, '-s', destination]);
    await call([...gui, 'xfconf-query', '-c', 'xfce4-desktop', '-p', property.replace(/last-image$/, 'image-style'), '-s', '5']);
    if (await call([...gui, 'xfconf-query', '-c', 'xfce4-desktop', '-p', property]) !== destination) throw new Error('Wallpaper setting did not persist.');
  }
  return { role, container, wallpaper: destination, sha256: createHash('sha256').update(png).digest('hex'), displaysConfigured: properties.length };
}
