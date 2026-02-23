import { useMemo, useState } from 'react';

type Lang = 'zh' | 'en';

type Employee = {
  id: string;
  name: string;
  maxWorkDaysPerWeek?: number;
  maxWorkDaysPerMonth?: number;
  blackoutDates?: string[];
};

type Day = {
  date: string;
  required: number | null;
  assigned: string[];
  isWeekend?: boolean;
  isNationalHoliday?: boolean;
  holidayDesc?: string;
};

type CompanyRules = {
  weekStartsOn: 'mon';
  maxConsecutiveWorkDays?: number;
  enforceBlackoutDates?: boolean;
  enforceWeeklyMax?: boolean;
  enforceMonthlyMax?: boolean;
  enforceWeekendRestOneDay?: boolean;
};

type Issue = {
  code: string;
  severity: 'warn' | 'block';
  message: string;
  date?: string;
  employeeId?: string;
};

const I18N = {
  zh: {
    title: '排班',
    lang: '中文 / English',
    month: '月份',
    weekdayRequired: '平日需要幾人',
    weekendRequired: '假日需要幾人',
    maxConsecutive: '最多連續天數',
    autoFill: '自動排班',
    exportCsv: '匯出 CSV',
    assigned: '已排',
    available: '可排',
    weekend: '週末',
    holiday: '國定假日',
    over: '超編',
    enforceBlackout: '限制不可排日期',
    weeklyMax: '每週上限',
    monthlyMax: '每月上限',
    holidayAsWork: '國定假日視為工作日',
    weekendRestOne: '每人至少在周末休一天',
    underBy: '人力不足',
    overBy: '人力超編',
    blackout: '不可排日期衝突',
    weeklyExceeded: '每週超過上限',
    monthlyExceeded: '每月超過上限',
    consecutiveExceeded: '連續天數超過上限',
    weekendOff2: '連續兩個週末都全休',
    weekendRestWarn: '週末兩天都有上班'
  },
  en: {
    title: 'Scheduling',
    lang: '中文 / English',
    month: 'Month',
    weekdayRequired: 'Weekday required',
    weekendRequired: 'Weekend required',
    maxConsecutive: 'Max consecutive',
    autoFill: 'Auto Fill',
    exportCsv: 'Export CSV',
    assigned: 'Assigned',
    available: 'Available',
    weekend: 'Weekend',
    holiday: 'Holiday',
    over: 'Over',
    enforceBlackout: 'enforce blackout',
    weeklyMax: 'weekly max',
    monthlyMax: 'monthly max',
    holidayAsWork: 'consider holidays as working days',
    weekendRestOne: 'Each person must rest one weekend day',
    underBy: 'Understaffed',
    overBy: 'Overstaffed',
    blackout: 'Blackout violation',
    weeklyExceeded: 'Weekly max exceeded',
    monthlyExceeded: 'Monthly max exceeded',
    consecutiveExceeded: 'Max consecutive exceeded',
    weekendOff2: 'Two consecutive full weekends off',
    weekendRestWarn: 'Works both weekend days'
  }
} as const;

const HOLIDAYS: Record<string, string> = {
  '2025-01-01': 'New Year',
  '2025-01-28': 'Spring Festival Eve',
  '2025-01-29': 'Spring Festival',
  '2025-02-28': 'Peace Memorial Day',
  '2025-04-04': 'Children’s Day'
};

const EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'Ava', maxWorkDaysPerWeek: 4, maxWorkDaysPerMonth: 14, blackoutDates: ['2025-01-06', '2025-01-15'] },
  { id: 'e2', name: 'Ben', maxWorkDaysPerWeek: 5, maxWorkDaysPerMonth: 16, blackoutDates: ['2025-01-20'] },
  { id: 'e3', name: 'Cody', maxWorkDaysPerWeek: 4, maxWorkDaysPerMonth: 15, blackoutDates: ['2025-01-29'] },
  { id: 'e4', name: 'Dora', maxWorkDaysPerWeek: 5, maxWorkDaysPerMonth: 17 },
  { id: 'e5', name: 'Eli', maxWorkDaysPerWeek: 4, maxWorkDaysPerMonth: 14, blackoutDates: ['2025-02-01'] },
  { id: 'e6', name: 'Faye', maxWorkDaysPerWeek: 5, maxWorkDaysPerMonth: 16 }
];

