import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import dayjs from 'dayjs';
import ExcelJS from 'exceljs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';

dotenv.config();

// EMAIL TRANSPORTER
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
    },
    tls: {
        rejectUnauthorized: false // ข้ามการตรวจสอบใบรับรอง (เพื่อแก้ปัญหายิบย่อยบนคลาวด์)
    },
    family: 4,
    debug: true,
    logger: true,
    connectionTimeout: 10000 // เพิ่มเวลาให้ระบบเชื่อมต่อหากช้า// บังคับใช้ IPv4 เพื่อแก้ปัญหา ENETUNREACH บน Render
});

const sendEmail = async (to, subject, html) => {
    if (!process.env.SMTP_HOST) {
        console.log('--- Email Not Configured: Logging to Console ---');
        console.log(`To: ${to}\nSubject: ${subject}\nBody: ${html}`);
        return;
    }
    try {
        console.log(`[Email] Attempting to send to ${to}...`);
        const info = await transporter.sendMail({ from: `"HR System" <${process.env.SMTP_USER}>`, to, subject, html });
        console.log(`[Email] Success! Message ID: ${info.messageId}`);
        return info;
    } catch (err) {
        console.error('[Email] CRITICAL ERROR:', err.message);
        throw err; // Re-throw to handle in endpoint
    }
};

const app = express();
app.use(cors()); // อนุญาตให้ทุกโดเมน (Origins) เข้าถึงได้ ป้องกันปัญหา CORS บน Production
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve uploads as static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage });

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hr-payroll-db',
    port: parseInt(process.env.DB_PORT) || 3306,
    connectionLimit: 10,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : null, // เพิ่มบรรทัดนี้เพื่อรองรับ Cloud DB
    waitForConnections: true,
    queueLimit: 0
});

// ─────────────────────────────────────────────
// 💡 HELPER: คำนวณประกันสังคม
// ─────────────────────────────────────────────
function calculateSSO(baseSalary, settings = {}) {
    const rate = parseFloat(settings.sso_rate || 0.05);
    const max = parseFloat(settings.sso_max_amount || 750);
    // ประกันสังคม % ของเงินเดือน แต่ไม่เกินยอดสูงสุด
    return Math.min(Math.floor(baseSalary * rate), max);
}

// ─────────────────────────────────────────────
// 💡 HELPER: สำหรับคำนวณช่วงวันที่ของรอบการจ่ายเงินเดือน
// ─────────────────────────────────────────────
function getPayrollDateRange(month, year, cutoffDay = 25) {
    // If cutoff is 25:
    // This month's payroll is from (Last Month 26th) to (This Month 25th)
    const end = dayjs(`${year}-${String(month).padStart(2, '0')}-${cutoffDay}`);
    const start = end.subtract(1, 'month').add(1, 'day');
    return {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD')
    };
}

// ─────────────────────────────────────────────
// 💡 HELPER: คำนวณภาษีเงินได้บุคคลธรรมดา (PIT) - แบบขั้นบันได (รวมลดหย่อน)
// ─────────────────────────────────────────────
function calculateIncomeTax(baseSalary, allowances = {}, settings = {}) {
    const annualIncome = baseSalary * 12;

    // รายได้หลังหักค่าใช้จ่าย (หักได้ 50% แต่ไม่เกิน 100,000 หรือตามที่ตั้งค่า)
    const expenseRate = parseFloat(settings.tax_expense_rate || 0.5);
    const expenseMax = parseFloat(settings.tax_expense_max || 100000);
    const expenses = Math.min(annualIncome * expenseRate, expenseMax);

    // ลดหย่อนพื้นฐาน
    let totalAllowances = parseFloat(settings.tax_allowance_personal || 60000); // ส่วนตัว

    // ลดหย่อนอื่นๆ
    if (allowances.spouse_allowance) totalAllowances += 60000;
    totalAllowances += (parseInt(allowances.children_count || 0) * 30000);
    totalAllowances += (parseInt(allowances.parents_care_count || 0) * 30000);

    // ประกันชีวิต/สุขภาพ (รวมกันไม่เกิน 100,000 โดยสุขภาพไม่เกิน 25,000)
    const health = Math.min(parseFloat(allowances.health_insurance || 0), 25000);
    const life = parseFloat(allowances.life_insurance || 0);
    totalAllowances += Math.min(health + life, 100000);

    // ประกันสังคม (หักตามจริงรายปี - สมมติ 750 * 12 = 9,000)
    const annualSSO = (settings.sso_max_amount || 750) * 12;
    totalAllowances += annualSSO;

    const taxableIncome = Math.max(0, annualIncome - expenses - totalAllowances);

    if (taxableIncome <= 150000) return 0;

    let tax = 0;
    const tiers = [
        { limit: 150000, rate: 0 },
        { limit: 300000, rate: 0.05 },
        { limit: 500000, rate: 0.10 },
        { limit: 750000, rate: 0.15 },
        { limit: 1000000, rate: 0.20 },
        { limit: 2000000, rate: 0.25 },
        { limit: 5000000, rate: 0.30 },
        { limit: Infinity, rate: 0.35 }
    ];

    let remainingIncome = taxableIncome;
    let previousLimit = 0;

    for (const tier of tiers) {
        const incomeInTier = Math.min(remainingIncome, tier.limit - previousLimit);
        if (incomeInTier <= 0) break;

        tax += incomeInTier * tier.rate;
        remainingIncome -= incomeInTier;
        previousLimit = tier.limit;
    }

    return Math.floor(tax / 12);
}

// ─────────────────────────────────────────────
// 💡 HELPER: คำนวณค่าล่วงเวลา (OT)
// ─────────────────────────────────────────────
function calculateOTPay(baseSalary, hours, multiplier, settings = {}) {
    const daysPerMonth = parseFloat(settings.days_per_month || 30);
    const hoursPerDay = parseFloat(settings.hours_per_day || 8);
    // ฐานคำนวณ: (เงินเดือน / วันต่อเดือน / ชม.ต่อวัน) * ชั่วโมง * ตัวคูณ
    const hourlyRate = (baseSalary / daysPerMonth / hoursPerDay);
    return Math.floor(hourlyRate * hours * multiplier);
}

