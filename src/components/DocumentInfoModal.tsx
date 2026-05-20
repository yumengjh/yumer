"use client";

import { useState, useCallback, useEffect } from "react";
import { Modal, Form, Input, Select, Button, message } from "antd";
import {
  LockOutlined,
  TeamOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import { useDocument } from "../contexts/DocumentContext";
import type { Document } from "../services/document";
import { getTags, type Tag } from "../services/tags";
import "./DocumentInfoModal.css";

interface DocumentInfoModalProps {
  open: boolean;
  onClose: () => void;
  doc: Document;
}

export function DocumentInfoModal({
  open,
  onClose,
  doc,
}: DocumentInfoModalProps) {
  const { updateDoc } = useDocument();
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [cover, setCover] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("normal");
  const [tags, setTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(doc.title || "");
      setIcon(doc.icon || "");
      setCover(doc.cover || "");
      setVisibility(doc.visibility || "private");
      setCategory(doc.category || "");
      setStatus(doc.status || "normal");
      setTags(doc.tags || []);
      
      // Load available tags
      if (doc.workspaceId) {
        getTags(doc.workspaceId)
          .then(res => setAvailableTags(res.items))
          .catch(() => message.error("获取可用标签失败"));
      }
    }
  }, [open, doc]);

  const handleSubmit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      message.warning("标题不能为空");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc.docId, {
        title: trimmed,
        icon: icon.trim() || undefined,
        cover: cover.trim() || undefined,
        visibility,
        category: category.trim() || undefined,
        status,
        tags,
      });
      message.success("文档信息已更新");
      onClose();
    } catch {
      message.error("更新失败");
    } finally {
      setSaving(false);
    }
  }, [doc.docId, title, icon, cover, visibility, category, status, tags, updateDoc, onClose]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="文档信息"
      width={520}
      className="doc-info-modal"
      destroyOnHidden
      zIndex={1100}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={saving}
          onClick={handleSubmit}
        >
          保存
        </Button>,
      ]}
    >
      <Form layout="vertical" size="small">
        <Form.Item label="标题" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={handleSubmit}
            placeholder="文档标题"
            maxLength={255}
          />
        </Form.Item>

        <Form.Item label="图标">
          <Input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="输入 emoji，如 📄"
            maxLength={10}
          />
        </Form.Item>

        <Form.Item label="封面 URL">
          <Input
            value={cover}
            onChange={(e) => setCover(e.target.value)}
            placeholder="https://..."
            maxLength={500}
          />
        </Form.Item>

        <Form.Item label="可见性">
          <Select
            value={visibility}
            onChange={setVisibility}
            options={[
              {
                value: "private",
                label: (
                  <span>
                    <LockOutlined /> 私有
                  </span>
                ),
              },
              {
                value: "workspace",
                label: (
                  <span>
                    <TeamOutlined /> 工作空间
                  </span>
                ),
              },
              {
                value: "public",
                label: (
                  <span>
                    <GlobalOutlined /> 公开
                  </span>
                ),
              },
            ]}
          />
        </Form.Item>

        <Form.Item label="分类">
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="文档分类"
            maxLength={50}
          />
        </Form.Item>

        <Form.Item label="标签">
          <Select
            mode="multiple"
            placeholder="选择标签"
            value={tags}
            onChange={setTags}
            options={availableTags.map(t => ({
              value: t.tagId,
              label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: t.color || '#ccc' }} />
                  {t.name}
                </span>
              )
            }))}
          />
        </Form.Item>

        <Form.Item label="状态">
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { value: "draft", label: "草稿" },
              { value: "normal", label: "正常" },
              { value: "archived", label: "归档" },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
