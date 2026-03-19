import dayjs from 'dayjs';
import 'dayjs/locale/th';

const thaiMonthsFull = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const thaiMonthsShort = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

export const toThaiDate = (date: string | dayjs.Dayjs | Date, formatType: 'full' | 'short' | 'monthOnly' = 'full') => {
    if (!date) return '-';
    const d = dayjs(date);
    if (!d.isValid()) return '-';

    const day = d.date();
    const monthIndex = d.month();
    const yearBE = d.year() + 543;

    if (formatType === 'monthOnly') {
        return `${thaiMonthsFull[monthIndex]} ${yearBE}`;
    }

    const month = formatType === 'full' ? thaiMonthsFull[monthIndex] : thaiMonthsShort[monthIndex];
    return `${day} ${month} ${yearBE}`;
};

export const toThaiMonth = (month: number, year: number) => {
    return `${thaiMonthsFull[month - 1]} ${year + 543}`;
};
