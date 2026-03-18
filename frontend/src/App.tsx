import { useState, useEffect } from 'react';
import { MainLayout } from './MainLayout';
import { Dashboard } from './Dashboard';
import { DataImport } from './DataImport';
import { Payroll } from './Payroll';
import { PayrollHistory } from './PayrollHistory';
import { Settings } from './Settings';
import { Employees } from './Employees';
import { Leave } from './Leave';
import { Claims } from './Claims';
import { GovReports } from './GovReports';
import { Performance } from './Performance';
import { Assets } from './Assets';
import { OrgChart } from './OrgChart';
import { HRCalendarView } from './HRCalendarView';
import { Login } from './Login';
import './App.css';

function App() {
  const [user, setUser] = useState<any>(null);
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [payrollMonth, setPayrollMonth] = useState<{ month: number; year: number } | null>(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('hr_user');
    if (savedUser) setUser(JSON.parse(savedUser));
  }, []);

  const handleLoginSuccess = (userData: any) => {
    setUser(userData);
    localStorage.setItem('hr_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('hr_user');
  };

  const handleViewPayroll = (month: number, year: number) => {
    setPayrollMonth({ month, year });
    setActiveMenu('payroll');
  };

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const renderContent = () => {
    switch (activeMenu) {
      case 'dashboard':
        return <Dashboard onNavigate={setActiveMenu} />;
      case 'import':
        return <DataImport />;
      case 'employees':
        return <Employees />;
      case 'org-chart':
        return <OrgChart />;
      case 'performance':
        return <Performance />;
      case 'assets':
        return <Assets />;
      case 'leave':
        return <Leave />;
      case 'hr-calendar':
        return <HRCalendarView />;
      case 'claims':
        return <Claims />;
      case 'payroll':
        return <Payroll initialMonth={payrollMonth} />;
      case 'payroll-history':
        return <PayrollHistory onViewPayroll={handleViewPayroll} />;
      case 'gov-reports':
        return <GovReports />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <MainLayout activeMenu={activeMenu} onMenuClick={(key) => key === 'logout' ? handleLogout() : setActiveMenu(key)}>
      {renderContent()}
    </MainLayout>
  );
}

export default App;