const dayMs = 24 * 60 * 60 * 1000;
const toDate = (s: string) => new Date(`${s}T00:00:00`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (s: string) => s.slice(0, 7);
const csvEscape = (v: string | number | boolean) => `"${String(v).replaceAll('"', '""')}"`;

function getISOWeekKey(dateStr: string): string {
  const d = toDate(dateStr);
  const day = (d.getDay() + 6) % 7;
  const thursday = new Date(d.getTime() + (3 - day) * dayMs);
  const weekYear = thursday.getFullYear();
  const jan4 = new Date(`${weekYear}-01-04T00:00:00`);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const week1Mon = new Date(jan4.getTime() - jan4Day * dayMs);
  const targetMon = new Date(d.getTime() - day * dayMs);
  const week = Math.floor((targetMon.getTime() - week1Mon.getTime()) / (7 * dayMs)) + 1;
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

function generateMonthDays(month: string, considerHolidayAsWork: boolean, weekdayRequired: number, weekendRequired: number): Day[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const out: Day[] = [];
  for (let t = first.getTime(); t <= last.getTime(); t += dayMs) {
    const date = fmt(new Date(t));
    const dow = new Date(t).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const holidayDesc = HOLIDAYS[date];
    const isNationalHoliday = Boolean(holidayDesc);
    const required = isNationalHoliday && !considerHolidayAsWork ? 0 : isWeekend ? weekendRequired : weekdayRequired;
    out.push({ date, required, assigned: [], isWeekend, isNationalHoliday, holidayDesc });
  }
  return out;
}

function buildStats(days: Day[]) {
  const week = new Map<string, number>();
  const month = new Map<string, number>();
  const total = new Map<string, number>();
  const byEmployeeDates = new Map<string, string[]>();
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const eid of day.assigned) {
      const wk = `${eid}|${getISOWeekKey(day.date)}`;
      const mk = `${eid}|${monthKey(day.date)}`;
      week.set(wk, (week.get(wk) ?? 0) + 1);
      month.set(mk, (month.get(mk) ?? 0) + 1);
      total.set(eid, (total.get(eid) ?? 0) + 1);
      byEmployeeDates.set(eid, [...(byEmployeeDates.get(eid) ?? []), day.date]);
    }
  }
  return { week, month, total, byEmployeeDates };
}

function getWeekendAnchor(dateStr: string) {
  const d = toDate(dateStr);
  const day = d.getDay();
  const satOffset = day === 0 ? -1 : day === 6 ? 0 : 6 - day;
  return fmt(new Date(d.getTime() + satOffset * dayMs));
}

