import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hr-payroll-db',
        port: parseInt(process.env.DB_PORT) || 3306,
    });

    try {
        console.log('Testing employee query...');
        const [employees] = await pool.query(`
            SELECT e.*, d.name AS department_name, c.name AS company_name,
            m.first_name AS manager_name_first, m.last_name AS manager_name_last,
            e.username, e.must_change_password
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN subsidiaries c ON e.company_id = c.id
            LEFT JOIN employees m ON e.reports_to = m.id
        `);
        console.log('✅ Success! Found', employees.length, 'employees.');
    } catch (err) {
        console.error('❌ Query failed:', err.message);
    } finally {
        await pool.end();
    }
}

check();
