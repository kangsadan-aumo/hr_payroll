import React, { useState, useEffect } from 'react';
import {
    Row, Col, Card, Upload, Statistic, Typography, Table, Space, Tag, Input,
    message, Button, DatePicker, Modal, Calendar, Badge, Tooltip
} from 'antd';
import type { TableProps } from 'antd';
import {
    InboxOutlined, UserOutlined, ClockCircleOutlined,
    SearchOutlined, DatabaseOutlined, SyncOutlined,
    CheckCircleOutlined, CalendarOutlined, FileExcelOutlined
} from '@ant-design/icons';
import { parseAttendanceCSV } from './utils/csvProcessor';
import dayjs, { Dayjs } from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import axios from 'axios';
import * as XLSX from 'xlsx';

dayjs.extend(isSameOrBefore);

const { Title, Text } = Typography;
const { Dragger } = Upload;

const API = 'http://localhost:5000/api';

interface DbSummary {
    employeeId: string;
    name: string;
    department: string;
    workDays: number;
    weekdays: number;
    weekends: number;
    onTimeDays: number;
    lateCount: number;
    totalLateMinutes: number;
}

export const DataImport: React.FC = () => {
    // ── DB state (persisted data) ──
    const [dbSummary, setDbSummary] = useState<DbSummary[]>([]);
    const [dbLogs, setDbLogs] = useState<any[]>([]);
    const [dbLoading, setDbLoading] = useState(false);
    const [dbMonth, setDbMonth] = useState<dayjs.Dayjs | null>(dayjs());
    const [dbSearch, setDbSearch] = useState('');

    // ── Upload Modal state ──
    const [isUploadModalVisible, setIsUploadModalVisible] = useState(false);
    const [uploading, setUploading] = useState(false);

    // ── Calendar Modal state ──
    const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false);
    const [selectedEmployeeName, setSelectedEmployeeName] = useState('');
    const [selectedEmployeeLogs, setSelectedEmployeeLogs] = useState<any[]>([]);
    const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
    const [publicHolidays, setPublicHolidays] = useState<any[]>([]);

    // ── Fetch persisted data from DB ──
    const fetchDbAttendance = async () => {
        setDbLoading(true);
        try {
            const month = dbMonth ? dbMonth.month() + 1 : undefined;
            const year = dbMonth ? dbMonth.year() : undefined;
            const [res, leaveRes, holidaysRes] = await Promise.all([
                axios.get(`${API}/attendance`, { params: { month, year } }),
                axios.get(`${API}/leaves/requests`),
                axios.get(`${API}/settings/holidays`)
            ]);
            setDbSummary(res.data.summary || []);
            setDbLogs(res.data.logs || []);
            setLeaveRequests(leaveRes.data || []);
            setPublicHolidays(holidaysRes.data || []);
        } catch {
            message.error('ไม่สามารถดึงข้อมูล attendance จากระบบได้');
        } finally {
            setDbLoading(false);
        }
    };

    useEffect(() => { fetchDbAttendance(); }, [dbMonth]);

    // ── Normalize date string to YYYY-MM-DD HH:MM:SS for MariaDB ──
    const normalizeDateTime = (dateStr: string, timeStr?: string): string | null => {
        if (!dateStr || dateStr.trim() === '' || dateStr === '-') return null;
        try {
            let normalized = dateStr.trim();
            normalized = normalized.replace(/\//g, '-');
            if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(normalized)) {
                const [d, m, y] = normalized.split('-');
                normalized = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            }
            const parts = normalized.split('-');
            if (parts[0] && parseInt(parts[0]) > 2500) {
                parts[0] = String(parseInt(parts[0]) - 543);
                normalized = parts.join('-');
            }
            const timePart = timeStr && timeStr.trim() !== '' && timeStr !== '-'
                ? timeStr.trim().length <= 5 ? `${timeStr.trim()}:00` : timeStr.trim()
                : '00:00:00';
            return `${normalized} ${timePart}`;
        } catch {
            return null;
        }
    };

    // ── File Upload Handler ──
    const handleFileUpload = (file: File) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                setUploading(true);
                let records: any[] = [];
                
                if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                    const data = new Uint8Array(e.target?.result as ArrayBuffer);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
                    
                    // Skip header and map rows
                    if (jsonData.length > 1) {
                        records = jsonData.slice(1).map(row => ({
                            employee_code: String(row[1] || ''),
                            check_in_time: normalizeDateTime(String(row[5] || ''), String(row[6] || '')),
                            check_out_time: normalizeDateTime(String(row[7] || ''), String(row[8] || '')),
                            status: String(row[9] || ''),
                            late_minutes: 0,
                        })).filter(r => r.employee_code && r.check_in_time);
                    }
                } else {
                    const text = e.target?.result as string;
                    const parsed = parseAttendanceCSV(text);
                    if (parsed.length === 0) throw new Error('ไม่พบข้อมูลหรือรูปแบบไม่ถูกต้อง');
                    records = parsed.map(r => ({
                        employee_code: r.employeeId,
                        check_in_time: normalizeDateTime(r.checkInDate, r.checkInTime),
                        check_out_time: normalizeDateTime(r.checkOutDate, r.checkOutTime),
                        status: r.status,
                        late_minutes: 0,
                    }));
                }

                if (records.length === 0) throw new Error('ไม่พบข้อมูลที่สามารถนำเข้าได้');

                const res = await axios.post(`${API}/attendance/import`, { records });
                
                if (res.data.errors && res.data.errors.length > 0) {
                    message.warning(`นำเข้าสำเร็จบางส่วน: พบ ${res.data.errors.length} รายการที่ไม่พบในระบบ`);
                } else {
                    message.success(`นำเข้าสำเร็จ: เพิ่มใหม่ ${res.data.inserted} รายการ, แทนที่ ${res.data.replaced} รายการ`);
                }
                
                setIsUploadModalVisible(false);
                fetchDbAttendance(); // Refresh table immediately
            } catch (err: any) {
                message.error(err?.response?.data?.error || err.message || 'นำเข้าไม่สำเร็จ');
            } finally {
                setUploading(false);
            }
        };

        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file, 'UTF-8');
        }
        return false; // Prevent auto-upload
    };

    const handleOpenCalendar = (record: DbSummary) => {
        setSelectedEmployeeName(record.name);
        setSelectedEmployeeLogs(dbLogs.filter(log => log.employee_code === record.employeeId));
        setIsCalendarModalVisible(true);
    };

    const dateCellRender = (current: Dayjs) => {
        // Only show indicators for the currently filtered month
        if (current.month() !== dbMonth?.month() || current.year() !== dbMonth?.year()) {
            return null;
        }

        const day = current.day();
        const isWeekend = day === 0 || day === 6;
        const isFuture = current.isAfter(dayjs(), 'day');

        // Check if employee has leave on this day
        const employeeId = selectedEmployeeLogs.length > 0 ? selectedEmployeeLogs[0].employee_code : null;
        let isLeaveDay = false;
        let leaveReason = '';

        if (employeeId) {
            // Find an approved/pending leave request that covers this date
            const matchingLeave = leaveRequests.find(lr => {
                // employee_id is actually the employee's ID in database, wait, in Leave table it returns `employeeId: number` or what?
                // Let's check what `lr.employee_code` or `lr.employee_id` is. In server.js, /api/leaves/requests joins employees and we get the employee's name. Let's see if employee_code is returned.
                // Wait, if not, we might need to filter by something else, or let's assume `lr` has employee_id or name. We know `selectedEmployeeName` is available
                // To be safe, let's filter by name for now if employee_code is not joined.
                if (lr.employee_name !== selectedEmployeeName) return false;
                
                const start = dayjs(lr.start_date);
                const end = dayjs(lr.end_date);
                return current.isBetween(start, end, 'day', '[]');
            });

            if (matchingLeave && (matchingLeave.status === 'approved' || matchingLeave.status === 'pending')) {
                isLeaveDay = true;
                leaveReason = `${matchingLeave.leave_type_name} (${matchingLeave.status === 'approved' ? 'อนุมัติแล้ว' : 'รออนุมัติ'})`;
            }
        }

        const log = selectedEmployeeLogs.find(l => dayjs(l.check_in_time).isSame(current, 'day'));
        const holiday = publicHolidays.find(h => dayjs(h.holiday_date).isSame(current, 'day'));

        if (isLeaveDay) {
            return (
                <Tooltip title={leaveReason}>
                    <div style={{ textAlign: 'center', marginTop: -4 }}><Badge status="processing" color="blue" /></div>
                </Tooltip>
            );
        }

        if (holiday) {
            return (
                <Tooltip title={`วันหยุด: ${holiday.name}`}>
                    <div style={{ textAlign: 'center', marginTop: -4 }}><Badge status="success" color="cyan" /></div>
                </Tooltip>
            );
        }

        if (log) {
            if (log.status === 'late') {
                return (
                    <Tooltip title={`มาสาย: ${log.check_in_time ? dayjs(log.check_in_time).format('HH:mm') : ''}`}>
                        <div style={{ textAlign: 'center', marginTop: -4 }}><Badge status="warning" /></div>
                    </Tooltip>
                );
            } else {
                return (
                    <Tooltip title={`ตรงเวลา: ${log.check_in_time ? dayjs(log.check_in_time).format('HH:mm') : ''}`}>
                        <div style={{ textAlign: 'center', marginTop: -4 }}><Badge status="success" /></div>
                    </Tooltip>
                );
            }
        } else {
            // Absent (no record on a weekday, not in the future)
            if (!isWeekend && !isFuture) {
                return (
                    <Tooltip title="ขาดงาน หรือ ไม่มีข้อมูลเข้างาน">
                        <div style={{ textAlign: 'center', marginTop: -4 }}><Badge status="error" /></div>
                    </Tooltip>
                );
            }
        }
        return null;
    };

    const calendarCellRender = (current: Dayjs, info: any) => {
        if (info.type === 'date') return dateCellRender(current);
        return info.originNode;
    };

    const filteredDbSummary = dbSummary.filter(r =>
        r.name.toLowerCase().includes(dbSearch.toLowerCase()) ||
        r.employeeId.toLowerCase().includes(dbSearch.toLowerCase()) ||
        r.department.toLowerCase().includes(dbSearch.toLowerCase())
    );

    const dbLateCount = dbSummary.reduce((s, r) => s + r.lateCount, 0);
    const dbWorkDays = dbSummary.reduce((s, r) => s + r.workDays, 0);
    const dbWeekends = dbSummary.reduce((s, r) => s + (r.weekends ?? 0), 0);
    const dbOnTimeDays = dbSummary.reduce((s, r) => s + (r.onTimeDays ?? 0), 0);

    const dbColumns: TableProps<DbSummary>['columns'] = [
        { title: 'รหัสพนักงาน', dataIndex: 'employeeId', key: 'employeeId', width: 110 },
        { title: 'ชื่อ-นามสกุล', dataIndex: 'name', key: 'name' },
        {
            title: 'แผนก', dataIndex: 'department', key: 'department',
            filters: Array.from(new Set(dbSummary.map(s => s.department))).map(d => ({ text: d, value: d })),
            onFilter: (value: any, record: DbSummary) => record.department === value,
        },
        {
            title: 'วันมาทำงาน', key: 'workDays',
            align: 'center' as const,
            render: (_: any, r: DbSummary) => (
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{r.workDays}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>จ-ศ: {r.weekdays} | ส-อ: {r.weekends}</div>
                </div>
            ),
            sorter: (a: DbSummary, b: DbSummary) => a.workDays - b.workDays,
        },
        {
            title: 'วันหยุด เสาร์-อาทิตย์', dataIndex: 'weekends', key: 'weekends',
            align: 'center' as const,
            sorter: (a: DbSummary, b: DbSummary) => a.weekends - b.weekends,
            render: (v: number) => v > 0
                ? <Tag color="purple">{v} วัน</Tag>
                : <Tag color="default">0</Tag>
        },
        {
            title: 'ตรงเวลา (วัน)', dataIndex: 'onTimeDays', key: 'onTimeDays',
            align: 'center' as const,
            sorter: (a: DbSummary, b: DbSummary) => a.onTimeDays - b.onTimeDays,
            render: (v: number) => <Tag color="success" icon={<CheckCircleOutlined />}>{v}</Tag>
        },
        {
            title: 'มาสาย (ครั้ง)', dataIndex: 'lateCount', key: 'lateCount',
            align: 'center' as const,
            sorter: (a: DbSummary, b: DbSummary) => a.lateCount - b.lateCount,
            render: (v: number) => <Tag color={v > 3 ? 'volcano' : v > 0 ? 'orange' : 'success'}>{v}</Tag>
        },
        {
            title: 'รวมนาทีสาย', dataIndex: 'totalLateMinutes', key: 'totalLateMinutes',
            align: 'center' as const,
            sorter: (a: DbSummary, b: DbSummary) => a.totalLateMinutes - b.totalLateMinutes,
            render: (v: number, record: DbSummary) => (
                <Button 
                    type="link" 
                    size="small" 
                    icon={<CalendarOutlined />} 
                    onClick={() => handleOpenCalendar(record)}
                >
                    {v > 0 ? <Text type="danger">{v} นาที</Text> : 'ดูปฏิทิน'}
                </Button>
            )
        },
    ];

    return (
        <div>
            {/* ── Header ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <Title level={2} style={{ margin: 0 }}>ประวัติและข้อมูลการเข้า-ออกงาน</Title>
                    <Text type="secondary">ตรวจสอบข้อมูลการลงเวลาทำงาน หรือนำเข้าข้อมูลใหม่จากเครื่องสแกน</Text>
                </div>
                <Space>
                    <Upload 
                        accept=".csv, .xlsx, .xls"
                        showUploadList={false}
                        beforeUpload={handleFileUpload}
                    >
                        <Button 
                            type="primary" 
                            icon={<FileExcelOutlined />} 
                            loading={uploading}
                            size="large"
                        >
                            Import File (Excel/CSV)
                        </Button>
                    </Upload>
                </Space>
            </div>

            <Card bordered={false} style={{ borderRadius: 8 }}>
                {/* Filter */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                    <Space>
                        <Text strong>เดือน:</Text>
                        <DatePicker picker="month" value={dbMonth} onChange={setDbMonth} allowClear={false} />
                        <Button icon={<SyncOutlined />} onClick={fetchDbAttendance} loading={dbLoading}>รีโหลด</Button>
                    </Space>
                    <Input
                        placeholder="ค้นหาพนักงาน" prefix={<SearchOutlined />}
                        style={{ width: 250 }} value={dbSearch}
                        onChange={e => setDbSearch(e.target.value)} allowClear
                    />
                </div>

                {/* System Stats */}
                <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                    <Col xs={24} sm={12} lg={6}>
                        <Card size="small" style={{ borderRadius: 6 }}>
                            <Statistic title="พนักงานที่มีข้อมูล" value={dbSummary.length} prefix={<UserOutlined />} valueStyle={{ color: '#3f8600' }} />
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Card size="small" style={{ borderRadius: 6 }}>
                            <Statistic title="รวมวันมาทำงานทั้งหมด" value={dbWorkDays} prefix={<DatabaseOutlined />} valueStyle={{ color: '#1890ff' }}
                                suffix={<span style={{ fontSize: 12, color: '#888' }}> (เสาร์-อาทิตย์: {dbWeekends})</span>} />
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Card size="small" style={{ borderRadius: 6 }}>
                            <Statistic title="มาตรงเวลา ไม่สาย" value={dbOnTimeDays} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} />
                        </Card>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <Card size="small" style={{ borderRadius: 6 }}>
                            <Statistic title="มาสายรวม (ครั้ง)" value={dbLateCount} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#cf1322' }} />
                        </Card>
                    </Col>
                </Row>

                {/* Table or Empty State */}
                {dbSummary.length === 0 && !dbLoading ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: '#999',  background: '#fafafa', borderRadius: 8 }}>
                        <DatabaseOutlined style={{ fontSize: 48, marginBottom: 16, color: '#d9d9d9' }} />
                        <div style={{ fontSize: 16, fontWeight: 500, color: '#666', marginBottom: 8 }}>ยังไม่มีข้อมูลการเข้างานสำหรับเดือนนี้</div>
                        <Text type="secondary">โปรดกดปุ่ม <b>นำเข้าไฟล์ CSV</b> มุมขวาบนเพื่ออัปโหลดข้อมูลจากเครื่องสแกน</Text>
                    </div>
                ) : (
                    <Table
                        dataSource={filteredDbSummary} columns={dbColumns}
                        rowKey="employeeId" loading={dbLoading}
                        pagination={{ pageSize: 15 }} bordered size="middle"
                        scroll={{ x: 1000 }}
                    />
                )}
            </Card>

            {/* ── UPLOAD MODAL ── */}
            <Modal
                title="นำเข้าข้อมูลการเข้า-ออกงาน (CSV)"
                open={isUploadModalVisible}
                onCancel={() => !uploading && setIsUploadModalVisible(false)}
                footer={null}
            >
                <div style={{ marginBottom: 16 }}>
                    <Text type="secondary">อัปโหลดไฟล์ CSV แล้วข้อมูลจะถูกบันทึกลงระบบทันที — หากเป็นข้อมูลเดิมระบบจะเขียนทับอัตโนมัติ (Upsert)</Text>
                </div>
                <Dragger 
                    accept=".csv" 
                    showUploadList={false} 
                    beforeUpload={handleFileUpload} 
                    style={{ padding: '24px 0' }}
                    disabled={uploading}
                >
                    <p className="ant-upload-drag-icon">
                        {uploading ? <SyncOutlined spin style={{ color: '#1890ff' }} /> : <InboxOutlined />}
                    </p>
                    <p className="ant-upload-text">
                        {uploading ? 'กำลังประมวลผลและบันทึก...' : 'คลิกหรือลากไฟล์ Time Attendance มาที่นี่'}
                    </p>
                    <div className="ant-upload-hint" style={{ marginTop: 12 }}>
                        <Tag color="blue">รหัสพนักงาน</Tag>
                        <Tag color="cyan">วันที่เข้ารหัส</Tag>
                        <Tag color="cyan">เวลาเข้ารหัส</Tag>
                        <Tag color="cyan">เวลาออก</Tag>
                    </div>
                </Dragger>
            </Modal>

            {/* ── CALENDAR MODAL ── */}
            <Modal
                title={`ปฏิทินเข้างาน: ${selectedEmployeeName}`}
                open={isCalendarModalVisible}
                onCancel={() => setIsCalendarModalVisible(false)}
                footer={null}
                width={800}
                style={{ top: 20 }}
            >
                <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
                    <div><Badge status="success" text="มาตรงเวลา" /></div>
                    <div><Badge status="warning" text="มาสาย" /></div>
                    <div><Badge status="error" text="ขาดงาน (ไม่มีข้อมูล)" /></div>
                    <div><Badge status="processing" color="blue" text="ลางาน" /></div>
                </div>
                <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
                    <Calendar 
                        value={dbMonth || dayjs()} 
                        cellRender={calendarCellRender}
                        headerRender={() => null} // Hide the default header to force viewing current selected month only
                    />
                </div>
            </Modal>
        </div>
    );
};
