import React, { useState, useEffect } from 'react';
import { Card, Typography, Tag, message } from 'antd';
import { 
    CheckCircleFilled
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { API_BASE } from './config';

const { Title, Text } = Typography;

interface AttendanceLog {
    id: number;
    check_in_time: string;
    check_out_time: string | null;
    status: string;
    late_minutes: number;
}

export const EmployeeAttendance: React.FC<{ user: any }> = ({ user }) => {
    const isMobile = window.innerWidth < 768;
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<AttendanceLog[]>([]);
    const [todayLog, setTodayLog] = useState<AttendanceLog | null>(null);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(dayjs()), 1000);
        fetchLogs();
        return () => clearInterval(timer);
    }, []);

    const fetchLogs = async () => {
        try {
            const res = await axios.get(`${API_BASE}/attendance`, {
                params: {
                    employee_id: user.id,
                    role: 'employee',
                    month: dayjs().month() + 1,
                    year: dayjs().year()
                }
            });
            const allLogs = res.data.logs;
            setLogs(allLogs);
            
            const today = dayjs().format('YYYY-MM-DD');
            const found = allLogs.find((l: any) => dayjs(l.check_in_time).format('YYYY-MM-DD') === today);
            setTodayLog(found || null);
        } catch (error) {
            console.error('Failed to fetch attendance', error);
        }
    };

    const handleAction = async (action: 'check-in' | 'check-out') => {
        setLoading(true);
        try {
            const endpoint = `${API_BASE}/attendance/${action}`;
            const res = await axios.post(endpoint, { employee_id: user.id });
            message.success(res.data.message);
            fetchLogs();
        } catch (error: any) {
            message.error(error.response?.data?.error || 'Action failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: isMobile ? '12px' : '24px', maxWidth: 800, margin: '0 auto', background: '#f8f9fa', minHeight: 'calc(100vh - 128px)' }}>
            <div style={{ textAlign: 'center', marginBottom: 32, marginTop: 16 }}>
                <Title level={1} style={{ fontSize: 64, margin: 0, color: '#ff7a45', letterSpacing: 2 }}>
                    {currentTime.format('HH:mm:ss')}
                </Title>
                <Text type="secondary" style={{ fontSize: 18 }}>
                    {currentTime.format('ddddที่ DD MMMM YYYY')}
                </Text>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 40 }}>
                <div 
                    onClick={() => {
                        if (loading) return;
                        if (!todayLog) handleAction('check-in');
                        else if (!todayLog.check_out_time) handleAction('check-out');
                    }}
                    style={{
                        width: 220,
                        height: 220,
                        borderRadius: '50%',
                        background: (todayLog && todayLog.check_out_time) ? '#d9d9d9' : 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 12px 32px rgba(82, 196, 26, 0.3)',
                        cursor: (todayLog && todayLog.check_out_time) ? 'not-allowed' : 'pointer',
                        transition: 'all 0.3s',
                        color: 'white',
                        border: '8px solid rgba(255,255,255,0.2)'
                    }}
                    className="check-button"
                >
                    <CheckCircleFilled style={{ fontSize: 40, marginBottom: 12 }} />
                    <span style={{ fontSize: 24, fontWeight: 'bold' }}>
                        {!todayLog ? 'เข้างาน' : (todayLog.check_out_time ? 'เสร็จสิ้น' : 'ออกงาน')}
                    </span>
                </div>
            </div>

            <Card bordered={false} style={{ borderRadius: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <Title level={4}>สรุปการเข้าออกงานวันนี้</Title>
                <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                        <Text type="secondary">เข้างาน:</Text>
                        <Text strong style={{ fontSize: 16 }}>
                            {todayLog ? dayjs(todayLog.check_in_time).format('YYYY-MM-DD HH:mm') : '-'}
                        </Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                        <Text type="secondary">ออกงาน:</Text>
                        <Text strong style={{ fontSize: 16 }}>
                            {todayLog?.check_out_time ? dayjs(todayLog.check_out_time).format('YYYY-MM-DD HH:mm') : '-'}
                        </Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', alignItems: 'center' }}>
                        <Text type="secondary">สถานะ:</Text>
                        {todayLog ? (
                            <Tag color={todayLog.check_out_time ? "green" : "orange"} style={{ borderRadius: 12, padding: '2px 12px' }}>
                                {todayLog.check_out_time ? "เสร็จสิ้น" : "ยังไม่ออกงาน"}
                            </Tag>
                        ) : (
                            <Tag color="default">ยังไม่พบข้อมูล</Tag>
                        )}
                    </div>
                </div>
            </Card>

            {/* Recent Mini History */}
            <div style={{ marginTop: 24 }}>
                <Title level={5}>ประวัติล่าสุด</Title>
                <div style={{ background: '#fff', borderRadius: 16, padding: '8px 16px' }}>
                    {logs.slice(0, 3).map(log => (
                        <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f5f5f5' }}>
                            <Text>{dayjs(log.check_in_time).format('DD/MM/YYYY')}</Text>
                            <Tag color={log.status === 'late' ? 'red' : 'blue'}>
                                {log.status === 'late' ? 'สาย' : 'ปกติ'}
                            </Tag>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
