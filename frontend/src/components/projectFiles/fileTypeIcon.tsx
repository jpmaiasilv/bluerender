import { Box, File, FileImage, FileSpreadsheet, FileText } from 'lucide-react';
import { fileExtension } from '../../config/projectFiles';

const CAD_EXTENSIONS = ['dwg', 'dxf'];
const SPREADSHEET_EXTENSIONS = ['xls', 'xlsx'];

/** Icon by file type — mime type first (more reliable when present), extension as a fallback
 * (CAD files in particular often arrive with no useful mime type). */
export function fileTypeIcon(mimeType: string | null, name: string, size = 16, className = 'text-ink-muted') {
  const ext = fileExtension(name);
  if ((mimeType && mimeType.startsWith('image/')) || ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
    return <FileImage size={size} className={className} />;
  }
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return <FileText size={size} className={className} />;
  }
  if (SPREADSHEET_EXTENSIONS.includes(ext)) {
    return <FileSpreadsheet size={size} className={className} />;
  }
  if (CAD_EXTENSIONS.includes(ext)) {
    return <Box size={size} className={className} />;
  }
  if (ext === 'doc' || ext === 'docx') {
    return <FileText size={size} className={className} />;
  }
  return <File size={size} className={className} />;
}

export function isPreviewableImage(mimeType: string | null, name: string): boolean {
  const ext = fileExtension(name);
  return Boolean((mimeType && mimeType.startsWith('image/')) || ['png', 'jpg', 'jpeg', 'webp'].includes(ext));
}

export function isPreviewablePdf(mimeType: string | null, name: string): boolean {
  return mimeType === 'application/pdf' || fileExtension(name) === 'pdf';
}
