import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, message, Layout } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import axios from 'axios';
import { API_BASE } from './config';

const { Title, Text } = Typography;

interface LoginProps {
    onLoginSuccess: (user: any) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
    const [loading, setLoading] = useState(false);

    const onFinish = async (values: any) => {
        setLoading(true);
        try {
            const res = await axios.post(`${API_BASE}/auth/login`, values);
            message.success(res.data.message);
            onLoginSuccess(res.data.user);
        } catch (error: any) {
            message.error(error.response?.data?.error || 'Login Failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Layout className="login-layout" style={{ minHeight: '100vh', background: '#f0f2f5', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Card bordered={false} style={{ width: 400, borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <Title level={2} style={{ margin: 0, color: '#1890ff' }}>HR Management</Title>
                    <Text type="secondary">ระบบบริหารจัดการทรัพยากรบุคคลและเงินเดือน</Text>
                </div>
                <Form
                    name="login_form"
                    onFinish={onFinish}
                    autoComplete="off"
                    layout="vertical"
                    size="large"
                >
                    <Form.Item
                        name="username"
                        rules={[{ required: true, message: 'กรุณากรอก Username' }]}
                    >
                        <Input prefix={<UserOutlined />} placeholder="Username" />
                    </Form.Item>

                    <Form.Item
                        name="password"
                        rules={[{ required: true, message: 'กรุณากรอก Password' }]}
                    >
                        <Input.Password prefix={<LockOutlined />} placeholder="Password" />
                    </Form.Item>

                    <Form.Item>
                        <Button type="primary" htmlType="submit" block loading={loading} style={{ borderRadius: 6 }}>
                            เข้าสู่ระบบ
                        </Button>
                    </Form.Item>
                </Form>
                <div style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>HR System v1.0 • © 2024</Text>
                </div>
            </Card>
        </Layout>
    );
};
