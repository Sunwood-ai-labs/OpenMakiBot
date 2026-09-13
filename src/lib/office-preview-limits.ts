/** Check ZIP directory sizes before an Office parser allocates inflated parts.
 * Legacy XLS and CSV are not ZIPs and stay bounded by the upload and worker timeout. */
export function checkOfficeArchive(data: Uint8Array): void {
  if (data[0] !== 0x50 || data[1] !== 0x4b) return;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error('invalid ZIP');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count > 3000 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error('archive too large');
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('invalid ZIP entry');
    const size = view.getUint32(offset + 24, true);
    total += size;
    if (size > 25 * 1024 * 1024 || total > 100 * 1024 * 1024) throw new Error('archive too large');
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}
