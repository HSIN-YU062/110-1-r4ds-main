import { useMemo, useState } from 'react';

type Employee = {
  id: string;
  name: string;
  maxWorkDaysPerWeek?: number;
  maxWorkDaysPerMonth?: number;
  blackoutDates?: string[];
};

type Day = {
  date: string;
  required: number;
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
};

type Issue = {
  code: string;
  severity: 'warn' | 'block';
  message: string;
  date?: string;
  employeeId?: string;
};

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

function generateDays(start: string, end: string, considerHolidayAsWork: boolean): Day[] {
  const out: Day[] = [];
  for (let t = toDate(start).getTime(); t <= toDate(end).getTime(); t += dayMs) {
    const date = fmt(new Date(t));
    const dow = new Date(t).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const holidayDesc = HOLIDAYS[date];
    const isNationalHoliday = Boolean(holidayDesc);
    const required = isNationalHoliday && !considerHolidayAsWork ? 0 : isWeekend ? 1 : 2;
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

function validateSchedule(days: Day[], employees: Employee[], rules: CompanyRules) {
  const issues: Issue[] = [];
  const issuesByDate: Record<string, Issue[]> = {};
  const add = (i: Issue) => {
    issues.push(i);
    if (i.date) issuesByDate[i.date] = [...(issuesByDate[i.date] ?? []), i];
  };
  const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));

  for (const d of sortedDays) {
    if (d.assigned.length < d.required) add({ code: 'UNDERSTAFFED', severity: 'warn', date: d.date, message: `Under by ${d.required - d.assigned.length}` });
    if (d.assigned.length > d.required) add({ code: 'OVERSTAFFED', severity: 'block', date: d.date, message: `Over by ${d.assigned.length - d.required}` });
    for (const eid of d.assigned) {
      const e = empMap[eid];
      if (!e) add({ code: 'UNKNOWN_EMPLOYEE', severity: 'block', date: d.date, employeeId: eid, message: `${eid} not found` });
      if (rules.enforceBlackoutDates && e?.blackoutDates?.includes(d.date)) {
        add({ code: 'BLACKOUT', severity: 'block', date: d.date, employeeId: eid, message: `${e.name} blackout date` });
      }
    }
  }

  const stats = buildStats(sortedDays);
  for (const e of employees) {
    if (rules.enforceWeeklyMax && e.maxWorkDaysPerWeek != null) {
      for (const [k, n] of stats.week.entries()) {
        if (k.startsWith(`${e.id}|`) && n > e.maxWorkDaysPerWeek) {
          add({ code: 'WEEKLY_MAX', severity: 'block', employeeId: e.id, message: `${e.name} weekly max exceeded (${n}/${e.maxWorkDaysPerWeek})` });
        }
      }
    }
    if (rules.enforceMonthlyMax && e.maxWorkDaysPerMonth != null) {
      for (const [k, n] of stats.month.entries()) {
        if (k.startsWith(`${e.id}|`) && n > e.maxWorkDaysPerMonth) {
          add({ code: 'MONTHLY_MAX', severity: 'block', employeeId: e.id, message: `${e.name} monthly max exceeded (${n}/${e.maxWorkDaysPerMonth})` });
        }
      }
    }
    if (rules.maxConsecutiveWorkDays != null) {
      const dates = [...(stats.byEmployeeDates.get(e.id) ?? [])].sort();
      let streak = 0;
      let prev = '';
      for (const d of dates) {
        streak = prev && toDate(d).getTime() - toDate(prev).getTime() === dayMs ? streak + 1 : 1;
        if (streak > rules.maxConsecutiveWorkDays) {
          add({ code: 'MAX_CONSECUTIVE', severity: 'block', date: d, employeeId: e.id, message: `${e.name} > ${rules.maxConsecutiveWorkDays} consecutive days` });
        }
        prev = d;
      }
    }
  }
  return { issues, issuesByDate };
}