// ─────────────────────────────────────────────
// 💡 AUDIT LOGGER
// ─────────────────────────────────────────────
async function logAudit(userId, action, targetTable, targetId, details) {
    try {
        await pool.query(
            'INSERT INTO audit_logs (user_id, action, target_table, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [userId || 1, action, targetTable, targetId, JSON.stringify(details)]
        );
    } catch (err) {
        console.error('Audit log error:', err.message);
    }
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
// 🏢 SUBSIDIARIES (บริษัทย่อย)
// ─────────────────────────────────────────────
app.get('/api/subsidiaries', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM subsidiaries ORDER BY id ASC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/subsidiaries', async (req, res) => {
    try {
        const { name, tax_id, address } = req.body;
        await pool.query('INSERT INTO subsidiaries (name, tax_id, address) VALUES (?, ?, ?)', [name, tax_id, address]);
        res.status(201).json({ message: 'Subsidiary created' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/subsidiaries/:id', async (req, res) => {
    try {
        const { name, tax_id, address } = req.body;
        await pool.query('UPDATE subsidiaries SET name=?, tax_id=?, address=? WHERE id=?', [name, tax_id, address, req.params.id]);
        res.json({ message: 'Subsidiary updated' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/subsidiaries/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM subsidiaries WHERE id = ?', [req.params.id]);
        res.json({ message: 'Subsidiary deleted' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// 🏢 DEPARTMENTS (แผนก)
// ─────────────────────────────────────────────
app.get('/api/departments', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM departments ORDER BY id ASC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/departments', async (req, res) => {
    try {
        const { name } = req.body;
        // Check for existing department
        const [existing] = await pool.query('SELECT id FROM departments WHERE LOWER(name) = LOWER(?)', [name]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'ชื่อแผนกนี้มีอยู่ในระบบแล้ว' });
        }
        await pool.query('INSERT INTO departments (name) VALUES (?)', [name]);
        res.status(201).json({ message: 'Department created' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/departments/:id', async (req, res) => {
    try {
        await pool.query('UPDATE departments SET name=? WHERE id=?', [req.body.name, req.params.id]);
        res.json({ message: 'Department updated' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/departments/:id', async (req, res) => {
    try {
        const [inUse] = await pool.query('SELECT COUNT(*) as count FROM employees WHERE department_id = ?', [req.params.id]);
        if (inUse[0].count > 0) {
            return res.status(400).json({ error: 'ไม่สามารถลบแผนกได้ เนื่องจากมีพนักงานสังกัดข้อมูลชุดนี้อยู่' });
        }
        await pool.query('DELETE FROM departments WHERE id = ?', [req.params.id]);
        res.json({ message: 'ลบแผนกเรียบร้อยแล้ว' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// 👥 EMPLOYEES
// ─────────────────────────────────────────────
app.get('/api/employees', async (req, res) => {
    try {
        const [employees] = await pool.query(`
            SELECT e.*, d.name AS department_name, c.name AS company_name,
            m.first_name AS manager_name_first, m.last_name AS manager_name_last
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN subsidiaries c ON e.company_id = c.id
            LEFT JOIN employees m ON e.reports_to = m.id
        `);
        res.json(employees);
    } catch (error) {
        console.error('API Error /api/employees:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/employees', async (req, res) => {
    try {
        const {
            first_name, last_name, employee_code, department_id, company_id, position,
            join_date, shift_id, base_salary, phone, email, status, id_number,
            spouse_allowance, children_count, parents_care_count, health_insurance, life_insurance,
            pvf_rate, pvf_employer_rate, reports_to
        } = req.body;

        // Fetch default password from settings
        const [[settings]] = await pool.query('SELECT default_password FROM system_settings LIMIT 1');
        const defaultPassword = settings?.default_password || 'Example123';
        const username = employee_code; // Default username to employee code

        const [result] = await pool.query(`
            INSERT INTO employees (
                first_name, last_name, employee_code, username, password, must_change_password, 
                department_id, company_id, position, 
                join_date, shift_id, base_salary, phone, email, status, id_number,
                spouse_allowance, children_count, parents_care_count, health_insurance, life_insurance,
                pvf_rate, pvf_employer_rate, reports_to
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            first_name, last_name, employee_code, username, defaultPassword,
            department_id, company_id, position,
            join_date, shift_id, base_salary, phone, email, status || 'active', id_number,
            spouse_allowance || 0, children_count || 0, parents_care_count || 0,
            health_insurance || 0, life_insurance || 0, pvf_rate || 0, pvf_employer_rate || 0, reports_to || null
        ]);

        const newEmpId = result.insertId;

        // --- Initialize Leave Quotas for the new employee ---
        try {
            // 1. Handle regular leave types (Sick, Personal, etc. using default days_per_year)
            const [types] = await pool.query("SELECT id, name, days_per_year FROM leave_types WHERE name NOT LIKE '%พักร้อน%' AND name NOT LIKE '%Annual%' AND name NOT LIKE '%Vacation%'");
            for (const type of types) {
                await pool.query(
                    "INSERT INTO employee_leave_quotas (employee_id, leave_type_id, quota_days) VALUES (?, ?, ?)",
                    [newEmpId, type.id, parseFloat(type.days_per_year) || 0]
                );
            }

            // 2. Handle Vacation leave type (based on tenure rules)
            const [vacTypes] = await pool.query("SELECT id FROM leave_types WHERE name LIKE '%พักร้อน%' OR name LIKE '%Annual%' OR name LIKE '%Vacation%' LIMIT 1");
            if (vacTypes.length > 0) {
                const vTypeID = vacTypes[0].id;
                const [rules] = await pool.query("SELECT * FROM leave_quota_rules ORDER BY tenure_years DESC");
                const tenureYears = dayjs().diff(dayjs(join_date), 'year');
                const matchedRule = rules.find(r => tenureYears >= r.tenure_years);
                const vacQuota = matchedRule ? matchedRule.vacation_days : 0;

                await pool.query(
                    "INSERT INTO employee_leave_quotas (employee_id, leave_type_id, quota_days) VALUES (?, ?, ?)",
                    [newEmpId, vTypeID, vacQuota]
                );
            }
        } catch (quotaErr) {
            console.error('Failed to init leave quotas for new employee:', quotaErr);
        }

        res.status(201).json({ id: newEmpId });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/employees/:id', async (req, res) => {
    try {
        const {
            first_name, last_name, employee_code, department_id, company_id, position,
            join_date, shift_id, base_salary, phone, email, status, id_number,
            spouse_allowance, children_count, parents_care_count, health_insurance, life_insurance,
            pvf_rate, pvf_employer_rate, reports_to
        } = req.body;

        await pool.query(`
            UPDATE employees SET 
                first_name=?, last_name=?, employee_code=?, department_id=?, company_id=?, position=?, 
                join_date=?, shift_id=?, base_salary=?, phone=?, email=?, status=?, id_number=?,
                spouse_allowance=?, children_count=?, parents_care_count=?, health_insurance=?, life_insurance=?,
                pvf_rate=?, pvf_employer_rate=?, reports_to=?
            WHERE id = ?
        `, [
            first_name, last_name, employee_code, department_id, company_id, position,
            join_date, shift_id, base_salary, phone, email, status, id_number,
            spouse_allowance, children_count, parents_care_count, health_insurance, life_insurance,
            pvf_rate, pvf_employer_rate, reports_to, req.params.id
        ]);
        res.json({ message: 'Employee updated successfully' });
    } catch (error) { res.status(500).json({ error: error.message }); }
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
                        // Check again with a lock or just handle existing
                        const [checkDept] = await pool.query('SELECT id FROM departments WHERE name = ?', [emp.department]);
                        if (checkDept.length > 0) {
                            deptId = checkDept[0].id;
                        } else {
                            const [newDept] = await pool.query('INSERT INTO departments (name) VALUES (?)', [emp.department]);
                            deptId = newDept.insertId;
                        }
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
                const [insertRes] = await pool.query(
                    `INSERT INTO employees (employee_code, username, password, must_change_password, first_name, last_name, department_id, position, join_date, status, base_salary) VALUES (?, ?, 'Example123', 1, ?, ?, ?, ?, ?, ?, ?)`,
                    [code, code, emp.first_name, emp.last_name, deptId, emp.position, emp.join_date, emp.status || 'active', emp.base_salary || 0]
                );
                created++;

                // --- Auto Initialize Quotas for the newly imported employee ---
                const newEmpId = insertRes.insertId;
                try {
                    // Sick/Personal/etc
                    const [types] = await pool.query("SELECT id, days_per_year FROM leave_types WHERE name NOT LIKE '%พักร้อน%' AND name NOT LIKE '%Annual%' AND name NOT LIKE '%Vacation%'");
                    for (const t of types) {
                        await pool.query("INSERT IGNORE INTO employee_leave_quotas (employee_id, leave_type_id, quota_days) VALUES (?, ?, ?)", [newEmpId, t.id, parseFloat(t.days_per_year) || 0]);
                    }
                    // Vacation (Tenure based)
                    const [vacTypes] = await pool.query("SELECT id FROM leave_types WHERE name LIKE '%พักร้อน%' OR name LIKE '%Annual%' OR name LIKE '%Vacation%' LIMIT 1");
                    if (vacTypes.length > 0) {
                        const vTypeID = vacTypes[0].id;
                        const [rules] = await pool.query("SELECT * FROM leave_quota_rules ORDER BY tenure_years DESC");
                        const tenureYears = dayjs().diff(dayjs(emp.join_date), 'year');
                        const matchedRule = rules.find(r => tenureYears >= r.tenure_years);
                        await pool.query("INSERT IGNORE INTO employee_leave_quotas (employee_id, leave_type_id, quota_days) VALUES (?, ?, ?)", [newEmpId, vTypeID, matchedRule ? matchedRule.vacation_days : 0]);
                    }
                } catch (qErr) { console.warn('Failed to init quotas in import for', code, qErr.message); }
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
        const { employee_id, role } = req.query;
        let whereClause = 'WHERE 1=1';
        let params = [];

        if (role === 'employee' && employee_id) {
            whereClause += ' AND lr.employee_id = ?';
            params.push(employee_id);
        } else if (role === 'supervisor' && employee_id) {
            // ดึงคำขอของลูกน้อง (reports_to) หรือของตัวเองถ้าต้องการ (แต่อันนี้เอาแค่ลูกน้องก่อน)
            whereClause += ' AND e.reports_to = ?';
            params.push(employee_id);
        }

        const [rows] = await pool.query(`
            SELECT lr.*, l.name as leave_type_name, 
                   CONCAT(e.first_name, ' ', e.last_name) as employee_name,
                   d.name as department
            FROM leave_requests lr
            JOIN employees e ON lr.employee_id = e.id
            JOIN leave_types l ON lr.leave_type_id = l.id
            LEFT JOIN departments d ON e.department_id = d.id
            ${whereClause}
            ORDER BY lr.submitted_at DESC
        `, params);
        const formatted = rows.map(r => ({ ...r, id: r.id.toString(), total_days: parseFloat(r.total_days) }));
        res.json(formatted);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/leaves/requests', async (req, res) => {
    try {
        const { employee_id, leave_type_id, start_date, end_date, total_days, reason } = req.body;
        const approval_token = jwt.sign({ empId: employee_id, rand: Math.random() }, process.env.JWT_SECRET || 'hr-secret');

        // 1. บันทึกคำขอเบื้องต้น
        const [result] = await pool.query(
            'INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason, status, approval_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [employee_id, leave_type_id, start_date, end_date, total_days, reason, 'รอหัวหน้าอนุมัติ', approval_token]
        );

        // 2. ดึงข้อมูลพนักงานและหัวหน้า
        const [[emp]] = await pool.query('SELECT e.first_name, e.last_name, s.first_name as s_first, s.last_name as s_last, s.email as s_email FROM employees e LEFT JOIN employees s ON e.reports_to = s.id WHERE e.id = ?', [employee_id]);

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

        if (emp && emp.s_email) {
            const approveLink = `${frontendUrl}/approve-leave?token=${approval_token}&action=approve&from=supervisor&id=${result.insertId}`;
            const rejectLink = `${frontendUrl}/approve-leave?token=${approval_token}&action=reject&from=supervisor&id=${result.insertId}`;

            await sendEmail(emp.s_email, 'คำขออนุมัติการลา: ' + emp.first_name + ' ' + emp.last_name, `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>คำขอการลาใหม่</h2>
                    <p>พนักงาน: ${emp.first_name} ${emp.last_name}</p>
                    <p>วันที่: ${start_date} ถึง ${end_date} (รวม ${total_days} วัน)</p>
                    <p>เหตุผล: ${reason}</p>
                    <hr/>
                    <div style="margin-top: 20px;">
                        <a href="${approveLink}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-right: 10px;">อนุมัติ</a>
                        <a href="${rejectLink}" style="background-color: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">ปฏิเสธ</a>
                    </div>
                </div>
            `);
        } else {
            // ไม่มีหัวหน้า ให้ส่งถึง HR โดยตรง และเปลี่ยนสถานะ
            await pool.query('UPDATE leave_requests SET status = ? WHERE id = ?', ['รอ hr อนุมัติ', result.insertId]);

            const hrEmail = process.env.SMTP_USER; // Default to SMTP user for HR
            const approveLink = `${frontendUrl}/approve-leave?token=${approval_token}&action=approve&from=hr&id=${result.insertId}`;
            const rejectLink = `${frontendUrl}/approve-leave?token=${approval_token}&action=reject&from=hr&id=${result.insertId}`;

            await sendEmail(hrEmail, 'คำขออนุมัติการลา (ส่งตรงถึง HR): ' + emp.first_name + ' ' + emp.last_name, `
                <p>พนักงานไม่มีระบุหัวหน้า คำขอส่งตรงถึง HR</p>
                <p>พนักงาน: ${emp.first_name} ${emp.last_name}</p>
                <p>วันที่: ${start_date} ถึง ${end_date} (รวม ${total_days} วัน)</p>
                <div style="margin-top: 20px;">
                    <a href="${approveLink}">อนุมัติ</a> | <a href="${rejectLink}">ปฏิเสธ</a>
                </div>
            `);
        }

        res.status(201).json({ id: result.insertId.toString(), message: 'ส่งคำขอสำเร็จ' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/leaves/requests/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, from } = req.body; // status: 'approved' | 'rejected', from: 'supervisor' | 'hr'

        const [[leave]] = await pool.query('SELECT lr.*, e.first_name, e.last_name, e.email, e.reports_to FROM leave_requests lr JOIN employees e ON lr.employee_id = e.id WHERE lr.id = ?', [id]);
        if (!leave) return res.status(404).json({ error: 'ไม่พบรายการลา' });

        let newStatus = leave.status;
        let updateFields = [];
        let params = [];

        if (from === 'supervisor') {
            if (status === 'approve') {
                newStatus = 'รอ hr อนุมัติ';
                updateFields.push('supervisor_approved_at = CURRENT_TIMESTAMP');

                // แจ้งเตือน HR ให้มาอนุมัติต่อ
                const [hrs] = await pool.query("SELECT email FROM admins WHERE role IN ('admin', 'hr', 'superadmin') AND email IS NOT NULL AND email != ''");
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
                const approveLink = `${frontendUrl}/approve-leave?token=${leave.approval_token}&action=approve&from=hr&id=${id}`;
                const rejectLink = `${frontendUrl}/approve-leave?token=${leave.approval_token}&action=reject&from=hr&id=${id}`;

                for (const hr of hrs) {
                    await sendEmail(hr.email, 'คำขออนุมัติการลา (ขั้นตอนสุดท้าย): ' + leave.first_name, `
                        <p>หัวหน้าอนุมัติแล้ว และรอ HR อนุมัติขั้นสุดท้าย</p>
                        <p>พนักงาน: ${leave.first_name} ${leave.last_name}</p>
                        <hr/>
                        <a href="${approveLink}">อนุมัติ</a> | <a href="${rejectLink}">ปฏิเสธ</a>
                    `);
                }
            } else {
                newStatus = 'ปฏิเสธโดยหัวหน้า';
            }
        } else if (from === 'hr') {
            if (status === 'approve') {
                newStatus = 'เสร็จสิ้น';
                updateFields.push('hr_approved_at = CURRENT_TIMESTAMP');
                updateFields.push('approved_at = CURRENT_TIMESTAMP');

                // --- Sync/Deduct from Employee Leave Quotas ---
                try {
                    await pool.query(
                        'UPDATE employee_leave_quotas SET quota_days = quota_days - ? WHERE employee_id = ? AND leave_type_id = ?',
                        [leave.total_days, leave.employee_id, leave.leave_type_id]
                    );
                } catch (quotaErr) {
                    console.error('Failed to deduct quota:', quotaErr.message);
                    // Continue anyway but log it
                }
            } else {
                newStatus = 'ยกเลิกโดยhr';
            }
        } else if (from === 'employee' && status === 'cancel') {
            newStatus = 'ยกเลิกโดยพนักงาน';
        }

        params.push(newStatus, id);
        await pool.query(`UPDATE leave_requests SET status = ? ${updateFields.length > 0 ? ', ' + updateFields.join(', ') : ''} WHERE id = ?`, params);

        // แจ้งผลพนักงาน
        if (leave.email) {
            await sendEmail(leave.email, 'แจ้งสถานะการลาของคุณ: ' + newStatus, `<p>การลาของคุณปรับสถานะเป็น: ${newStatus}</p>`);
        }

        res.json({ message: `อัปเดตสถานะเป็น ${newStatus} เรียบร้อย` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET verify leave token (for email approval links)
app.get('/api/leaves/verify-token', async (req, res) => {
    try {
        const { token, id } = req.query;
        const [[rows]] = await pool.query('SELECT status FROM leave_requests WHERE id = ? AND approval_token = ?', [id, token]);
        if (!rows) return res.status(401).json({ error: 'Token ไม่ถูกต้องหรือรายการนี้ถูกดำเนินการไปแล้ว' });
        res.json({ status: rows.status });
    } catch (error) { res.status(500).json({ error: error.message }); }
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

app.post('/api/leave-rules/apply-to-all', async (req, res) => {
    try {
        // 1. Get rules sorted DESC by years to find highest match easily
        const [rules] = await pool.query('SELECT * FROM leave_quota_rules ORDER BY tenure_years DESC');

        // 2. Find vacation leave type ID
        const [types] = await pool.query("SELECT id FROM leave_types WHERE name LIKE '%พักร้อน%' OR name LIKE '%Annual%' OR name LIKE '%Vacation%' LIMIT 1");
        if (types.length === 0) throw new Error('ไม่พบประเภทการลา "พักร้อน" หรือ "Annual Leave" ในระบบ');
        const vTypeID = types[0].id;

        // 3. Get all active employees
        const [employees] = await pool.query("SELECT id, join_date FROM employees WHERE status = 'active'");

        let updateCount = 0;
        for (const emp of employees) {
            if (!emp.join_date) continue;

            const joinDate = dayjs(emp.join_date);
            const tenureYears = dayjs().diff(joinDate, 'year');

            // Find first rule where tenureYears >= rule.tenure_years
            const matchedRule = rules.find(r => tenureYears >= r.tenure_years);

            if (matchedRule) {
                // Upsert into employee_leave_quotas
                await pool.query(
                    `INSERT INTO employee_leave_quotas (employee_id, leave_type_id, quota_days) 
                     VALUES (?, ?, ?) 
                     ON DUPLICATE KEY UPDATE quota_days = ?`,
                    [emp.id, vTypeID, matchedRule.vacation_days, matchedRule.vacation_days]
                );
                updateCount++;
            }
        }

        res.json({ message: `อัปเดตโควตาวันหยุดพนักงานสำเร็จ ${updateCount} คน` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
        res.json(rows.map(r => ({
            id: r.id.toString(),
            leaveName: r.name,
            isDeductSalary: r.is_unpaid,
            daysPerYear: r.days_per_year
        })));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/leave-types', async (req, res) => {
    try {
        const [result] = await pool.query('INSERT INTO leave_types (name, is_unpaid, days_per_year) VALUES (?, ?, ?)',
            [req.body.leaveName, req.body.isDeductSalary, req.body.daysPerYear || 0]);
        res.status(201).json({ id: result.insertId.toString() });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/leave-types/:id', async (req, res) => {
    try {
        await pool.query('UPDATE leave_types SET name=?, is_unpaid=?, days_per_year=? WHERE id=?',
            [req.body.leaveName, req.body.isDeductSalary, req.body.daysPerYear, req.params.id]);
        res.json({ message: 'Updated' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/leave-types/:id', async (req, res) => {
    try { await pool.query('DELETE FROM leave_types WHERE id=?', [req.params.id]); res.json({ message: 'Deleted' }); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/leave-types/sync-all', async (req, res) => {
    try {
        // 1. Get all leave types EXCEPT vacation ones (already handled by tenure rules)
        const [types] = await pool.query("SELECT id, name, days_per_year FROM leave_types WHERE name NOT LIKE '%พักร้อน%' AND name NOT LIKE '%Annual%' AND name NOT LIKE '%Vacation%'");

        // 2. Get all active employees
        const [employees] = await pool.query("SELECT id FROM employees WHERE status = 'active'");

        let updateCount = 0;
        for (const type of types) {
            const quota = parseFloat(type.days_per_year) || 0;
            for (const emp of employees) {
                await pool.query(
                    `INSERT INTO employee_leave_quotas (employee_id, leave_type_id, quota_days) 
                     VALUES (?, ?, ?) 
                     ON DUPLICATE KEY UPDATE quota_days = ?`,
                    [emp.id, type.id, quota, quota]
                );
                updateCount++;
            }
        }
        res.json({ message: `ซิงค์โควตาวันลา (Sick, Personal, etc.) สำเร็จสำหรับ ${employees.length} พนักงาน` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// EMPLOYEE ACCOUNT & SECURITY
// ─────────────────────────────────────────────

// Admin sets account credentials
app.put('/api/employees/:id/account', async (req, res) => {
    try {
        const { id } = req.params;
        const { username, password, role, must_change_password } = req.body;

        let query = 'UPDATE employees SET username = ?, role = ?, must_change_password = ?';
        let params = [username, role, must_change_password ? 1 : 0];

        if (password) {
            query += ', password = ?';
            params.push(password);
        }

        query += ' WHERE id = ?';
        params.push(id);

        await pool.query(query, params);
        res.json({ message: 'อัปเดตข้อมูลบัญชีผู้ใช้สำเร็จ' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Employee changes their own password
app.put('/api/employees/:id/change-password', async (req, res) => {
    try {
        const { id } = req.params;
        const { currentPassword, newPassword } = req.body;

        // Check current password
        const [[emp]] = await pool.query('SELECT password FROM employees WHERE id = ?', [id]);
        if (!emp || emp.password !== currentPassword) {
            return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
        }

        await pool.query('UPDATE employees SET password = ?, must_change_password = 0 WHERE id = ?', [newPassword, id]);
        res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
        const {
            company_name, tax_id, address, deduct_excess_sick_leave, deduct_excess_personal_leave,
            late_penalty_per_minute, auto_deduct_tax, auto_deduct_sso, payroll_cutoff_date,
            diligence_allowance, days_per_month, hours_per_day, sso_rate, sso_max_amount,
            default_password
        } = req.body;
        await pool.query(`
            UPDATE system_settings SET 
                company_name=COALESCE(?, company_name), tax_id=COALESCE(?, tax_id), address=COALESCE(?, address),
                deduct_excess_sick_leave=COALESCE(?, deduct_excess_sick_leave),
                deduct_excess_personal_leave=COALESCE(?, deduct_excess_personal_leave),
                late_penalty_per_minute=COALESCE(?, late_penalty_per_minute),
                auto_deduct_tax=COALESCE(?, auto_deduct_tax), auto_deduct_sso=COALESCE(?, auto_deduct_sso),
                payroll_cutoff_date=COALESCE(?, payroll_cutoff_date),
                diligence_allowance=COALESCE(?, diligence_allowance),
                days_per_month=COALESCE(?, days_per_month),
                hours_per_day=COALESCE(?, hours_per_day),
                sso_rate=COALESCE(?, sso_rate),
                sso_max_amount=COALESCE(?, sso_max_amount),
                default_password=COALESCE(?, default_password),
                updated_at=CURRENT_TIMESTAMP
            WHERE id = 1
        `, [
            company_name, tax_id, address, deduct_excess_sick_leave, deduct_excess_personal_leave,
            late_penalty_per_minute, auto_deduct_tax, auto_deduct_sso, payroll_cutoff_date,
            diligence_allowance, days_per_month, hours_per_day, sso_rate, sso_max_amount,
            default_password
        ]);
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
                    d.name as department, e.base_salary as emp_base_salary,
                    s.name as company_name, s.address as company_address, s.tax_id as company_tax_id
            FROM payroll_records pr
            JOIN employees e ON pr.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN subsidiaries s ON e.company_id = s.id
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
                    tripAllowance: parseFloat(r.trip_allowance || 0),
                },
                deductions: {
                    tax: parseFloat(r.tax_deduction),
                    socialSecurity: parseFloat(r.sso_deduction),
                    latePenalty: parseFloat(r.late_deduction),
                    unpaidLeave: parseFloat(r.leave_deduction),
                },
                trip_count: parseInt(r.trip_count || 0),
                netSalary: parseFloat(r.net_salary),
                status: r.status,
                period: { month, year },
                company_name: r.company_name,
                company_address: r.company_address,
                company_tax_id: r.company_tax_id,
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
                   d.name as department, e.base_salary, e.shift_id,
                   e.spouse_allowance, e.children_count, e.parents_care_count,
                   e.health_insurance, e.life_insurance, e.pvf_rate, e.pvf_employer_rate,
                   s.name as company_name, s.address as company_address, s.tax_id as company_tax_id
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN subsidiaries s ON e.company_id = s.id
            WHERE e.status = 'active'
        `);

        // ดึง attendance และ OT
        const cutoffDay = settings.payroll_cutoff_date || 25;
        const { startDate, endDate } = getPayrollDateRange(month, year, cutoffDay);

        const [attendanceLogs] = await pool.query(`
            SELECT employee_id, SUM(late_minutes) as total_late_minutes,
                   COUNT(*) as work_days
            FROM attendance_logs
            WHERE check_in_time BETWEEN ? AND ?
            GROUP BY employee_id
        `, [startDate + ' 00:00:00', endDate + ' 23:59:59']);
        const attendanceMap = {};
        attendanceLogs.forEach(a => { attendanceMap[a.employee_id] = a; });

        const [otLogs] = await pool.query(`
            SELECT employee_id, multiplier, SUM(hours) as total_hours
            FROM overtime_requests
            WHERE status = 'approved' AND date BETWEEN ? AND ?
            GROUP BY employee_id, multiplier
        `, [startDate, endDate]);
        const otMap = {};
        otLogs.forEach(o => {
            if (!otMap[o.employee_id]) otMap[o.employee_id] = {};
            otMap[o.employee_id][o.multiplier] = parseFloat(o.total_hours);
        });

        // ดึงค่าเที่ยวสำหรับ Preview
        const [trips] = await pool.query(`
            SELECT employee_id, SUM(amount) as trip_total, COUNT(*) as trip_count
            FROM trip_logs
            WHERE (status = 'unpaid' OR payroll_id IS NULL OR payroll_id IN (SELECT id FROM payroll_records WHERE period_month=? AND period_year=?))
              AND trip_date BETWEEN ? AND ?
            GROUP BY employee_id
        `, [month, year, startDate, endDate]);
        const tripMap = {};
        trips.forEach(t => { tripMap[t.employee_id] = t; });

        // ดึง unpaid leave
        const [unpaidLeaves] = await pool.query(`
            SELECT lr.employee_id, SUM(lr.total_days) as unpaid_days
            FROM leave_requests lr
            JOIN leave_types lt ON lr.leave_type_id = lt.id
            WHERE lt.is_unpaid = 1 AND lr.status = 'approved'
              AND lr.start_date BETWEEN ? AND ?
            GROUP BY lr.employee_id
        `, [startDate, endDate]);
        const leaveMap = {};
        unpaidLeaves.forEach(l => { leaveMap[l.employee_id] = l; });

        const preview = employees.map(e => {
            const baseSalary = parseFloat(e.base_salary || 0);
            const att = attendanceMap[e.id];

            // OT
            const empOt = otMap[e.id] || {};
            const ot1_5_pay = calculateOTPay(baseSalary, empOt['1.5'] || 0, 1.5, settings);
            const ot2_pay = calculateOTPay(baseSalary, empOt['2.0'] || empOt['2'] || 0, 2.0, settings);
            const ot3_pay = calculateOTPay(baseSalary, empOt['3.0'] || empOt['3'] || 0, 3.0, settings);
            const totalOT = ot1_5_pay + ot2_pay + ot3_pay;

            // PVF
            const pvfEmployee = Math.floor(baseSalary * (parseFloat(e.pvf_rate || 0) / 100));
            const pvfEmployer = Math.floor(baseSalary * (parseFloat(e.pvf_employer_rate || 0) / 100));

            // ค่าปรับสาย
            const totalLateMinutes = att ? parseInt(att.total_late_minutes || 0) : 0;
            const latePenalty = Math.floor(totalLateMinutes * latePenaltyPerMin);

            // หักลา
            const lv = leaveMap[e.id];
            const unpaidDays = lv ? parseFloat(lv.unpaid_days || 0) : 0;
            const daysPerMonth = parseFloat(settings.days_per_month || 30);
            const unpaidLeaveDeduction = Math.floor((baseSalary / daysPerMonth) * unpaidDays);

            // เบี้ยขยัน (เงื่อนไขอัตโนมัติ: ไม่สาย และไม่มีลาไม่รับเงิน)
            const earnedDiligence = (totalLateMinutes === 0 && unpaidDays === 0) ? diligenceAllowance : 0;

            // ภาษี (PIT) - ส่ง allowances ไปคำนวณ
            const taxDeduction = autoDeductTax ? calculateIncomeTax(baseSalary, e, settings) : 0;
            const ssoDeduction = autoDeductSSO ? calculateSSO(baseSalary, settings) : 0;

            return {
                employeeId: e.employee_code,
                employee_id: e.id,
                name: e.name,
                department: e.department || 'ไม่ระบุ',
                baseSalary,
                earnings: {
                    overtime: totalOT,
                    bonus: 0,
                    diligenceAllowance: earnedDiligence,
                    tripAllowance: tripMap[e.id] ? parseFloat(tripMap[e.id].trip_total || 0) : 0,
                    ot1_5_pay,
                    ot2_pay,
                    ot3_pay
                },
                deductions: { tax: taxDeduction, socialSecurity: ssoDeduction, latePenalty, unpaidLeave: unpaidLeaveDeduction, pvfEmployee },
                pvfEmployer,
                trip_count: tripMap[e.id] ? parseInt(tripMap[e.id].trip_count || 0) : 0,
                netSalary: baseSalary + totalOT + earnedDiligence + (tripMap[e.id] ? parseFloat(tripMap[e.id].trip_total || 0) : 0) - taxDeduction - ssoDeduction - latePenalty - unpaidLeaveDeduction - pvfEmployee,
                status: 'draft',
                period: { month, year },
                isPreview: true,
                company_name: e.company_name,
                company_address: e.company_address,
                company_tax_id: e.company_tax_id,
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
        const monthStr = String(month).padStart(2, '0');
        const yearStr = String(year);

        const [settingsRows] = await pool.query('SELECT * FROM system_settings LIMIT 1');
        const settings = settingsRows[0] || {};
        const diligenceAllowance = parseFloat(settings.diligence_allowance || 0);
        const latePenaltyPerMin = parseFloat(settings.late_penalty_per_minute || 0);
        const autoDeductTax = settings.auto_deduct_tax !== 0;
        const autoDeductSSO = settings.auto_deduct_sso !== 0;

        const [employees] = await pool.query(`
            SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', e.last_name) as name,
                   d.name as department, e.base_salary,
                   e.spouse_allowance, e.children_count, e.parents_care_count,
                   e.health_insurance, e.life_insurance, e.pvf_rate, e.pvf_employer_rate
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE e.status = 'active'
        `);

        // Fetch Data Maps
        const cutoffDay = settings.payroll_cutoff_date || 25;
        const { startDate, endDate } = getPayrollDateRange(month, year, cutoffDay);

        const [attendanceLogs] = await pool.query(`
            SELECT employee_id, SUM(late_minutes) as total_late_minutes
            FROM attendance_logs
            WHERE check_in_time BETWEEN ? AND ?
            GROUP BY employee_id
        `, [startDate + ' 00:00:00', endDate + ' 23:59:59']);
        const attendanceMap = {};
        attendanceLogs.forEach(a => { attendanceMap[a.employee_id] = a; });

        const [otLogs] = await pool.query(`
            SELECT employee_id, multiplier, SUM(hours) as total_hours
            FROM overtime_requests
            WHERE status = 'approved' AND date BETWEEN ? AND ?
            GROUP BY employee_id, multiplier
        `, [startDate, endDate]);
        const otMap = {};
        otLogs.forEach(o => {
            if (!otMap[o.employee_id]) otMap[o.employee_id] = {};
            otMap[o.employee_id][o.multiplier] = parseFloat(o.total_hours);
        });

        const [claims] = await pool.query(`
            SELECT employee_id, SUM(amount) as total_claims
            FROM claims
            WHERE status = 'approved' AND (payroll_id IS NULL OR payroll_id IN (SELECT id FROM payroll_records WHERE period_month=? AND period_year=?))
              AND receipt_date BETWEEN ? AND ?
            GROUP BY employee_id
        `, [month, year, startDate, endDate]);
        const claimsMap = {};
        claims.forEach(c => { claimsMap[c.employee_id] = c; });

        const [unpaidLeaves] = await pool.query(`
            SELECT lr.employee_id, SUM(lr.total_days) as unpaid_days
            FROM leave_requests lr
            JOIN leave_types lt ON lr.leave_type_id = lt.id
            WHERE lt.is_unpaid = 1 AND lr.status = 'approved'
              AND lr.start_date BETWEEN ? AND ?
            GROUP BY lr.employee_id
        `, [startDate, endDate]);
        const leaveMap = {};
        unpaidLeaves.forEach(l => { leaveMap[l.employee_id] = l; });

        const [trips] = await pool.query(`
            SELECT employee_id, COUNT(*) as trip_count, SUM(amount) as trip_total
            FROM trip_logs
            WHERE (status = 'unpaid' OR payroll_id IS NULL OR payroll_id IN (SELECT id FROM payroll_records WHERE period_month=? AND period_year=?))
              AND trip_date BETWEEN ? AND ?
            GROUP BY employee_id
        `, [month, year, startDate, endDate]);
        const tripMap = {};
        trips.forEach(t => { tripMap[t.employee_id] = t; });

        let savedCount = 0;
        for (const e of employees) {
            const baseSalary = parseFloat(e.base_salary || 0);

            // OT Calculation
            const empOt = otMap[e.id] || {};
            const ot1_5_pay = calculateOTPay(baseSalary, empOt['1.5'] || 0, 1.5, settings);
            const ot2_pay = calculateOTPay(baseSalary, empOt['2.0'] || empOt['2'] || 0, 2.0, settings);
            const ot3_pay = calculateOTPay(baseSalary, empOt['3.0'] || empOt['3'] || 0, 3.0, settings);
            const totalOT = ot1_5_pay + ot2_pay + ot3_pay;

            // Health/Deductions
            const att = attendanceMap[e.id];
            const lateMinutes = att ? parseInt(att.total_late_minutes || 0) : 0;
            const latePenalty = Math.floor(lateMinutes * latePenaltyPerMin);
            const lv = leaveMap[e.id];
            const unpaidDays = lv ? parseFloat(lv.unpaid_days || 0) : 0;
            const daysPerMonth = parseFloat(settings.days_per_month || 30);
            const unpaidLeaveDeduction = Math.floor((baseSalary / daysPerMonth) * unpaidDays);

            const cl = claimsMap[e.id];
            const totalClaims = cl ? parseFloat(cl.total_claims || 0) : 0;
            const earnedDiligence = (lateMinutes === 0 && unpaidDays === 0) ? diligenceAllowance : 0;

            // PVF
            const pvfEmployee = Math.floor(baseSalary * (parseFloat(e.pvf_rate || 0) / 100));
            const pvfEmployer = Math.floor(baseSalary * (parseFloat(e.pvf_employer_rate || 0) / 100));

            // Tax & SSO
            const taxDeduction = autoDeductTax ? calculateIncomeTax(baseSalary, e, settings) : 0;
            const ssoDeduction = autoDeductSSO ? calculateSSO(baseSalary, settings) : 0;

            const tr = tripMap[e.id];
            const tripCount = tr ? parseInt(tr.trip_count || 0) : 0;
            const tripAllowanceTotal = tr ? parseFloat(tr.trip_total || 0) : 0;

            const netSalary = baseSalary + totalOT + earnedDiligence + totalClaims + tripAllowanceTotal - taxDeduction - ssoDeduction - latePenalty - unpaidLeaveDeduction - pvfEmployee;

            // Upsert
            await pool.query(
                'DELETE FROM payroll_records WHERE employee_id=? AND period_month=? AND period_year=?',
                [e.id, month, year]
            );
            const [payrollRes] = await pool.query(`
                INSERT INTO payroll_records 
                    (employee_id, period_month, period_year, base_salary, overtime_pay, bonus,
                     late_deduction, leave_deduction, tax_deduction, sso_deduction, diligence_allowance, claims_total, trip_count, trip_allowance, net_salary, 
                     pvf_employee_amount, pvf_employer_amount, ot_1_5_pay, ot_2_pay, ot_3_pay, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
            `, [e.id, month, year, baseSalary, totalOT, 0, latePenalty, unpaidLeaveDeduction, taxDeduction, ssoDeduction, earnedDiligence, totalClaims, tripCount, tripAllowanceTotal, netSalary,
                pvfEmployee, pvfEmployer, ot1_5_pay, ot2_pay, ot3_pay]);

            const payrollId = payrollRes.insertId;

            // Update trips status
            await pool.query(
                "UPDATE trip_logs SET payroll_id = ?, status = 'paid' WHERE employee_id = ? AND (status = 'unpaid' OR payroll_id IS NULL) AND DATE_FORMAT(trip_date, '%m') = ? AND DATE_FORMAT(trip_date, '%Y') = ?",
                [payrollId, e.id, monthStr, yearStr]
            );

            // Fix claims
            await pool.query(
                "UPDATE claims SET payroll_id = ?, status = 'paid' WHERE employee_id = ? AND status = 'approved' AND payroll_id IS NULL AND DATE_FORMAT(receipt_date, '%m') = ? AND DATE_FORMAT(receipt_date, '%Y') = ?",
                [payrollId, e.id, monthStr, yearStr]
            );

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

// GET ดึงข้อมูล attendance จาก DB
app.get('/api/attendance', async (req, res) => {
    try {
        const { month, year, employee_id, role } = req.query;
        let whereClause = 'WHERE 1=1';
        let params = [];

        if (month && year) {
            whereClause += ` AND DATE_FORMAT(al.check_in_time, '%m') = ? AND DATE_FORMAT(al.check_in_time, '%Y') = ?`;
            params.push(String(month).padStart(2, '0'), year);
        }

        if (role === 'employee' && employee_id) {
            whereClause += ' AND al.employee_id = ?';
            params.push(employee_id);
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

        // คำนวณ Summary สำหรับหน้า Admin (DataImport.tsx)
        const summaryMap = new Map();

        rows.forEach(log => {
            const key = log.employee_code;
            if (!summaryMap.has(key)) {
                summaryMap.set(key, {
                    employeeId: log.employee_code,
                    name: log.emp_name,
                    department: log.department || 'ไม่ระบุ',
                    workDays: 0,
                    weekdays: 0,
                    weekends: 0,
                    onTimeDays: 0,
                    lateCount: 0,
                    totalLateMinutes: 0
                });
            }

            const s = summaryMap.get(key);
            s.workDays++;

            // แยกวันธรรมดา/เสาร์-อาทิตย์
            const day = dayjs(log.check_in_time).day();
            if (day === 0 || day === 6) s.weekends++;
            else s.weekdays++;

            if (log.status === 'late') {
                s.lateCount++;
                s.totalLateMinutes += (log.late_minutes || 0);
            } else {
                s.onTimeDays++;
            }
        });

        res.json({
            logs: rows,
            summary: Array.from(summaryMap.values())
        });
    } catch (error) {
        console.error('Attendance error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/attendance/check-in', async (req, res) => {
    try {
        const { employee_id } = req.body;
        const today = dayjs().format('YYYY-MM-DD');

        // เช็คว่าเช็คอินไปยังวันนี้
        const [[exists]] = await pool.query("SELECT id FROM attendance_logs WHERE employee_id = ? AND DATE(check_in_time) = ?", [employee_id, today]);
        if (exists) return res.status(400).json({ error: 'วันนี้คุณได้บันทึกเวลาเข้างานไปแล้ว' });

        // เช็คเวลาสายจาก Shift
        const [[emp]] = await pool.query("SELECT e.shift_id, s.start_time, s.late_allowance_minutes FROM employees e JOIN shifts s ON e.shift_id = s.id WHERE e.id = ?", [employee_id]);

        let status = 'on_time';
        let lateMinutes = 0;

        if (emp && emp.start_time) {
            const now = dayjs();
            const shiftStart = dayjs(`${today} ${emp.start_time}`);
            const diff = now.diff(shiftStart, 'minute');
            if (diff > (emp.late_allowance_minutes || 0)) {
                status = 'late';
                lateMinutes = diff;
            }
        }

        await pool.query(
            "INSERT INTO attendance_logs (employee_id, check_in_time, status, late_minutes) VALUES (?, NOW(), ?, ?)",
            [employee_id, status, lateMinutes]
        );
        res.json({ message: 'ลงเวลาเข้างานเรียบร้อย' + (status === 'late' ? ` (สาย ${lateMinutes} นาที)` : '') });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/attendance/check-out', async (req, res) => {
    try {
        const { employee_id } = req.body;
        const today = dayjs().format('YYYY-MM-DD');
        const [[log]] = await pool.query("SELECT id FROM attendance_logs WHERE employee_id = ? AND DATE(check_in_time) = ? ORDER BY id DESC LIMIT 1", [employee_id, today]);

        if (!log) return res.status(400).json({ error: 'ไม่พบประวัติการลงเวลาเข้างานของวันนี้' });

        await pool.query("UPDATE attendance_logs SET check_out_time = NOW() WHERE id = ?", [log.id]);
        res.json({ message: 'ลงเวลาออกงานเรียบร้อย' });
    } catch (error) { res.status(500).json({ error: error.message }); }
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
// 💸 CLAIMS & REIMBURSEMENTS
// ─────────────────────────────────────────────
app.get('/api/claims', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT c.*, CONCAT(e.first_name, ' ', e.last_name) as employee_name, e.employee_code
            FROM claims c
            JOIN employees e ON c.employee_id = e.id
            ORDER BY c.receipt_date DESC
        `);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/claims', async (req, res) => {
    try {
        const { employee_id, claim_type, amount, receipt_date, description } = req.body;
        await pool.query(
            'INSERT INTO claims (employee_id, claim_type, amount, receipt_date, description) VALUES (?, ?, ?, ?, ?)',
            [employee_id, claim_type, amount, receipt_date, description]
        );
        res.status(201).json({ message: 'Claim submitted' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/claims/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        await pool.query('UPDATE claims SET status = ? WHERE id = ?', [status, req.params.id]);
        res.json({ message: `Claim ${status}` });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/claims/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM claims WHERE id = ?', [req.params.id]);
        res.json({ message: 'Claim deleted' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// 🚚 TRIP LOGS (บันทึกค่าเที่ยว)
// ─────────────────────────────────────────────
app.get('/api/trips', async (req, res) => {
    try {
        const { employee_id, month, year } = req.query;
        let sql = `SELECT t.*, CONCAT(e.first_name, ' ', e.last_name) as employee_name, e.employee_code
                   FROM trip_logs t
                   JOIN employees e ON t.employee_id = e.id`;
        const params = [];
        if (employee_id) { sql += ' WHERE t.employee_id = ?'; params.push(employee_id); }
        else if (month && year) {
            sql += " WHERE DATE_FORMAT(t.trip_date, '%m') = ? AND DATE_FORMAT(t.trip_date, '%Y') = ?";
            params.push(String(month).padStart(2, '0'), String(year));
        }
        sql += ' ORDER BY t.trip_date DESC';
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/trips', async (req, res) => {
    try {
        const { employee_id, trip_date, amount, notes } = req.body;
        await pool.query(
            'INSERT INTO trip_logs (employee_id, trip_date, amount, notes) VALUES (?, ?, ?, ?)',
            [employee_id, trip_date, amount, notes]
        );
        res.status(201).json({ message: 'Trip log saved' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/trips/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM trip_logs WHERE id = ?', [req.params.id]);
        res.json({ message: 'Trip log deleted' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// START SERVER + AUTO MIGRATION
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

async function runMigrations() {
    const migrations = [
        // 1. Core Structure
        `CREATE TABLE IF NOT EXISTS departments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS shifts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            start_time TIME NOT NULL,
            end_time TIME NOT NULL,
            late_allowance_minutes INT DEFAULT 0,
            color VARCHAR(20) DEFAULT 'blue',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS employees (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_code VARCHAR(50) UNIQUE NOT NULL,
            username VARCHAR(50) UNIQUE,
            password VARCHAR(255),
            role VARCHAR(20) DEFAULT 'employee',
            must_change_password TINYINT(1) DEFAULT 0,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            department_id INT,
            company_id INT,
            position VARCHAR(100),
            join_date DATE NOT NULL,
            status ENUM('active', 'inactive') DEFAULT 'active',
            shift_id INT,
            base_salary DECIMAL(10, 2) DEFAULT 0.00,
            phone VARCHAR(20),
            email VARCHAR(100),
            id_number VARCHAR(13) DEFAULT NULL,
            probation_end_date DATE,
            contract_end_date DATE,
            notes TEXT,
            reports_to INT DEFAULT NULL,
            spouse_allowance TINYINT(1) DEFAULT 0,
            children_count INT DEFAULT 0,
            parents_care_count INT DEFAULT 0,
            health_insurance DECIMAL(10,2) DEFAULT 0.00,
            life_insurance DECIMAL(10,2) DEFAULT 0.00,
            pvf_rate DECIMAL(5,2) DEFAULT 0.00,
            pvf_employer_rate DECIMAL(5,2) DEFAULT 0.00,
            trip_allowance DECIMAL(10,2) DEFAULT 0.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
            FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
            FOREIGN KEY (reports_to) REFERENCES employees(id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS leave_types (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL,
            is_unpaid BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS leave_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            leave_type_id INT NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            total_days DECIMAL(5, 2) NOT NULL,
            reason TEXT,
            status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            approved_by INT,
            approved_at TIMESTAMP NULL,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS system_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            company_name VARCHAR(255) NOT NULL,
            tax_id VARCHAR(50),
            address TEXT,
            deduct_excess_sick_leave BOOLEAN DEFAULT FALSE,
            deduct_excess_personal_leave BOOLEAN DEFAULT FALSE,
            late_penalty_per_minute DECIMAL(10, 2) DEFAULT 0.00,
            auto_deduct_tax BOOLEAN DEFAULT TRUE,
            auto_deduct_sso BOOLEAN DEFAULT TRUE,
            payroll_cutoff_date INT DEFAULT 25,
            diligence_allowance DECIMAL(10, 2) DEFAULT 0.00,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS attendance_logs (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            check_in_time DATETIME NULL,
            check_out_time DATETIME NULL,
            status ENUM('on_time', 'late', 'absent', 'half_day') DEFAULT 'on_time',
            late_minutes INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS payroll_records (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            period_month INT NOT NULL,
            period_year INT NOT NULL,
            base_salary DECIMAL(10, 2) NOT NULL,
            overtime_pay DECIMAL(10, 2) DEFAULT 0.00,
            bonus DECIMAL(10, 2) DEFAULT 0.00,
            late_deduction DECIMAL(10, 2) DEFAULT 0.00,
            leave_deduction DECIMAL(10, 2) DEFAULT 0.00,
            tax_deduction DECIMAL(10, 2) DEFAULT 0.00,
            sso_deduction DECIMAL(10, 2) DEFAULT 0.00,
            pvf_employee_amount DECIMAL(10,2) DEFAULT 0.00,
            pvf_employer_amount DECIMAL(10,2) DEFAULT 0.00,
            net_salary DECIMAL(10, 2) NOT NULL,
            ot_1_5_pay DECIMAL(10, 2) DEFAULT 0.00,
            ot_2_pay DECIMAL(10, 2) DEFAULT 0.00,
            ot_3_pay DECIMAL(10, 2) DEFAULT 0.00,
            status ENUM('draft', 'paid') DEFAULT 'draft',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(20) DEFAULT 'admin',
            name VARCHAR(100),
            email VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS public_holidays (
            id INT AUTO_INCREMENT PRIMARY KEY,
            holiday_date DATE NOT NULL UNIQUE,
            name VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,

        // 2. Initial Data
        `INSERT IGNORE INTO admins (username, password, name, role) VALUES ('admin', 'admin123', 'System Administrator', 'superadmin')`,
        `INSERT IGNORE INTO departments (name) VALUES ('HR'), ('IT Support'), ('Accounting'), ('Sales'), ('Marketing'), ('Warehouse'), ('Transport')`,
        `INSERT IGNORE INTO leave_types (name, is_unpaid) VALUES ('ลาป่วย (Sick Leave)', 0), ('ลากิจ (Personal Leave)', 0), ('ลาพักร้อน (Vacation)', 0), ('ลางานไม่รับค่าจ้าง (LWOP)', 1)`,
        `INSERT IGNORE INTO system_settings (id, company_name, tax_id, address, deduct_excess_sick_leave, deduct_excess_personal_leave, late_penalty_per_minute, payroll_cutoff_date, diligence_allowance)
         VALUES (1, 'บริษัท ตัวอย่าง จำกัด', '0123456789012', '123 ถ.สุขุมวิท กรุงเทพฯ', 1, 1, 10.00, 25, 500.00)`,

        `CREATE TABLE IF NOT EXISTS subsidiaries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            tax_id VARCHAR(50),
            address TEXT,
            logo_path VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id INT AFTER department_id`,
        `ALTER TABLE employees ADD FOREIGN KEY IF NOT EXISTS (company_id) REFERENCES subsidiaries(id) ON DELETE SET NULL`,
        // 3. Incremental Migrations
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS diligence_allowance DECIMAL(10,2) DEFAULT 0.00`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS diligence_allowance DECIMAL(10,2) DEFAULT 0.00`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS days_per_month INT DEFAULT 30`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS hours_per_day INT DEFAULT 8`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sso_rate DECIMAL(5,4) DEFAULT 0.05`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sso_max_amount DECIMAL(10,2) DEFAULT 750.00`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS tax_expense_rate DECIMAL(5,4) DEFAULT 0.5`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS tax_expense_max DECIMAL(10,2) DEFAULT 100000.00`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS tax_allowance_personal DECIMAL(10,2) DEFAULT 60000.00`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone VARCHAR(20) DEFAULT NULL`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS email VARCHAR(150) DEFAULT NULL`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS claims_total DECIMAL(10,2) DEFAULT 0.00`,
        `CREATE TABLE IF NOT EXISTS claims (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            claim_type VARCHAR(100) NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            receipt_date DATE NOT NULL,
            description TEXT,
            status VARCHAR(20) DEFAULT 'pending',
            payroll_id INT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end_date DATE DEFAULT NULL`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_end_date DATE DEFAULT NULL`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL`,
        `CREATE TABLE IF NOT EXISTS employee_documents (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            document_name VARCHAR(255) NOT NULL,
            file_path VARCHAR(255) NOT NULL,
            category VARCHAR(100),
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS disciplinary_records (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            type VARCHAR(100) NOT NULL,
            description TEXT,
            issued_at DATE NOT NULL,
            created_by INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS audit_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            action VARCHAR(100) NOT NULL,
            target_table VARCHAR(100),
            target_id INT,
            details JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_number VARCHAR(13) DEFAULT NULL`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS reports_to INT DEFAULT NULL REFERENCES employees(id) ON DELETE SET NULL`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS spouse_allowance TINYINT(1) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS children_count INT DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS parents_care_count INT DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS health_insurance DECIMAL(10,2) DEFAULT 0.00`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS life_insurance DECIMAL(10,2) DEFAULT 0.00`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS pvf_rate DECIMAL(5,2) DEFAULT 0.00`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS pvf_employer_rate DECIMAL(5,2) DEFAULT 0.00`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS pvf_employee_amount DECIMAL(10,2) DEFAULT 0.00`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS pvf_employer_amount DECIMAL(10,2) DEFAULT 0.00`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS trip_allowance DECIMAL(10, 2) DEFAULT 0.00`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS trip_count INT DEFAULT 0`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS trip_allowance DECIMAL(10, 2) DEFAULT 0.00`,
        `CREATE TABLE IF NOT EXISTS trip_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            trip_date DATE NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            notes TEXT,
            status VARCHAR(20) DEFAULT 'unpaid',
            payroll_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS trip_allowance DECIMAL(10, 2) DEFAULT 0.00`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS trip_count INT DEFAULT 0`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS trip_allowance DECIMAL(10, 2) DEFAULT 0.00`,
        `CREATE TABLE IF NOT EXISTS overtime_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            date DATE NOT NULL,
            hours DECIMAL(5,2) NOT NULL,
            multiplier DECIMAL(3,1) DEFAULT 1.5,
            reason TEXT,
            status VARCHAR(20) DEFAULT 'pending',
            approved_by INT,
            approved_at TIMESTAMP NULL,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS shift_schedules (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            shift_id INT NOT NULL,
            date DATE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
            UNIQUE(employee_id, date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS kpis (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            weight DECIMAL(5, 2) DEFAULT 1.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS performance_evaluations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            evaluator_id INT,
            period_name VARCHAR(100),
            score DECIMAL(5, 2),
            feedback TEXT,
            status VARCHAR(20) DEFAULT 'draft',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS assets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            category VARCHAR(50),
            serial_number VARCHAR(100) UNIQUE,
            status VARCHAR(20) DEFAULT 'available',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS employee_assets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            asset_id INT NOT NULL,
            assigned_at DATE NOT NULL,
            returned_at DATE NULL,
            note TEXT,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS pdpa_consents (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            consent_type VARCHAR(50) NOT NULL,
            status TINYINT(1) DEFAULT 1,
            consented_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS leave_quota_rules (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenure_years INT NOT NULL,
            vacation_days INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS employee_leave_quotas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            leave_type_id INT NOT NULL,
            quota_days DECIMAL(5, 2) DEFAULT 0.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE,
            UNIQUE(employee_id, leave_type_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `DELETE t1 FROM leave_types t1 JOIN leave_types t2 WHERE t1.id > t2.id AND t1.name = t2.name`,
        `ALTER TABLE leave_types ADD UNIQUE (name)`,
        `ALTER TABLE leave_requests MODIFY COLUMN status VARCHAR(50) DEFAULT 'รอหัวหน้าอนุมัติ'`,
        `ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approval_token VARCHAR(255) AFTER reason`,
        `ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS supervisor_approved_at TIMESTAMP NULL AFTER approved_at`,
        `ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_approved_at TIMESTAMP NULL AFTER supervisor_approved_at`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE AFTER employee_code`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS password VARCHAR(255) AFTER username`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'employee' AFTER password`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_password TINYINT(1) DEFAULT 0 AFTER role`,
        `UPDATE employees SET username = employee_code, password = 'Example123', must_change_password = 1 WHERE username IS NULL OR password IS NULL`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS ot_1_5_pay DECIMAL(10, 2) DEFAULT 0.00`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS ot_2_pay DECIMAL(10, 2) DEFAULT 0.00`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS ot_3_pay DECIMAL(10, 2) DEFAULT 0.00`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS trip_count INT DEFAULT 0`,
        `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS trip_allowance DECIMAL(10, 2) DEFAULT 0.00`,
        `ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS days_per_year DECIMAL(5, 2) DEFAULT 0.00 AFTER is_unpaid`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS days_per_month INT DEFAULT 30`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS hours_per_day INT DEFAULT 8`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sso_rate DECIMAL(5, 4) DEFAULT 0.05`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sso_max_amount DECIMAL(10, 2) DEFAULT 750.00`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS default_password VARCHAR(255) DEFAULT 'Example123'`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS payroll_cutoff_date INT DEFAULT 25`,
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

// TEST EMAIL ENDPOINT
app.get('/api/settings/test-email', async (req, res) => {
    try {
        console.log('--- Manual Email Test Triggered ---');
        const testUser = process.env.SMTP_USER;
        if (!testUser) throw new Error('SMTP_USER is not defined in environment variables.');

        await sendEmail(testUser, 'HR System: Test Email Connection', `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #1890ff;">การทดสอบระบบอีเมลสำเร็จ! 🎉</h2>
                <p>หากคุณได้รับข้อความนี้ แสดงว่าการตั้งค่า <b>SMTP</b> ของคุณถูกต้องแล้ว</p>
                <hr/>
                <p style="color: #8c8c8c; font-size: 12px;">ส่งจากระบบ Enterprise Leave Management</p>
            </div>
        `);
        res.json({ message: `ส่งเมลทดสอบไปยัง ${testUser} เรียบร้อยแล้ว กรุณาตรวจสอบ Inbox` });
    } catch (error) {
        console.error('Test Email Failed:', error.message);
        res.status(500).json({ error: `การทดสอบล้มเหลว: ${error.message}` });
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
// 📄 GOVERNMENT REPORTS (Tax & SSO)
// ─────────────────────────────────────────────

// 1. พ.ง.ด. 1 (Monthly Withholding Tax)
app.get('/api/reports/pnd1', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'กรุณาระบุเดือนและปี' });

        const [rows] = await pool.query(`
            SELECT pr.*, e.first_name, e.last_name, e.id_number, d.name as department
            FROM payroll_records pr
            JOIN employees e ON pr.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE pr.period_month = ? AND pr.period_year = ? AND pr.status = 'paid'
        `, [month, year]);

        const [settings] = await pool.query('SELECT * FROM system_settings LIMIT 1');
        const company = settings[0] || {};

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('PND1');

        sheet.columns = [
            { header: 'ลำดับ', key: 'idx', width: 5 },
            { header: 'เลขประจำตัวประจำตัวผู้เสียภาษี (ID Number)', key: 'id_number', width: 20 },
            { header: 'ชื่อ-นามสกุล', key: 'name', width: 25 },
            { header: 'เงินเดือน/เงินได้', key: 'income', width: 15 },
            { header: 'ภาษีที่หักไว้', key: 'tax', width: 15 },
            { header: 'เงื่อนไขหักภาษี', key: 'type', width: 10 },
        ];

        rows.forEach((r, i) => {
            sheet.addRow({
                idx: i + 1,
                id_number: r.id_number || '-',
                name: `${r.first_name} ${r.last_name}`,
                income: parseFloat(r.base_salary) + parseFloat(r.overtime_pay) + parseFloat(r.bonus),
                tax: parseFloat(r.tax_deduction),
                type: '1' // หัก ณ ที่จ่าย
            });
        });

        // Add Header rows for company info
        sheet.insertRow(1, ['รายงานภาษีเงินได้หัก ณ ที่จ่าย (พ.ง.ด. 1)']);
        sheet.insertRow(2, [`บริษัท: ${company.company_name || '-'}`, '', `Tax ID: ${company.tax_id || '-'}`]);
        sheet.insertRow(3, [`ประจำเดือน: ${month}/${year}`]);
        sheet.insertRow(4, []); // Empty

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=PND1_${month}_${year}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 2. สปส. 1-10 (Social Security Report)
app.get('/api/reports/sso', async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ error: 'กรุณาระบุเดือนและปี' });

        const [rows] = await pool.query(`
            SELECT pr.*, e.first_name, e.last_name, e.id_number
            FROM payroll_records pr
            JOIN employees e ON pr.employee_id = e.id
            WHERE pr.period_month = ? AND pr.period_year = ? AND pr.status = 'paid'
        `, [month, year]);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('SSO_1_10');

        sheet.columns = [
            { header: 'ลำดับ', key: 'idx', width: 5 },
            { header: 'เลขบัตรประชาชน', key: 'id_number', width: 20 },
            { header: 'ชื่อ-นามสกุล', key: 'name', width: 25 },
            { header: 'ค่าจ้าง (ไม่เกิน 15,000)', key: 'salary', width: 15 },
            { header: 'เงินสมทบ (5%)', key: 'sso', width: 15 },
        ];

        rows.forEach((r, i) => {
            const cappedSalary = Math.min(15000, parseFloat(r.base_salary));
            sheet.addRow({
                idx: i + 1,
                id_number: r.id_number || '-',
                name: `${r.first_name} ${r.last_name}`,
                salary: cappedSalary,
                sso: parseFloat(r.sso_deduction)
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=SSO_${month}_${year}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. ทวิ 50 (Annual Withholding Tax Certificate)
app.get('/api/reports/50tawi/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { year } = req.query;
        if (!year) return res.status(400).json({ error: 'กรุณาระบุปี' });

        const [records] = await pool.query(`
            SELECT SUM(base_salary + overtime_pay + bonus) as total_income,
                   SUM(tax_deduction) as total_tax,
                   SUM(sso_deduction) as total_sso
            FROM payroll_records
            WHERE employee_id = ? AND period_year = ? AND status = 'paid'
        `, [id, year]);

        const [[emp]] = await pool.query('SELECT * FROM employees WHERE id = ?', [id]);
        const [[company]] = await pool.query('SELECT * FROM system_settings LIMIT 1');

        if (!emp) return res.status(404).json({ error: 'พนักงานไม่พบ' });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('50Tawi');

        sheet.addRow(['หนังสือรับรองการหักภาษี ณ ที่จ่าย (ทวิ 50)']);
        sheet.addRow([`ประจำปีภาษี: ${year}`]);
        sheet.addRow([]);
        sheet.addRow(['ผู้มีหน้าที่หัก ณ ที่จ่าย (บริษัท)']);
        sheet.addRow([`ชื่อ: ${company?.company_name || '-'}`]);
        sheet.addRow([`เลขประจำตัวผู้เสียภาษี: ${company?.tax_id || '-'}`]);
        sheet.addRow([`ที่อยู่: ${company?.address || '-'}`]);
        sheet.addRow([]);
        sheet.addRow(['ผู้ถูกหัก ณ ที่จ่าย (พนักงาน)']);
        sheet.addRow([`ชื่อ: ${emp.first_name} ${emp.last_name}`]);
        sheet.addRow([`เลขประจำตัวประชาชน: ${emp.id_number || '-'}`]);
        sheet.addRow([]);
        sheet.addRow(['รายการเงินได้', 'จำนวนเงินที่จ่าย (บาท)', 'ภาษีที่หักและนำส่ง (บาท)']);
        sheet.addRow(['1. เงินเดือน ค่าจ้าง โบนัส ฯลฯ', records[0].total_income || 0, records[0].total_tax || 0]);
        sheet.addRow([]);
        sheet.addRow([`เงินสมทบกองทุนประกันสังคม: ${records[0].total_sso || 0} บาท`]);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=50Tawi_${emp.first_name}_${year}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) { res.status(500).json({ error: error.message }); }
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

app.get('/api/analytics/cost-summary', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT d.name as department, 
                   SUM(pr.base_salary + pr.overtime_pay + pr.bonus + pr.diligence_allowance + pr.claims_total) as total_cost,
                   SUM(pr.base_salary) as base_total,
                   SUM(pr.overtime_pay) as ot_total,
                   SUM(pr.claims_total) as claims_total
            FROM payroll_records pr
            JOIN employees e ON pr.employee_id = e.id
            JOIN departments d ON e.department_id = d.id
            WHERE pr.status = 'paid'
            GROUP BY d.name
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// HR ADMIN — ADVANCED FEATURES
// ─────────────────────────────────────────────

// Employee Admin Info (Probation, Contract, Notes)
app.put('/api/employees/:id/admin', async (req, res) => {
    try {
        const { probation_end_date, contract_end_date, notes } = req.body;
        await pool.query(
            'UPDATE employees SET probation_end_date=?, contract_end_date=?, notes=? WHERE id=?',
            [probation_end_date, contract_end_date, notes, req.params.id]
        );
        logAudit(null, 'UPDATE_ADMIN_INFO', 'employees', req.params.id, { probation_end_date, contract_end_date });
        res.json({ message: 'ข้อมูลแอดมินอัปเดตแล้ว' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Documents Management
app.post('/api/employees/:id/documents', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const { category } = req.body;
        const [result] = await pool.query(
            'INSERT INTO employee_documents (employee_id, document_name, file_path, category) VALUES (?, ?, ?, ?)',
            [req.params.id, req.file.originalname, req.file.path, category]
        );
        logAudit(null, 'UPLOAD_DOC', 'employee_documents', result.insertId, { filename: req.file.originalname });
        res.status(201).json({ message: 'อัปโหลดเอกสารสำเร็จ' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/employees/:id/documents', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM employee_documents WHERE employee_id=?', [req.params.id]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/documents/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT file_path FROM employee_documents WHERE id=?', [req.params.id]);
        if (rows.length > 0 && fs.existsSync(rows[0].file_path)) {
            fs.unlinkSync(rows[0].file_path);
        }
        await pool.query('DELETE FROM employee_documents WHERE id=?', [req.params.id]);
        logAudit(null, 'DELETE_DOC', 'employee_documents', req.params.id, {});
        res.json({ message: 'ลบเอกสารแล้ว' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Disciplinary Records
app.post('/api/employees/:id/disciplinary', async (req, res) => {
    try {
        const { type, description, issued_at } = req.body;
        const [result] = await pool.query(
            'INSERT INTO disciplinary_records (employee_id, type, description, issued_at) VALUES (?, ?, ?, ?)',
            [req.params.id, type, description, issued_at]
        );
        logAudit(null, 'ADD_DISCIPLINARY', 'disciplinary_records', result.insertId, { type });
        res.status(201).json({ message: 'บันทึกประวัติวินัยสำเร็จ' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/employees/:id/disciplinary', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM disciplinary_records WHERE employee_id=? ORDER BY issued_at DESC', [req.params.id]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Admin Alerts (Dashboard Notifications)
app.get('/api/admin/alerts', async (req, res) => {
    try {
        const today = dayjs().format('YYYY-MM-DD');
        const nextMonth = dayjs().add(30, 'day').format('YYYY-MM-DD');

        // Contract Expiry
        const [contracts] = await pool.query(
            'SELECT id, first_name, last_name, contract_end_date FROM employees WHERE contract_end_date BETWEEN ? AND ?',
            [today, nextMonth]
        );
        // Probation Expiry
        const [probations] = await pool.query(
            'SELECT id, first_name, last_name, probation_end_date FROM employees WHERE probation_end_date BETWEEN ? AND ?',
            [today, nextMonth]
        );
        // Pending Claims
        const [claims] = await pool.query('SELECT COUNT(*) as count FROM claims WHERE status="pending"');

        res.json({
            expiringContracts: contracts.map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name}`, date: c.contract_end_date })),
            expiringProbations: probations.map(p => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, date: p.probation_end_date })),
            pendingClaimsCount: claims[0].count
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Calendar Events
app.get('/api/admin/calendar', async (req, res) => {
    try {
        const events = [];

        const [emps] = await pool.query('SELECT id, first_name, last_name, join_date, probation_end_date, contract_end_date FROM employees WHERE status="active"');

        emps.forEach(e => {
            const name = `${e.first_name} ${e.last_name}`;
            if (e.join_date) {
                // Simplified anniversary for current year
                const joinDay = dayjs(e.join_date).format('MM-DD');
                const currYearJoin = `${dayjs().year()}-${joinDay}`;
                events.push({ date: currYearJoin, type: 'success', content: `ครบรอบเริ่มงาน: ${name}` });
            }
            if (e.probation_end_date) {
                events.push({ date: dayjs(e.probation_end_date).format('YYYY-MM-DD'), type: 'warning', content: `ครบโปร: ${name}` });
            }
            if (e.contract_end_date) {
                events.push({ date: dayjs(e.contract_end_date).format('YYYY-MM-DD'), type: 'error', content: `หมดสัญญา: ${name}` });
            }
        });

        // Leaves
        const [leaves] = await pool.query(`
            SELECT lr.start_date, lt.name as type_name, e.first_name, e.last_name 
            FROM leave_requests lr 
            JOIN leave_types lt ON lr.leave_type_id = lt.id 
            JOIN employees e ON lr.employee_id = e.id
            WHERE lr.status = 'approved'
        `);
        leaves.forEach(l => {
            events.push({ date: dayjs(l.start_date).format('YYYY-MM-DD'), type: 'processing', content: `ลา ${l.type_name}: ${l.first_name}` });
        });

        res.json(events);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Audit Logs
app.get('/api/admin/audit-logs', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
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
// ─────────────────────────────────────────────
// 🔐 AUTHENTICATION
// ─────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // 1. Check in admins table first
        const [admins] = await pool.query('SELECT * FROM admins WHERE username = ? AND password = ?', [username, password]);
        if (admins.length > 0) {
            const user = admins[0];
            delete user.password;
            return res.json({ user, message: 'เข้าสู่ระบบสำเร็จ (Admin)' });
        }

        // 2. Check in employees table
        const [employees] = await pool.query('SELECT * FROM employees WHERE (username = ? OR employee_code = ?) AND password = ?', [username, username, password]);
        if (employees.length > 0) {
            const employee = employees[0];
            delete employee.password;

            // Check if supervisor
            const [[isBoss]] = await pool.query('SELECT COUNT(*) as subordinates FROM employees WHERE reports_to = ?', [employee.id]);
            const role = isBoss.subordinates > 0 ? 'supervisor' : (employee.role || 'employee');

            return res.json({
                message: 'เข้าสู่ระบบสำเร็จ',
                user: {
                    id: employee.id,
                    username: employee.username,
                    name: `${employee.first_name} ${employee.last_name}`,
                    role: role,
                    employee_code: employee.employee_code,
                    must_change_password: !!employee.must_change_password
                }
            });
        }

        return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// 📈 PERFORMANCE MANAGEMENT
// ─────────────────────────────────────────────
app.get('/api/performance/kpis', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM kpis ORDER BY id ASC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/performance/kpis', async (req, res) => {
    try {
        const { name, description, weight } = req.body;
        const [result] = await pool.query('INSERT INTO kpis (name, description, weight) VALUES (?, ?, ?)', [name, description, weight]);
        res.status(201).json({ id: result.insertId });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/performance/evaluations', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT pe.*, CONCAT(e.first_name, ' ', e.last_name) as employee_name, a.name as evaluator_name
            FROM performance_evaluations pe
            JOIN employees e ON pe.employee_id = e.id
            LEFT JOIN admins a ON pe.evaluator_id = a.id
            ORDER BY pe.created_at DESC
        `);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/performance/evaluations', async (req, res) => {
    try {
        const { employee_id, evaluator_id, period_name, score, feedback, status } = req.body;
        const [result] = await pool.query(
            'INSERT INTO performance_evaluations (employee_id, evaluator_id, period_name, score, feedback, status) VALUES (?, ?, ?, ?, ?, ?)',
            [employee_id, evaluator_id, period_name, score, feedback, status || 'draft']
        );
        res.status(201).json({ id: result.insertId });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// 📂 ASSET MANAGEMENT
// ─────────────────────────────────────────────
app.get('/api/assets', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM assets ORDER BY id DESC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/assets', async (req, res) => {
    try {
        const { name, category, serial_number, status } = req.body;
        const [result] = await pool.query('INSERT INTO assets (name, category, serial_number, status) VALUES (?, ?, ?, ?)', [name, category, serial_number, status || 'available']);
        res.status(201).json({ id: result.insertId });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/assets/assignments', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT ea.*, e.first_name, e.last_name, a.name as asset_name, a.category as asset_category, a.serial_number
            FROM employee_assets ea
            JOIN employees e ON ea.employee_id = e.id
            JOIN assets a ON ea.asset_id = a.id
            ORDER BY ea.assigned_at DESC
        `);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/assets/assignments', async (req, res) => {
    try {
        const { employee_id, asset_id, assigned_at, note } = req.body;
        const [result] = await pool.query(
            'INSERT INTO employee_assets (employee_id, asset_id, assigned_at, note) VALUES (?, ?, ?, ?)',
            [employee_id, asset_id, assigned_at, note]
        );
        await pool.query('UPDATE assets SET status = "assigned" WHERE id = ?', [asset_id]);
        res.status(201).json({ id: result.insertId });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// 📂 PDPA COMPLIANCE
// ─────────────────────────────────────────────
app.get('/api/pdpa/consents', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT c.*, CONCAT(e.first_name, ' ', e.last_name) as employee_name
            FROM pdpa_consents c
            JOIN employees e ON c.employee_id = e.id
            ORDER BY c.consented_at DESC
        `);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/pdpa/consents', async (req, res) => {
    try {
        const { employee_id, consent_type, status } = req.body;
        await pool.query('INSERT INTO pdpa_consents (employee_id, consent_type, status) VALUES (?, ?, ?)', [employee_id, consent_type, status]);
        res.status(201).json({ message: 'บันทึกความยินยอมเสร็จสิ้น' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─────────────────────────────────────────────
// 🌳 ORG CHART
// ─────────────────────────────────────────────
app.get('/api/org-chart', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT id, first_name, last_name, position, reports_to, department_id 
            FROM employees 
            WHERE status = 'active'
        `);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ... rest of the file ...
