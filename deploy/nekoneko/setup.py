"""Resolve a literal .env file and prepare only the marked guide data root."""
import json
import os
import pathlib
import re

env_path = pathlib.Path(__file__).resolve().parent.parent / 'podman' / '.env.nekoneko'
values = {}
if env_path.exists():
    for line in env_path.read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', line)
        if not match:
            raise SystemExit('Use literal KEY=value lines in .env.nekoneko.')
        key, value = match.groups()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if '$' in value or '\n' in value or '\r' in value:
            raise SystemExit('Use literal values, not shell/Compose expansion, in .env.nekoneko.')
        values[key] = value

defaults = {
    'OMB_PODMAN_MACHINE': os.environ.get('OMB_PODMAN_MACHINE', 'openmausbot'),
    'COMPOSE_PROJECT_NAME': 'nekoneko-article',
    'OMB_IMAGE_TAG': 'nekoneko-article',
    'OMB_DATA_ROOT': str(pathlib.Path.home() / 'nekoneko-article'),
    'PODMAN_SOCKET': f'/run/user/{os.getuid()}/podman/podman.sock',
    'OMB_PORT': '31799', 'OMB_WEBHOOK_PORT': '31800', 'OMB_HTTP_PORT': '31880',
    'OMB_HTTPS_HOST': 'https-disabled.invalid',
    'ENGINES': '@anthropic-ai/claude-code@2.1.263',
    'OMB_GLM_MODEL': 'glm-5.3',
    'OMB_ANTHROPIC_BASE_URL': 'https://api.z.ai/api/anthropic',
    'OMB_TURN_TIMEOUT_MINUTES': '20',
}
# The official server owns the GUI image identity. Discard the former kit-only
# setting when an existing literal settings file is reused.
values.pop('OMB_VM_IMAGE_REPOSITORY', None)
for key, default in defaults.items():
    if not values.get(key):
        values[key] = default
values['OMB_PODMAN_MACHINE'] = os.environ.get('OMB_PODMAN_MACHINE', values['OMB_PODMAN_MACHINE'])
if not values.get('OMB_PUBLIC_URL'):
    values['OMB_PUBLIC_URL'] = f"http://localhost:{values['OMB_HTTP_PORT']}"
if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', values['COMPOSE_PROJECT_NAME']):
    raise SystemExit('Invalid COMPOSE_PROJECT_NAME.')
if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', values['OMB_IMAGE_TAG']):
    raise SystemExit('Invalid OMB_IMAGE_TAG.')
ports = [int(values[name]) for name in ('OMB_PORT', 'OMB_WEBHOOK_PORT', 'OMB_HTTP_PORT')]
if len(set(ports)) != 3 or any(port < 1 or port > 65535 for port in ports):
    raise SystemExit('Choose three distinct valid ports.')
if not 1 <= int(values['OMB_TURN_TIMEOUT_MINUTES']) <= 120:
    raise SystemExit('OMB_TURN_TIMEOUT_MINUTES must be between 1 and 120.')
root = pathlib.Path(values['OMB_DATA_ROOT'])
if not root.is_absolute() or root == pathlib.Path('/') or root.is_symlink():
    raise SystemExit('Choose an absolute, non-root Linux data directory without a symlink.')
root = root.resolve()
marker = root / '.nekoneko-guide.json'
if root.exists() and not marker.is_file():
    raise SystemExit('Refusing existing data without the guide marker; choose a new directory.')
if marker.is_symlink() or (marker.exists() and json.loads(marker.read_text()).get('version') != 1):
    raise SystemExit('Invalid guide marker.')
os.umask(0o077)
(root / '.openmausbot').mkdir(parents=True, exist_ok=True)
marker.write_text('{"version":1}\n', encoding='utf-8')
values['OMB_DATA_ROOT'] = str(root)
env_path.write_text('# Generated literal settings; edit values, then rerun setup. Never put API keys here.\n' +
                    ''.join(f'{key}={value}\n' for key, value in values.items()), encoding='utf-8')
print(f"Prepared {values['COMPOSE_PROJECT_NAME']}; data: {root}; browser: {values['OMB_PUBLIC_URL']}")
