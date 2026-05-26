import { apiPostForm } from "./api-client";

export interface UploadedImage {
  imageId: string;
  url: string;
  publicUrl: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export async function uploadImage(workspaceId: string, file: File): Promise<UploadedImage> {
  const formData = new FormData();
  formData.append("workspaceId", workspaceId);
  formData.append("file", file);
  return apiPostForm<UploadedImage>("/images/upload", formData);
}
