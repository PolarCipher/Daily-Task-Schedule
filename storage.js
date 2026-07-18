/**
 * Persistence + date/week bookkeeping. No DOM. Loadable in browser (window.Store)
 * or Node for testing (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Store = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'pts_scheduler_v1';
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  function mondayOf(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 Sun ... 6 Sat
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  // dayKey for "today" ('mon'..'fri'), or null on a weekend.
  function dayKeyOf(date) {
    const idx = date.getDay(); // 0 Sun..6 Sat
    if (idx === 0 || idx === 6) return null;
    return DAYS[idx - 1];
  }

  // The Monday this app should currently be planning against: this week's Monday
  // on a weekday, or next week's Monday on a weekend (nothing left to schedule this week).
  function activeWeekStart(now) {
    const dow = now.getDay();
    if (dow === 0 || dow === 6) {
      const addDays = dow === 0 ? 1 : 2;
      const nextMon = new Date(now);
      nextMon.setDate(nextMon.getDate() + addDays);
      return toDateStr(mondayOf(nextMon));
    }
    return toDateStr(mondayOf(now));
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  function dateForWeekDay(weekStart, day) {
    return addDays(weekStart, DAYS.indexOf(day));
  }

  // Rows of weeks covering `yearMonth` ('YYYY-MM'), each a { weekStart, days: [{dateStr, inMonth}, ...5] }.
  // Always full Mon-Fri weeks (may include padding days from the adjacent month).
  function monthGrid(yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number);
    const firstOfMonth = new Date(y, m - 1, 1);
    const lastOfMonth = new Date(y, m, 0);
    let weekMonday = mondayOf(firstOfMonth);
    const rows = [];
    while (weekMonday <= lastOfMonth) {
      const days = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(weekMonday);
        d.setDate(d.getDate() + i);
        days.push({ dateStr: toDateStr(d), inMonth: d.getMonth() === m - 1 });
      }
      rows.push({ weekStart: toDateStr(weekMonday), days });
      weekMonday = new Date(weekMonday);
      weekMonday.setDate(weekMonday.getDate() + 7);
    }
    return rows;
  }

  function defaultWeekState(weekStart) {
    return {
      weekStart,
      flexBlocks: { mon: [], tue: [], wed: [], thu: [], fri: [] },
      wedAutoFlexEnabled: true,
      breaksTaken: { mon: [], tue: [], wed: [], thu: [], fri: [] }
    };
  }

  function defaultState() {
    const weekStart = toDateStr(mondayOf(new Date()));
    return {
      version: 1,
      tasks: [],
      weeks: { [weekStart]: defaultWeekState(weekStart) },
      stats: { totalCompleted: 0, streak: 0, lastRolloverDate: toDateStr(new Date()) },
      nextOrder: 1
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) return defaultState();
      return parsed;
    } catch (e) {
      console.warn('Failed to load saved schedule, starting fresh.', e);
      return defaultState();
    }
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function ensureWeek(state, weekStart) {
    if (!state.weeks[weekStart]) {
      state.weeks[weekStart] = defaultWeekState(weekStart);
    }
    return state.weeks[weekStart];
  }

  /**
   * One-time upgrade for state saved before blocks carried their own dateStr/weekStart:
   * backfill dateStr on legacy blocks from the task-level _weekStart, then drop
   * _weekStart — block identity is now self-contained (weekStart+day+dateStr per block),
   * which is required now that a single task's blocks can span multiple weeks.
   */
  function migrate(state) {
    for (const t of state.tasks) {
      if (t._weekStart && Array.isArray(t.blocks)) {
        for (const b of t.blocks) {
          if (!b.dateStr) b.dateStr = dateForWeekDay(t._weekStart, b.day);
          if (!b.weekStart) b.weekStart = t._weekStart;
        }
      }
      delete t._weekStart;
      if (t.notBefore === undefined) t.notBefore = null;
    }
    return state;
  }

  /**
   * Run once per session load (idempotent within a calendar day):
   *  - Any in-progress task left running from a prior date is un-started (its startedAt
   *    no longer means anything once the day has turned over).
   *  - Any task still 'scheduled'/'in-progress' with no block on today or later gets
   *    requeued (its day happened without it, so it needs re-planning). Tasks with a
   *    future block — e.g. scheduled weeks or months out — are left alone.
   *  - Daily completion streak: if a previous workday had scheduled tasks and all
   *    finished, streak += 1; if any were left unfinished, streak resets to 0.
   */
  function rollover(state, now) {
    const todayStr = toDateStr(now);
    if (state.stats.lastRolloverDate === todayStr) return state; // already done today

    const prevDate = new Date(state.stats.lastRolloverDate + 'T00:00:00');
    const prevDateStr = toDateStr(prevDate);
    const prevDayKey = dayKeyOf(prevDate);

    if (prevDayKey) {
      const prevDayTasks = state.tasks.filter(t => (t.blocks || []).some(b => b.dateStr === prevDateStr));
      if (prevDayTasks.length) {
        const allDone = prevDayTasks.every(t => t.status === 'done');
        state.stats.streak = allDone ? (state.stats.streak || 0) + 1 : 0;
      }
    }

    for (const t of state.tasks) {
      if (t.status === 'in-progress' && t.startedAt) {
        const startedDateStr = toDateStr(new Date(t.startedAt));
        if (startedDateStr < todayStr) {
          t.status = 'scheduled';
          t.startedAt = null;
          t.startedAtMinutes = null;
        }
      }
      if (t.status === 'scheduled' || t.status === 'in-progress') {
        const hasCurrentOrFutureBlock = (t.blocks || []).some(b => b.dateStr >= todayStr);
        if (!hasCurrentOrFutureBlock) {
          t.status = 'queued';
          t.blocks = [];
          t.startedAt = null;
          t.startedAtMinutes = null;
        }
      }
    }

    state.stats.lastRolloverDate = todayStr;
    return state;
  }

  return {
    KEY, DAYS, toDateStr, mondayOf, dayKeyOf, activeWeekStart, addDays, dateForWeekDay, monthGrid,
    defaultWeekState, defaultState, load, save, ensureWeek, migrate, rollover
  };
});
