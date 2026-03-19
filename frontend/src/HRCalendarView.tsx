import React, { useState, useEffect } from 'react';
import { Calendar, Badge, Card, Typography, Alert, Select, Row, Col } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import axios from 'axios';
import { API_BASE } from './config';
import dayjs from 'dayjs';
import { toThaiMonth } from './utils/thaiDate';

const { Title } = Typography;

export const HRCalendarView: React.FC = () => {
    const [events, setEvents] = useState<any[]>([]);

    useEffect(() => {
        const fetchEvents = async () => {
            try {
                const res = await axios.get(`${API_BASE}/admin/calendar`);
                setEvents(res.data);
            } catch (error) {
                console.error('Failed to fetch calendar events');
            }
        };
        fetchEvents();
    }, []);

    const dateCellRender = (value: dayjs.Dayjs) => {
        const listData = events.filter(e => dayjs(e.date).format('YYYY-MM-DD') === value.format('YYYY-MM-DD'));
        return (
            <ul className="events" style={{ listStyle: 'none', padding: 0 }}>
                {listData.map((item, index) => (
                    <li key={index}>
                        <Badge status={item.type as any} text={item.content} style={{ fontSize: '11px' }} />
                    </li>
                ))}
            </ul>
        );
    };

    return (
        <div style={{ padding: '24px' }}>
            <Title level={2}><CalendarOutlined /> ปฏิทินงาน HR (HR Calendar)</Title>
            <Alert 
                message="ปฏิทินแสดงภาพรวม: วันครบรอบเริ่มงาน, วันลาที่อนุมัติแล้ว, วันหมดสัญญา และวันครบโปรโมชั่น" 
                type="info" 
                showIcon 
                style={{ marginBottom: 16 }}
            />
            <Card>
                <Calendar 
                    cellRender={dateCellRender} 
                    headerRender={({ value, onChange }) => {
                        const year = value.year();
                        const month = value.month();
                        const options = [];
                        for (let i = year - 10; i < year + 10; i += 1) {
                            options.push(<Select.Option key={i} value={i}>{i + 543}</Select.Option>);
                        }
                        const monthOptions = [];
                        for (let i = 0; i < 12; i++) {
                            monthOptions.push(<Select.Option key={i} value={i}>{toThaiMonth(i + 1, year).split(' ')[0]}</Select.Option>);
                        }
                        return (
                            <div style={{ padding: 16 }}>
                                <Row justify="end" gutter={8}>
                                    <Col>
                                        <Select
                                            size="small"
                                            value={year}
                                            onChange={newYear => onChange(value.clone().year(newYear))}
                                        >
                                            {options}
                                        </Select>
                                    </Col>
                                    <Col>
                                        <Select
                                            size="small"
                                            value={month}
                                            onChange={newMonth => onChange(value.clone().month(newMonth))}
                                        >
                                            {monthOptions}
                                        </Select>
                                    </Col>
                                </Row>
                            </div>
                        );
                    }}
                />
            </Card>
        </div>
    );
};
