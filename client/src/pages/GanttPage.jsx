import React, { useEffect, useRef, useState } from 'react';
import api from '../utils/api';
import styles from './GanttPage.module.css';

// ── date utils ────────────────────────────────────────────────
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function dateToISO(d) { return d.toISOString().split('T')[0]; }
function parseDate(s) { if (!s) return null; const clean = s.includes('T') ? s.split('T')[0] : s; const d = new Date(clean + 'T00:00:00'); return isNaN(d.getTime()) ? null : d; }
function isWeekend(d) { const w = typeof d === 'string' ? parseDate(d).getDay() : d.getDay(); return w === 0 || w === 6; }
function addWorkdays(d, days) {
  const r = new Date(d); let rem = days;
  while (rem > 0) { r.setDate(r.getDate() + 1); if (!isWeekend(r)) rem--; }
  return r;
}
function nextWorkday(d) { const r = new Date(d); while (isWeekend(r)) r.setDate(r.getDate() + 1); return r; }

// ── phase config ──────────────────────────────────────────────
const PHASES = [
  { key:'hours_admin',     label:'Admin/Draw',  cls: styles.gAdmin    },
  { key:'hours_machining', label:'Machining',   cls: styles.gMachining },
  { key:'hours_assembly',  label:'Assembly',    cls: styles.gAssembly  },
  { key:'hours_delivery',  label:'Delivery',    cls: styles.gDelivery  },
  { key:'hours_install',   label:'Installation',cls: styles.gInstall   },
];

const LEGEND_COLORS = ['#5B8DB8','#B87333','#5B8B5B','#8B5B8B','#B8A033'];

function parseJobNum(job) {
  const s = String(job || '');
  const m = s.match(/^(\d+)(?:_(\d+))?$/);
  if (m) return { base: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0 };
  return { base: 0, sub: 0 };
}

function getPhaseRanges(job) {
  // Start = wip_start, fall back to quote_accept_date
  const startStr = job.wip_start || job.quote_accept_date;
  if (!startStr) return null;
  const start = parseDate(startStr);
  if (!start) return null;
  const activePh = PHASES.filter(p => parseFloat(job[p.key]) > 0);
  const ranges = []; let cursor = nextWorkday(new Date(start));
  for (const ph of activePh) {
    const hrs = parseFloat(job[ph.key]);
    const phEnd = addWorkdays(cursor, Math.ceil(hrs / 8));
    ranges.push({ ...ph, hrs, start: dateToISO(cursor), end: dateToISO(phEnd) });
    cursor = nextWorkday(new Date(phEnd));
  }
  return ranges;
}

function getGanttRange(view, offset) {
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const dow = base.getDay();
  const monday = addDays(base, -(dow === 0 ? 6 : dow - 1));
  const weeks = view === '4w' ? 4 : view === '8w' ? 8 : view === '12w' ? 12 : 26;
  const isWeekly = view === '6m';
  if (isWeekly) {
    const start = addDays(monday, offset * weeks * 7);
    return { start, cols: weeks, colW: 56, unit: 'week' };
  }
  const start = addDays(monday, offset * weeks * 7);
  return { start, cols: weeks * 7, colW: 34, unit: 'day' };
}

const NAME_W = 280;

