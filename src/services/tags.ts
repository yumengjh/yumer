import { apiGet, apiPost, apiPatch, apiDelete } from "./api-client";

export interface Tag {
  tagId: string;
  workspaceId: string;
  name: string;
  color: string;
  createdAt?: string;
  usageCount?: number;
}

export interface TagUsage {
  tagId: string;
  name: string;
  usage: number;
}

export async function createTag(data: {
  workspaceId: string;
  name: string;
  color?: string;
}): Promise<Tag> {
  return apiPost<Tag>("/tags", data);
}

export async function getTags(
  workspaceId: string,
  page = 1,
  pageSize = 100
): Promise<{ items: Tag[]; total: number; page: number; pageSize: number }> {
  return apiGet(`/tags?workspaceId=${workspaceId}&page=${page}&pageSize=${pageSize}`);
}

export async function getTagDetails(tagId: string): Promise<Tag> {
  return apiGet<Tag>(`/tags/${tagId}`);
}

export async function getTagUsage(tagId: string): Promise<TagUsage> {
  return apiGet<TagUsage>(`/tags/${tagId}/usage`);
}

export async function updateTag(
  tagId: string,
  data: { name?: string; color?: string }
): Promise<Tag> {
  return apiPatch<Tag>(`/tags/${tagId}`, data);
}

export async function deleteTag(tagId: string): Promise<{ message: string; removedFromDocuments: number }> {
  return apiDelete(`/tags/${tagId}`);
}
