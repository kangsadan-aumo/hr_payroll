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
        // dateStrings: false // Default
    });

    try {
        console.log('Fetching without dateStrings...');
        const [employees] = await pool.query('SELECT * FROM employees');
        console.log('Success! Fetch returned', employees.length, 'employees.');
    } catch (err) {
        console.error('❌ Query failed:', err.message);
        console.error('Error Code:', err.code);
        console.error('Stack:', err.stack);
    } finally {
        await pool.end();
    }
}

check();
