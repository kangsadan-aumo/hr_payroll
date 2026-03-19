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
        dateStrings: true // This will return dates as strings instead of parsing, which avoids the crash
    });

    try {
        const [employees] = await pool.query('SELECT * FROM employees');
        console.log('Successfully fetched', employees.length, 'employees with dateStrings: true');
        
        // Let's try to parse them manually to find the culprit
        let count = 0;
        for (const emp of employees) {
            for (const [key, value] of Object.entries(emp)) {
                if (key.includes('date') || key.includes('at')) {
                    if (value === '0000-00-00' || value === '0000-00-00 00:00:00') {
                        console.log('Found zero-date in column:', key, 'row ID:', emp.id);
                        count++;
                    }
                }
            }
        }
        console.log('Total zero-dates found:', count);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

check();
