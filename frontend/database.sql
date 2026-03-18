-- HR Payroll System Database Schema (Production Ready)
-- Designed for MySQL / MariaDB / TiDB

-- 1. Departments Table
CREATE TABLE IF NOT EXISTS `departments` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Shifts Table
CREATE TABLE IF NOT EXISTS `shifts` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `start_time` TIME NOT NULL,
    `end_time` TIME NOT NULL,
    `late_allowance_minutes` INT DEFAULT 0,
    `color` VARCHAR(20) DEFAULT 'blue',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. Employees Table
CREATE TABLE IF NOT EXISTS `employees` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `employee_code` VARCHAR(50) UNIQUE NOT NULL,
    `first_name` VARCHAR(100) NOT NULL,
    `last_name` VARCHAR(100) NOT NULL,
    `department_id` INT,
    `position` VARCHAR(100),
    `join_date` DATE NOT NULL,
    `status` ENUM('active', 'inactive') DEFAULT 'active',
    `shift_id` INT,
    `base_salary` DECIMAL(10, 2) DEFAULT 0.00,
    `id_number` VARCHAR(13) DEFAULT NULL,
    `reports_to` INT DEFAULT NULL,
    `spouse_allowance` TINYINT(1) DEFAULT 0,
    `children_count` INT DEFAULT 0,
    `parents_care_count` INT DEFAULT 0,
    `health_insurance` DECIMAL(10,2) DEFAULT 0.00,
    `life_insurance` DECIMAL(10,2) DEFAULT 0.00,
    `pvf_rate` DECIMAL(5,2) DEFAULT 0.00,
    `pvf_employer_rate` DECIMAL(5,2) DEFAULT 0.00,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL,
    FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON DELETE SET NULL,
    FOREIGN KEY (`reports_to`) REFERENCES `employees`(`id`) ON DELETE SET NULL
);

-- 4. Admins Table
CREATE TABLE IF NOT EXISTS `admins` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(50) UNIQUE NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `role` VARCHAR(20) DEFAULT 'admin',
    `name` VARCHAR(100),
    `email` VARCHAR(100),
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Leave Types
CREATE TABLE IF NOT EXISTS `leave_types` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `is_unpaid` BOOLEAN DEFAULT FALSE,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Leave Requests
CREATE TABLE IF NOT EXISTS `leave_requests` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `employee_id` INT NOT NULL,
    `leave_type_id` INT NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `total_days` DECIMAL(5, 2) NOT NULL,
    `reason` TEXT,
    `status` ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    `submitted_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `approved_by` INT,
    `approved_at` TIMESTAMP NULL,
    FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE CASCADE
);

-- 7. System Settings
CREATE TABLE IF NOT EXISTS `system_settings` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `company_name` VARCHAR(255) NOT NULL,
    `tax_id` VARCHAR(50),
    `address` TEXT,
    `deduct_excess_sick_leave` BOOLEAN DEFAULT FALSE,
    `deduct_excess_personal_leave` BOOLEAN DEFAULT FALSE,
    `late_penalty_per_minute` DECIMAL(10, 2) DEFAULT 0.00,
    `auto_deduct_tax` BOOLEAN DEFAULT TRUE,
    `auto_deduct_sso` BOOLEAN DEFAULT TRUE,
    `payroll_cutoff_date` INT DEFAULT 25,
    `diligence_allowance` DECIMAL(10, 2) DEFAULT 0.00,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 8. Attendance Logs
CREATE TABLE IF NOT EXISTS `attendance_logs` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `employee_id` INT NOT NULL,
    `check_in_time` DATETIME NULL,
    `check_out_time` DATETIME NULL,
    `status` ENUM('on_time', 'late', 'absent', 'half_day') DEFAULT 'on_time',
    `late_minutes` INT DEFAULT 0,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE
);

-- 9. Payroll Records
CREATE TABLE IF NOT EXISTS `payroll_records` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `employee_id` INT NOT NULL,
    `period_month` INT NOT NULL,
    `period_year` INT NOT NULL,
    `base_salary` DECIMAL(10, 2) NOT NULL,
    `overtime_pay` DECIMAL(10, 2) DEFAULT 0.00,
    `bonus` DECIMAL(10, 2) DEFAULT 0.00,
    `late_deduction` DECIMAL(10, 2) DEFAULT 0.00,
    `leave_deduction` DECIMAL(10, 2) DEFAULT 0.00,
    `tax_deduction` DECIMAL(10, 2) DEFAULT 0.00,
    `sso_deduction` DECIMAL(10, 2) DEFAULT 0.00,
    `pvf_employee_amount` DECIMAL(10,2) DEFAULT 0.00,
    `pvf_employer_amount` DECIMAL(10,2) DEFAULT 0.00,
    `net_salary` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('draft', 'paid') DEFAULT 'draft',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE
);

-- 10. Performance & KPIs
CREATE TABLE IF NOT EXISTS `kpis` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL,
    `description TEXT`,
    `weight` DECIMAL(5, 2) DEFAULT 1.0,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `performance_evaluations` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `employee_id` INT NOT NULL,
    `evaluator_id` INT,
    `period_name` VARCHAR(100),
    `score` DECIMAL(5, 2),
    `feedback` TEXT,
    `status` VARCHAR(20) DEFAULT 'draft',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE
);

-- 11. Assets Management
CREATE TABLE IF NOT EXISTS `assets` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL,
    `category` VARCHAR(50),
    `serial_number` VARCHAR(100) UNIQUE,
    `status` VARCHAR(20) DEFAULT 'available',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `employee_assets` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `employee_id` INT NOT NULL,
    `asset_id` INT NOT NULL,
    `assigned_at` DATE NOT NULL,
    `returned_at` DATE NULL,
    `note` TEXT,
    FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE
);

-- 12. PDPA Consents
CREATE TABLE IF NOT EXISTS `pdpa_consents` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `employee_id` INT NOT NULL,
    `consent_type` VARCHAR(50) NOT NULL,
    `status` TINYINT(1) DEFAULT 1,
    `consented_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE
);

-- Initial Data
INSERT IGNORE INTO `admins` (username, password, name, role) VALUES ('admin', 'admin123', 'System Administrator', 'superadmin');
INSERT IGNORE INTO `departments` (`name`) VALUES ('HR'), ('IT Support'), ('Accounting'), ('Sales'), ('Marketing'), ('Warehouse'), ('Transport');
INSERT IGNORE INTO `leave_types` (`name`, `is_unpaid`) VALUES ('ลาป่วย (Sick Leave)', 0), ('ลากิจ (Personal Leave)', 0), ('ลาพักร้อน (Vacation)', 0), ('ลางานไม่รับค่าจ้าง (LWOP)', 1);
INSERT IGNORE INTO `system_settings` (id, company_name, tax_id, address, deduct_excess_sick_leave, deduct_excess_personal_leave, late_penalty_per_minute, payroll_cutoff_date, diligence_allowance)
VALUES (1, 'บริษัท ตัวอย่าง จำกัด', '0123456789012', '123 ถ.สุขุมวิท กรุงเทพฯ', 1, 1, 10.00, 25, 500.00);
