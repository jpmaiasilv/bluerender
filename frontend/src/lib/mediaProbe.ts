/** Reads real media duration client-side via a throwaway element's metadata —
 * used when adding an existing history result (already hosted on the backend,
 * so there's no upload response to read a duration from). */
export function probeMediaDuration(url: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.src = url;
    el.onloadedmetadata = () => {
      resolve(el.duration || 0);
      el.src = '';
    };
    el.onerror = () => {
      reject(new Error('Could not read media duration.'));
      el.src = '';
    };
  });
}

/** Reads a video's or image's native pixel dimensions client-side — used to
 * detect the "Automático" project format's reference ratio from the first
 * visual clip. */
export function probeMediaDimensions(url: string, kind: 'video' | 'image'): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('Could not read image dimensions.'));
      img.src = url;
      return;
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight });
      video.src = '';
    };
    video.onerror = () => {
      reject(new Error('Could not read video dimensions.'));
      video.src = '';
    };
    video.src = url;
  });
}
