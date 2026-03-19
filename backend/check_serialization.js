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
        const [employees] = await pool.query('SELECT * FROM employees');
        if (employees.length > 0) {
            const firstRow = employees[0];
            for (const [key, value] of Object.entries(firstRow)) {
                if (typeof value === 'bigint') {
                    console.log('Found BigInt in column:', key, 'value:', value.toString());
                } else {
                    try {
                        JSON.stringify(value);
                    } catch (e) {
                        console.log('Unserializable value in column:', key, 'type:', typeof value);
                    }
                }
            }
        }
        console.log('Check finished.');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

check();
