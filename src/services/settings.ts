import { apiGet, apiPatch, getAccessToken } from "./api-client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://api-zzz.yumgjs.com/api/v1";
export const SETTINGS_PRIORITY_STORAGE_KEY = "yuediter_settings_priority";

export interface ReaderSettings {
  contentWidth: number;
  fontSize: number;
}

export interface EditorSettings {
  contentWidth: number;
  fontSize: number;
  confirmBeforeLeave: boolean;
}

export interface AppSettings {
  reader: ReaderSettings;
  editor: EditorSettings;
}

export type PartialAppSettings = Partial<{
  reader: Partial<ReaderSettings>;
  editor: Partial<EditorSettings>;
}>;

export interface UserSettings {
  editor: EditorSettings;
}

export interface WorkspaceSettings {
  reader: ReaderSettings;
  editor: EditorSettings;
}

export interface SettingsEnvelope {
  settings?: PartialAppSettings | null;
}

export type SettingsScope = "user" | "workspace";
export type SettingsPriority = "workspace-first" | "user-first";

export interface SettingsState {
  userSettings: UserSettings;
  workspaceSettings: WorkspaceSettings;
  effectiveSettings: AppSettings;
  priority: SettingsPriority;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  reader: {
    contentWidth: 800,
    fontSize: 16,
  },
  editor: {
    contentWidth: 800,
    fontSize: 16,
    confirmBeforeLeave: false,
  },
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  editor: {
    contentWidth: DEFAULT_APP_SETTINGS.editor.contentWidth,
    fontSize: DEFAULT_APP_SETTINGS.editor.fontSize,
    confirmBeforeLeave: DEFAULT_APP_SETTINGS.editor.confirmBeforeLeave,
  },
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  reader: {
    contentWidth: DEFAULT_APP_SETTINGS.reader.contentWidth,
    fontSize: DEFAULT_APP_SETTINGS.reader.fontSize,
  },
  editor: {
    contentWidth: DEFAULT_APP_SETTINGS.editor.contentWidth,
    fontSize: DEFAULT_APP_SETTINGS.editor.fontSize,
    confirmBeforeLeave: false,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeWidth(value: unknown, fallback: number): number {
  return typeof value === "number" ? clamp(value, 680, 1200) : fallback;
}

function normalizeFontSize(value: unknown, fallback: number): number {
  return typeof value === "number" ? clamp(value, 13, 22) : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readSettingsPriority(): SettingsPriority {
  if (typeof window === "undefined") return "workspace-first";
  const saved = window.localStorage.getItem(SETTINGS_PRIORITY_STORAGE_KEY);
  return saved === "user-first" ? "user-first" : "workspace-first";
}

export function writeSettingsPriority(priority: SettingsPriority) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTINGS_PRIORITY_STORAGE_KEY, priority);
}

export function extractSettings(payload: unknown): PartialAppSettings {
  if (!payload || typeof payload !== "object") return {};

  const source =
    "settings" in (payload as Record<string, unknown>)
      ? (payload as SettingsEnvelope).settings
      : payload;

  if (!source || typeof source !== "object") return {};
  return source as PartialAppSettings;
}

export function normalizeSettings(payload?: unknown): AppSettings {
  const partial = extractSettings(payload);

  return {
    reader: {
      contentWidth: normalizeWidth(partial.reader?.contentWidth, DEFAULT_APP_SETTINGS.reader.contentWidth),
      fontSize: normalizeFontSize(partial.reader?.fontSize, DEFAULT_APP_SETTINGS.reader.fontSize),
    },
    editor: {
      contentWidth: normalizeWidth(partial.editor?.contentWidth, DEFAULT_APP_SETTINGS.editor.contentWidth),
      fontSize: normalizeFontSize(partial.editor?.fontSize, DEFAULT_APP_SETTINGS.editor.fontSize),
      confirmBeforeLeave: normalizeBoolean(partial.editor?.confirmBeforeLeave, DEFAULT_APP_SETTINGS.editor.confirmBeforeLeave),
    },
  };
}

export function normalizeUserSettings(payload?: unknown): UserSettings {
  const partial = extractSettings(payload);

  return {
    editor: {
      contentWidth: normalizeWidth(partial.editor?.contentWidth, DEFAULT_USER_SETTINGS.editor.contentWidth),
      fontSize: normalizeFontSize(partial.editor?.fontSize, DEFAULT_USER_SETTINGS.editor.fontSize),
      confirmBeforeLeave: normalizeBoolean(partial.editor?.confirmBeforeLeave, DEFAULT_USER_SETTINGS.editor.confirmBeforeLeave),
    },
  };
}

export function normalizeWorkspaceSettings(payload?: unknown): WorkspaceSettings {
  const normalized = normalizeSettings(payload);
  return {
    reader: normalized.reader,
    editor: normalized.editor,
  };
}

export function buildSettingsPatch(settings: AppSettings) {
  return {
    settings: {
      reader: {
        contentWidth: normalizeWidth(settings.reader.contentWidth, DEFAULT_APP_SETTINGS.reader.contentWidth),
        fontSize: normalizeFontSize(settings.reader.fontSize, DEFAULT_APP_SETTINGS.reader.fontSize),
      },
      editor: {
        contentWidth: normalizeWidth(settings.editor.contentWidth, DEFAULT_APP_SETTINGS.editor.contentWidth),
        fontSize: normalizeFontSize(settings.editor.fontSize, DEFAULT_APP_SETTINGS.editor.fontSize),
      },
    },
  };
}

export function buildUserSettingsPatch(settings: UserSettings) {
  return {
    settings: {
      editor: {
        contentWidth: normalizeWidth(settings.editor.contentWidth, DEFAULT_USER_SETTINGS.editor.contentWidth),
        fontSize: normalizeFontSize(settings.editor.fontSize, DEFAULT_USER_SETTINGS.editor.fontSize),
        confirmBeforeLeave: normalizeBoolean(
          settings.editor.confirmBeforeLeave,
          DEFAULT_USER_SETTINGS.editor.confirmBeforeLeave,
        ),
      },
    },
  };
}

export function buildWorkspaceSettingsPatch(settings: WorkspaceSettings) {
  return {
    settings: {
      reader: {
        contentWidth: normalizeWidth(settings.reader.contentWidth, DEFAULT_WORKSPACE_SETTINGS.reader.contentWidth),
        fontSize: normalizeFontSize(settings.reader.fontSize, DEFAULT_WORKSPACE_SETTINGS.reader.fontSize),
      },
      editor: {
        contentWidth: normalizeWidth(settings.editor.contentWidth, DEFAULT_WORKSPACE_SETTINGS.editor.contentWidth),
        fontSize: normalizeFontSize(settings.editor.fontSize, DEFAULT_WORKSPACE_SETTINGS.editor.fontSize),
      },
    },
  };
}

function mergeSettings(base: AppSettings, override: AppSettings): AppSettings {
  return {
    reader: {
      contentWidth: normalizeWidth(override.reader.contentWidth, base.reader.contentWidth),
      fontSize: normalizeFontSize(override.reader.fontSize, base.reader.fontSize),
    },
    editor: {
      contentWidth: normalizeWidth(override.editor.contentWidth, base.editor.contentWidth),
      fontSize: normalizeFontSize(override.editor.fontSize, base.editor.fontSize),
      confirmBeforeLeave: normalizeBoolean(override.editor.confirmBeforeLeave, base.editor.confirmBeforeLeave),
    },
  };
}

export function resolveSettings(
  userSettings: UserSettings,
  workspaceSettings: WorkspaceSettings,
  priority: SettingsPriority,
): AppSettings {
  const reader = {
    contentWidth: workspaceSettings.reader.contentWidth,
    fontSize: workspaceSettings.reader.fontSize,
  };

  const baseEditor = DEFAULT_APP_SETTINGS.editor;
  const editor =
    priority === "user-first"
      ? {
          contentWidth: normalizeWidth(userSettings.editor.contentWidth, workspaceSettings.editor.contentWidth),
          fontSize: normalizeFontSize(userSettings.editor.fontSize, workspaceSettings.editor.fontSize),
          confirmBeforeLeave: userSettings.editor.confirmBeforeLeave,
        }
      : {
          contentWidth: normalizeWidth(workspaceSettings.editor.contentWidth, baseEditor.contentWidth),
          fontSize: normalizeFontSize(workspaceSettings.editor.fontSize, baseEditor.fontSize),
          confirmBeforeLeave: userSettings.editor.confirmBeforeLeave,
        };

  return {
    reader,
    editor,
  };
}

export function buildSettingsState(params: {
  userSettings?: unknown;
  workspaceSettings?: unknown;
  priority?: SettingsPriority;
}): SettingsState {
  const userSettings = normalizeUserSettings(params.userSettings);
  const workspaceSettings = normalizeWorkspaceSettings(params.workspaceSettings);
  const priority = params.priority ?? "workspace-first";

  return {
    userSettings,
    workspaceSettings,
    effectiveSettings: resolveSettings(userSettings, workspaceSettings, priority),
    priority,
  };
}

export async function getUserSettings(): Promise<UserSettings> {
  const data = await apiGet<unknown>("/settings/me");
  return normalizeUserSettings(data);
}

export async function updateUserSettings(settings: UserSettings): Promise<UserSettings> {
  const data = await apiPatch<unknown>("/settings/me", buildUserSettingsPatch(settings));
  return normalizeUserSettings(data);
}

export async function getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings> {
  const data = await apiGet<unknown>(`/workspaces/${workspaceId}/settings`);
  return normalizeWorkspaceSettings(data);
}

export async function updateWorkspaceSettings(
  workspaceId: string,
  settings: WorkspaceSettings,
): Promise<WorkspaceSettings> {
  const data = await apiPatch<unknown>(
    `/workspaces/${workspaceId}/settings`,
    buildWorkspaceSettingsPatch(settings),
  );
  return normalizeWorkspaceSettings(data);
}

export async function getPublicWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings> {
  const response = await fetch(`${API_BASE}/workspaces/${workspaceId}/settings`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to load workspace settings: ${response.status}`);
  }

  const json = await response.json();
  return normalizeWorkspaceSettings(json?.data);
}

export async function getClientVisibleSettings(workspaceId?: string): Promise<SettingsState> {
  const priority = readSettingsPriority();
  const hasToken = Boolean(getAccessToken());

  const [userSettings, workspaceSettings] = await Promise.all([
    hasToken ? updatePromiseUserFallback() : Promise.resolve(DEFAULT_USER_SETTINGS),
    workspaceId ? getPublicWorkspaceSettings(workspaceId).catch(() => DEFAULT_WORKSPACE_SETTINGS) : Promise.resolve(DEFAULT_WORKSPACE_SETTINGS),
  ]);

  return buildSettingsState({
    userSettings,
    workspaceSettings,
    priority,
  });
}

function updatePromiseUserFallback(): Promise<UserSettings> {
  return getUserSettings()
    .then((value) => normalizeUserSettings(value))
    .catch(() => DEFAULT_USER_SETTINGS);
}
