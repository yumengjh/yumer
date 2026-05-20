import { useState, useEffect, useCallback } from "react";
import { Modal, List, Button, Input, Space, Popconfirm, message, ColorPicker } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useDocument } from "../contexts/DocumentContext";
import { getTags, createTag, updateTag, deleteTag, type Tag } from "../services/tags";

interface TagManagementModalProps {
  open: boolean;
  onClose: () => void;
}

export function TagManagementModal({ open, onClose }: TagManagementModalProps) {
  const { workspaceId } = useDocument();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#1890ff");

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#1890ff");

  const loadTags = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await getTags(workspaceId);
      setTags(res.items);
    } catch (e) {
      message.error("加载标签失败");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (open) {
      loadTags();
      setCreating(false);
      setEditingTagId(null);
    }
  }, [open, loadTags]);

  const handleCreate = async () => {
    if (!workspaceId) return;
    if (!newName.trim()) {
      message.warning("请输入标签名称");
      return;
    }
    try {
      await createTag({ workspaceId, name: newName.trim(), color: newColor });
      message.success("创建成功");
      setCreating(false);
      setNewName("");
      setNewColor("#1890ff");
      loadTags();
    } catch (e) {
      message.error("创建失败，可能标签名已存在");
    }
  };

  const handleUpdate = async (tagId: string) => {
    if (!editName.trim()) {
      message.warning("请输入标签名称");
      return;
    }
    try {
      await updateTag(tagId, { name: editName.trim(), color: editColor });
      message.success("更新成功");
      setEditingTagId(null);
      loadTags();
    } catch (e) {
      message.error("更新失败");
    }
  };

  const handleDelete = async (tagId: string) => {
    try {
      await deleteTag(tagId);
      message.success("删除成功");
      loadTags();
    } catch (e) {
      message.error("删除失败");
    }
  };

  const startEdit = (tag: Tag) => {
    setEditingTagId(tag.tagId);
    setEditName(tag.name);
    setEditColor(tag.color || "#1890ff");
  };

  return (
    <Modal
      title="标签管理"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      width={500}
    >
      <div style={{ marginBottom: 16 }}>
        {creating ? (
          <Space>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="标签名称"
              onPressEnter={handleCreate}
              autoFocus
            />
            <ColorPicker value={newColor} onChange={(_, hex) => setNewColor(hex)} />
            <Button type="primary" onClick={handleCreate}>保存</Button>
            <Button onClick={() => setCreating(false)}>取消</Button>
          </Space>
        ) : (
          <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            新建标签
          </Button>
        )}
      </div>

      <List
        loading={loading}
        dataSource={tags}
        renderItem={(tag) => (
          <List.Item
            actions={
              editingTagId === tag.tagId
                ? [
                    <Button key="save" type="link" size="small" onClick={() => handleUpdate(tag.tagId)}>保存</Button>,
                    <Button key="cancel" type="link" size="small" onClick={() => setEditingTagId(null)}>取消</Button>
                  ]
                : [
                    <Button key="edit" type="text" icon={<EditOutlined />} onClick={() => startEdit(tag)} />,
                    <Popconfirm
                      key="delete"
                      title="确定要删除该标签吗？"
                      onConfirm={() => handleDelete(tag.tagId)}
                    >
                      <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  ]
            }
          >
            {editingTagId === tag.tagId ? (
              <Space>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onPressEnter={() => handleUpdate(tag.tagId)}
                  autoFocus
                />
                <ColorPicker value={editColor} onChange={(_, hex) => setEditColor(hex)} />
              </Space>
            ) : (
              <Space>
                <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: tag.color || '#ccc' }} />
                <span>{tag.name}</span>
              </Space>
            )}
          </List.Item>
        )}
      />
    </Modal>
  );
}
