import React, { useState, useEffect } from 'react';
import { Card, Tabs, Table, Button, Modal, Form, Input, InputNumber, Select, message, Typography, Space, Tag, Divider, Row, Col, Alert } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, BarChartOutlined, FileSearchOutlined, StarOutlined, CheckCircleOutlined } from '@ant-design/icons';
import axios from 'axios';
import { API_BASE } from './config';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

export const Performance: React.FC = () => {
    const [kpis, setKpis] = useState<any[]>([]);
    const [evaluations, setEvaluations] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [kpiModalOpen, setKpiModalOpen] = useState(false);
    const [evalModalOpen, setEvalModalOpen] = useState(false);
    const [kpiForm] = Form.useForm();
    const [evalForm] = Form.useForm();

    const API_BASE = ${API_BASE}';

    const fetchData = async () => {
        setLoading(true);
        try {
            const [kpiRes, evalRes, empRes] = await Promise.all([
                axios.get(`${API_BASE}/performance/kpis`),
                axios.get(`${API_BASE}/performance/evaluations`),
                axios.get(`${API_BASE}/employees`)
            ]);
            setKpis(kpiRes.data);
            setEvaluations(evalRes.data);
            setEmployees(empRes.data);
        } catch (error) {
            message.error('Failed to load performance data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleSaveKpi = async (values: any) => {
        try {
            await axios.post(`${API_BASE}/performance/kpis`, values);
            message.success('KPI added successfully');
            setKpiModalOpen(false);
            kpiForm.resetFields();
            fetchData();
        } catch { message.error('Failed to save KPI'); }
    };

    const handleSaveEval = async (values: any) => {
        try {
            await axios.post(`${API_BASE}/performance/evaluations`, values);
            message.success('Evaluation saved successfully');
            setEvalModalOpen(false);
            evalForm.resetFields();
            fetchData();
        } catch { message.error('Failed to save Evaluation'); }
    };

    const kpiColumns = [
        { title: 'ชื่อตัวชี้วัด (KPI Name)', dataIndex: 'name', key: 'name' },
        { title: 'คำอธิบาย (Description)', dataIndex: 'description', key: 'description' },
        { title: 'น้ำหนัก (Weight)', dataIndex: 'weight', key: 'weight', render: (w: number) => `${w || 1.0}` },
        {
            title: 'จัดการ', key: 'action', render: () => (
                <Space>
                    <Button type="text" icon={<EditOutlined style={{ color: '#1890ff' }} />} />
                    <Button type="text" danger icon={<DeleteOutlined />} />
                </Space>
            )
        }
    ];

    const evalColumns = [
        { title: 'พนักงาน', dataIndex: 'employee_name', key: 'employee_name' },
        { title: 'ช่วงเวลา', dataIndex: 'period_name', key: 'period_name' },
        { title: 'คะแนน', dataIndex: 'score', key: 'score', render: (s: number) => <Tag color={s > 80 ? 'green' : s > 50 ? 'blue' : 'orange'}>{s}%</Tag> },
        { title: 'ผู้ประเมิน', dataIndex: 'evaluator_name', key: 'evaluator_name' },
        { title: 'สถานะ', dataIndex: 'status', key: 'status', render: (st: string) => <Tag color={st === 'completed' ? 'green' : 'blue'}>{st === 'completed' ? 'เสร็จสมบูรณ์' : 'รอดำเนินการ'}</Tag> },
        {
            title: 'Action', key: 'action', render: () => (
                <Button type="link">ดูรายละเอียด</Button>
            )
        }
    ];

    return (
        <div>
            <div style={{ marginBottom: 24 }}>
                <Title level={2} style={{ margin: 0 }}>ระบบบริหารผลงาน (Performance Management)</Title>
                <Text type="secondary">ตั้งค่า KPI, ติดตาม OKR และประเมินผลงานพนักงานรายไตรมาส/ปี</Text>
            </div>

            <Card bordered={false} style={{ borderRadius: 8 }}>
                <Tabs defaultActiveKey="1">
                    <TabPane tab={<span><BarChartOutlined /> สรุปผลงานยอดเยี่ยม (Top Performers)</span>} key="top">
                        <Row gutter={16}>
                            <Col span={8}>
                                <Card size="small" title="Top Performer (Sales)" bordered={false} style={{ background: '#f6ffed', border: '1px solid #b7eb8f' }}>
                                    <Space align="center">
                                        <StarOutlined style={{ fontSize: 24, color: '#52c41a' }} />
                                        <div>
                                            <Text strong>สมชาย ใจกล้า</Text>
                                            <div style={{ fontSize: 12 }}>คะแนนประเมินล่าสุด: 95%</div>
                                        </div>
                                    </Space>
                                </Card>
                            </Col>
                        </Row>
                        <Divider />
                        <Title level={4}>รายการประเมินล่าสุด</Title>
                        <Table columns={evalColumns} dataSource={evaluations} rowKey="id" loading={loading} />
                    </TabPane>

                    <TabPane tab={<span><FileSearchOutlined /> ตั้งค่า KPI/OKR</span>} key="kpis">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                            <Title level={4}>ตัวชี้วัดวัดผลงานหลัก (Key Performance Indicators)</Title>
                            <Button type="primary" icon={<PlusOutlined />} onClick={() => setKpiModalOpen(true)}>เพิ่มตัวชี้วัดใหม่</Button>
                        </div>
                        <Table columns={kpiColumns} dataSource={kpis} rowKey="id" loading={loading} />
                    </TabPane>

                    <TabPane tab={<span><StarOutlined /> ประเมินพนักงาน (Evaluation)</span>} key="eval">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                            <Title level={4}>การประเมินผลพนักงาน</Title>
                            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEvalModalOpen(true)}>สร้างรอบการประเมินใหม่</Button>
                        </div>
                        <Table columns={evalColumns} dataSource={evaluations} rowKey="id" loading={loading} />
                    </TabPane>

                    <TabPane tab={<span><CheckCircleOutlined /> 360 Degree Feedback</span>} key="360">
                        <Alert 
                            message="ระบบประเมินรอบทิศทาง (360 Degree Feedback)" 
                            description="เร็วๆ นี้: ระบบจะเปิดให้พนักงานในทีมและเพื่อนร่วมงานมีส่วนร่วมในการส่งคำติชมเพื่อการพัฒนาในไตรมาสหน้า"
                            type="info" showIcon
                        />
                    </TabPane>
                </Tabs>
            </Card>

            {/* KPI Modal */}
            <Modal title="เพิ่มตัวชี้วัด KPI ใหม่" open={kpiModalOpen} onOk={() => kpiForm.submit()} onCancel={() => setKpiModalOpen(false)}>
                <Form form={kpiForm} layout="vertical" onFinish={handleSaveKpi}>
                    <Form.Item name="name" label="ชื่อตัวชี้วัด" rules={[{ required: true }]}><Input /></Form.Item>
                    <Form.Item name="description" label="รายละเอียด"><Input.TextArea /></Form.Item>
                    <Form.Item name="weight" label="น้ำหนัก (0.1 - 10.0)" initialValue={1.0}><InputNumber min={0.1} max={10} step={0.1} style={{ width: '100%' }} /></Form.Item>
                </Form>
            </Modal>

            {/* Evaluation Modal */}
            <Modal title="สร้างรอบการประเมิน" open={evalModalOpen} onOk={() => evalForm.submit()} onCancel={() => setEvalModalOpen(false)}>
                <Form form={evalForm} layout="vertical" onFinish={handleSaveEval} initialValues={{ status: 'draft' }}>
                    <Form.Item name="employee_id" label="พนักงาน" rules={[{ required: true }]}>
                        <Select placeholder="เลือกพนักงาน">
                            {employees.map(e => <Select.Option key={e.id} value={e.id}>{e.name}</Select.Option>)}
                        </Select>
                    </Form.Item>
                    <Form.Item name="period_name" label="ชื่อรอบการประเมิน" rules={[{ required: true }]}><Input placeholder="เช่น Q1 2024" /></Form.Item>
                    <Form.Item name="score" label="คะแนนรวม (%)" rules={[{ required: true }]}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item>
                    <Form.Item name="feedback" label="คำติชม / ความคิดเห็นเพิ่มเติม"><Input.TextArea rows={4} /></Form.Item>
                    <Form.Item name="status" label="สถานะประเมิน">
                        <Select>
                            <Select.Option value="draft">บันทึกร่าง (Draft)</Select.Option>
                            <Select.Option value="completed">เสร็จสมบูรณ์ (Completed)</Select.Option>
                        </Select>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
