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
        console.log('--- Migrating Database (Password Reset Flag) ---');
        
        const [empColumns] = await connection.query("SHOW COLUMNS FROM employees");
        const hasMustChange = empColumns.some(c => c.Field === 'must_change_password');
        
        if (!hasMustChange) {
            await connection.query("ALTER TABLE employees ADD COLUMN must_change_password TINYINT(1) DEFAULT 0 AFTER role");
            console.log('Added must_change_password to employees');
        }
        
        console.log('--- Migration Completed Successfully ---');

    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        await connection.end();
    }
}

migrate();
