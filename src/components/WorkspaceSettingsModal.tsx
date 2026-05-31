"use client";

import { useEffect, useMemo } from "react";
import { Checkbox, Form, InputNumber, Modal, Radio, Space, Switch, Typography } from "antd";
import type {
  SettingsPriority,
  SettingsScope,
  UserSettings,
  WorkspaceSettings,
  AppSettings,
} from "@/services/settings";
import {
  DEFAULT_EDITOR_TOOLBAR_PREFERENCES,
  FLOATING_TOOLBAR_ITEMS,
  type EditorToolbarPreferences,
  type FloatingToolbarItemId,
} from "@/services/editor-toolbar-preferences";

interface WorkspaceSettingsModalProps {
  open: boolean;
  saving?: boolean;
  scope: SettingsScope;
  priority: SettingsPriority;
  settingsByScope: {
    user: UserSettings;
    workspace: WorkspaceSettings;
  };
  effectiveSettings: AppSettings;
  toolbarPreferences?: EditorToolbarPreferences;
  onClose: () => void;
  onScopeChange: (scope: SettingsScope) => void;
  onPriorityChange: (priority: SettingsPriority) => void;
  onToolbarPreferencesChange?: (preferences: EditorToolbarPreferences) => void;
  onSubmit: (settings: UserSettings | WorkspaceSettings) => Promise<void> | void;
}

