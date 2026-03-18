import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function cleanDB() {
    try {
        const pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'hr-payroll-db',
            port: 3306
        });

        console.log('Finding duplicate leave types...');
        const [rows] = await pool.query('SELECT name, MIN(id) as keep_id FROM leave_types GROUP BY name HAVING COUNT(*) > 1');
        
        for (const row of rows) {
            console.log(`Deleting duplicates for: ${row.name}, keeping ID: ${row.keep_id}`);
            // Update leave_requests or employee_leave_quotas that might point to the deleted ones to point to keep_id
            await pool.query('UPDATE leave_requests SET leave_type_id = ? WHERE leave_type_id IN (SELECT id FROM leave_types WHERE name = ? AND id != ?)', [row.keep_id, row.name, row.keep_id]);
            await pool.query('UPDATE employee_leave_quotas SET leave_type_id = ? WHERE leave_type_id IN (SELECT id FROM leave_types WHERE name = ? AND id != ?)', [row.keep_id, row.name, row.keep_id]);
            
            // Delete the duplicates
            await pool.query('DELETE FROM leave_types WHERE name = ? AND id != ?', [row.name, row.keep_id]);
        }
        
        // Try adding unique constraint
        try {
            await pool.query('ALTER TABLE leave_types ADD UNIQUE (name)');
            console.log('Added unique constraint to leave_types.name');
        } catch (e) {
            console.log('Unique constraint already exists or could not be added:', e.message);
        }

        console.log('Cleanup complete.');
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}
cleanDB();
