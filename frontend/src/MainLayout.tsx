import React, { useState } from 'react';
import { Layout, Menu, Typography, Avatar, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
    DashboardOutlined,
    TeamOutlined,
    CalendarOutlined,
    DollarOutlined,
    SettingOutlined,
    ImportOutlined,
    ClockCircleOutlined,
    UserOutlined,
    LogoutOutlined,
    MenuUnfoldOutlined,
    MenuFoldOutlined,
    HistoryOutlined,
    AuditOutlined,
    BarChartOutlined,
    FileProtectOutlined,
    ApartmentOutlined,
    LaptopOutlined,
} from '@ant-design/icons';
import './MainLayout.css';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

interface MainLayoutProps {
    children: React.ReactNode;
    user: any;
    activeMenu: string;
    onMenuClick: (key: string) => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children, user, activeMenu, onMenuClick }) => {
    const [collapsed, setCollapsed] = useState(false);

    const role = user?.role || 'admin';

    const hrItems = [
        { key: 'emp-attendance', icon: <ClockCircleOutlined />, label: 'ลงเวลาเข้า-ออกงาน' },
        { key: 'emp-leave', icon: <CalendarOutlined />, label: 'ทำเรื่องลาส่วนตัว' },
        { key: 'dashboard', icon: <DashboardOutlined />, label: 'Dashboard (หน้าแรก)' },
        { key: 'hr-calendar', icon: <CalendarOutlined style={{ color: '#ff4d4f' }} />, label: 'ปฏิทินงาน HR' },
        { key: 'employees', icon: <TeamOutlined />, label: 'จัดการข้อมูลพนักงาน' },
        { key: 'leave', icon: <CalendarOutlined />, label: 'อนุมัติการลา' },
        { key: 'import', icon: <ImportOutlined />, label: 'นำเข้าข้อมูล เข้า-ออกงาน' },
        { key: 'payroll', icon: <DollarOutlined />, label: 'จัดการเงินเดือน' },
        { key: 'payroll-history', icon: <HistoryOutlined />, label: 'ประวัติเงินเดือน' },
        { key: 'claims', icon: <AuditOutlined />, label: 'สวัสดิการและเบิกจ่าย' },
        { key: 'gov-reports', icon: <FileProtectOutlined />, label: 'รายงานรัฐบาล (Compliance)' },
        { key: 'org-chart', icon: <ApartmentOutlined />, label: 'โครงสร้างองค์กร (Org Chart)' },
        { key: 'performance', icon: <BarChartOutlined />, label: 'การประเมินผล (Performance)' },
        { key: 'assets', icon: <LaptopOutlined />, label: 'ทรัพย์สิน & PDPA' },
        { key: 'settings', icon: <SettingOutlined />, label: 'ตั้งค่าระบบ' },
    ];

    const employeeItems = [
        { key: 'emp-attendance', icon: <ClockCircleOutlined />, label: 'ลงเวลาเข้า-ออกงาน' },
        { key: 'emp-leave', icon: <CalendarOutlined />, label: 'ทำเรื่องลา' },
    ];

    const supervisorItems = [
        ...employeeItems,
        { key: 'leave', icon: <AuditOutlined />, label: 'อนุมัติการลาลูกน้อง' },
    ];

    const menuItems = (role === 'admin' || role === 'superadmin' || role === 'hr') ? hrItems : 
                      (role === 'supervisor' ? supervisorItems : employeeItems);

    const userMenu: MenuProps = {
        items: [
            { key: 'logout', icon: <LogoutOutlined />, label: 'ออกจากระบบ', danger: true },
        ],
        onClick: (e) => onMenuClick(e.key),
    };

    const isMobile = window.innerWidth <= 768;
    // For HR/Admin, if they are on mobile, show the employee layout (bottom nav, no sidebar)
    const isEmployee = (role !== 'admin' && role !== 'superadmin' && role !== 'hr') || 
                      (isMobile && (role === 'admin' || role === 'superadmin' || role === 'hr'));

    return (
        <Layout style={{ minHeight: '100vh' }}>
            {(!isMobile || !isEmployee) && (
                <Sider
                    trigger={null}
                    collapsible
                    collapsed={collapsed}
                    theme="dark"
                    width={250}
                    style={{
                        overflow: 'auto',
                        height: '100vh',
                        position: 'fixed',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        display: isMobile && isEmployee ? 'none' : 'block'
                    }}
                >
                    <div className="sidebar-logo">
                        {!collapsed ? (
                            <Title level={4} style={{ color: 'white', margin: 0 }}>HR System</Title>
                        ) : (
                            <Title level={4} style={{ color: 'white', margin: 0, textAlign: 'center' }}>HR</Title>
                        )}
                    </div>
                    <Menu
                        theme="dark"
                        mode="inline"
                        selectedKeys={[activeMenu]}
                        items={menuItems}
                        onClick={(e) => onMenuClick(e.key)}
                    />
                </Sider>
            )}

            <Layout className="main-content-layout" style={{ 
                marginLeft: (isMobile || isEmployee) ? 0 : (collapsed ? 80 : 250), 
                transition: 'all 0.2s',
                paddingBottom: isEmployee ? 64 : 0
            }}>
                <Header
                    className="main-header"
                    style={{
                        padding: '0 24px',
                        background: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        boxShadow: '0 1px 4px rgba(0,21,41,0.08)',
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                        width: '100%'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        {(!isEmployee) && React.createElement(collapsed ? MenuUnfoldOutlined : MenuFoldOutlined, {
                            className: 'trigger',
                            onClick: () => setCollapsed(!collapsed),
                            style: { fontSize: '18px', cursor: 'pointer', marginRight: '16px' }
                        })}
                        <Text strong style={{ fontSize: '16px' }}>
                            {isEmployee ? 'HR Mobile' : 'HR Management System'}
                        </Text>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <Dropdown menu={userMenu} placement="bottomRight" arrow>
                            <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
                                <Avatar style={{ backgroundColor: (role === 'admin' || role === 'superadmin' || role === 'hr') ? '#1890ff' : '#52c41a' }} icon={<UserOutlined />} />
                                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
                                    <Text strong>{user?.name || `${user?.first_name} ${user?.last_name}`}</Text>
                                    <Text type="secondary" style={{ fontSize: '12px' }}>{role.toUpperCase()}</Text>
                                </div>
                            </div>
                        </Dropdown>
                    </div>
                </Header>

                <Content style={{ margin: isMobile ? '12px 8px' : '24px 16px', overflow: 'initial' }}>
                    {children}
                </Content>
                
                {/* Bottom Navigation for Mobile (Employee Only) */}
                {isEmployee && (
                    <div className="bottom-nav">
                        <div 
                            className={`bottom-nav-item ${activeMenu === 'emp-attendance' ? 'active' : ''}`}
                            onClick={() => onMenuClick('emp-attendance')}
                        >
                            <ClockCircleOutlined />
                            <span>หน้าแรก</span>
                        </div>
                        <div 
                            className={`bottom-nav-item ${activeMenu === 'emp-leave' ? 'active' : ''}`}
                            onClick={() => onMenuClick('emp-leave')}
                        >
                            <CalendarOutlined />
                            <span>การลา</span>
                        </div>
                    </div>
                )}
            </Layout>
        </Layout>
    );
};
