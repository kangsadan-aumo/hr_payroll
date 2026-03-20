import { useState } from 'react';
import { ConfigProvider, message } from 'antd';
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
  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem('hr_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [activeMenu, setActiveMenu] = useState<string>(() => {
    const saved = localStorage.getItem('hr_user');
    if (saved) {
      const u = JSON.parse(saved);
      if (u.role !== 'admin' && u.role !== 'superadmin') return 'emp-attendance';
    }
    return 'dashboard';
  });
  const [payrollMonth, setPayrollMonth] = useState<{ month: number; year: number } | null>(null);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);

  const handleLoginSuccess = (userData: any) => {
    setUser(userData);
    localStorage.setItem('hr_user', JSON.stringify(userData));
    
    // Set default menu based on role
    if (userData.role !== 'admin' && userData.role !== 'superadmin') {
      setActiveMenu('emp-attendance');
    } else {
      setActiveMenu('dashboard');
    }

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
        if (role !== 'admin' && role !== 'superadmin') return <EmployeeAttendance user={user} />;
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
        if (role !== 'admin' && role !== 'superadmin') return <EmployeeAttendance user={user} />;
        return <Dashboard onNavigate={setActiveMenu} />;
    }
  };

  if (user.must_change_password || passwordModalVisible) {
    return (
      <ConfigProvider locale={thTH}>
        <div style={{ minHeight: '100vh', background: '#f0f2f5', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <ChangePasswordModal 
            visible={true}
            user={user}
            onCancel={() => {
               // ถ้าไม่ได้บังคับเปลี่ยน (เช่น กดจากเมนูเอง) ถึงจะให้ปิดได้
               if (!user.must_change_password) setPasswordModalVisible(false);
            }}
            onSuccess={(updatedUser) => {
              setUser(updatedUser);
              localStorage.setItem('hr_user', JSON.stringify(updatedUser));
              setPasswordModalVisible(false);
              message.success('เปลี่ยนรหัสผ่านสำเร็จ เตรียมเข้าสู่ระบบ');
            }}
          />
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider locale={thTH}>
      <MainLayout 
        user={user} 
        activeMenu={activeMenu} 
        onMenuClick={(key) => key === 'logout' ? handleLogout() : (key === 'change-password' ? setPasswordModalVisible(true) : setActiveMenu(key))}
      >
        {renderContent()}
      </MainLayout>
    </ConfigProvider>
  );
}

export default App;