function autoFill(days: Day[], employees: Employee[], rules: CompanyRules): Day[] {
  const out = [...days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, assigned: [...d.assigned] }));

  const canAssign = (eid: string, day: Day, current: Day[]) => {
    if (day.assigned.includes(eid)) return false;
    const e = employees.find((x) => x.id === eid);
    if (!e) return false;
    if (rules.enforceBlackoutDates && e.blackoutDates?.includes(day.date)) return false;
    const simulated = current.map((d) => (d.date === day.date ? { ...d, assigned: [...d.assigned, eid] } : d));
    const v = validateSchedule(simulated, employees, rules);
    return !v.issues.some((i) => i.severity === 'block' && i.employeeId === eid);
  };

  for (const day of out) {
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
  const [start, setStart] = useState('2025-01-25');
  const [end, setEnd] = useState('2025-02-08');
  const [considerHolidayAsWork, setConsiderHolidayAsWork] = useState(true);
  const [rules, setRules] = useState<CompanyRules>({
    weekStartsOn: 'mon',
    maxConsecutiveWorkDays: 5,
    enforceBlackoutDates: true,
    enforceWeeklyMax: true,
    enforceMonthlyMax: true
  });
  const [days, setDays] = useState<Day[]>(() => generateDays('2025-01-25', '2025-02-08', true));

  const employeesById = useMemo(() => Object.fromEntries(EMPLOYEES.map((e) => [e.id, e])), []);
  const validation = useMemo(() => validateSchedule(days, EMPLOYEES, rules), [days, rules]);

  const regen = () => setDays(generateDays(start, end, considerHolidayAsWork));
  const updateDay = (date: string, fn: (d: Day) => Day) => setDays((prev) => prev.map((d) => (d.date === date ? fn(d) : d)));

  const onDrop = (date: string, zone: 'assigned' | 'available', eid: string) => {
    updateDay(date, (d) => {
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
        d.required,
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

  return (
    <div className="page">
      <div className="card toolbar">
        <h1>Scheduling</h1>
        <div className="row">
          <label>Start <input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>End <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <label>Max Consecutive <input type="number" min={1} value={rules.maxConsecutiveWorkDays ?? ''} onChange={(e) => setRules((r) => ({ ...r, maxConsecutiveWorkDays: Number(e.target.value) || undefined }))} /></label>
          <button onClick={regen}>Generate</button>
          <button onClick={() => setDays((d) => autoFill(d, EMPLOYEES, rules))}>Auto Fill</button>
          <button onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="row toggles">
          <label><input type="checkbox" checked={rules.enforceBlackoutDates} onChange={(e) => setRules((r) => ({ ...r, enforceBlackoutDates: e.target.checked }))} /> enforce blackout</label>
          <label><input type="checkbox" checked={rules.enforceWeeklyMax} onChange={(e) => setRules((r) => ({ ...r, enforceWeeklyMax: e.target.checked }))} /> weekly max</label>
          <label><input type="checkbox" checked={rules.enforceMonthlyMax} onChange={(e) => setRules((r) => ({ ...r, enforceMonthlyMax: e.target.checked }))} /> monthly max</label>
          <label><input type="checkbox" checked={considerHolidayAsWork} onChange={(e) => setConsiderHolidayAsWork(e.target.checked)} /> consider holidays as working days</label>
        </div>
      </div>

      <div className="card content">
        {[...days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
          const available = EMPLOYEES.filter((e) => !d.assigned.includes(e.id));
          const issues = validation.issuesByDate[d.date] ?? [];
          const over = d.assigned.length > d.required;
          return (
            <div key={d.date} className={`day ${over ? 'over' : ''}`}>
              <div>
                <div className="date">{d.date} · {new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div className="badges">
                  {d.isWeekend && <span className="badge">Weekend</span>}
                  {d.isNationalHoliday && <span className="badge">Holiday · {d.holidayDesc}</span>}
                  {over && <span className="badge red">Over</span>}
                </div>
              </div>
              <label>Req <input type="number" min={0} value={d.required} onChange={(e) => updateDay(d.date, (x) => ({ ...x, required: Math.max(0, Number(e.target.value) || 0) }))} /></label>
              <div className={`drop ${over ? 'redbox' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(d.date, 'assigned', e.dataTransfer.getData('text/plain'))}>
                {d.assigned.map((id) => <span key={id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', id)} className="chip">{employeesById[id]?.name ?? id}</span>)}
              </div>
              <div className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(d.date, 'available', e.dataTransfer.getData('text/plain'))}>
                {available.map((e) => <span key={e.id} draggable onDragStart={(ev) => ev.dataTransfer.setData('text/plain', e.id)} className="chip muted">{e.name}</span>)}
              </div>
              <div className="badges">
                {issues.map((i, idx) => <span key={`${i.code}-${idx}`} className={`badge ${i.code === 'OVERSTAFFED' ? 'red' : ''}`}>{i.code}</span>)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
