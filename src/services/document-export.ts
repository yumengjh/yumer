import { apiFetch } from "@/services/api-client";

export type DocumentExportFormat = "md" | "html" | "pdf";

type ExportDownloadResult = {
  filename: string;
  blob: Blob;
};

function parseFilename(contentDisposition: string | null, format: DocumentExportFormat): string {
  if (contentDisposition) {
    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return utf8Match[1];
      }
    }

    const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
    if (quotedMatch?.[1]) {
      return quotedMatch[1];
    }

    const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
    if (plainMatch?.[1]) {
      return plainMatch[1].trim();
    }
  }

  return `document.${format === "html" ? "zip" : format}`;
}

function readErrorMessage(payload: unknown, status: number): string {
  if (!payload || typeof payload !== "object") {
    return `导出失败 (${status})`;
  }

  const message = (payload as { error?: { message?: string | string[] } }).error?.message;
  if (Array.isArray(message)) {
    return message.join(", ");
  }
  if (typeof message === "string" && message.trim()) {
    return message;
  }
  return `导出失败 (${status})`;
}

function triggerDownload(blob: Blob, filename: string) {
  if (typeof window === "undefined") return;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadDocumentExport(
  docId: string,
  format: DocumentExportFormat,
): Promise<ExportDownloadResult> {
  const response = await apiFetch(`/documents/${docId}/export?format=${format}`);
  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");
    throw new Error(
      typeof payload === "string" ? payload || `导出失败 (${response.status})` : readErrorMessage(payload, response.status),
    );
  }

  const blob = await response.blob();
  const filename = parseFilename(response.headers.get("content-disposition"), format);
  triggerDownload(blob, filename);
  return { filename, blob };
}
