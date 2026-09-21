import type Konva from 'konva';
import { jsPDF } from 'jspdf';

function triggerDownload(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Flattens the whole Stage (base image + every annotation layer) into one raster image — this is what makes "export includes all annotations" true for free. */
export function exportStagePng(stage: Konva.Stage, filename: string): void {
  triggerDownload(stage.toDataURL({ mimeType: 'image/png', pixelRatio: 2 }), filename);
}

export function exportStageJpg(stage: Konva.Stage, filename: string): void {
  // JPG has no alpha channel — Konva fills transparent areas with black by
  // default, which would show through the printer's page margins if unset,
  // so this stays opaque white via the shared background rect the canvas
  // always renders behind the loaded image.
  triggerDownload(stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.92, pixelRatio: 2 }), filename);
}

export function exportStagePdf(stage: Konva.Stage, filename: string): void {
  const dataUrl = stage.toDataURL({ mimeType: 'image/png', pixelRatio: 2 });
  const width = stage.width();
  const height = stage.height();
  const orientation = width >= height ? 'l' : 'p';
  const pdf = new jsPDF({ orientation, unit: 'px', format: [width, height] });
  pdf.addImage(dataUrl, 'PNG', 0, 0, width, height);
  pdf.save(filename);
}
