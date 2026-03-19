import React, { useState, useEffect } from 'react';
import { 
    Card, Table, Button, Modal, Form, Select, DatePicker, 
    Input, Space, Tag, Typography, message, 
    Row, Col, Statistic, Progress 
} from 'antd';
import { 
    CalendarOutlined, 
    PlusOutlined, 
    HistoryOutlined, 
    ClockCircleOutlined,
    CheckCircleFilled,
    CloseCircleFilled,
    SyncOutlined
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { API_BASE } from './config';

const { Title } = Typography;
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

    return (
        <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={2}>ระบบทำเรื่องลา</Title>
                <Button type="primary" size="large" icon={<PlusOutlined />} style={{ borderRadius: 8 }} onClick={() => setIsModalOpen(true)}>
                    ยื่นคำขอการลา
                </Button>
            </div>

            {/* 1. Leave Quota Dashboard */}
            <Row gutter={[24, 24]} style={{ marginBottom: 32 }}>
                {quotas.map(q => (
                    <Col xs={12} sm={8} md={6} key={q.leave_type_id}>
                        <Card hoverable style={{ borderRadius: 16, textAlign: 'center' }}>
                            <Statistic title={q.leave_name} value={q.quota_days} suffix="วัน" />
                            <Progress percent={100} showInfo={false} strokeColor="#1890ff" size="small" />
                        </Card>
                    </Col>
                ))}
            </Row>

            {/* 2. Leave History Table */}
            <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.05)' }} title={
                <Space><HistoryOutlined /><span>ประวัติการลา</span></Space>
            }>
                <Table 
                    dataSource={requests} 
                    columns={columns} 
                    rowKey="id" 
                    pagination={{ pageSize: 5 }} 
                    style={{ borderRadius: 16 }}
                />
            </Card>

            {/* 3. Leave Submission Modal */}
            <Modal
                title={<Space><CalendarOutlined /><span>ยื่นแบบคำร้องขอลา</span></Space>}
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
                footer={null}
                style={{ borderRadius: 16 }}
            >
                <Form layout="vertical" form={form} onFinish={handleSubmit}>
                    <Form.Item label="ประเภทการลา" name="leave_type_id" rules={[{ required: true, message: 'กรุณาเลือกประเภทการลา' }]}>
                        <Select placeholder="เลือกหัวข้อการลา" style={{ borderRadius: 8 }}>
                            {leaveTypes.map(lt => (
                                <Select.Option key={lt.id} value={lt.id}>{lt.leaveName}</Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                    
                    <Form.Item label="ระยะเวลา" name="dates" rules={[{ required: true, message: 'กรุณาเลือกวันที่' }]}>
                        <RangePicker style={{ width: '100%', borderRadius: 8 }} />
                    </Form.Item>

                    <Form.Item label="เหตุผล / หมายเหตุ" name="reason" rules={[{ required: true, message: 'กรุณากรอกเหตุผล' }]}>
                        <TextArea rows={4} placeholder="ระบุเหตุผลการลา..." style={{ borderRadius: 8 }} />
                    </Form.Item>

                    <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                        <Space>
                            <Button onClick={() => setIsModalOpen(false)} style={{ borderRadius: 8 }}>ยกเลิก</Button>
                            <Button type="primary" htmlType="submit" loading={loading} style={{ borderRadius: 8 }}>ส่งคำขอ</Button>
                        </Space>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
