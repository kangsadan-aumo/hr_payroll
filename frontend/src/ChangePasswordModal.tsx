import React, { useState } from 'react';
import { Modal, Form, Input, Button, Alert, message } from 'antd';
import { LockOutlined, SaveOutlined } from '@ant-design/icons';
import axios from 'axios';
import { API_BASE } from './config';

interface ChangePasswordModalProps {
    visible: boolean;
    user: any;
    onSuccess: (updatedUser: any) => void;
    onCancel: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ visible, user, onSuccess, onCancel }) => {
    const [loading, setLoading] = useState(false);
    const [form] = Form.useForm();

    const onFinish = async (values: any) => {
        if (values.newPassword !== values.confirmPassword) {
            return message.error('รหัสผ่านยืนยันไม่ตรงกัน');
        }

        setLoading(true);
        try {
            await axios.put(`${API_BASE}/employees/${user.id}/change-password`, {
                currentPassword: values.currentPassword,
                newPassword: values.newPassword
            });
            message.success('เปลี่ยนรหัสผ่านสำเร็จ');
            
            // Update local user state
            const updatedUser = { ...user, must_change_password: false };
            onSuccess(updatedUser);
        } catch (error: any) {
            message.error(error.response?.data?.error || 'ไม่สามารถเปลี่ยนรหัสผ่านได้');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            title="ตั้งค่ารหัสผ่านใหม่ (Security Update)"
            open={visible}
            onCancel={onCancel}
            footer={null}
            maskClosable={false}
            closable={!user.must_change_password}
        >
            <Alert
                message="บังคับเปลี่ยนรหัสผ่าน"
                description="เนื่องจากแอดมินได้ระบุรหัสผ่านเริ่มต้นให้คุณ หรือมีการรีเซ็ทรหัสผ่าน เพื่อความปลอดภัยกรุณาตั้งรหัสผ่านใหม่ที่คุณจำได้ก่อนเข้าใช้งาน"
                type="warning"
                showIcon
                style={{ marginBottom: 20 }}
            />
            
            <Form form={form} layout="vertical" onFinish={onFinish}>
                <Form.Item
                    name="currentPassword"
                    label="รหัสผ่านปัจจุบัน (Current Password)"
                    rules={[{ required: true, message: 'กรุณากรอกรหัสผ่านปัจจุบัน' }]}
                >
                    <Input.Password prefix={<LockOutlined />} placeholder="รหัสผ่านที่คุณใช้ล็อกอินตะกี้" />
                </Form.Item>

                <Form.Item
                    name="newPassword"
                    label="รหัสผ่านใหม่ (New Password)"
                    rules={[
                        { required: true, message: 'กรุณากรอกรหัสผ่านใหม่' },
                        { min: 6, message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' }
                    ]}
                >
                    <Input.Password prefix={<LockOutlined />} placeholder="รหัสผ่านใหม่" />
                </Form.Item>

                <Form.Item
                    name="confirmPassword"
                    label="ยืนยันรหัสผ่านใหม่ (Confirm Password)"
                    rules={[{ required: true, message: 'กรุณายืนยันรหัสผ่านใหม่' }]}
                >
                    <Input.Password prefix={<LockOutlined />} placeholder="ยืนยันรหัสผ่านใหม่" />
                </Form.Item>

                <Button type="primary" htmlType="submit" block loading={loading} icon={<SaveOutlined />} size="large">
                    บันทึกรหัสผ่านและเข้าสู่ระบบ
                </Button>
            </Form>
        </Modal>
    );
};
