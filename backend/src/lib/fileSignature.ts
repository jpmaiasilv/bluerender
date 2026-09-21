/**
 * Detects image type from magic bytes rather than trusting the client-supplied
 * Content-Type. A spoofed mimetype could otherwise route a crafted ICNS/JXL/HEIF
 * payload into image-size's parsers (see GHSA-w3rx-r6r6-pgpr / GHSA-5p2g-fcmc-qvqq),
 * which have known infinite-loop DoS bugs for those formats.
 */
export function detectImageMimeType(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Same magic-bytes-over-mimetype approach as detectImageMimeType, for the Video Editor's raw media uploads. */
export function detectVideoMimeType(buffer: Buffer): 'video/mp4' | 'video/webm' | 'video/quicktime' | null {
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand.startsWith('qt')) return 'video/quicktime';
    return 'video/mp4';
  }
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'video/webm';
  }
  return null;
}

export function detectAudioMimeType(buffer: Buffer): 'audio/mpeg' | 'audio/wav' | 'audio/mp4' | null {
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') {
    return 'audio/mpeg';
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') {
    return 'audio/wav';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return 'audio/mp4';
  }
  return null;
}
