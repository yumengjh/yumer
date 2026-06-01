import { useState, useEffect, useCallback } from "react";
import {
  Modal,
  Tabs,
  Form,
  Input,
  Button,
  List,
  Space,
  Typography,
  Spin,
  App,
  Avatar,
} from "antd";
import {
  UserOutlined,
  PlusOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import { useAuth } from "../contexts/AuthContext";
import {
  listWorkspaces,
  createWorkspace,
  type Workspace,
} from "../services/workspace";
import "./SetupModal.css";

const { Title, Text } = Typography;

interface SetupModalProps {
  open: boolean;
  onComplete: (workspaceId: string) => void;
}

export function SetupModal({ open, onComplete }: SetupModalProps) {
  const { message } = App.useApp();
  const { user, isAuthenticated, login, register, error, clearError } =
    useAuth();
  const [step, setStep] = useState<"auth" | "workspace">("auth");
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();
  const [createWsForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsLoading, setWsLoading] = useState(false);

  // 已登录时跳到工作空间选择
  useEffect(() => {
    if (isAuthenticated) {
      setStep("workspace");
    } else {
      setStep("auth");
    }
  }, [isAuthenticated]);

  // 加载工作空间列表
  const fetchWorkspaces = useCallback(async () => {
    setWsLoading(true);
    try {
      const res = await listWorkspaces();
      setWorkspaces(res.items);
      // 只有一个工作空间时自动选中
      if (res.items.length === 1) {
        onComplete(res.items[0].workspaceId);
      }
    } catch {
      message.error("加载工作空间失败");
    } finally {
      setWsLoading(false);
    }
  }, [onComplete]);

  useEffect(() => {
    if (step === "workspace" && open) {
      fetchWorkspaces();
    }
  }, [step, open, fetchWorkspaces]);

  const handleLogin = async (values: {
    emailOrUsername: string;
    password: string;
  }) => {
    clearError();
    setLoading(true);
    try {
      await login(values.emailOrUsername, values.password);
      message.success("登录成功");
    } catch {
      // error 已在 context 中设置
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
  }) => {
    clearError();
    setLoading(true);
    try {
      await register(values);
      message.success("注册成功");
    } catch {
      // error 已在 context 中设置
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWorkspace = async (values: {
    name: string;
    description?: string;
  }) => {
    setLoading(true);
    try {
      const ws = await createWorkspace(values);
      message.success("工作空间创建成功");
      onComplete(ws.workspaceId);
    } catch {
      message.error("创建工作空间失败");
    } finally {
      setLoading(false);
    }
  };

  const authTabItems = [
    {
      key: "login",
      label: "登录",
      children: (
        <Form
          form={loginForm}
          onFinish={handleLogin}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            name="emailOrUsername"
            label="邮箱或用户名"
            rules={[{ required: true, message: "请输入邮箱或用户名" }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="请输入邮箱或用户名"
              size="large"
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password placeholder="请输入密码" size="large" />
          </Form.Item>
          {error && <div className="setup-modal-error">{error}</div>}
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: "register",
      label: "注册",
      children: (
        <Form
          form={registerForm}
          onFinish={handleRegister}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: "请输入用户名" },
              {
                pattern: /^[a-zA-Z0-9_]+$/,
                message: "仅支持字母、数字和下划线",
              },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: "请输入邮箱" },
              { type: "email", message: "邮箱格式不正确" },
            ]}
          >
            <Input placeholder="邮箱" size="large" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 8, message: "密码至少 8 位" },
            ]}
          >
            <Input.Password placeholder="密码（至少8位）" size="large" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称">
            <Input placeholder="显示名称（可选）" size="large" />
          </Form.Item>
          {error && <div className="setup-modal-error">{error}</div>}
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
            >
              注册
            </Button>
          </Form.Item>
        </Form>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      title={null}
      footer={null}
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      width={440}
      className="setup-modal"
    >
      <div className="setup-modal-header">
        <Title level={4} style={{ margin: 0 }}>
          {step === "auth" ? "欢迎使用 Editor" : "选择工作空间"}
        </Title>
        <Text type="secondary">
          {step === "auth"
            ? "请先登录或注册账号"
            : `当前用户：${user?.displayName || user?.username}`}
        </Text>
      </div>

      {step === "auth" && <Tabs items={authTabItems} centered />}

      {step === "workspace" && (
        <div className="setup-modal-workspace">
          <Spin spinning={wsLoading}>
            {workspaces.length > 0 && (
              <List
                className="setup-modal-ws-list"
                dataSource={workspaces}
                renderItem={(ws) => (
                  <List.Item
                    className="setup-modal-ws-item"
                    onClick={() => onComplete(ws.workspaceId)}
                  >
                    <List.Item.Meta
                      avatar={
                        <Avatar
                          style={{ backgroundColor: "#00b96b" }}
                          icon={<FolderOutlined />}
                        >
                          {ws.icon || ws.name[0]}
                        </Avatar>
                      }
                      title={ws.name}
                      description={
                        ws.description || `${ws.documentCount} 篇文档`
                      }
                    />
                  </List.Item>
                )}
              />
            )}

            <div className="setup-modal-ws-create">
              <Title level={5}>
                {workspaces.length === 0
                  ? "创建工作空间"
                  : "或创建新工作空间"}
              </Title>
              <Form
                form={createWsForm}
                onFinish={handleCreateWorkspace}
                layout="inline"
              >
                <Form.Item
                  name="name"
                  rules={[{ required: true, message: "请输入名称" }]}
                  style={{ flex: 1 }}
                >
                  <Input placeholder="工作空间名称" size="large" />
                </Form.Item>
                <Form.Item>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    icon={<PlusOutlined />}
                    size="large"
                  >
                    创建
                  </Button>
                </Form.Item>
              </Form>
            </div>
          </Spin>
        </div>
      )}
    </Modal>
  );
}