function validateSchedule(days: Day[], employees: Employee[], rules: CompanyRules, t: (k: keyof typeof I18N.zh) => string) {
  const issues: Issue[] = [];
  const issuesByDate: Record<string, Issue[]> = {};
  const add = (i: Issue) => {
    issues.push(i);
    if (i.date) issuesByDate[i.date] = [...(issuesByDate[i.date] ?? []), i];
  };
  const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));

  for (const d of sortedDays) {
    if (d.required == null) continue;
    if (d.assigned.length < d.required) add({ code: 'UNDERSTAFFED', severity: 'warn', date: d.date, message: `${t('underBy')} ${d.required - d.assigned.length}` });
    if (d.assigned.length > d.required) add({ code: 'OVERSTAFFED', severity: 'block', date: d.date, message: `${t('overBy')} ${d.assigned.length - d.required}` });
    for (const eid of d.assigned) {
      const e = empMap[eid];
      if (!e) add({ code: 'UNKNOWN_EMPLOYEE', severity: 'block', date: d.date, employeeId: eid, message: `${eid} not found` });
      if (rules.enforceBlackoutDates && e?.blackoutDates?.includes(d.date)) add({ code: 'BLACKOUT', severity: 'block', date: d.date, employeeId: eid, message: t('blackout') });
    }
  }

  const stats = buildStats(sortedDays);
  for (const e of employees) {
    if (rules.enforceWeeklyMax && e.maxWorkDaysPerWeek != null) {
      for (const [k, n] of stats.week.entries()) if (k.startsWith(`${e.id}|`) && n > e.maxWorkDaysPerWeek) add({ code: 'WEEKLY_MAX', severity: 'block', employeeId: e.id, message: t('weeklyExceeded') });
    }
    if (rules.enforceMonthlyMax && e.maxWorkDaysPerMonth != null) {
      for (const [k, n] of stats.month.entries()) if (k.startsWith(`${e.id}|`) && n > e.maxWorkDaysPerMonth) add({ code: 'MONTHLY_MAX', severity: 'block', employeeId: e.id, message: t('monthlyExceeded') });
    }
    if (rules.maxConsecutiveWorkDays != null) {
      const dates = [...(stats.byEmployeeDates.get(e.id) ?? [])].sort();
      let streak = 0;
      let prev = '';
      for (const d of dates) {
        streak = prev && toDate(d).getTime() - toDate(prev).getTime() === dayMs ? streak + 1 : 1;
        if (streak > rules.maxConsecutiveWorkDays) add({ code: 'MAX_CONSECUTIVE', severity: 'block', date: d, employeeId: e.id, message: t('consecutiveExceeded') });
        prev = d;
      }
    }
  }

  const weekendMap = new Map<string, { sat?: Day; sun?: Day }>();
  for (const d of sortedDays) {
    if (!d.isWeekend) continue;
    const key = getWeekendAnchor(d.date);
    const item = weekendMap.get(key) ?? {};
    if (toDate(d.date).getDay() === 6) item.sat = d;
    if (toDate(d.date).getDay() === 0) item.sun = d;
    weekendMap.set(key, item);
  }
  const weekendKeys = [...weekendMap.keys()].sort();
  const fullOff = (eid: string, w: { sat?: Day; sun?: Day }) => w.sat && w.sun ? !w.sat.assigned.includes(eid) && !w.sun.assigned.includes(eid) : null;

  for (const e of employees) {
    for (let i = 1; i < weekendKeys.length; i++) {
      const a = weekendMap.get(weekendKeys[i - 1])!;
      const b = weekendMap.get(weekendKeys[i])!;
      const offA = fullOff(e.id, a);
      const offB = fullOff(e.id, b);
      if (offA === true && offB === true) add({ code: 'WEEKEND_OFF_2', severity: 'warn', employeeId: e.id, date: b.sun?.date ?? b.sat?.date, message: t('weekendOff2') });
      if (rules.enforceWeekendRestOneDay && b.sat && b.sun && b.sat.assigned.includes(e.id) && b.sun.assigned.includes(e.id)) add({ code: 'WEEKEND_REST_ONE', severity: 'warn', employeeId: e.id, date: b.sun.date, message: t('weekendRestWarn') });
    }
  }

  return { issues, issuesByDate };
}

function autoFill(days: Day[], employees: Employee[], rules: CompanyRules, t: (k: keyof typeof I18N.zh) => string): Day[] {
  const out = [...days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, assigned: [...d.assigned] }));

  const weekendBothWorked = (eid: string, date: string, current: Day[]) => {
    if (!rules.enforceWeekendRestOneDay) return false;
    const key = getWeekendAnchor(date);
    const sat = current.find((d) => d.date === key);
    const sun = current.find((d) => d.date === fmt(new Date(toDate(key).getTime() + dayMs)));
    const day = toDate(date).getDay();
    if (day === 6) return Boolean(sun?.assigned.includes(eid));
    if (day === 0) return Boolean(sat?.assigned.includes(eid));
    return false;
  };

  const canAssign = (eid: string, day: Day, current: Day[]) => {
    if (day.assigned.includes(eid) || day.required == null) return false;
    const e = employees.find((x) => x.id === eid);
    if (!e) return false;
    if (rules.enforceBlackoutDates && e.blackoutDates?.includes(day.date)) return false;
    if (weekendBothWorked(eid, day.date, current)) return false;
    const simulated = current.map((d) => (d.date === day.date ? { ...d, assigned: [...d.assigned, eid] } : d));
    const v = validateSchedule(simulated, employees, rules, t);
    return !v.issues.some((i) => i.severity === 'block' && i.employeeId === eid);
  };

  for (const day of out) {
    if (day.required == null) continue;
    while (day.assigned.length < day.required) {
      const stats = buildStats(out);
      const candidates = employees.filter((e) => canAssign(e.id, day, out));
      if (!candidates.length) break;
      candidates.sort((a, b) => {
        const aw = stats.week.get(`${a.id}|${getISOWeekKey(day.date)}`) ?? 0;
        const bw = stats.week.get(`${b.id}|${getISOWeekKey(day.date)}`) ?? 0;
        if (aw !== bw) return aw - bw;
        const am = stats.month.get(`${a.id}|${monthKey(day.date)}`) ?? 0;
        const bm = stats.month.get(`${b.id}|${monthKey(day.date)}`) ?? 0;
        if (am !== bm) return am - bm;
        const at = stats.total.get(a.id) ?? 0;
        const bt = stats.total.get(b.id) ?? 0;
        if (at !== bt) return at - bt;
        return a.id.localeCompare(b.id);
      });
      day.assigned.push(candidates[0].id);
    }
  }
  return out;
}