export function WorkspaceSettingsModal({
  open,
  saving = false,
  scope,
  priority,
  settingsByScope,
  effectiveSettings,
  toolbarPreferences = DEFAULT_EDITOR_TOOLBAR_PREFERENCES,
  onClose,
  onScopeChange,
  onPriorityChange,
  onToolbarPreferencesChange,
  onSubmit,
}: WorkspaceSettingsModalProps) {
  const [form] = Form.useForm<AppSettings>();

  const currentSettings = useMemo(() => settingsByScope[scope], [scope, settingsByScope]);
  const enabledFloatingItemIds = FLOATING_TOOLBAR_ITEMS
    .filter((item) => toolbarPreferences.floatingItems[item.id])
    .map((item) => item.id);

  const patchToolbarPreferences = (patch: Partial<EditorToolbarPreferences>) => {
    onToolbarPreferencesChange?.({
      ...toolbarPreferences,
      ...patch,
    });
  };

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(currentSettings);
  }, [currentSettings, form, open]);

  return (
    <Modal
      open={open}
      title="页面设置"
      okText={scope === "user" ? "保存到个人设置" : "保存到空间设置"}
      cancelText="取消"
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => void form.submit()}
      width={720}
      destroyOnHidden
    >
      <Space direction="vertical" size={16} style={{ width: "100%", marginBottom: 16 }}>
        <div>
          <Typography.Text strong>保存位置</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 8 }}>
            选择这次修改要保存到哪里，不同位置会影响不同范围的使用者。
          </Typography.Paragraph>
          <div style={{ marginTop: 8 }}>
            <Radio.Group
              value={scope}
              optionType="button"
              buttonStyle="solid"
              onChange={(e) => onScopeChange(e.target.value as SettingsScope)}
              options={[
                { label: "个人设置", value: "user" },
                { label: "空间设置", value: "workspace" },
              ]}
            />
          </div>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            {scope === "user"
              ? "个人设置：仅影响你自己的编辑体验，不会影响其他成员，也不会改变公开展示页。"
              : "空间设置：影响当前空间下文档的默认展示与编辑体验，其中展示区设置只支持空间级控制。"}
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Text strong>应用优先级</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 8 }}>
            仅对编辑区相关设置生效，用来决定“个人设置”和“空间设置”冲突时优先采用哪一套。
          </Typography.Paragraph>
          <div style={{ marginTop: 8 }}>
            <Radio.Group
              value={priority}
              onChange={(e) => onPriorityChange(e.target.value as SettingsPriority)}
              options={[
                { label: "空间优先", value: "workspace-first" },
                { label: "个人优先", value: "user-first" },
              ]}
            />
          </div>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            当前生效：编辑区 {effectiveSettings.editor.contentWidth}px / {effectiveSettings.editor.fontSize}px；
            展示区 {effectiveSettings.reader.contentWidth}px / {effectiveSettings.reader.fontSize}px。
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Text strong>本地工具栏</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 8 }}>
            这些选项只保存在当前浏览器，用来控制选区悬浮工具栏和固定工具栏是否同时显示。
          </Typography.Paragraph>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span>选中内容时显示悬浮工具栏</span>
              <Switch
                checked={toolbarPreferences.floatingToolbarEnabled}
                onChange={(checked) => patchToolbarPreferences({ floatingToolbarEnabled: checked })}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span>开启悬浮工具栏时保留顶部固定工具栏</span>
              <Switch
                checked={toolbarPreferences.showFixedToolbarWithFloating}
                disabled={!toolbarPreferences.floatingToolbarEnabled}
                onChange={(checked) => patchToolbarPreferences({ showFixedToolbarWithFloating: checked })}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span>悬浮工具栏延迟</span>
              <InputNumber
                min={0}
                max={1200}
                step={20}
                addonAfter="ms"
                value={toolbarPreferences.floatingToolbarDelayMs}
                disabled={!toolbarPreferences.floatingToolbarEnabled}
                onChange={(value) =>
                  patchToolbarPreferences({
                    floatingToolbarDelayMs:
                      typeof value === "number" ? value : toolbarPreferences.floatingToolbarDelayMs,
                  })
                }
                style={{ width: 140 }}
              />
            </div>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              数值越小越灵敏，`0ms` 表示选中后立即显示。
            </Typography.Paragraph>
            <Checkbox.Group
              value={enabledFloatingItemIds}
              onChange={(values) => {
                const enabled = new Set(values.map(String));
                const floatingItems = FLOATING_TOOLBAR_ITEMS.reduce(
                  (acc, item) => {
                    acc[item.id] = enabled.has(item.id);
                    return acc;
                  },
                  {} as Record<FloatingToolbarItemId, boolean>,
                );
                patchToolbarPreferences({ floatingItems });
              }}
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}
            >
              {FLOATING_TOOLBAR_ITEMS.map((item) => (
                <Checkbox key={item.id} value={item.id}>
                  {item.label}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </Space>
        </div>
      </Space>

      <Form<AppSettings>
        form={form}
        layout="vertical"
        initialValues={currentSettings}
        onFinish={(values) => void onSubmit(values)}
      >
        <Form.Item label="编辑区宽度" name={["editor", "contentWidth"]} rules={[{ required: true }]}>
          <InputNumber min={680} max={1200} step={20} addonAfter="px" style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item label="编辑区默认字号" name={["editor", "fontSize"]} rules={[{ required: true }]}>
          <InputNumber min={13} max={22} step={1} addonAfter="px" style={{ width: "100%" }} />
        </Form.Item>

        {scope === "user" && (
          <Form.Item label="离开页面时确认" name={["editor", "confirmBeforeLeave"]} valuePropName="checked">
            <Switch />
          </Form.Item>
        )}

        {scope === "workspace" ? (
          <>
            <Form.Item label="展示区宽度" name={["reader", "contentWidth"]} rules={[{ required: true }]}>
              <InputNumber min={680} max={1200} step={20} addonAfter="px" style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item label="阅读默认字号" name={["reader", "fontSize"]} rules={[{ required: true }]}>
              <InputNumber min={13} max={22} step={1} addonAfter="px" style={{ width: "100%" }} />
            </Form.Item>
          </>
        ) : (
          <Typography.Paragraph type="secondary">
            展示区设置仅支持空间级配置。也就是说，公开阅读页和空间内统一展示效果只由空间设置控制，个人设置不会覆盖这里。
          </Typography.Paragraph>
        )}
      </Form>
    </Modal>
  );
}
