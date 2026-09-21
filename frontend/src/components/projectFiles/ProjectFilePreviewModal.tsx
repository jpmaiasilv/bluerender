import { Loader2 } from 'lucide-react';
import { Modal } from '../Modal';
import { ProjectFile } from '../../lib/projectFiles/types';

interface Props {
  file: ProjectFile | null;
  signedUrl: string | null;
  onClose: () => void;
}

/** Images only — PDFs open in a new tab (see fileTypeIcon.ts's isPreviewablePdf caller), DOC/XLS/DWG/DXF have no viewer and just offer download. */
export function ProjectFilePreviewModal({ file, signedUrl, onClose }: Props) {
  return (
    <Modal open={file !== null} onClose={onClose} labelledBy="project-file-preview-title" panelClassName="w-fit max-w-[92vw]">
      {file && (
        <div className="flex flex-col">
          <div className="border-b border-border px-6 py-3">
            <h2 id="project-file-preview-title" className="truncate pr-8 text-sm font-medium text-ink">
              {file.name}
            </h2>
          </div>
          <div className="flex min-h-[200px] items-center justify-center p-4">
            {signedUrl ? (
              <img src={signedUrl} alt={file.name} className="block h-auto max-h-[75vh] w-auto max-w-full rounded-lg" />
            ) : (
              <Loader2 size={22} className="animate-spin text-ink-muted" />
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