export default function App() {
  const [lang, setLang] = useState<Lang>('zh');
  const t = (k: keyof typeof I18N.zh) => I18N[lang][k];
  const [month, setMonth] = useState('2025-02');
  const [weekdayRequired, setWeekdayRequired] = useState(2);
  const [weekendRequired, setWeekendRequired] = useState(1);
  const [considerHolidayAsWork, setConsiderHolidayAsWork] = useState(true);
  const [rules, setRules] = useState<CompanyRules>({
    weekStartsOn: 'mon',
    maxConsecutiveWorkDays: 5,
    enforceBlackoutDates: true,
    enforceWeeklyMax: true,
    enforceMonthlyMax: true,
    enforceWeekendRestOneDay: false
  });
  const [days, setDays] = useState<Day[]>(() => generateMonthDays('2025-01', true, 2, 1).concat(generateMonthDays('2025-02', true, 2, 1)).concat(generateMonthDays('2025-03', true, 2, 1)));

  const employeesById = useMemo(() => Object.fromEntries(EMPLOYEES.map((e) => [e.id, e])), []);
  const validation = useMemo(() => validateSchedule(days, EMPLOYEES, rules, t), [days, rules, lang]);

  const ensureMonth = (targetMonth: string) => {
    setDays((prev) => prev.some((d) => d.date.startsWith(targetMonth)) ? prev : [...prev, ...generateMonthDays(targetMonth, considerHolidayAsWork, weekdayRequired, weekendRequired)]);
  };

  const monthDays = useMemo(() => [...days].filter((d) => d.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date)), [days, month]);

  const setDay = (date: string, fn: (d: Day) => Day) => setDays((prev) => prev.map((d) => (d.date === date ? fn(d) : d)));

  const applyGlobalRequired = (isWeekend: boolean, value: number) => {
    setDays((prev) => prev.map((d) => (!d.date.startsWith(month) || d.required == null || Boolean(d.isWeekend) !== isWeekend ? d : { ...d, required: value })));
  };

  const onDrop = (date: string, zone: 'assigned' | 'available', eid: string) => {
    setDay(date, (d) => {
      const assigned = d.assigned.filter((x) => x !== eid);
      return zone === 'assigned' ? { ...d, assigned: [...assigned, eid].sort() } : { ...d, assigned };
    });
  };

  const exportCsv = () => {
    const rows = [
      ['日期', '是否國定假日', '是否週末', '假日名稱', '需求人數', '上班(依員工姓名)'],
      ...[...days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => [
        d.date,
        d.isNationalHoliday ? '是' : '否',
        d.isWeekend ? '是' : '否',
        d.holidayDesc ?? '',
        d.required ?? '',
        d.assigned.map((id) => employeesById[id]?.name ?? id).join('、')
      ])
    ];
    const content = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schedule.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const firstWeekday = monthDays[0] ? toDate(monthDays[0].date).getDay() : 0;
  const cells: Array<Day | null> = [...Array(firstWeekday).fill(null), ...monthDays];

  return (
    <div className="page">
      <div className="card toolbar">
        <div className="toolbar-top">
          <h1>{t('title')}</h1>
          <button onClick={() => setLang((v) => (v === 'zh' ? 'en' : 'zh'))}>{t('lang')}</button>
        </div>
        <div className="row">
          <label>{t('month')} <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); ensureMonth(e.target.value); }} /></label>
          <label>{t('weekdayRequired')} <input type="number" min={0} value={weekdayRequired} onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setWeekdayRequired(v); applyGlobalRequired(false, v); }} /></label>
          <label>{t('weekendRequired')} <input type="number" min={0} value={weekendRequired} onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setWeekendRequired(v); applyGlobalRequired(true, v); }} /></label>
          <label>{t('maxConsecutive')} <input type="number" min={1} value={rules.maxConsecutiveWorkDays ?? ''} onChange={(e) => setRules((r) => ({ ...r, maxConsecutiveWorkDays: Number(e.target.value) || undefined }))} /></label>
          <button onClick={() => setDays((d) => autoFill(d, EMPLOYEES, rules, t))}>{t('autoFill')}</button>
          <button onClick={exportCsv}>{t('exportCsv')}</button>
        </div>
        <div className="row toggles">
          <label><input type="checkbox" checked={rules.enforceBlackoutDates} onChange={(e) => setRules((r) => ({ ...r, enforceBlackoutDates: e.target.checked }))} /> {t('enforceBlackout')}</label>
          <label><input type="checkbox" checked={rules.enforceWeeklyMax} onChange={(e) => setRules((r) => ({ ...r, enforceWeeklyMax: e.target.checked }))} /> {t('weeklyMax')}</label>
          <label><input type="checkbox" checked={rules.enforceMonthlyMax} onChange={(e) => setRules((r) => ({ ...r, enforceMonthlyMax: e.target.checked }))} /> {t('monthlyMax')}</label>
          <label><input type="checkbox" checked={considerHolidayAsWork} onChange={(e) => setConsiderHolidayAsWork(e.target.checked)} /> {t('holidayAsWork')}</label>
          <label><input type="checkbox" checked={rules.enforceWeekendRestOneDay} onChange={(e) => setRules((r) => ({ ...r, enforceWeekendRestOneDay: e.target.checked }))} /> {t('weekendRestOne')}</label>
        </div>
      </div>

      <div className="card content">
        <div className="week-header">
          {lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']}
        </div>
        <div className="calendar-grid">
          {cells.map((d, idx) => {
            if (!d) return <div key={`blank-${idx}`} className="day-cell blank" />;
            const available = EMPLOYEES.filter((e) => !d.assigned.includes(e.id));
            const issues = validation.issuesByDate[d.date] ?? [];
            const over = d.required != null && d.assigned.length > d.required;
            return (
              <div key={d.date} className={`day-cell ${over ? 'over' : ''}`}>
                <div className="day-head">
                  <strong>{Number(d.date.slice(-2))}</strong>
                  <div className="badges">
                    {d.isWeekend && <span className="badge">{t('weekend')}</span>}
                    {d.isNationalHoliday && <span className="badge">{t('holiday')} · {d.holidayDesc}</span>}
                    {over && <span className="badge red">{t('over')}</span>}
                  </div>
                </div>
                <input
                  type="text"
                  value={d.required == null ? '' : String(d.required)}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d+$/.test(v)) setDay(d.date, (x) => ({ ...x, required: v === '' ? null : Number(v) }));
                  }}
                  onBlur={(e) => {
                    const v = e.target.value;
                    setDay(d.date, (x) => ({ ...x, required: v === '' ? null : Math.max(0, Number(v) || 0) }));
                  }}
                />
                <div className={`drop ${over ? 'redbox' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(d.date, 'assigned', e.dataTransfer.getData('text/plain'))}>
                  <div className="drop-title">{t('assigned')}</div>
                  {d.assigned.map((id) => <span key={id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', id)} className="chip">{employeesById[id]?.name ?? id}</span>)}
                </div>
                <div className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(d.date, 'available', e.dataTransfer.getData('text/plain'))}>
                  <div className="drop-title">{t('available')}</div>
                  {available.map((e) => <span key={e.id} draggable onDragStart={(ev) => ev.dataTransfer.setData('text/plain', e.id)} className="chip muted">{e.name}</span>)}
                </div>
                <div className="badges issues">
                  {issues.slice(0, 3).map((i, iIdx) => <span key={`${i.code}-${iIdx}`} className={`badge ${i.code === 'OVERSTAFFED' ? 'red' : ''}`}>{i.code}</span>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
