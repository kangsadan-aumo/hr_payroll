import React, { useState, useEffect } from 'react';
import { Card, Tabs, Table, Button, Modal, Form, Input, Select, message, Typography, Space, Tag, Alert, DatePicker, Popconfirm } from 'antd';
import { LaptopOutlined, MobileOutlined, SolutionOutlined, SafetyCertificateOutlined, PlusOutlined, EditOutlined, DeleteOutlined, HistoryOutlined } from '@ant-design/icons';
import axios from 'axios';
import { API_BASE } from './config';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

export const Assets: React.FC = () => {
    const [assets, setAssets] = useState<any[]>([]);
    const [assignments, setAssignments] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [consents, setConsents] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [assetModalOpen, setAssetModalOpen] = useState(false);
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [assetForm] = Form.useForm();
    const [assignForm] = Form.useForm();


    const fetchData = async () => {
        setLoading(true);
        try {
            const [assetRes, assignRes, empRes, pdpaRes] = await Promise.all([
                axios.get(`${API_BASE}/assets`),
                axios.get(`${API_BASE}/assets/assignments`),
                axios.get(`${API_BASE}/employees`),
                axios.get(`${API_BASE}/pdpa/consents`)
            ]);
            setAssets(assetRes.data);
            setAssignments(assignRes.data);
            setEmployees(empRes.data);
            setConsents(pdpaRes.data);
        } catch (error) {
            message.error('ไม่สามารถดึงข้อมูลทรัพย์สินได้');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const handleSaveAsset = async (values: any) => {
        try {
            await axios.post(`${API_BASE}/assets`, values);
            message.success('Asset saved successfully');
            setAssetModalOpen(false);
            assetForm.resetFields();
            fetchData();
        } catch { message.error('Failed to save asset'); }
    };

    const handleSaveAssignment = async (values: any) => {
        try {
            const payload = {
                ...values,
                assigned_at: values.assigned_at.format('YYYY-MM-DD')
            };
            await axios.post(`${API_BASE}/assets/assignments`, payload);
            message.success('Asset assigned successfully');
            setAssignModalOpen(false);
            assignForm.resetFields();
            fetchData();
        } catch { message.error('Failed to assign asset'); }
    };

    const assetColumns = [
        { 
            title: 'ชื่อทรัพย์สิน', dataIndex: 'name', key: 'name', 
            render: (text: string, r: any) => (
                <Space>
                    {r.category === 'Laptop' ? <LaptopOutlined /> : r.category === 'Mobile' ? <MobileOutlined /> : <SolutionOutlined />}
                    <Text strong>{text}</Text>
                </Space>
            )
        },
        { title: 'หมวดหมู่', dataIndex: 'category', key: 'category' },
        { title: 'Serial Number', dataIndex: 'serial_number', key: 'serial_number' },
        { 
            title: 'สถานะ', dataIndex: 'status', key: 'status', 
            render: (st: string) => <Tag color={st === 'available' ? 'green' : st === 'assigned' ? 'blue' : 'red'}>{st === 'available' ? 'พร้อมใช้งาน' : st === 'assigned' ? 'ถูกยืม' : 'ซ่อม/ชำรุด'}</Tag> 
        },
        {
            title: 'จัดการ', key: 'action', render: () => (
                <Space>
                    <Button type="text" icon={<EditOutlined style={{ color: '#1890ff' }} />} />
                    <Button type="text" danger icon={<DeleteOutlined />} />
                </Space>
            )
        }
    ];

    const assignmentColumns = [
        { title: 'พนักงาน', dataIndex: 'first_name', key: 'name', render: (text: string, r: any) => `${text} ${r.last_name}` },
        { title: 'ทรัพย์สิน', dataIndex: 'asset_name', key: 'asset_name' },
        { title: 'วันที่ยืม', dataIndex: 'assigned_at', key: 'assigned_at', render: (d: string) => dayjs(d).format('DD MMM YYYY') },
        { title: 'หมายเหตุ', dataIndex: 'note', key: 'note' },
        {
            title: 'จัดการ', key: 'action', align: 'center' as const, render: () => (
                <Popconfirm title="คุณต้องการรับทรัพย์สินคืนหรือไม่?"><Button type="primary" size="small">ส่งคืน</Button></Popconfirm>
            )
        }
    ];

    const pdpaColumns = [
        { title: 'พนักงาน', dataIndex: 'employee_name', key: 'employee_name' },
        { title: 'ประเภทความยินยอม', dataIndex: 'consent_type', key: 'consent_type' },
        { title: 'วันที่ยินยอม', dataIndex: 'consented_at', key: 'consented_at', render: (d: string) => dayjs(d).format('DD/MM/YYYY HH:mm') },
        { title: 'สถานะ', dataIndex: 'status', key: 'status', render: (st: boolean) => st ? <Tag color="green">ยินยอม (Consented)</Tag> : <Tag color="red">ยกเลิก (Revoked)</Tag> }
    ];

    return (
        <div>
            <div style={{ marginBottom: 24 }}>
                <Title level={2} style={{ margin: 0 }}>การจัดการทรัพย์สินและเอกสาร (Asset & PDPA)</Title>
                <Text type="secondary">บันทึกอุปกรณ์บริษัท, การเบิกยืม-คืน และความยิมยอมการจัดเก็บข้อมูลพนักงาน</Text>
            </div>

            <Card bordered={false} style={{ borderRadius: 8 }}>
                <Tabs defaultActiveKey="1">
                    <TabPane tab={<span><LaptopOutlined /> คลังทรัพย์สิน (Inventory)</span>} key="1">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                            <Title level={4}>รายการทรัพย์สินของบริษัท</Title>
                            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAssetModalOpen(true)}>เพิ่มทรัพย์สินใหม่</Button>
                        </div>
                        <Table columns={assetColumns} dataSource={assets} rowKey="id" loading={loading} />
                    </TabPane>

                    <TabPane tab={<span><HistoryOutlined /> การเบิกยืมสวัสดิการ (Borrowing)</span>} key="2">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                            <Title level={4}>ประวัติการถือครองและยืมทรัพย์สิน</Title>
                            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAssignModalOpen(true)}>ทำรายการเบิกยืม / จ่ายพนักงาน</Button>
                        </div>
                        <Table columns={assignmentColumns} dataSource={assignments} rowKey="id" loading={loading} />
                    </TabPane>

                    <TabPane tab={<span><SafetyCertificateOutlined /> PDPA Compliance</span>} key="3">
                        <Alert 
                            message="กฎหมายคุ้มครองข้อมูลส่วนบุคคล (PDPA)" 
                            description="บันทึกและจัดการความยินยอม (Consent) ของพนักงานในการจัดเก็บข้อมูลส่วนตัว ธุรกรรม หรือข้อมูลที่ใช้ประเมินผลงาน"
                            type="info" showIcon style={{ marginBottom: 24 }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                            <Title level={4}>บันทึกความยินยอมของพนักงาน</Title>
                        </div>
                        <Table columns={pdpaColumns} dataSource={consents} rowKey="id" loading={loading} />
                    </TabPane>
                </Tabs>
            </Card>

            {/* Asset Modal */}
            <Modal title="เพิ่มทรัพย์สินใหม่" open={assetModalOpen} onOk={() => assetForm.submit()} onCancel={() => setAssetModalOpen(false)}>
                <Form form={assetForm} layout="vertical" onFinish={handleSaveAsset}>
                    <Form.Item name="name" label="ชื่อทรัพย์สิน" rules={[{ required: true }]}><Input placeholder="Laptop / Phone / Mac" /></Form.Item>
                    <Form.Item name="category" label="หมวดหมู่" rules={[{ required: true }]}>
                        <Select>
                            <Select.Option value="Laptop">Laptop / Computer</Select.Option>
                            <Select.Option value="Mobile">Mobile Phone</Select.Option>
                            <Select.Option value="Uniform">ชุดยูนิฟอร์ม / อุปกรณ์สำนักงาน</Select.Option>
                        </Select>
                    </Form.Item>
                    <Form.Item name="serial_number" label="Serial Number (รหัสสินค้า)" rules={[{ required: true }]}><Input /></Form.Item>
                    <Form.Item name="status" label="สถานะเริ่มต้น" initialValue="available">
                        <Select>
                            <Select.Option value="available">พร้อมใช้งาน (Available)</Select.Option>
                            <Select.Option value="maintenance">ซ่อมบำรุง (Maintenance)</Select.Option>
                        </Select>
                    </Form.Item>
                </Form>
            </Modal>

            {/* Assign Modal */}
            <Modal title="มอบหมายทรัพย์สินให้พนักงาน" open={assignModalOpen} onOk={() => assignForm.submit()} onCancel={() => setAssignModalOpen(false)}>
                <Form form={assignForm} layout="vertical" onFinish={handleSaveAssignment}>
                    <Form.Item name="employee_id" label="เลือกพนักงาน" rules={[{ required: true }]}>
                        <Select placeholder="ค้นหาชื่อพนักงาน" showSearch optionFilterProp="children">
                            {employees.map(e => <Select.Option key={e.id} value={e.id}>{e.name}</Select.Option>)}
                        </Select>
                    </Form.Item>
                    <Form.Item name="asset_id" label="เลือกทรัพย์สิน (ที่พร้อมใช้งาน)" rules={[{ required: true }]}>
                        <Select placeholder="ค้นหาชื่อทรัพย์สิน">
                            {assets.filter(a => a.status === 'available').map(a => (
                                <Select.Option key={a.id} value={a.id}>{a.name} ({a.serial_number || 'No serial'})</Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item name="assigned_at" label="วันที่มอบหมาย" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
                    <Form.Item name="note" label="หมายเหตุ (Note)"><Input.TextArea /></Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
