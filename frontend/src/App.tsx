import { useState, useEffect } from 'react';
import { ConfigProvider } from 'antd';
import thTH from 'antd/es/locale/th_TH';
import dayjs from 'dayjs';
import 'dayjs/locale/th';

dayjs.locale('th');

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
import { EmployeeAttendance } from './EmployeeAttendance';
import { EmployeeLeave } from './EmployeeLeave';
import { ApproveLeave } from './ApproveLeave';
import { ChangePasswordModal } from './ChangePasswordModal';
import './App.css';

function App() {
  const [user, setUser] = useState<any>(null);
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [payrollMonth, setPayrollMonth] = useState<{ month: number; year: number } | null>(null);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);

  useEffect(() => {
    const savedUser = localStorage.getItem('hr_user');
    if (savedUser) setUser(JSON.parse(savedUser));
  }, []);

  const handleLoginSuccess = (userData: any) => {
    setUser(userData);
    localStorage.setItem('hr_user', JSON.stringify(userData));
    if (userData.must_change_password) {
      setPasswordModalVisible(true);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('hr_user');
  };

  const handleViewPayroll = (month: number, year: number) => {
    setPayrollMonth({ month, year });
    setActiveMenu('payroll');
  };

  const isApprovePage = window.location.pathname === '/approve-leave';
  
  if (isApprovePage) {
    return <ApproveLeave />;
  }

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const role = user.role || 'admin'; // admin, supervisor, employee

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
        // ถ้าเป็นหัวหน้า ให้ดูแค่ของลูกน้อง ถ้าเป็น HR ให้ดูหมด
        return <Leave role={role} user={user} />;
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
      
      // New Employee Views
      case 'emp-attendance':
        return <EmployeeAttendance user={user} />;
      case 'emp-leave':
        return <EmployeeLeave user={user} />;
        
      default:
        return <Dashboard />;
    }
  };

  return (
    <ConfigProvider locale={thTH}>
      <MainLayout 
        user={user} 
        activeMenu={activeMenu} 
        onMenuClick={(key) => key === 'logout' ? handleLogout() : (key === 'change-password' ? setPasswordModalVisible(true) : setActiveMenu(key))}
      >
        {renderContent()}
      </MainLayout>

      <ChangePasswordModal 
        visible={passwordModalVisible || !!user?.must_change_password}
        user={user}
        onCancel={() => setPasswordModalVisible(false)}
        onSuccess={(updatedUser) => {
          setUser(updatedUser);
          localStorage.setItem('hr_user', JSON.stringify(updatedUser));
          setPasswordModalVisible(false);
        }}
      />
    </ConfigProvider>
  );
}

export default App;
