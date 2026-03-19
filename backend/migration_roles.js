import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hr-payroll-db',
        port: parseInt(process.env.DB_PORT) || 3306,
    });

    try {
        console.log('--- Migrating Database ---');
        
        // 1. Update employees table for login and roles
        const [empColumns] = await connection.query("SHOW COLUMNS FROM employees");
        const hasUsername = empColumns.some(c => c.Field === 'username');
        const hasPassword = empColumns.some(c => c.Field === 'password');
        const hasRole = empColumns.some(c => c.Field === 'role');
        
        if (!hasUsername) {
            await connection.query("ALTER TABLE employees ADD COLUMN username VARCHAR(50) UNIQUE AFTER employee_code");
            await connection.query("UPDATE employees SET username = employee_code");
            console.log('Added username to employees');
        }
        
        if (!hasPassword) {
            await connection.query("ALTER TABLE employees ADD COLUMN password VARCHAR(255) AFTER username");
            await connection.query("UPDATE employees SET password = 'password123'"); // Initial default password
            console.log('Added password to employees');
        }
        
        if (!hasRole) {
            await connection.query("ALTER TABLE employees ADD COLUMN role VARCHAR(20) DEFAULT 'employee' AFTER password");
            console.log('Added role to employees');
        }

        // 2. Update leave_requests table statuses if needed (current status is VARCHAR(20))
        // The user wants: "รอหัวหน้าอนุมัติ", "รอhrอนุมัติ", "เสร็จสิ้น", "ยกเลิกโดยhr", "ยกเลิกโดยพนักงาน"
        // Let's ensure statuses are okay with 40 chars just in case (e.g. pending_supervisor, approved_hr, cancelled_employee, etc.)
        await connection.query("ALTER TABLE leave_requests MODIFY COLUMN status VARCHAR(50) DEFAULT 'pending_supervisor'");
        
        // Add approver log columns
        const [lrColumns] = await connection.query("SHOW COLUMNS FROM leave_requests");
        if (!lrColumns.some(c => c.Field === 'supervisor_id')) {
            await connection.query("ALTER TABLE leave_requests ADD COLUMN supervisor_id INT AFTER approved_by");
        }
        if (!lrColumns.some(c => c.Field === 'supervisor_approved_at')) {
            await connection.query("ALTER TABLE leave_requests ADD COLUMN supervisor_approved_at TIMESTAMP NULL AFTER approved_at");
        }
        if (!lrColumns.some(c => c.Field === 'hr_approved_at')) {
            await connection.query("ALTER TABLE leave_requests ADD COLUMN hr_approved_at TIMESTAMP NULL AFTER supervisor_approved_at");
        }
        if (!lrColumns.some(c => c.Field === 'approval_token')) {
            await connection.query("ALTER TABLE leave_requests ADD COLUMN approval_token VARCHAR(255) AFTER status");
        }
        
        console.log('Updated leave_requests table');

        // 3. Update existing admins to include a role if not present or make sure it maps well.
        // Admins table already has role.
        
        console.log('--- Migration Completed Successfully ---');

    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        await connection.end();
    }
}

migrate();
