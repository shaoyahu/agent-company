export interface ProjectAttachment {
  name: string;
  size: number;
  contentBase64: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function fileToProjectAttachment(file: File, fallbackName?: string): Promise<ProjectAttachment> {
  return {
    name: file.name || fallbackName || '附件',
    size: file.size,
    contentBase64: arrayBufferToBase64(await file.arrayBuffer()),
  };
}

export function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024).toFixed(1)} KB`;
}
