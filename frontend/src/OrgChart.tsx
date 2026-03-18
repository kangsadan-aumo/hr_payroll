import React, { useState, useEffect } from 'react';
import { Card, Tree, Typography, Spin, Empty, Avatar, Space, message, Alert, Divider, Badge } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import axios from 'axios';
import { API_BASE } from './config';

const { Title, Text } = Typography;

export const OrgChart: React.FC = () => {
    const [treeData, setTreeData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const buildTree = (employees: any[], parentId: any = null): any[] => {
        return employees
            .filter(e => e.reports_to === parentId)
            .map(e => ({
                title: (
                    <Space style={{ padding: '8px 12px', border: '1px solid #f0f0f0', borderRadius: 8, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                        <Avatar icon={<UserOutlined />} style={{ backgroundColor: parentId === null ? '#1890ff' : '#52c41a' }} />
                        <div>
                            <div style={{ fontWeight: 600 }}>{`${e.first_name} ${e.last_name}`}</div>
                            <div style={{ fontSize: 12, color: '#888' }}>{e.position}</div>
                        </div>
                    </Space>
                ),
                key: e.id.toString(),
                children: buildTree(employees, e.id)
            }));
    };

    const fetchOrgData = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_BASE}/org-chart`);
            const employees = res.data;
            const roots = buildTree(employees, null);
            setTreeData(roots);
        } catch (error) {
            message.error('ไม่สามารถดึงข้อมูลโครงสร้างองค์กรได้');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchOrgData(); }, []);

    return (
        <div>
            <div style={{ marginBottom: 24 }}>
                <Title level={2} style={{ margin: 0 }}>โครงสร้างองค์กร (Organizational Chart)</Title>
                <Text type="secondary">ผังโครงสร้างการบังคับบัญชาและสายงานรายงาน</Text>
            </div>

            <Alert 
                message="วิธีการตั้งค่าสายงานรายงาน" 
                description="คุณสามารถเข้าจัดการว่าพนักงานคนใดรายงานตัวต่อใคร ได้ที่หน้าจัดการพนักงาน"
                type="info" showIcon style={{ marginBottom: 24 }}
            />

            <Card bordered={false} style={{ borderRadius: 8, minHeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflow: 'auto' }}>
                {loading ? (
                    <div style={{ marginTop: 100 }}><Spin size="large" tip="กำลังสร้างผังองค์กร..." /></div>
                ) : treeData.length > 0 ? (
                    <div style={{ padding: 40, width: '100%' }}>
                        <Tree
                            showLine={{ showLeafIcon: false }}
                            showIcon={false}
                            defaultExpandAll
                            selectable={false}
                            treeData={treeData}
                            style={{ background: 'transparent' }}
                        />
                    </div>
                ) : (
                    <Empty description="ยังไม่มีการตั้งค่าโครงสร้างองค์กร" />
                )}
            </Card>

            <Divider />
            <div style={{ textAlign: 'center' }}>
                <Space>
                    <Badge status="processing" text="ระดับผู้บริหาร" />
                    <Badge status="success" text="ระดับหัวหน้างาน" />
                    <Badge status="default" text="พนักงานทั่วไป" />
                </Space>
            </div>
        </div>
    );
};
