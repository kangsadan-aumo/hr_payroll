import { useState } from 'react';
import { MainLayout } from './MainLayout';
import { Dashboard } from './Dashboard';
import { DataImport } from './DataImport';
import { Payroll } from './Payroll';
import { PayrollHistory } from './PayrollHistory';
import { Settings } from './Settings';
import { Employees } from './Employees';
import { Leave } from './Leave';
import './App.css';

function App() {
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [payrollMonth, setPayrollMonth] = useState<{ month: number; year: number } | null>(null);

  const handleViewPayroll = (month: number, year: number) => {
    setPayrollMonth({ month, year });
    setActiveMenu('payroll');
  };

  const renderContent = () => {
    switch (activeMenu) {
      case 'dashboard':
        return <Dashboard />;
      case 'import':
        return <DataImport />;
      case 'employees':
        return <Employees />;
      case 'leave':
        return <Leave />;
      case 'payroll':
        return <Payroll initialMonth={payrollMonth} />;
      case 'payroll-history':
        return <PayrollHistory onViewPayroll={handleViewPayroll} />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <MainLayout activeMenu={activeMenu} onMenuClick={setActiveMenu}>
      {renderContent()}
    </MainLayout>
  );
}

export default App;
