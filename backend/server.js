import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import dayjs from 'dayjs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hr-payroll-db',
    port: parseInt(process.env.DB_PORT) || 3306,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
});

// ─────────────────────────────────────────────
// 💡 HELPER: คำนวณประกันสังคม
// ─────────────────────────────────────────────
function calculateSSO(baseSalary) {
    // ประกันสังคม 5% ของเงินเดือน แต่ไม่เกิน 750 บาท/เดือน
    return Math.min(Math.floor(baseSalary * 0.05), 750);
}

// ─────────────────────────────────────────────
// TEST ROUTE
// ─────────────────────────────────────────────
app.get('/api/test', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1 + 1 AS solution');
        res.json({ message: 'Database connected successfully', data: rows });
    } catch (error) {
        console.error('Database connection failed:', error);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const today = dayjs().format('YYYY-MM-DD');
        const currentYearMonth = dayjs().format('YYYY-MM');

        // Total Counts
        const [[totalEmpRow]] = await pool.query("SELECT COUNT(*) as count FROM employees WHERE status = 'active'");
        const [[newEmpRow]] = await pool.query(
            "SELECT COUNT(*) as count FROM employees WHERE DATE_FORMAT(join_date, '%Y-%m') = ?", [currentYearMonth]
        );
        const [[pendingLeavesRow]] = await pool.query("SELECT COUNT(*) as count FROM leave_requests WHERE status = 'pending'");
        const [[resignedEmpRow]] = await pool.query(
            "SELECT COUNT(*) as count FROM employees WHERE status = 'inactive' AND DATE_FORMAT(updated_at, '%Y-%m') = ?", [currentYearMonth]
        );

        const totalActive = parseInt(totalEmpRow.count) || 0;

        // Today's Attendance
        const [[presentTodayRow]] = await pool.query(`
            SELECT COUNT(DISTINCT employee_id) as count 
            FROM attendance_logs 
            WHERE DATE(check_in_time) = ?
        `, [today]);
        
        const [[leaveTodayRow]] = await pool.query(`
            SELECT COUNT(DISTINCT employee_id) as count 
            FROM leave_requests 
            WHERE ? BETWEEN start_date AND end_date AND status = 'approved'
        `, [today]);

        const presentToday = parseInt(presentTodayRow.count) || 0;
        const leaveToday = parseInt(leaveTodayRow.count) || 0;
        const absentToday = Math.max(0, totalActive - presentToday - leaveToday);

        // 7-Day Trend (Approximate using past 7 days logs and leaves)
        const attendanceTrendData = [];
        for (let i = 6; i >= 0; i--) {
            const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
            const dayName = dayjs().subtract(i, 'day').locale('th').format('ddd'); // requires locale if needed, we'll use format('ddd')

            const [[pRow]] = await pool.query("SELECT COUNT(DISTINCT employee_id) as count FROM attendance_logs WHERE DATE(check_in_time) = ?", [d]);
            const [[lRow]] = await pool.query("SELECT COUNT(DISTINCT employee_id) as count FROM leave_requests WHERE ? BETWEEN start_date AND end_date AND status = 'approved'", [d]);
            
            const pCount = parseInt(pRow.count) || 0;
            const lCount = parseInt(lRow.count) || 0;
            const aCount = Math.max(0, totalActive - pCount - lCount);

            attendanceTrendData.push({
                name: dayName,
                present: pCount,
                leave: lCount,
                absent: aCount
            });
        }

        // Department Distribution
        const [departmentData] = await pool.query(`
            SELECT d.name, COUNT(e.id) as employees 
            FROM departments d 
            LEFT JOIN employees e ON d.id = e.department_id AND e.status = 'active'
            GROUP BY d.name
        `);

        // Recent Activities (Mix of recent hires, resignations, and approved leaves)
        const [recentHires] = await pool.query(`
            SELECT CONCAT('พนักงานเข้าใหม่: ', first_name, ' ', last_name, ' (', IFNULL(d.name, 'ไม่ระบุ'), ')') as title, 
                   join_date as event_time, 
                   'hire' as type 
            FROM employees e LEFT JOIN departments d ON e.department_id = d.id 
            ORDER BY join_date DESC LIMIT 3
        `);
        const [recentResigns] = await pool.query(`
            SELECT CONCAT('พนักงานลาออก: ', first_name, ' ', last_name) as title, 
                   updated_at as event_time, 
                   'resign' as type 
            FROM employees WHERE status = 'inactive' 
            ORDER BY updated_at DESC LIMIT 3
        `);
        const [recentLeaves] = await pool.query(`
            SELECT CONCAT(IF(lr.status='approved', 'อนุมัติการลา: ', 'ปฏิเสธการลา: '), IFNULL(lt.name, ''), ' (', e.first_name, ' ', e.last_name, ')') as title, 
                   lr.approved_at as event_time, 
                   'leave' as type 
            FROM leave_requests lr 
            JOIN employees e ON lr.employee_id = e.id 
            LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
            WHERE lr.status IN ('approved', 'rejected') AND lr.approved_at IS NOT NULL
            ORDER BY lr.approved_at DESC LIMIT 4
        `);

        // Merge, sort, and format time ago
        let recentActivities = [...recentHires, ...recentResigns, ...recentLeaves]
            .sort((a, b) => dayjs(b.event_time).valueOf() - dayjs(a.event_time).valueOf())
            .slice(0, 6)
            .map(act => {
                const diffHours = dayjs().diff(dayjs(act.event_time), 'hour');
                const diffDays = dayjs().diff(dayjs(act.event_time), 'day');
                let timeStr = 'เพิ่งเกิดขึ้น';
                if (diffDays > 0) timeStr = `${diffDays} วันที่แล้ว`;
                else if (diffHours > 0) timeStr = `${diffHours} ชั่วโมงที่แล้ว`;
                
                return {
                    title: act.title,
                    time: timeStr,
                    type: act.type
                };
            });

        res.json({
            stats: {
                totalEmployees: totalActive,
                newEmployees: parseInt(newEmpRow.count),
                pendingLeaves: parseInt(pendingLeavesRow.count),
                resignedEmployees: parseInt(resignedEmpRow.count),
            },
            todayAttendance: {
                present: presentToday,
                leave: leaveToday,
                absent: absentToday
            },
            recentActivities,
            charts: {
                attendanceTrendData,
                departmentData: departmentData.map(d => ({ name: d.name, employees: parseInt(d.employees) }))
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
app.get('/api/departments', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM departments ORDER BY id ASC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM system_settings LIMIT 1');
        res.json(rows[0] || {});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/settings', async (req, res) => {
    try {
        const payload = req.body;
        await pool.query(
            `UPDATE system_settings SET company_name=?, tax_id=?, address=?, deduct_excess_sick_leave=?, deduct_excess_personal_leave=?, late_penalty_per_minute=?, auto_deduct_tax=?, auto_deduct_sso=?, payroll_cutoff_date=?, diligence_allowance=? WHERE id=1`,
            [payload.company_name, payload.tax_id, payload.address, payload.deduct_excess_sick_leave, payload.deduct_excess_personal_leave, payload.late_penalty_per_minute, payload.auto_deduct_tax, payload.auto_deduct_sso, payload.payroll_cutoff_date, payload.diligence_allowance]
        );
        res.json({ message: 'Settings updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// EMPLOYEES
// ─────────────────────────────────────────────
app.get('/api/employees', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT e.*, d.name as department_name, s.name as shift_name 
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN shifts s ON e.shift_id = s.id
            ORDER BY e.id DESC
        `);
        const formatted = rows.map(r => ({
            id: r.id.toString(),
            employee_code: r.employee_code,
            name: `${r.first_name} ${r.last_name}`,
            department: r.department_name || 'ไม่ระบุ',
            position: r.position || '-',
            joinDate: r.join_date,
            status: r.status,
            phone: r.phone || '-',
            email: r.email || `${r.employee_code}@company.com`,
            baseSalary: r.base_salary
        }));
        res.json(formatted);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/employees', async (req, res) => {
    try {
        const { employee_code, first_name, last_name, department_id, position, join_date, status, base_salary, phone, email } = req.body;
        const code = employee_code || `EMP${Math.floor(100 + Math.random() * 900)}`;
        const [result] = await pool.query(
            `INSERT INTO employees (employee_code, first_name, last_name, department_id, position, join_date, status, base_salary, phone, email)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [code, first_name, last_name, department_id, position, join_date, status || 'active', base_salary || 0, phone || null, email || null]
        );
        res.status(201).json({ id: result.insertId, message: 'Employee created' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/employees/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { first_name, last_name, department_id, position, join_date, status, base_salary, phone, email } = req.body;
        const [result] = await pool.query(
            `UPDATE employees SET first_name=?, last_name=?, department_id=?, position=?, join_date=?, status=?, base_salary=?, phone=?, email=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            [first_name, last_name, department_id, position, join_date, status, base_salary, phone || null, email || null, id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ message: 'Employee updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/employees/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM employees WHERE id = ?', [req.params.id]);
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// IMPORT EMPLOYEE CSV
// ─────────────────────────────────────────────
app.post('/api/employees/import', async (req, res) => {
    try {
        const { employees } = req.body;
        if (!employees || !Array.isArray(employees)) {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        let created = 0, updated = 0, errors = [];
        for (const emp of employees) {
            try {
                let deptId = null;
                if (emp.department) {
                    const [deptRows] = await pool.query('SELECT id FROM departments WHERE name = ?', [emp.department]);
                    if (deptRows.length > 0) {
                        deptId = deptRows[0].id;
                    } else {
                        const [newDept] = await pool.query('INSERT INTO departments (name) VALUES (?)', [emp.department]);
                        deptId = newDept.insertId;
                    }
                }
                if (emp.id) {
                    const [exist] = await pool.query('SELECT id FROM employees WHERE id = ?', [emp.id]);
                    if (exist.length > 0) {
                        await pool.query(
                            `UPDATE employees SET first_name=?, last_name=?, department_id=?, position=?, join_date=?, status=?, base_salary=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                            [emp.first_name, emp.last_name, deptId, emp.position, emp.join_date, emp.status || 'active', emp.base_salary || 0, emp.id]
                        );
                        updated++;
                        continue;
                    }
                }
const code = emp.employee_code || `EMP${Math.floor(100 + Math.random() * 900)}`;
                await pool.query(
                    `INSERT INTO employees (employee_code, first_name, last_name, department_id, position, join_date, status, base_salary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [code, emp.first_name, emp.last_name, deptId, emp.position, emp.join_date, emp.status || 'active', emp.base_salary || 0]
                );
                created++;
            } catch (e) {
                errors.push({ employee: emp.employee_code, error: e.message });
            }
        }
        res.json({ message: `Import complete`, created, updated, errors });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// EMPLOYEE LEAVE QUOTAS
// ─────────────────────────────────────────────
app.get('/api/employees/:id/leave-quotas', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT lt.id as leave_type_id, lt.name as leave_name, 
                   IFNULL(eq.quota_days, 0) as quota_days
            FROM leave_types lt
            LEFT JOIN employee_leave_quotas eq 
              ON lt.id = eq.leave_type_id AND eq.employee_id = ?
            WHERE lt.is_unpaid = 0
            ORDER BY lt.id ASC
        `, [req.params.id]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/employees/:id/leave-quotas', async (req, res) => {
    try {
        const employeeId = req.params.id;
        const { quotas } = req.body; // Array of { leave_type_id, quota_days }
        
        // Loop and UPSERT
        for (const q of quotas) {
            const currentQuota = parseFloat(q.quota_days) || 0;
            const [existing] = await pool.query('SELECT id FROM employee_leave_quotas WHERE employee_id=? AND leave_type_id=?', [employeeId, q.leave_type_id]);
            if (existing.length > 0) {
                await pool.query('UPDATE employee_leave_quotas SET quota_days=? WHERE employee_id=? AND leave_type_id=?', [currentQuota, employeeId, q.leave_type_id]);
            } else {
                await pool.query('INSERT INTO employee_leave_quotas (employee_id, leave_type_id, quota_days) VALUES (?, ?, ?)', [employeeId, q.leave_type_id, currentQuota]);
            }
        }
        res.json({ message: 'บันทึกโควตาวันลาสำเร็จ' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// LEAVES (วันลาต่างๆ)
// ─────────────────────────────────────────────
app.get('/api/leaves/requests', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT lr.*, l.name as leave_type_name, 
                   CONCAT(e.first_name, ' ', e.last_name) as employee_name,
                   d.name as department
            FROM leave_requests lr
            JOIN employees e ON lr.employee_id = e.id
            JOIN leave_types l ON lr.leave_type_id = l.id
            LEFT JOIN departments d ON e.department_id = d.id
            ORDER BY lr.submitted_at DESC
        `);
        const formatted = rows.map(r => ({ ...r, id: r.id.toString(), total_days: parseFloat(r.total_days) }));
        res.json(formatted);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/leaves/requests', async (req, res) => {
    try {
        const { employee_id, leave_type_id, start_date, end_date, total_days, reason } = req.body;
        const [result] = await pool.query(
            'INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason) VALUES (?, ?, ?, ?, ?, ?)',
            [employee_id || 1, leave_type_id || 1, start_date, end_date, total_days, reason]
        );
        res.status(201).json({ id: result.insertId.toString(), message: 'Leave request created' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/leaves/requests/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const [result] = await pool.query(
            'UPDATE leave_requests SET status = ?, approved_at=CURRENT_TIMESTAMP WHERE id = ?',
            [status, id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Leave request not found' });
        res.json({ message: `Leave request ${status}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// LEAVES IMPORT (BULK UPSERT)
// ─────────────────────────────────────────────
app.post('/api/leaves/import', async (req, res) => {
    try {
        const { records } = req.body;
        if (!records || records.length === 0) {
            return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะนำเข้า' });
        }

        let inserted = 0;
        let replaced = 0;
        const errors = [];

        for (const rec of records) {
            try {
                // หา employee_id จาก employee_code
                const [empRows] = await pool.query(
                    'SELECT id FROM employees WHERE employee_code = ?',
                    [rec.employeeId]
                );

                if (empRows.length === 0) {
                    errors.push({ code: rec.employeeId, error: 'ไม่พบรหัสพนักงานในระบบ' });
                    continue;
                }

                const employeeId = empRows[0].id;

                // หา leave_type_id จากชื่อ
                const [typeRows] = await pool.query(
                    'SELECT id FROM leave_types WHERE name = ?',
                    [rec.leaveType]
                );

                let leaveTypeId;
                if (typeRows.length === 0) {
                    const [resType] = await pool.query('INSERT INTO leave_types (name) VALUES (?)', [rec.leaveType]);
                    leaveTypeId = resType.insertId;
                } else {
                    leaveTypeId = typeRows[0].id;
                }

                // UPSERT: เช็คว่าพนักงานคนนี้เคยลาช่วงนี้ไปแล้วหรือยัง
                const [existing] = await pool.query(
                    `SELECT id FROM leave_requests 
                     WHERE employee_id = ? AND start_date = ? AND end_date = ?`,
                    [employeeId, rec.startDate, rec.endDate]
                );

                if (existing.length > 0) {
                    await pool.query(
                        `DELETE FROM leave_requests WHERE employee_id = ? AND start_date = ? AND end_date = ?`,
                        [employeeId, rec.startDate, rec.endDate]
                    );
                    replaced++;
                } else {
                    inserted++;
                }

                await pool.query(
                    `INSERT INTO leave_requests 
                        (employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        employeeId,
                        leaveTypeId,
                        rec.startDate,
                        rec.endDate,
                        rec.days || 1,
                        rec.reason || 'Imported via CSV',
                        rec.status === 'รอหัวหน้าอนุมัติ' || rec.status === 'pending' ? 'pending' : 'approved'
                    ]
                );

            } catch (e) {
                errors.push({ code: rec.employeeId, error: e.message });
            }
        }

        res.json({
            message: `นำเข้าสำเร็จ: เพิ่มใหม่ ${inserted} รายการ, แทนที่ ${replaced} รายการ`,
            inserted,
            replaced,
            total: inserted + replaced,
            errors,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// SHIFTS
// ─────────────────────────────────────────────
app.get('/api/shifts', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM shifts ORDER BY id ASC');
        const formatted = rows.map(r => ({
            id: r.id.toString(), shiftName: r.name, startTime: r.start_time,
            endTime: r.end_time, lateThreshold: r.late_allowance_minutes, color: r.color || 'blue'
        }));
        res.json(formatted);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/shifts', async (req, res) => {
    try {
        const { shiftName, startTime, endTime, lateThreshold, color } = req.body;
        const [result] = await pool.query(
            'INSERT INTO shifts (name, start_time, end_time, late_allowance_minutes, color) VALUES (?, ?, ?, ?, ?)',
            [shiftName, startTime, endTime, lateThreshold, color]
        );
        res.status(201).json({ id: result.insertId.toString() });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/shifts/:id', async (req, res) => {
    try {
        const { shiftName, startTime, endTime, lateThreshold, color } = req.body;
        await pool.query(
            'UPDATE shifts SET name=?, start_time=?, end_time=?, late_allowance_minutes=?, color=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
            [shiftName, startTime, endTime, lateThreshold, color, req.params.id]
        );
        res.json({ message: 'Updated' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/shifts/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM shifts WHERE id=?', [req.params.id]);
        res.json({ message: 'Deleted' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// LEAVE QUOTA RULES
// ─────────────────────────────────────────────
app.get('/api/leave-rules', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM leave_quota_rules ORDER BY tenure_years ASC');
        res.json(rows.map(r => ({ id: r.id.toString(), minYears: r.tenure_years, maxYears: r.tenure_years, vacationDays: r.vacation_days })));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/leave-rules', async (req, res) => {
    try {
        const [result] = await pool.query('INSERT INTO leave_quota_rules (tenure_years, vacation_days) VALUES (?, ?)', [req.body.minYears, req.body.vacationDays]);
        res.status(201).json({ id: result.insertId.toString() });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/leave-rules/:id', async (req, res) => {
    try {
        await pool.query('UPDATE leave_quota_rules SET tenure_years=?, vacation_days=? WHERE id=?', [req.body.minYears, req.body.vacationDays, req.params.id]);
        res.json({ message: 'Updated' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/leave-rules/:id', async (req, res) => {
    try { await pool.query('DELETE FROM leave_quota_rules WHERE id=?', [req.params.id]); res.json({ message: 'Deleted' }); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// LEAVE TYPES
// ─────────────────────────────────────────────
app.get('/api/leave-types', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM leave_types ORDER BY id ASC');
        res.json(rows.map(r => ({ id: r.id.toString(), leaveName: r.name, isDeductSalary: r.is_unpaid })));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/leave-types', async (req, res) => {
    try {
        const [result] = await pool.query('INSERT INTO leave_types (name, is_unpaid) VALUES (?, ?)', [req.body.leaveName, req.body.isDeductSalary]);
        res.status(201).json({ id: result.insertId.toString() });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/leave-types/:id', async (req, res) => {
    try {
        await pool.query('UPDATE leave_types SET name=?, is_unpaid=? WHERE id=?', [req.body.leaveName, req.body.isDeductSalary, req.params.id]);
        res.json({ message: 'Updated' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/leave-types/:id', async (req, res) => {
    try { await pool.query('DELETE FROM leave_types WHERE id=?', [req.params.id]); res.json({ message: 'Deleted' }); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// SYSTEM SETTINGS
// ─────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM system_settings LIMIT 1');
        res.json(rows[0] || {});
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/settings', async (req, res) => {
    try {
        const { company_name, tax_id, address, deduct_excess_sick_leave, deduct_excess_personal_leave,
            late_penalty_per_minute, auto_deduct_tax, auto_deduct_sso, payroll_cutoff_date, diligence_allowance } = req.body;
        await pool.query(`
            UPDATE system_settings SET 
                company_name=COALESCE(?, company_name), tax_id=COALESCE(?, tax_id), address=COALESCE(?, address),
                deduct_excess_sick_leave=COALESCE(?, deduct_excess_sick_leave),
                deduct_excess_personal_leave=COALESCE(?, deduct_excess_personal_leave),
                late_penalty_per_minute=COALESCE(?, late_penalty_per_minute),
                auto_deduct_tax=COALESCE(?, auto_deduct_tax), auto_deduct_sso=COALESCE(?, auto_deduct_sso),
                payroll_cutoff_date=COALESCE(?, payroll_cutoff_date),
                diligence_allowance=COALESCE(?, diligence_allowance),
                updated_at=CURRENT_TIMESTAMP
        `, [company_name, tax_id, address, deduct_excess_sick_leave, deduct_excess_personal_leave,
            late_penalty_per_minute, auto_deduct_tax, auto_deduct_sso, payroll_cutoff_date, diligence_allowance]);
        res.json({ message: 'Settings updated' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// 🧠 PAYROLL — GET (ดึงจาก payroll_records ถ้ามี, ไม่มีดึง preview)
// ─────────────────────────────────────────────
app.get('/api/payroll', async (req, res) => {
    try {
        const month = parseInt(req.query.month) || dayjs().month() + 1;
        const year = parseInt(req.query.year) || dayjs().year();

        // ลองดึงจาก payroll_records ก่อน
        const [saved] = await pool.query(`
            SELECT pr.*, CONCAT(e.first_name, ' ', e.last_name) as name, e.employee_code,
                   d.name as department, e.base_salary as emp_base_salary
            FROM payroll_records pr
            JOIN employees e ON pr.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE pr.period_month = ? AND pr.period_year = ?
            ORDER BY e.id ASC
        `, [month, year]);

        if (saved.length > 0) {
            const result = saved.map(r => ({
                employeeId: r.employee_code,
                employee_id: r.employee_id,
                name: r.name,
                department: r.department || 'ไม่ระบุ',
                baseSalary: parseFloat(r.base_salary),
                earnings: {
                    overtime: parseFloat(r.overtime_pay),
                    bonus: parseFloat(r.bonus),
                    diligenceAllowance: parseFloat(r.diligence_allowance || 0),
                },
                deductions: {
                    tax: parseFloat(r.tax_deduction),
                    socialSecurity: parseFloat(r.sso_deduction),
                    latePenalty: parseFloat(r.late_deduction),
                    unpaidLeave: parseFloat(r.leave_deduction),
                },
                netSalary: parseFloat(r.net_salary),
                status: r.status,
                period: { month, year },
            }));
            return res.json(result);
        }

        // ถ้ายังไม่มี → ส่ง preview (ยังไม่บันทึก)
        const [settingsRows] = await pool.query('SELECT * FROM system_settings LIMIT 1');
        const settings = settingsRows[0] || {};
        const diligenceAllowance = parseFloat(settings.diligence_allowance || 0);
        const latePenaltyPerMin = parseFloat(settings.late_penalty_per_minute || 0);
        const autoDeductTax = settings.auto_deduct_tax !== 0;
        const autoDeductSSO = settings.auto_deduct_sso !== 0;

        const [employees] = await pool.query(`
            SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', e.last_name) as name,
                   d.name as department, e.base_salary, e.shift_id
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE e.status = 'active'
        `);

        // ดึง attendance รายเดือน
        const [attendanceLogs] = await pool.query(`
            SELECT employee_id, SUM(late_minutes) as total_late_minutes,
                   COUNT(*) as work_days
            FROM attendance_logs
            WHERE DATE_FORMAT(check_in_time, '%m') = ? AND DATE_FORMAT(check_in_time, '%Y') = ?
            GROUP BY employee_id
        `, [String(month).padStart(2, '0'), String(year)]);
        const attendanceMap = {};
        attendanceLogs.forEach(a => { attendanceMap[a.employee_id] = a; });

        // ดึง unpaid leave รายเดือน
        const [unpaidLeaves] = await pool.query(`
            SELECT lr.employee_id, SUM(lr.total_days) as unpaid_days
            FROM leave_requests lr
            JOIN leave_types lt ON lr.leave_type_id = lt.id
            WHERE lt.is_unpaid = 1 AND lr.status = 'approved'
              AND DATE_FORMAT(lr.start_date, '%m') = ? AND DATE_FORMAT(lr.start_date, '%Y') = ?
            GROUP BY lr.employee_id
        `, [String(month).padStart(2, '0'), String(year)]);
        const leaveMap = {};
        unpaidLeaves.forEach(l => { leaveMap[l.employee_id] = l; });

        const preview = employees.map(e => {
            const baseSalary = parseFloat(e.base_salary || 0);
            const att = attendanceMap[e.id];

            // คำนวณค่าปรับสาย
            const totalLateMinutes = att ? parseInt(att.total_late_minutes || 0) : 0;
            const latePenalty = Math.floor(totalLateMinutes * latePenaltyPerMin);

            // คำนวณหักลาไม่รับเงิน
            const lv = leaveMap[e.id];
            const unpaidDays = lv ? parseFloat(lv.unpaid_days || 0) : 0;
            const unpaidLeaveDeduction = Math.floor((baseSalary / 30) * unpaidDays);

            // เบี้ยขยัน: ได้ถ้าไม่สาย และไม่มีลาไม่รับเงิน
            const earnedDiligence = (latePenalty === 0 && unpaidDays === 0) ? diligenceAllowance : 0;

            // ภาษี/SSO
            const taxDeduction = autoDeductTax ? calculateIncomeTax(baseSalary * 12) : 0;
            const ssoDeduction = autoDeductSSO ? calculateSSO(baseSalary) : 0;

            return {
                employeeId: e.employee_code,
                employee_id: e.id,
                name: e.name,
                department: e.department || 'ไม่ระบุ',
                baseSalary,
                earnings: { overtime: 0, bonus: 0, diligenceAllowance: earnedDiligence },
                deductions: { tax: taxDeduction, socialSecurity: ssoDeduction, latePenalty: latePenalty, unpaidLeave: unpaidLeaveDeduction },
                netSalary: baseSalary + earnedDiligence - taxDeduction - ssoDeduction - latePenalty - unpaidLeaveDeduction,
                status: 'draft',
                period: { month, year },
                isPreview: true,
            };
        });

        res.json(preview);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// 🧠 PAYROLL — CALCULATE & SAVE to payroll_records
// ─────────────────────────────────────────────
app.post('/api/payroll/calculate', async (req, res) => {
    try {
        const month = parseInt(req.body.month) || dayjs().month() + 1;
        const year = parseInt(req.body.year) || dayjs().year();

        const [settingsRows] = await pool.query('SELECT * FROM system_settings LIMIT 1');
        const settings = settingsRows[0] || {};
        const diligenceAllowance = parseFloat(settings.diligence_allowance || 0);
        const latePenaltyPerMin = parseFloat(settings.late_penalty_per_minute || 0);
        const autoDeductTax = settings.auto_deduct_tax !== 0;
        const autoDeductSSO = settings.auto_deduct_sso !== 0;

        const [employees] = await pool.query(`
            SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', e.last_name) as name,
                   d.name as department, e.base_salary
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE e.status = 'active'
        `);

        const [attendanceLogs] = await pool.query(`
            SELECT employee_id, SUM(late_minutes) as total_late_minutes
            FROM attendance_logs
            WHERE DATE_FORMAT(check_in_time, '%m') = ? AND DATE_FORMAT(check_in_time, '%Y') = ?
            GROUP BY employee_id
        `, [String(month).padStart(2, '0'), String(year)]);
        const attendanceMap = {};
        attendanceLogs.forEach(a => { attendanceMap[a.employee_id] = a; });

        const [unpaidLeaves] = await pool.query(`
            SELECT lr.employee_id, SUM(lr.total_days) as unpaid_days
            FROM leave_requests lr
            JOIN leave_types lt ON lr.leave_type_id = lt.id
            WHERE lt.is_unpaid = 1 AND lr.status = 'approved'
              AND DATE_FORMAT(lr.start_date, '%m') = ? AND DATE_FORMAT(lr.start_date, '%Y') = ?
            GROUP BY lr.employee_id
        `, [String(month).padStart(2, '0'), String(year)]);
        const leaveMap = {};
        unpaidLeaves.forEach(l => { leaveMap[l.employee_id] = l; });

        let savedCount = 0;
        for (const e of employees) {
            const baseSalary = parseFloat(e.base_salary || 0);
            const att = attendanceMap[e.id];
            const totalLateMinutes = att ? parseInt(att.total_late_minutes || 0) : 0;
            const latePenalty = Math.floor(totalLateMinutes * latePenaltyPerMin);

            const lv = leaveMap[e.id];
            const unpaidDays = lv ? parseFloat(lv.unpaid_days || 0) : 0;
            const unpaidLeaveDeduction = Math.floor((baseSalary / 30) * unpaidDays);

            const earnedDiligence = (latePenalty === 0 && unpaidDays === 0) ? diligenceAllowance : 0;
            const taxDeduction = autoDeductTax ? calculateIncomeTax(baseSalary * 12) : 0;
            const ssoDeduction = autoDeductSSO ? calculateSSO(baseSalary) : 0;

            const netSalary = baseSalary + earnedDiligence - taxDeduction - ssoDeduction - latePenalty - unpaidLeaveDeduction;

            // Upsert: ลบเก่าแล้วใส่ใหม่
            await pool.query(
                'DELETE FROM payroll_records WHERE employee_id=? AND period_month=? AND period_year=?',
                [e.id, month, year]
            );
            await pool.query(`
                INSERT INTO payroll_records 
                    (employee_id, period_month, period_year, base_salary, overtime_pay, bonus,
                     late_deduction, leave_deduction, tax_deduction, sso_deduction, diligence_allowance, net_salary, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
            `, [e.id, month, year, baseSalary, 0, 0, latePenalty, unpaidLeaveDeduction, taxDeduction, ssoDeduction, earnedDiligence, netSalary]);
            savedCount++;
        }

        res.json({ message: `คำนวณเงินเดือนเสร็จแล้ว บันทึก ${savedCount} รายการ`, month, year, count: savedCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// PAYROLL — APPROVE (เปลี่ยน status เป็น paid)
// ─────────────────────────────────────────────
app.put('/api/payroll/approve', async (req, res) => {
    try {
        const { employee_codes, month, year } = req.body;
        const m = parseInt(month) || dayjs().month() + 1;
        const y = parseInt(year) || dayjs().year();

        if (!employee_codes || employee_codes.length === 0) {
            return res.status(400).json({ error: 'No employees selected' });
        }

        const [empRows] = await pool.query(
            `SELECT id FROM employees WHERE employee_code IN (${employee_codes.map(() => '?').join(',')})`,
            employee_codes
        );
        const empIds = empRows.map(r => r.id);

        if (empIds.length === 0) return res.status(404).json({ error: 'No employees found' });

        await pool.query(
            `UPDATE payroll_records SET status='paid' WHERE employee_id IN (${empIds.map(() => '?').join(',')}) AND period_month=? AND period_year=?`,
            [...empIds, m, y]
        );
        res.json({ message: `อนุมัติจ่ายเงินเดือนสำเร็จ ${empIds.length} คน` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// PAYROLL — ADJUST (แก้ไขรายละเอียดเงินเดือน)
// ─────────────────────────────────────────────
app.put('/api/payroll/adjust', async (req, res) => {
    try {
        const {
            employee_code, month, year,
            overtime_pay, bonus, diligence_allowance,
            late_deduction, leave_deduction, tax_deduction, sso_deduction,
            note
        } = req.body;

        const m = parseInt(month);
        const y = parseInt(year);

        // หา employee_id
        const [empRows] = await pool.query(
            'SELECT id FROM employees WHERE employee_code = ?', [employee_code]
        );
        if (empRows.length === 0) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
        const employeeId = empRows[0].id;

        // หา base_salary ปัจจุบัน
        const [recRows] = await pool.query(
            'SELECT base_salary FROM payroll_records WHERE employee_id=? AND period_month=? AND period_year=?',
            [employeeId, m, y]
        );
        if (recRows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูลเงินเดือนรอบนี้ กรุณาคำนวณก่อน' });

        const baseSalary = parseFloat(recRows[0].base_salary);
        const ot = parseFloat(overtime_pay ?? 0);
        const bns = parseFloat(bonus ?? 0);
        const dil = parseFloat(diligence_allowance ?? 0);
        const lateDed = parseFloat(late_deduction ?? 0);
        const leaveDed = parseFloat(leave_deduction ?? 0);
        const taxDed = parseFloat(tax_deduction ?? 0);
        const ssoDed = parseFloat(sso_deduction ?? 0);

        // คำนวณ net ใหม่
        const newNet = baseSalary + ot + bns + dil - lateDed - leaveDed - taxDed - ssoDed;

        await pool.query(`
            UPDATE payroll_records SET
                overtime_pay = ?, bonus = ?, diligence_allowance = ?,
                late_deduction = ?, leave_deduction = ?, tax_deduction = ?, sso_deduction = ?,
                net_salary = ?, status = 'draft'
            WHERE employee_id = ? AND period_month = ? AND period_year = ?
        `, [ot, bns, dil, lateDed, leaveDed, taxDed, ssoDed, newNet, employeeId, m, y]);

        res.json({
            message: 'แก้ไขข้อมูลเงินเดือนสำเร็จ',
            net_salary: newNet,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ─────────────────────────────────────────────
// PAYROLL HISTORY (ประวัติรอบที่บันทึกแล้ว)
// ─────────────────────────────────────────────
app.get('/api/payroll/history', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT period_year, period_month, COUNT(*) as employee_count,
                   SUM(net_salary) as total_net, SUM(base_salary) as total_gross,
                   SUM(tax_deduction + sso_deduction) as total_tax_sso,
                   MAX(status) as status
            FROM payroll_records
            GROUP BY period_year, period_month
            ORDER BY period_year DESC, period_month DESC
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// 📥 ATTENDANCE IMPORT (CSV → DB with upsert)
// ─────────────────────────────────────────────

// GET ดึงข้อมูล attendance จาก DB พร้อมสรุปรายพนักงาน
app.get('/api/attendance', async (req, res) => {
    try {
        const month = req.query.month ? String(req.query.month).padStart(2, '0') : null;
        const year = req.query.year ? String(req.query.year) : null;

        let whereClause = '';
        const params = [];
        if (month && year) {
            whereClause = `WHERE DATE_FORMAT(al.check_in_time, '%m') = ? AND DATE_FORMAT(al.check_in_time, '%Y') = ?`;
            params.push(month, year);
        }

        const [rows] = await pool.query(`
            SELECT al.*, 
                   e.employee_code, CONCAT(e.first_name,' ',e.last_name) as emp_name,
                   d.name as department
            FROM attendance_logs al
            JOIN employees e ON al.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            ${whereClause}
            ORDER BY al.check_in_time DESC
        `, params);

        // สรุปรายพนักงาน
        const summaryMap = {};
        rows.forEach(r => {
            const key = r.employee_code;
            if (!summaryMap[key]) {
                summaryMap[key] = {
                    employeeId: r.employee_code,
                    name: r.emp_name,
                    department: r.department || 'ไม่ระบุ',
                    workDays: 0,        // วันทำงานทั้งหมด (รวม เสาร์-อาทิตย์)
                    weekdays: 0,        // จันทร์-ศุกร์
                    weekends: 0,        // เสาร์-อาทิตย์
                    onTimeDays: 0,      // มาตรงเวลา ไม่สาย
                    lateCount: 0,       // มาสาย
                    totalLateMinutes: 0,
                };
            }
            const s = summaryMap[key];
            s.workDays++;

            // ตรวจสอบว่าเป็นวันหยุดสุดสัปดาห์หรือไม่
            if (r.check_in_time) {
                const day = new Date(r.check_in_time).getDay(); // 0=Sun, 6=Sat
                if (day === 0 || day === 6) {
                    s.weekends++;
                } else {
                    s.weekdays++;
                }
            }

            if (r.status === 'late') {
                s.lateCount++;
                s.totalLateMinutes += parseInt(r.late_minutes || 0);
            } else {
                s.onTimeDays++; // ตรงเวลา (ไม่สาย)
            }
        });

        res.json({
            logs: rows,
            summary: Object.values(summaryMap),
            total: rows.length,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST นำเข้าข้อมูล attendance จาก CSV (upsert: ลบซ้ำแล้วใส่ใหม่)
app.post('/api/attendance/import', async (req, res) => {
    try {
        const { records } = req.body;
        if (!records || !Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะนำเข้า' });
        }

        let inserted = 0;
        let replaced = 0;
        const errors = [];

        for (const rec of records) {
            try {
                // หา employee_id จาก employee_code
                const [empRows] = await pool.query(
                    'SELECT id FROM employees WHERE employee_code = ?',
                    [rec.employee_code]
                );

                if (empRows.length === 0) {
                    errors.push({ code: rec.employee_code, error: 'ไม่พบรหัสพนักงานในระบบ' });
                    continue;
                }

                const employeeId = empRows[0].id;
                const checkInDatetime = rec.check_in_time || null;
                const checkDate = checkInDatetime ? checkInDatetime.substring(0, 10) : null;

                // UPSERT: ถ้ามีข้อมูลวันเดิมของพนักงานนั้น → ลบทิ้งแล้วใส่ใหม่
                if (checkDate) {
                    const [existing] = await pool.query(
                        `SELECT id FROM attendance_logs 
                         WHERE employee_id = ? AND DATE(check_in_time) = ?`,
                        [employeeId, checkDate]
                    );

                    if (existing.length > 0) {
                        await pool.query(
                            `DELETE FROM attendance_logs WHERE employee_id = ? AND DATE(check_in_time) = ?`,
                            [employeeId, checkDate]
                        );
                        replaced++;
                    } else {
                        inserted++;
                    }
                } else {
                    inserted++;
                }

                // คำนวณ late_minutes จาก shift ของพนักงาน (ถ้ามี)
                const [shiftRows] = await pool.query(`
                    SELECT s.start_time, s.late_allowance_minutes
                    FROM employees e
                    LEFT JOIN shifts s ON e.shift_id = s.id
                    WHERE e.id = ?
                `, [employeeId]);

                let lateMinutes = 0;
                let attendanceStatus = rec.status || 'on_time';

                if (shiftRows.length > 0 && shiftRows[0].start_time && checkInDatetime) {
                    const shiftStart = shiftRows[0].start_time; // "HH:MM:SS"
                    const allowance = parseInt(shiftRows[0].late_allowance_minutes || 0);
                    const checkInTime = checkInDatetime.substring(11, 19) || checkInDatetime.substring(11);

                    if (checkInTime) {
                        const [sh, sm] = shiftStart.split(':').map(Number);
                        const [ch, cm] = checkInTime.split(':').map(Number);
                        const diff = (ch * 60 + cm) - (sh * 60 + sm);
                        if (diff > allowance) {
                            lateMinutes = diff - allowance;
                            attendanceStatus = 'late';
                        }
                    }
                } else if (rec.status) {
                    // ใช้ status จาก CSV
                    if (rec.status.includes('สาย') || rec.status === 'late') {
                        attendanceStatus = 'late';
                        lateMinutes = parseInt(rec.late_minutes || 0);
                    }
                }

                await pool.query(`
                    INSERT INTO attendance_logs 
                        (employee_id, check_in_time, check_out_time, status, late_minutes)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    employeeId,
                    rec.check_in_time || null,
                    rec.check_out_time || null,
                    attendanceStatus,
                    lateMinutes
                ]);

            } catch (e) {
                errors.push({ code: rec.employee_code, error: e.message });
            }
        }

        res.json({
            message: `นำเข้าสำเร็จ: เพิ่มใหม่ ${inserted} รายการ, แทนที่ ${replaced} รายการ`,
            inserted,
            replaced,
            total: inserted + replaced,
            errors,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// START SERVER + AUTO MIGRATION
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

async function runMigrations() {
    const migrations = [
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS diligence_allowance DECIMAL(10,2) DEFAULT 0.00`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS diligence_allowance DECIMAL(10,2) DEFAULT 0.00`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone VARCHAR(20) DEFAULT NULL`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS email VARCHAR(150) DEFAULT NULL`,
    ];
    for (const sql of migrations) {
        try {
            await pool.query(sql);
        } catch (err) {
            console.warn('Migration skipped:', err.message);
        }
    }
    console.log('✅ Database migrations done.');
}

// ─────────────────────────────────────────────
// PUBLIC HOLIDAYS (วันหยุดนักขัตฤกษ์)
// ─────────────────────────────────────────────
app.get('/api/settings/holidays', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM public_holidays ORDER BY holiday_date ASC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/settings/holidays', async (req, res) => {
    try {
        const { date, name } = req.body;
        if (!date || !name) return res.status(400).json({ error: 'กรุณาระบุวันที่และชื่อวันหยุด' });
        
        await pool.query('INSERT INTO public_holidays (holiday_date, name) VALUES (?, ?)', [date, name]);
        res.status(201).json({ message: 'เพิ่มวันหยุดนักขัตฤกษ์สำเร็จ' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'มีวันหยุดในระบบสำหรับวันนี้แล้ว' });
        }
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/settings/holidays/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM public_holidays WHERE id = ?', [req.params.id]);
        res.json({ message: 'ลบวันหยุดสำเร็จ' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// DASHBOARD & ANALYTICS
// ─────────────────────────────────────────────
app.get('/api/dashboard/payroll-trends', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT period_year as year, period_month as month, 
                SUM(net_salary) as total_net, 
                SUM(base_salary) as total_base,
                SUM(overtime_pay) as total_ot
            FROM payroll_records 
            WHERE status = 'paid'
            GROUP BY period_year, period_month 
            ORDER BY period_year DESC, period_month DESC 
            LIMIT 6
        `);
        res.json(rows.reverse());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/dashboard/attendance-stats', async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        const [lateRows] = await pool.query(`
            SELECT employee_id, COUNT(*) as late_count 
            FROM attendance_logs 
            WHERE YEAR(check_in_time) = ? AND MONTH(check_in_time) = ? AND late_minutes > 0
            GROUP BY employee_id
            HAVING late_count >= 3
        `, [currentYear, currentMonth]);

        const [leaveRows] = await pool.query(`
            SELECT COUNT(*) as unpaid_leaves
            FROM leave_requests lr
            JOIN leave_types lt ON lr.leave_type_id = lt.id
            WHERE YEAR(lr.start_date) = ? AND MONTH(lr.start_date) = ? AND lr.status = 'approved' AND lt.is_unpaid = 1
        `, [currentYear, currentMonth]);

        res.json({
            frequentLates: lateRows.length,
            unpaidLeaves: leaveRows[0]?.unpaid_leaves || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

runMigrations()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('Migration error:', err);
        app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} (migration failed)`));
    });
