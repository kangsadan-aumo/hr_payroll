-- HR Payroll System Database Schema
-- Designed for MariaDB / MySQL

-- Create and select the database
CREATE DATABASE IF NOT EXISTS `hr-payroll-db`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `hr-payroll-db`;

-- 1. Departments Table
CREATE TABLE IF NOT EXISTS departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subsidiaries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50),
    address TEXT,
    logo_path VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Shifts Table (กะการทำงาน)
CREATE TABLE IF NOT EXISTS shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    late_allowance_minutes INT DEFAULT 0,
    color VARCHAR(20) DEFAULT 'blue',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Employees Table
CREATE TABLE IF NOT EXISTS employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_code VARCHAR(50) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE,
    password VARCHAR(255),
    role VARCHAR(20) DEFAULT 'employee',
    must_change_password TINYINT(1) DEFAULT 1,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    department_id INT,
    company_id INT,
    position VARCHAR(100),
    join_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    shift_id INT,
    base_salary DECIMAL(10, 2) DEFAULT 0.00,
    phone VARCHAR(20) DEFAULT NULL,
    email VARCHAR(150) DEFAULT NULL,
    probation_end_date DATE,
    contract_end_date DATE,
    notes TEXT,
    id_number VARCHAR(20),
    spouse_allowance DECIMAL(10, 2) DEFAULT 0,
    children_count INT DEFAULT 0,
    parents_care_count INT DEFAULT 0,
    health_insurance DECIMAL(10, 2) DEFAULT 0,
    life_insurance DECIMAL(10, 2) DEFAULT 0,
    pvf_rate DECIMAL(5, 4) DEFAULT 0,
    pvf_employer_rate DECIMAL(5, 4) DEFAULT 0,
    reports_to INT,
    trip_allowance DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
    FOREIGN KEY (reports_to) REFERENCES employees(id) ON DELETE SET NULL,
    FOREIGN KEY (company_id) REFERENCES subsidiaries(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Leave Types (ประเภทการลา)
CREATE TABLE IF NOT EXISTS leave_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_unpaid TINYINT(1) DEFAULT 0,
    days_per_year DECIMAL(5, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Leave Requests (คำขอการลา)
CREATE TABLE IF NOT EXISTS leave_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    leave_type_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days DECIMAL(5, 2) NOT NULL,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_by INT,
    approved_at TIMESTAMP NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Leave Quota Rules (สิทธิ์การลาตามอายุงาน)
CREATE TABLE IF NOT EXISTS leave_quota_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenure_years INT NOT NULL,
    vacation_days INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. System Settings (ตั้งค่าบริษัทและการหักเงิน)
CREATE TABLE IF NOT EXISTS system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50),
    address TEXT,
    deduct_excess_sick_leave TINYINT(1) DEFAULT 0,
    deduct_excess_personal_leave TINYINT(1) DEFAULT 0,
    late_penalty_per_minute DECIMAL(10, 2) DEFAULT 0.00,
    auto_deduct_tax TINYINT(1) DEFAULT 1,
    auto_deduct_sso TINYINT(1) DEFAULT 1,
    payroll_cutoff_date INT DEFAULT 25,
    diligence_allowance DECIMAL(10, 2) DEFAULT 0.00,
    days_per_month INT DEFAULT 30,
    hours_per_day INT DEFAULT 8,
    sso_rate DECIMAL(5, 4) DEFAULT 0.05,
    sso_max_amount DECIMAL(10, 2) DEFAULT 750.00,
    default_password VARCHAR(255) DEFAULT 'Example123',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Attendance Logs (ข้อมูลเข้า-ออกงาน)
CREATE TABLE IF NOT EXISTS attendance_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    check_in_time TIMESTAMP NULL,
    check_out_time TIMESTAMP NULL,
    status VARCHAR(20) DEFAULT 'on_time',
    late_minutes INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. Payroll Records (ประวัติการจ่ายเงินเดือน)
CREATE TABLE IF NOT EXISTS payroll_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    period_month INT NOT NULL,
    period_year INT NOT NULL,
    base_salary DECIMAL(10, 2) NOT NULL,
    overtime_pay DECIMAL(10, 2) DEFAULT 0.00,
    bonus DECIMAL(10, 2) DEFAULT 0.00,
    diligence_allowance DECIMAL(10, 2) DEFAULT 0.00,
    late_deduction DECIMAL(10, 2) DEFAULT 0.00,
    leave_deduction DECIMAL(10, 2) DEFAULT 0.00,
    tax_deduction DECIMAL(10, 2) DEFAULT 0.00,
    sso_deduction DECIMAL(10, 2) DEFAULT 0.00,
    net_salary DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. Public Holidays (วันหยุดนักขัตฤกษ์)
CREATE TABLE IF NOT EXISTS public_holidays (
    id INT AUTO_INCREMENT PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 11. Employee Leave Quotas (โควตาวันลาสำหรับพนักงานแต่ละคน)
CREATE TABLE IF NOT EXISTS employee_leave_quotas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    leave_type_id INT NOT NULL,
    quota_days DECIMAL(5, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE,
    UNIQUE(employee_id, leave_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert Default Data
INSERT INTO departments (name) VALUES
    ('HR'), ('IT Support'), ('Accounting'), ('Sales'), ('Marketing'), ('Warehouse'), ('Transport');

INSERT INTO leave_types (name, is_unpaid) VALUES
    ('ลาป่วย (Sick Leave)', 0),
    ('ลากิจ (Personal Leave)', 0),
    ('ลาพักร้อน (Vacation)', 0),
    ('ลางานไม่รับค่าจ้าง (LWOP)', 1);

INSERT INTO leave_quota_rules (tenure_years, vacation_days) VALUES
    (1, 6), (2, 7), (3, 8), (4, 9), (5, 10);

INSERT INTO system_settings (company_name, tax_id, address, deduct_excess_sick_leave, deduct_excess_personal_leave, late_penalty_per_minute, payroll_cutoff_date)
VALUES ('บริษัท ทดสอบ จำกัด', '0123456789012', '123 ถ.สุขุมวิท กรุงเทพฯ', 1, 1, 10.00, 25);

-- 12. Admins Table
CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'admin',
    name VARCHAR(100),
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 13. KPIs & OKRs
CREATE TABLE IF NOT EXISTS kpis (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    weight DECIMAL(5, 2) DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS performance_evaluations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    evaluator_id INT,
    period_name VARCHAR(100), -- e.g., 'Q1 2024', 'Annual 2024'
    score DECIMAL(5, 2),
    feedback TEXT,
    status VARCHAR(20) DEFAULT 'draft', -- draft, completed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (evaluator_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 14. Asset Management
CREATE TABLE IF NOT EXISTS assets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50), -- Laptop, Mobile, Uniform, etc.
    serial_number VARCHAR(100) UNIQUE,
    status VARCHAR(20) DEFAULT 'available', -- available, assigned, maintenance, broken
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS employee_assets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    asset_id INT NOT NULL,
    assigned_at DATE NOT NULL,
    returned_at DATE NULL,
    note TEXT,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 15. PDPA Compliance
CREATE TABLE IF NOT EXISTS pdpa_consents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    consent_type VARCHAR(50) NOT NULL, -- personal_data, marketing, etc.
    status TINYINT(1) DEFAULT 1, -- 1=consented, 0=revoked
    consented_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- Default Admin
INSERT INTO admins (username, password, name, role) VALUES ('admin', 'admin123', 'System Administrator', 'superadmin');
