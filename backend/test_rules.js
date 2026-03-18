import mysql from 'mysql2/promise';

async function testDB() {
    try {
        const pool = mysql.createPool({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'hr-payroll-db',
            port: 3306
        });

        const [rows] = await pool.query('SELECT * FROM leave_quota_rules');
        console.log('leave_quota_rules rows:', rows.length);
        
        const [rows2] = await pool.query('SELECT * FROM employee_leave_quotas');
        console.log('employee_leave_quotas rows:', rows2.length);
        
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}
testDB();
