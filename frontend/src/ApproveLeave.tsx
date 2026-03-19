import React, { useEffect, useState } from 'react';
import { Result, Button, Spin, Typography, Card } from 'antd';
import { 
    HomeOutlined,
    LoadingOutlined
} from '@ant-design/icons';
import axios from 'axios';
import { API_BASE } from './config';

const { Title } = Typography;

export const ApproveLeave: React.FC = () => {
    const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'already_processed'>('loading');
    const [errorMsg, setErrorMsg] = useState('');
    const [actionInfo, setActionInfo] = useState({ action: '', from: '' });

    useEffect(() => {
        const query = new URLSearchParams(window.location.search);
        const token = query.get('token');
        const id = query.get('id');
        const action = query.get('action'); // approve | reject
        const from = query.get('from'); // supervisor | hr

        if (!token || !id || !action || !from) {
            setStatus('error');
            setErrorMsg('ข้อมูลในลิงก์ไม่ครบถ้วน');
            return;
        }

        setActionInfo({ action, from });
        handleAction(id, token, action, from);
    }, []);

    const handleAction = async (id: string, token: string, action: string, from: string) => {
        try {
            // 1. Verify token first
            const verifyRes = await axios.get(`${API_BASE}/leaves/verify-token`, { params: { id, token } });
            const currentStatus = verifyRes.data.status;
            
            // 2. Check if already processed
            if (from === 'supervisor' && currentStatus !== 'รอหัวหน้าอนุมัติ') {
                setStatus('already_processed');
                return;
            }
            if (from === 'hr' && currentStatus !== 'รอ hr อนุมัติ') {
                setStatus('already_processed');
                return;
            }

            // 3. Execute action
            await axios.put(`${API_BASE}/leaves/requests/${id}/status`, { 
                status: action === 'approve' ? 'approve' : 'reject', 
                from 
            });

            setStatus('success');
        } catch (error: any) {
            setStatus('error');
            setErrorMsg(error.response?.data?.error || 'เกิดข้อผิดพลาดในการดำเนินการ');
        }
    };

    const renderContent = () => {
        switch (status) {
            case 'loading':
                return (
                    <Card style={{ borderRadius: 24, padding: 40, textAlign: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.1)' }}>
                        <Spin indicator={<LoadingOutlined style={{ fontSize: 64 }} spin />} />
                        <Title level={3} style={{ marginTop: 24 }}>กำลังประมวลผลคำขอ...</Title>
                    </Card>
                );
            case 'success':
                return (
                    <Result
                        status="success"
                        title={<Title level={2}>ดำเนินการสำเร็จ!</Title>}
                        subTitle={`คุณได้ทำการ ${actionInfo.action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'} คำขอการลา ในบทบาท ${actionInfo.from === 'supervisor' ? 'หัวหน้า' : 'HR'} เรียบร้อยแล้ว`}
                        extra={[
                            <Button type="primary" size="large" key="home" icon={<HomeOutlined />} onClick={() => window.location.href = '/'} style={{ borderRadius: 12 }}>
                                ไปที่หน้าหลัก
                            </Button>
                        ]}
                        style={{ background: 'white', borderRadius: 24, padding: 48, boxShadow: '0 20px 50px rgba(0,0,0,0.1)' }}
                    />
                );
            case 'already_processed':
                return (
                    <Result
                        status="info"
                        title="รายการนี้ถูกดำเนินการไปแล้ว"
                        subTitle="คำขอการลานี้ได้เปลี่ยนสถานะไปเรียบร้อยแล้ว หรือถูกดำเนินการไปก่อนหน้านี้"
                        extra={[
                            <Button type="primary" size="large" key="home" onClick={() => window.location.href = '/'} style={{ borderRadius: 12 }}>
                                กลับหน้าหลัก
                            </Button>
                        ]}
                        style={{ background: 'white', borderRadius: 24, padding: 48, boxShadow: '0 20px 50px rgba(0,0,0,0.1)' }}
                    />
                );
            case 'error':
                return (
                    <Result
                        status="error"
                        title="เกิดข้อผิดพลาด"
                        subTitle={errorMsg || 'ลิงก์นี้หมดอายุหรือไม่ถูกต้อง'}
                        extra={[
                            <Button type="primary" size="large" key="home" icon={<HomeOutlined />} onClick={() => window.location.href = '/'} style={{ borderRadius: 12 }}>
                                กลับหน้าหลัก
                            </Button>
                        ]}
                        style={{ background: 'white', borderRadius: 24, padding: 48, boxShadow: '0 20px 50px rgba(0,0,0,0.1)' }}
                    />
                );
        }
    };

    return (
        <div style={{ 
            minHeight: '100vh', 
            background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)', 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center',
            padding: 24
        }}>
            <div style={{ maxWidth: 600, width: '100%' }}>
                {renderContent()}
            </div>
        </div>
    );
};
