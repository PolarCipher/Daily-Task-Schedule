/**
 * Pure scheduling logic — no DOM. Loadable in the browser (window.Scheduler)
 * or in Node for testing (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Scheduler = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };

  const DAY_START = 8 * 60;          // 8:00 AM
  const LUNCH_START = 12 * 60;       // 12:00 PM
  const LUNCH_END = 13 * 60;         // 1:00 PM
  const DAY_END = 17 * 60;           // 5:00 PM
  const WED_MEETING_PREP = 16 * 60;  // 4:00 PM — default Flex hour ahead of the 7:30 PM Weeknight Meeting

  const WEEKLY_FLEX_BUDGET = 5; // hours

  // Rough keyword heuristics so new tasks get a sane default cognitive-load tag.
  const LOW_KEYWORDS = ['clean', 'flush', 'inspect', 'check', 'wipe', 'sweep', 'restock',
    'tidy', 'drain', 'sort', 'stock', 'sanitize', 'vacuum', 'routine', 'refill', 'label'];
  const HIGH_KEYWORDS = ['diagnose', 'troubleshoot', 'repair', 'install', 'redesign', 'design',
    'calibrate', 'estimate', 'propose', 'plan', 'train', 'learn', 'investigate', 'leak', 'emergency'];

  function guessLoad(name) {
    const n = (name || '').toLowerCase();
    if (HIGH_KEYWORDS.some(k => n.includes(k))) return 'high';
    if (LOW_KEYWORDS.some(k => n.includes(k))) return 'low';
    return 'medium';
  }

  function getBaseWindows(day) {
    if (day === 'wed') {
      return [[DAY_START, LUNCH_START], [LUNCH_END, WED_MEETING_PREP]];
    }
    return [[DAY_START, LUNCH_START], [LUNCH_END, DAY_END]];
  }

  // Subtract a set of [start,end) blocked ranges from a set of [start,end) free windows.
  function subtractRanges(windows, blocked) {
    let result = windows.map(w => [w[0], w[1]]);
    for (const [bs, be] of blocked) {
      const next = [];
      for (const [ws, we] of result) {
        if (be <= ws || bs >= we) { next.push([ws, we]); continue; }
        if (bs > ws) next.push([ws, Math.min(bs, we)]);
        if (be < we) next.push([Math.max(be, ws), we]);
      }
      result = next;
    }
    return result.filter(([s, e]) => e > s);
  }

  function getFlexRanges(day, weekState) {
    const ranges = (weekState.flexBlocks[day] || []).map(h => [h, h + 60]);
    if (day === 'wed' && weekState.wedAutoFlexEnabled !== false) {
      ranges.push([WED_MEETING_PREP, WED_MEETING_PREP + 60]);
    }
    return ranges;
  }

  function getAvailableSlots(day, weekState, clipStart) {
    const windows = getBaseWindows(day);
    const flex = getFlexRanges(day, weekState);
    let free = subtractRanges(windows, flex);
    if (typeof clipStart === 'number') {
      free = subtractRanges(free, [[0, clipStart]]);
    }
    return free;
  }

  function totalFlexUsed(weekState) {
    let total = 0;
    for (const day of DAYS) {
      total += (weekState.flexBlocks[day] || []).length;
      if (day === 'wed' && weekState.wedAutoFlexEnabled !== false) total += 1;
    }
    return total;
  }

  /**
   * Greedy-fill scheduler across an arbitrary sequence of day-slots, possibly spanning
   * many weeks. Does not mutate input tasks.
   *
   * tasks: candidate 'queued' tasks (each needs id, order, estHours, notBefore?).
   * getWeekState(weekStart): returns the weekState for a given Monday date-string
   *   (flex blocks etc.) — called lazily so future weeks can be created on demand.
   * slotSequence: ordered list of { weekStart, day, dateStr, clipMinute? }. `day` is a
   *   weekday abbreviation (drives lunch/flex windows), `dateStr` is the real calendar
   *   date (drives notBefore eligibility + block identity). clipMinute, if set, restricts
   *   that single slot to start no earlier than that minute (for "today, from now on").
   * occupiedByDate: optional { [dateStr]: [[start,end], ...] } of ranges already claimed
   *   by other (already-scheduled) tasks, so re-running this doesn't double-book.
   *
   * A task with a notBefore date-string is skipped (leaving room for lower-priority but
   * currently-eligible tasks) until slot.dateStr >= task.notBefore.
   */
  function scheduleForward(tasks, getWeekState, slotSequence, occupiedByDate) {
    const queue = tasks
      .filter(t => t.status === 'queued')
      .sort((a, b) => a.order - b.order)
      .map(t => Object.assign({}, t, { blocks: [], _remainingMin: Math.round(t.estHours * 60) }));

    const scheduled = [];
    for (const slot of slotSequence) {
      const weekState = getWeekState(slot.weekStart);
      let free = getAvailableSlots(slot.day, weekState, slot.clipMinute);
      const occ = (occupiedByDate && occupiedByDate[slot.dateStr]) || [];
      if (occ.length) free = subtractRanges(free, occ);

      for (const [slotStart, slotEnd] of free) {
        let cursor = slotStart;
        while (cursor < slotEnd) {
          const idx = queue.findIndex(t => !t.notBefore || t.notBefore <= slot.dateStr);
          if (idx === -1) break;
          const task = queue[idx];
          const room = slotEnd - cursor;
          const alloc = Math.min(room, task._remainingMin);
          if (alloc <= 0) break;
          task.blocks.push({ weekStart: slot.weekStart, day: slot.day, dateStr: slot.dateStr, start: cursor, end: cursor + alloc });
          task._remainingMin -= alloc;
          cursor += alloc;
          if (task._remainingMin <= 0) {
            scheduled.push(task);
            queue.splice(idx, 1);
          }
        }
      }
    }
    return { scheduled, unscheduled: queue };
  }

  /**
   * Repack today's not-yet-finished blocks back-to-back starting from `nowMinutes`,
   * so a task finishing early pulls everything after it forward. Does not touch other days.
   * todayDateStr identifies "today" unambiguously across weeks; todayDayKey ('mon'..'fri')
   * drives the lunch/flex window shape.
   */
  function repackToday(todayDateStr, todayDayKey, weekState, tasks, nowMinutes) {
    const items = [];
    for (const task of tasks) {
      if (task.status === 'done') continue;
      const block = (task.blocks || []).find(b => b.dateStr === todayDateStr);
      if (!block) continue;
      if (task.status === 'in-progress' && task.startedAtMinutes != null) {
        const elapsed = Math.max(0, nowMinutes - task.startedAtMinutes);
        const estMin = Math.round(task.estHours * 60);
        items.push({ task, minutes: Math.max(10, estMin - elapsed), origStart: block.start, inProgress: true });
      } else {
        items.push({ task, minutes: block.end - block.start, origStart: block.start, inProgress: false });
      }
    }
    items.sort((a, b) => a.origStart - b.origStart);

    const windows = getAvailableSlots(todayDayKey, weekState, nowMinutes);
    const packed = [];
    let wi = 0;
    let cursor = windows.length ? windows[0][0] : null;
    for (const item of items) {
      let remaining = item.minutes;
      while (remaining > 0 && wi < windows.length) {
        if (cursor >= windows[wi][1]) { wi++; cursor = windows[wi] ? windows[wi][0] : null; continue; }
        const room = windows[wi][1] - cursor;
        const alloc = Math.min(room, remaining);
        packed.push({ taskId: item.task.id, start: cursor, end: cursor + alloc, inProgress: item.inProgress });
        cursor += alloc;
        remaining -= alloc;
      }
    }
    const totalFree = windows.reduce((s, w) => s + (w[1] - w[0]), 0);
    const totalNeeded = items.reduce((s, i) => s + i.minutes, 0);
    return { packed, freeMinutesLeft: Math.max(0, totalFree - totalNeeded) };
  }

  function minutesToLabel(min) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    const period = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }

  function hoursLabel(min) {
    const h = min / 60;
    return (Math.round(h * 100) / 100) + 'h';
  }

  // Fatigue model: low-brain work accumulates fatigue, engaging (high) work relieves it,
  // breaks relieve it. Weights are heuristic, tuned to feel right rather than "correct".
  const FATIGUE_BREAK_HOURS = 2; // consecutive low/medium hours before a break is suggested

  function computeFatigue(dayBlocksInOrder) {
    let fatigue = 0;
    let consecutiveLowMed = 0;
    let breakSuggested = false;
    for (const b of dayBlocksInOrder) {
      if (b.type === 'break') {
        fatigue = Math.max(0, fatigue - 1.5);
        consecutiveLowMed = 0;
        continue;
      }
      const hours = (b.end - b.start) / 60;
      const weight = b.load === 'low' ? 1 : b.load === 'medium' ? 0.5 : -0.5;
      fatigue = Math.max(0, fatigue + weight * hours);
      if (b.load === 'high') {
        consecutiveLowMed = 0;
      } else {
        consecutiveLowMed += hours;
      }
      if (consecutiveLowMed >= FATIGUE_BREAK_HOURS) breakSuggested = true;
    }
    return { fatigue: Math.round(fatigue * 10) / 10, breakSuggested };
  }

  function fatigueLevel(fatigue) {
    if (fatigue < 3) return { label: 'Fresh', tier: 'fresh' };
    if (fatigue < 6) return { label: 'Getting Tired', tier: 'tiring' };
    if (fatigue < 8) return { label: 'Foggy', tier: 'foggy' };
    return { label: 'Burnt Out', tier: 'burnt' };
  }

  return {
    DAYS, DAY_LABELS, DAY_START, LUNCH_START, LUNCH_END, DAY_END, WED_MEETING_PREP, WEEKLY_FLEX_BUDGET,
    guessLoad, getBaseWindows, subtractRanges, getFlexRanges, getAvailableSlots, totalFlexUsed,
    scheduleForward, repackToday, minutesToLabel, hoursLabel,
    computeFatigue, fatigueLevel, FATIGUE_BREAK_HOURS
  };
});