export default function GanttPage() {
  const [jobs, setJobs]               = useState([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [view, setView]               = useState('8w');
  const [offset, setOffset]           = useState(0);
  const outerRef                      = useRef(null);
  const today                         = dateToISO(new Date());

  useEffect(() => {
    api.get('/jobs').then(r => setJobs(r.data));
  }, []);

  const visible = jobs
    .filter(j => showCompleted || !j.wip_completed)
    .sort((a, b) => {
      const na = parseJobNum(a.job_number), nb = parseJobNum(b.job_number);
      if (nb.base !== na.base) return nb.base - na.base;
      return na.sub - nb.sub;
    });

  const active = jobs.filter(j => !j.wip_completed).length;
  const { start, cols, colW, unit } = getGanttRange(view, offset);

  // Compute effective column width to fill container
  const outerW = outerRef.current?.clientWidth || 1200;
  const minW   = NAME_W + cols * colW;
  const effColW = minW < outerW ? colW + Math.floor((outerW - minW) / cols) : colW;
  const finalW  = NAME_W + cols * effColW;

  const colDates = [];
  for (let i = 0; i < cols; i++) {
    colDates.push(dateToISO(unit === 'day' ? addDays(start, i) : addDays(start, i * 7)));
  }
  const rangeEnd = dateToISO(unit === 'day' ? addDays(start, cols) : addDays(start, cols * 7));
  const ms = 86400000 * (unit === 'day' ? 1 : 7);

  const periodLabel = `${parseDate(colDates[0]).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' })} — ${parseDate(colDates[colDates.length - 1]).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' })}`;

  return (
    <div className={styles.pageFull}>
      <div className="section-header">
        <h1 className="section-title">Gantt Chart</h1>
        <span className="section-tag">{active} Active Job{active === 1 ? '' : 's'}</span>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <button className={styles.navBtn} onClick={() => setOffset(o => o - 1)}>◀ Prev</button>
        <button className={styles.todayBtn} onClick={() => setOffset(0)}>Today</button>
        <button className={styles.navBtn} onClick={() => setOffset(o => o + 1)}>Next ▶</button>
        <span className={styles.periodLabel}>{periodLabel}</span>
        <div className={styles.viewToggle}>
          {['4w','8w','12w','6m'].map(v => (
            <button
              key={v}
              className={`${styles.viewBtn}${view === v ? ' ' + styles.viewBtnActive : ''}`}
              onClick={() => { setView(v); setOffset(0); }}
            >
              {v === '4w' ? '4 Wks' : v === '8w' ? '8 Wks' : v === '12w' ? '12 Wks' : '6 Mth'}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className={styles.legend}>
        {PHASES.map((p, i) => (
          <span key={p.key} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: LEGEND_COLORS[i] }} />
            {p.label}
          </span>
        ))}
        <label className={styles.showCompleted} style={{ marginLeft:'auto' }}>
          <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} />
          Show completed
        </label>
      </div>

      {/* Chart */}
      <div className={styles.ganttOuter} ref={outerRef}>
        <div className={styles.ganttInner} style={{ width: finalW }}>

          {/* Sticky header */}
          <div className={styles.headRow} style={{ width: finalW }}>
            <div className={styles.nameHdr} style={{ width: NAME_W }}>Job / Project</div>
            {colDates.map(d => {
              const isToday  = d === today;
              const weekend  = unit === 'day' && isWeekend(d);
              const dt       = parseDate(d);
              const lbl      = dt.toLocaleDateString('en-AU', { day:'numeric', month:'short' });
              return (
                <div key={d}
                  className={`${styles.dateHdr}${isToday ? ' ' + styles.todayCol : ''}${weekend ? ' ' + styles.weekend : ''}`}
                  style={{ width: effColW }}
                >
                  {lbl}
                </div>
              );
            })}
          </div>

          {/* Data rows */}
          {visible.length ? visible.map(j => {
            const isSub      = parseJobNum(j.job_number).sub > 0;
            const phaseRanges = getPhaseRanges(j);
            const jobStart   = j.wip_start || j.quote_accept_date;
            const jobDue     = j.wip_due;

            // Build bar elements
            const bars = [];
            if (phaseRanges) {
              phaseRanges.forEach((ph, idx) => {
                const bs = ph.start < colDates[0] ? colDates[0] : ph.start;
                const be = ph.end   > rangeEnd    ? rangeEnd    : ph.end;
                if (bs >= rangeEnd || be <= colDates[0]) return;
                const si = Math.max(0, Math.round((parseDate(bs) - parseDate(colDates[0])) / ms));
                const ei = Math.min(cols, Math.round((parseDate(be) - parseDate(colDates[0])) / ms));
                const lx = si * effColW, bw = Math.max(3, (ei - si) * effColW);
                bars.push(
                  <div key={idx} className={`${styles.gBar} ${ph.cls}`}
                    style={{ left: NAME_W + lx, width: bw }}
                    title={`${ph.label}: ${ph.hrs}hrs`}
                  >
                    {ph.label}
                  </div>
                );
              });

              // Progress bar
              if (jobStart && jobDue) {
                const os = jobStart < colDates[0] ? colDates[0] : jobStart;
                const oe = jobDue   > rangeEnd    ? rangeEnd    : jobDue;
                if (os < rangeEnd && oe > colDates[0]) {
                  const si = Math.max(0, Math.round((parseDate(os) - parseDate(colDates[0])) / ms));
                  const ei = Math.min(cols, Math.round((parseDate(oe) - parseDate(colDates[0])) / ms));
                  const bw = Math.max(3, (ei - si) * effColW);
                  const pct = j.wip_complete || 0;
                  bars.push(
                    <div key="progress" className={styles.gProgress}
                      style={{ left: NAME_W + si * effColW, width: bw }}>
                      <div className={styles.gProgressFill} style={{ width: `${pct}%` }} />
                    </div>
                  );
                }
              }
            }

            return (
              <div
                key={j.id}
                className={`${styles.dataRow}${j.wip_completed ? ' ' + styles.completedRow : ''}${isSub ? ' ' + styles.subRow : ''}`}
                style={{ width: finalW }}
              >
                <div className={styles.nameCell} style={{ width: NAME_W }}>
                  <div className={styles.jobNum} style={isSub ? { paddingLeft: 12 } : {}}>
                    {isSub ? '↳ ' : ''}{j.job_number}
                  </div>
                  <div className={styles.jobName} style={{ maxWidth: NAME_W - 28 }}>
                    {j.project || j.client_name || '—'}
                  </div>
                </div>
                {colDates.map(d => {
                  const isToday = d === today;
                  const weekend = unit === 'day' && isWeekend(d);
                  return (
                    <div key={d}
                      className={`${styles.dayCell}${isToday ? ' ' + styles.todayCol : ''}${weekend ? ' ' + styles.weekend : ''}`}
                      style={{ width: effColW }}
                    />
                  );
                })}
                {bars}
              </div>
            );
          }) : (
            <div className="empty-state" style={{ padding: 48 }}>
              <div className="empty-icon">📅</div>
              <div className="empty-text">No jobs to display — add start dates in Project Tracking</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
