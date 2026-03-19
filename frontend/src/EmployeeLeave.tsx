import React, { useState, useEffect } from 'react';
import { 
    Card, Button, Modal, Form, Select, DatePicker, 
    Input, Space, Tag, Typography, message
} from 'antd';
import { 
    CalendarOutlined, 
    PlusOutlined, 
    SyncOutlined,
    CheckCircleFilled,
    CloseCircleFilled,
    ClockCircleOutlined
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { API_BASE } from './config';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const { TextArea } = Input;

interface LeaveRequest {
    id: string;
    leave_type_name: string;
    start_date: string;
    end_date: string;
    total_days: number;
    status: string;
    reason: string;
    submitted_at: string;
}

export const EmployeeLeave: React.FC<{ user: any }> = ({ user }) => {
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
    const [quotas, setQuotas] = useState<any[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [form] = Form.useForm();

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [reqRes, typeRes, quotaRes] = await Promise.all([
                axios.get(`${API_BASE}/leaves/requests`, { params: { employee_id: user.id, role: 'employee' } }),
                axios.get(`${API_BASE}/leave-types`),
                axios.get(`${API_BASE}/employees/${user.id}/leave-quotas`)
            ]);
            setRequests(reqRes.data);
            setLeaveTypes(typeRes.data);
            setQuotas(quotaRes.data);
        } catch (error) {
            console.error('Failed to fetch leave data');
        }
    };

    const handleSubmit = async (values: any) => {
        setLoading(true);
        try {
            const startDate = values.dates[0].format('YYYY-MM-DD');
            const endDate = values.dates[1].format('YYYY-MM-DD');
            const diff = values.dates[1].diff(values.dates[0], 'day') + 1;

            await axios.post(`${API_BASE}/leaves/requests`, {
                employee_id: user.id,
                leave_type_id: values.leave_type_id,
                start_date: startDate,
                end_date: endDate,
                total_days: diff,
                reason: values.reason
            });

            message.success('ส่งคำขอการลาสำเร็จ! ระบบส่งเมล์แจ้งหัวหน้าแล้ว');
            setIsModalOpen(false);
            form.resetFields();
            fetchData();
        } catch (error) {
            message.error('ไม่สามารถส่งคำขอได้');
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = async (id: string) => {
        try {
            await axios.put(`${API_BASE}/leaves/requests/${id}/status`, { status: 'cancel', from: 'employee' });
            message.success('ยกเลิกการลาเรียบร้อย');
            fetchData();
        } catch (error) {
            message.error('ไม่สามารถยกเลิกได้');
        }
    };

    const getStatusTag = (status: string) => {
        let color = 'default';
        let icon = <ClockCircleOutlined />;
        
        switch (status) {
            case 'รอหัวหน้าอนุมัติ':
                color = 'warning';
                icon = <SyncOutlined spin />;
                break;
            case 'รอ hr อนุมัติ':
                color = 'processing';
                icon = <SyncOutlined spin />;
                break;
            case 'เสร็จสิ้น':
                color = 'success';
                icon = <CheckCircleFilled />;
                break;
            case 'ปฏิเสธโดยหัวหน้า':
            case 'ยกเลิกโดยhr':
                color = 'error';
                icon = <CloseCircleFilled />;
                break;
            case 'ยกเลิกโดยพนักงาน':
                color = 'default';
                icon = <CloseCircleFilled />;
                break;
        }

        return <Tag color={color} icon={icon} style={{ borderRadius: 8, padding: '2px 10px' }}>{status}</Tag>;
    };

    const columns = [
        { title: 'ประเภท', dataIndex: 'leave_type_name', key: 'leave_type_name' },
        { title: 'วันที่เริ่มต้น', dataIndex: 'start_date', key: 'start_date', render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
        { title: 'วันที่สิ้นสุด', dataIndex: 'end_date', key: 'end_date', render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
        { title: 'จำนวน (วัน)', dataIndex: 'total_days', key: 'total_days' },
        { title: 'สถานะ', dataIndex: 'status', key: 'status', render: (s: string) => getStatusTag(s) },
        {
            title: 'จัดการ',
            key: 'action',
            render: (_: any, record: LeaveRequest) => (
                (record.status === 'รอหัวหน้าอนุมัติ' || record.status === 'รอ hr อนุมัติ') && (
                    <Button type="link" danger onClick={() => handleCancel(record.id)}>ยกเลิก</Button>
                )
            )
        }
    ];

    const isMobile = window.innerWidth < 768;

    return (
        <div style={{ padding: isMobile ? '16px' : '24px', maxWidth: 1000, margin: '0 auto', background: '#f8f9fa', minHeight: 'calc(100vh - 128px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={3} style={{ margin: 0 }}>วันลาคงเหลือ</Title>
                <Button type="primary" shape="circle" icon={<PlusOutlined />} size="large" onClick={() => setIsModalOpen(true)} />
            </div>

            {/* 1. Leave Quota - Card Layout */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
                {quotas.map(q => (
                    <Card key={q.leave_type_id} bodyStyle={{ padding: 16 }} bordered={false} style={{ borderRadius: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <div style={{ 
                                width: 48, height: 48, borderRadius: 12, 
                                background: q.leave_name.includes('กิจ') ? '#e6f7ff' : '#fff1f0',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24
                            }}>
                                {q.leave_name.includes('กิจ') ? '💼' : '🏥'}
                            </div>
                            <div>
                                <div style={{ fontSize: 16, fontWeight: 'bold' }}>{q.leave_name}</div>
                                <div style={{ color: '#8c8c8c' }}>
                                    เหลือ <span style={{ color: '#ff7a45', fontWeight: 'bold' }}>{q.quota_days}</span> จาก {q.total_days || q.quota_days} วัน
                                </div>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            <Title level={3} style={{ marginBottom: 16 }}>คำขอลาล่าสุด</Title>

            {/* 2. Leave History - Card Layout instead of Table */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {requests.map(req => (
                    <Card key={req.id} bodyStyle={{ padding: 16 }} bordered={false} style={{ borderRadius: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                            <Text strong style={{ fontSize: 16 }}>{req.leave_type_name}</Text>
                            {getStatusTag(req.status)}
                        </div>
                        <div style={{ fontSize: 14, color: '#595959', marginBottom: 4 }}>
                            {dayjs(req.start_date).format('DD/MM/YYYY')} - {dayjs(req.end_date).format('DD/MM/YYYY')} ({req.total_days} วัน)
                        </div>
                        <div style={{ fontSize: 13, color: '#8c8c8c' }}>
                            เหตุผล: {req.reason || '-'}
                        </div>
                        
                        {(req.status === 'รอหัวหน้าอนุมัติ' || req.status === 'รอ hr อนุมัติ') && (
                            <div style={{ textAlign: 'right', marginTop: 8 }}>
                                <Button type="link" danger size="small" onClick={() => handleCancel(req.id)}>ยกเลิกโดยพนักงาน</Button>
                            </div>
                        )}
                    </Card>
                ))}
                {requests.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 40, color: '#bfbfbf' }}>ยังไม่มีประวัติการลา</div>
                )}
            </div>

            {/* 3. Leave Submission Modal */}
            <Modal
                title={<Space><CalendarOutlined /><span>ยื่นแบบคำร้องขอลา</span></Space>}
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
                footer={null}
                width={isMobile ? '95%' : 520}
                style={{ borderRadius: 16 }}
            >
                <Form layout="vertical" form={form} onFinish={handleSubmit}>
                    <Form.Item label="ประเภทการลา" name="leave_type_id" rules={[{ required: true, message: 'กรุณาเลือกประเภทการลา' }]}>
                        <Select placeholder="เลือกหัวข้อการลา" style={{ borderRadius: 8 }} size="large">
                            {leaveTypes.map(lt => (
                                <Select.Option key={lt.id} value={lt.id}>{lt.leaveName}</Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                    
                    <Form.Item label="ระยะเวลา" name="dates" rules={[{ required: true, message: 'กรุณาเลือกวันที่' }]}>
                        <RangePicker style={{ width: '100%', borderRadius: 8 }} size="large" />
                    </Form.Item>

                    <Form.Item label="เหตุผล / หมายเหตุ" name="reason" rules={[{ required: true, message: 'กรุณากรอกเหตุผล' }]}>
                        <TextArea rows={4} placeholder="ระบุเหตุผลการลา..." style={{ borderRadius: 8 }} />
                    </Form.Item>

                    <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                        <Space>
                            <Button onClick={() => setIsModalOpen(false)} size="large">ยกเลิก</Button>
                            <Button type="primary" htmlType="submit" loading={loading} size="large">ส่งคำขอ</Button>
                        </Space>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
