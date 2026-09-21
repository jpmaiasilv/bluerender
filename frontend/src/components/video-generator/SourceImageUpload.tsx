import { UploadDropzone } from '../UploadDropzone';
import { useLanguage } from '../../i18n';

interface Props {
  previewUrl: string | null;
  onFileSelected: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
  compact?: boolean;
}

/** Thin, tool-specific wrapper around the shared UploadDropzone — no separate upload system. */
export function SourceImageUpload({ previewUrl, onFileSelected, onClear, disabled, compact }: Props) {
  const { messages } = useLanguage();
  const t = messages.videoGenerator.sourceImage;

  return (
    <UploadDropzone
      label={t.label}
      hint={t.hint}
      dragDropText={t.dragDrop}
      previewUrl={previewUrl}
      onFileSelected={onFileSelected}
      onClear={onClear}
      disabled={disabled}
      compact={compact}
    />
  );
}
