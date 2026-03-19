import React, { useState, useEffect } from 'react';
import { Card, Button, Typography, Space, Timeline, Tag, message, Statistic, Row, Col } from 'antd';
import { 
    ClockCircleOutlined, 
    LoginOutlined, 
    LogoutOutlined,
    CheckCircleFilled,
    WarningFilled 
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
        <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }}>
            <Title level={2} style={{ marginBottom: 24 }}>ระบบบันทึกเวลาปฏิบัติงาน</Title>
            
            <Row gutter={[24, 24]}>
                {/* 1. Main Action Card */}
                <Col xs={24} md={12}>
                    <Card bordered={false} style={{ borderRadius: 16, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
                        <Statistic 
                            title="เวลาปัจจุบัน" 
                            value={currentTime.format('HH:mm:ss')} 
                            valueStyle={{ fontSize: 48, fontWeight: 'bold', color: '#1890ff' }}
                        />
                        <Text type="secondary" style={{ display: 'block', marginBottom: 32 }}>
                            {currentTime.format('ddddที่ DD MMMM YYYY')}
                        </Text>
                        
                        <Space size="large" style={{ width: '100%', justifyContent: 'center' }}>
                            <Button 
                                type="primary" 
                                size="large" 
                                icon={<LoginOutlined />} 
                                disabled={!!todayLog || loading}
                                onClick={() => handleAction('check-in')}
                                style={{ 
                                    height: 120, 
                                    width: 140, 
                                    borderRadius: 16, 
                                    display: 'flex', 
                                    flexDirection: 'column', 
                                    alignItems: 'center', 
                                    justifyContent: 'center',
                                    fontSize: 18,
                                    background: todayLog ? '#d9d9d9' : '#52c41a',
                                    border: 'none'
                                }}
                            >
                                <div style={{ fontSize: 24, marginBottom: 8 }}><LoginOutlined /></div>
                                ลงเวลาเข้า
                            </Button>
                            
                            <Button 
                                type="primary" 
                                size="large" 
                                danger
                                icon={<LogoutOutlined />} 
                                disabled={!todayLog || !!todayLog?.check_out_time || loading}
                                onClick={() => handleAction('check-out')}
                                style={{ 
                                    height: 120, 
                                    width: 140, 
                                    borderRadius: 16, 
                                    display: 'flex', 
                                    flexDirection: 'column', 
                                    alignItems: 'center', 
                                    justifyContent: 'center',
                                    fontSize: 18,
                                    background: (!todayLog || todayLog.check_out_time) ? '#d9d9d9' : '#ff4d4f',
                                    border: 'none'
                                }}
                            >
                                <div style={{ fontSize: 24, marginBottom: 8 }}><LogoutOutlined /></div>
                                ลงเวลาออก
                            </Button>
                        </Space>
                    </Card>
                </Col>

                {/* 2. Status & Details */}
                <Col xs={24} md={12}>
                    <Card bordered={false} title="ประวัติของวันนี้" style={{ borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.05)', minHeight: 280 }}>
                        {todayLog ? (
                            <Timeline style={{ marginTop: 16 }}>
                                <Timeline.Item color="green">
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>เข้างาน: <b>{dayjs(todayLog.check_in_time).format('HH:mm')} น.</b></span>
                                        {todayLog.status === 'late' ? 
                                            <Tag color="red" icon={<WarningFilled />}>สาย {todayLog.late_minutes} นาที</Tag> : 
                                            <Tag color="green" icon={<CheckCircleFilled />}>ตรงเวลา</Tag>
                                        }
                                    </div>
                                </Timeline.Item>
                                {todayLog.check_out_time && (
                                    <Timeline.Item color="blue">
                                        <span>ออกงาน: <b>{dayjs(todayLog.check_out_time).format('HH:mm')} น.</b></span>
                                    </Timeline.Item>
                                )}
                            </Timeline>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '40px 0' }}>
                                <ClockCircleOutlined style={{ fontSize: 48, color: '#bfbfbf', marginBottom: 16 }} />
                                <p style={{ color: '#8c8c8c' }}>รอคุณบันทึกเวลาเข้างาน</p>
                            </div>
                        )}
                    </Card>
                </Col>

                {/* 3. Recent History List */}
                <Col span={24}>
                    <Card bordered={false} title="ประวัติการลงเวลาย้อนหลัง" style={{ borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.05)' }}>
                        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                            {logs.map(log => (
                                <div key={log.id} style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center', 
                                    padding: '12px 16px', 
                                    borderBottom: '1px solid #f0f0f0' 
                                }}>
                                    <div>
                                        <Text strong>{dayjs(log.check_in_time).format('DD/MM/YYYY')}</Text>
                                        <div style={{ fontSize: 13, color: '#8c8c8c' }}>
                                            {dayjs(log.check_in_time).format('HH:mm')} 
                                            {log.check_out_time ? ` - ${dayjs(log.check_out_time).format('HH:mm')}` : ' (ไม่มีข้อมูลออก)'}
                                        </div>
                                    </div>
                                    <div>
                                        {log.status === 'late' ? 
                                            <Tag color="volcano" style={{ borderRadius: 8 }}>สาย {log.late_minutes} นาที</Tag> : 
                                            <Tag color="blue" style={{ borderRadius: 8 }}>เข้างานปกติ</Tag>
                                        }
                                    </div>
                                </div>
                            ))}
                            {logs.length === 0 && <p style={{ textAlign: 'center', padding: 24, color: '#bfbfbf' }}>ไม่พบประวัติย้อนหลังในเดือนนี้</p>}
                        </div>
                    </Card>
                </Col>
            </Row>
        </div>
    );
};
