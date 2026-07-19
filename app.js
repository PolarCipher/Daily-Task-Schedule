(function () {
  'use strict';

  const AUTO_SCHEDULE_HORIZON_WEEKS = 26; // ~6 months out, comfortably covers season-out tasks

  // Must match the width in style.css's "Week view: phone-width layout" media
  // query — plain CSS has no way to expose a computed media-query value to
  // JS, so this one number is an unavoidable, hand-kept duplicate.
  const MOBILE_BREAKPOINT = 640; // px
  // A MediaQueryList is cheap to hold but wasteful to recreate every render
  // (render() fires on every action and on a 60s timer) — build it once.
  const mobileMQL = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
  function isMobileWeekView() {
    return mobileMQL.matches;
  }

  const BRAIN_BREAKS = [
    'Quick trivia: what’s the standard slope for drain pipe? (¼ inch of drop per foot)',
    'Mental math: a ¾" pipe flows ~8 GPM at 8 ft/s — roughly what would a 1" pipe flow at the same velocity?',
    'Sketch one process improvement idea for the task you just finished.',
    '60-second shoulder & wrist stretch — you’ve earned it.',
    'Name three tools you’d invent if you could.',
    'Quick riddle: what has to be broken before you can use it? (An egg)',
    'Recall: what’s the typical max trap seal depth code requires? (2–4 inches)',
    'Step outside for 2 minutes of fresh air.',
    'Mental puzzle: if a job takes 2 people 3 hours, how long would it take 3 people at the same rate?',
    'Text or call someone you like, just to say hi.',
    'Write down one thing that’s going well this week.',
    'Quick trivia: copper pipe became widely used in U.S. plumbing starting around which decade? (1960s)',
    'Do 10 jumping jacks or take a quick lap around the shop.',
    'Think of a better name for your least favorite tool.',
    'Hydrate — go refill your water bottle.',
    'Plan tomorrow’s first task in your head before you forget the idea.',
    'Quick riddle: I’m tall when I’m young and short when I’m old. What am I? (A candle)',
    'Listen to one song you actually like.',
    'Doodle the floor plan of the area you’re working in, from memory.',
    'Give yourself credit — say out loud one thing you did well today.'
  ];
  let currentBreakPrompt = BRAIN_BREAKS[Math.floor(Math.random() * BRAIN_BREAKS.length)];

  let state = Store.load();
  Store.migrate(state);
  Store.rollover(state, new Date());
  let saveFailed = !Store.save(state);

  // ---------- View (browsing) state — not persisted, always starts on "now" ----------
  let viewMode = 'week'; // 'week' | 'month'
  let viewWeekStart = Store.activeWeekStart(new Date());
  let viewMonth = monthKeyOf(new Date());
  let editingTaskId = null;

  function dayIndexOf(date) {
    const k = Store.dayKeyOf(date);
    return k ? Scheduler.DAYS.indexOf(k) : 0;
  }
  // Which day column is focused in the mobile single-day view. Only matters
  // below the phone-width breakpoint — desktop shows all 5 days at once.
  let viewDayIndex = dayIndexOf(new Date());

  function monthKeyOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function uid() {
    return 't_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatDateLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function persistAndRender() {
    saveFailed = !Store.save(state);
    render();
  }

  // ---------- Header ----------
  function renderHeader() {
    const now = new Date();
    const activeWeek = Store.activeWeekStart(now);
    const activeWeekState = Store.ensureWeek(state, activeWeek);
    const flexLeft = Scheduler.WEEKLY_FLEX_BUDGET - Scheduler.totalFlexUsed(activeWeekState);
    const todayKey = Store.dayKeyOf(now);
    const warningChip = saveFailed
      ? '<span class="stat-chip warning">⚠ Not saving — your browser is blocking storage (private mode?)</span>'
      : '';
    document.getElementById('headerStats').innerHTML = `
      ${warningChip}
      <span class="stat-chip">This week: <b>${activeWeek}</b></span>
      <span class="stat-chip">Flex left: <b>${flexLeft}h</b> / ${Scheduler.WEEKLY_FLEX_BUDGET}h</span>
      <span class="stat-chip">${todayKey ? escapeHtml(Scheduler.DAY_LABELS[todayKey]) : 'Weekend'}</span>
    `;
  }

  // ---------- Backlog ----------
  function renderBacklogItem(t, i, len) {
    if (t.id === editingTaskId) {
      return `<li class="backlog-item editing" data-id="${t.id}">
        <input type="text" class="edit-name" value="${escapeHtml(t.name)}">
        <input type="number" class="edit-hours" min="0.25" step="0.25" value="${t.estHours}" title="Est. hours">
        <input type="number" class="edit-people" min="1" step="1" value="${t.people}" title="People">
        <select class="edit-load">
          <option value="low" ${t.load === 'low' ? 'selected' : ''}>Low</option>
          <option value="medium" ${t.load === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high" ${t.load === 'high' ? 'selected' : ''}>High</option>
        </select>
        <input type="date" class="edit-notbefore" value="${t.notBefore || ''}" title="Not before">
        <button type="button" class="small primary" data-action="save-edit" data-id="${t.id}">Save</button>
        <button type="button" class="small ghost" data-action="cancel-edit" data-id="${t.id}">Cancel</button>
      </li>`;
    }
    const notBeforeChip = t.notBefore ? `<span class="meta">📅 not before ${escapeHtml(t.notBefore)}</span>` : '';
    return `<li class="backlog-item">
      <span class="load-badge ${t.load}">${t.load}</span>
      <span class="name">${escapeHtml(t.name)}</span>
      <span class="meta">${t.estHours}h · ${t.people}p</span>
      ${notBeforeChip}
      <button type="button" class="ghost small" data-action="reorder-up" data-id="${t.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="ghost small" data-action="reorder-down" data-id="${t.id}" ${i === len - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="ghost small" data-action="start-edit" data-id="${t.id}">✎</button>
      <button type="button" class="ghost small" data-action="delete-task" data-id="${t.id}">✕</button>
    </li>`;
  }

  function renderBacklog() {
    const el = document.getElementById('backlogContent');
    const queued = state.tasks.filter(t => t.status === 'queued').sort((a, b) => a.order - b.order);
    if (!queued.length) {
      el.innerHTML = '<p class="empty-hint">Backlog is empty — add a task above, then hit Auto-Schedule.</p>';
      return;
    }
    el.innerHTML = '<ul class="backlog-list">' + queued.map((t, i) => renderBacklogItem(t, i, queued.length)).join('') + '</ul>';
  }

  // ---------- Week/Month nav ----------
  function renderScheduleNav() {
    const el = document.getElementById('scheduleNav');
    const label = viewMode === 'week'
      ? `Week of ${viewWeekStart}`
      : new Date(viewMonth + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    // Only shown on phone-width screens (see .mobile-day-nav in style.css) —
    // desktop shows all 5 days at once, so there's no single "day" to step through.
    const mobileDayNav = viewMode === 'week'
      ? `<div class="mobile-day-nav">
          <button type="button" class="small" data-action="scroll-day" data-dir="-1">‹ Day</button>
          <span class="nav-label">${Scheduler.DAY_LABELS[Scheduler.DAYS[viewDayIndex]]}</span>
          <button type="button" class="small" data-action="scroll-day" data-dir="1">Day ›</button>
        </div>`
      : '';
    el.innerHTML = `
      <div class="nav-row">
        <div class="view-toggle">
          <button type="button" class="small ${viewMode === 'week' ? 'primary' : ''}" data-action="set-view" data-mode="week">Week</button>
          <button type="button" class="small ${viewMode === 'month' ? 'primary' : ''}" data-action="set-view" data-mode="month">Month</button>
        </div>
        <div class="nav-controls">
          <button type="button" class="small" data-action="nav-prev">← Prev</button>
          <button type="button" class="small" data-action="nav-today">Today</button>
          <button type="button" class="small" data-action="nav-next">Next →</button>
          <span class="nav-label">${label}</span>
        </div>
      </div>
      ${mobileDayNav}`;
  }

  function renderWeekSettings() {
    const weekState = Store.ensureWeek(state, viewWeekStart);
    const used = Scheduler.totalFlexUsed(weekState);
    const el = document.getElementById('weekSettings');
    el.innerHTML = `
      <label style="display:flex;align-items:center;gap:6px;">
        <input type="checkbox" id="wedFlexToggle" ${weekState.wedAutoFlexEnabled !== false ? 'checked' : ''}>
        Weeknight Meeting this Wednesday (auto-reserve 4–5pm Flex)
      </label>
      <span>Flex used: <b>${used}/${Scheduler.WEEKLY_FLEX_BUDGET}h</b> this week — click an open hour below to toggle Flex</span>
    `;
    document.getElementById('wedFlexToggle').addEventListener('change', (e) => {
      weekState.wedAutoFlexEnabled = e.target.checked;
      persistAndRender();
    });
  }

  function styleFor(start, end, totalStart, rangeMin) {
    const top = ((start - totalStart) / rangeMin) * 100;
    const height = ((end - start) / rangeMin) * 100;
    return `top:${top}%;height:${height}%`;
  }

  // A day column's horizontal position within .week-grid's own scrollable
  // content, independent of ancestor positioning. offsetLeft won't do here:
  // it's measured relative to the nearest *positioned* ancestor, and nothing
  // between .week-grid and <body> sets position, so it was picking up extra
  // padding from #app and .panel along the way instead of being relative to
  // the grid itself.
  function columnOffsetX(gridEl, colEl) {
    return colEl.getBoundingClientRect().left - gridEl.getBoundingClientRect().left + gridEl.scrollLeft;
  }

  // Measured live from the DOM rather than hardcoded, so it can never drift
  // out of sync with style.css's --gutter-width the way a duplicated JS
  // constant could.
  function gutterWidth(gridEl) {
    const gutterEl = gridEl.querySelector('.time-gutter');
    return gutterEl ? gutterEl.getBoundingClientRect().width : 0;
  }

  // Scrolls .week-grid so the given day sits flush against the sticky gutter.
  // behavior: 'instant' to restore position after a re-render (no visible
  // motion), 'smooth' when the user explicitly navigates via the Day buttons.
  function scrollToDay(gridEl, dayIndex, behavior) {
    const targetCol = gridEl.querySelector(`.day-col[data-day="${Scheduler.DAYS[dayIndex]}"]`);
    if (targetCol) gridEl.scrollTo({ left: columnOffsetX(gridEl, targetCol) - gutterWidth(gridEl), behavior });
  }

  // Which day column is currently most scrolled-into-view, used to keep
  // viewDayIndex in sync after the user swipes/drags rather than just when
  // they tap the Day buttons.
  function closestDayIndex(gridEl) {
    const gw = gutterWidth(gridEl);
    const cols = gridEl.querySelectorAll('.day-col');
    let closest = 0;
    let bestDist = Infinity;
    cols.forEach((col, i) => {
      const dist = Math.abs((columnOffsetX(gridEl, col) - gw) - gridEl.scrollLeft);
      if (dist < bestDist) { bestDist = dist; closest = i; }
    });
    return closest;
  }

  function renderWeekGrid() {
    const now = new Date();
    const todayDateStr = Store.toDateStr(now);
    const weekState = Store.ensureWeek(state, viewWeekStart);
    const totalStart = Scheduler.DAY_START;
    const totalEnd = Scheduler.DAY_END;
    const rangeMin = totalEnd - totalStart;

    let gutterHtml = '';
    for (let h = totalStart; h < totalEnd; h += 60) {
      const top = ((h - totalStart) / rangeMin) * 100;
      gutterHtml += `<div class="hour-label" style="top:${top}%">${Scheduler.minutesToLabel(h)}</div>`;
    }
    // Anchored to the bottom edge instead of a top offset, so its text renders
    // upward from the boundary and stays inside the box — a top:100% label
    // would render *below* the box and get clipped by overflow-y: hidden.
    gutterHtml += `<div class="hour-label" style="bottom:0">${Scheduler.minutesToLabel(totalEnd)}</div>`;

    let html = '<div class="week-grid">';
    html += `<div class="time-gutter">
      <div class="day-col-head">&nbsp;</div>
      <div class="gutter-timeline">${gutterHtml}</div>
    </div>`;
    for (const day of Scheduler.DAYS) {
      const dateStr = Store.dateForWeekDay(viewWeekStart, day);
      let blocksHtml = '';

      blocksHtml += `<div class="day-block lunch" style="${styleFor(Scheduler.LUNCH_START, Scheduler.LUNCH_END, totalStart, rangeMin)}">Lunch</div>`;

      if (day === 'wed' && weekState.wedAutoFlexEnabled !== false) {
        blocksHtml += `<div class="day-block flex-block" style="${styleFor(Scheduler.WED_MEETING_PREP, Scheduler.DAY_END, totalStart, rangeMin)}">Flex (meeting prep)</div>`;
      }

      for (const h of (weekState.flexBlocks[day] || [])) {
        blocksHtml += `<div class="day-block flex-block" data-action="toggle-flex" data-day="${day}" data-hour="${h}" style="${styleFor(h, h + 60, totalStart, rangeMin)}">Flex</div>`;
      }

      const dayTasks = state.tasks.filter(t => (t.blocks || []).some(b => b.dateStr === dateStr));
      for (const t of dayTasks) {
        for (const b of t.blocks.filter(x => x.dateStr === dateStr)) {
          const cls = `day-block load-${t.load} ${t.status === 'done' ? 'done' : ''}`;
          blocksHtml += `<div class="${cls}" title="${escapeHtml(t.name)}" style="${styleFor(b.start, b.end, totalStart, rangeMin)}">${escapeHtml(t.name)}</div>`;
        }
      }

      for (let h = totalStart; h < totalEnd; h += 60) {
        if (h >= Scheduler.LUNCH_START && h < Scheduler.LUNCH_END) continue;
        if (day === 'wed' && weekState.wedAutoFlexEnabled !== false && h >= Scheduler.WED_MEETING_PREP) continue;
        if ((weekState.flexBlocks[day] || []).includes(h)) continue;
        const occupied = dayTasks.some(t => t.blocks.some(b => b.dateStr === dateStr && b.start < h + 60 && b.end > h));
        if (occupied) continue;
        blocksHtml += `<div class="day-block flex-empty" data-action="toggle-flex" data-day="${day}" data-hour="${h}" style="${styleFor(h, h + 60, totalStart, rangeMin)}">+ Flex</div>`;
      }

      let gridHtml = '';
      for (let h = totalStart; h <= totalEnd; h += 60) {
        const top = ((h - totalStart) / rangeMin) * 100;
        gridHtml += `<div class="hour-row" style="top:${top}%"></div>`;
      }

      const isToday = dateStr === todayDateStr;
      html += `<div class="day-col" data-day="${day}">
        <div class="day-col-head"><span>${Scheduler.DAY_LABELS[day]}${isToday ? ' 📍' : ''}</span><span class="day-flex">${formatDateLabel(dateStr).split(', ')[1] || ''}</span></div>
        <div class="day-timeline">${gridHtml}${blocksHtml}</div>
      </div>`;
    }
    html += '</div>';
    document.getElementById('weekContent').innerHTML = html;

    // Below MOBILE_BREAKPOINT, .week-grid becomes a swipeable single-day strip
    // (see the matching media query in style.css) with a sticky time gutter
    // pinned over its left edge. This element gets torn down and rebuilt on
    // every render() — including the 60s auto-refresh — so without this, a
    // re-render would silently snap the view back to day 0 (Monday) out from
    // under someone mid-swipe. Restoring is instant (no animation). Manual
    // swipes are tracked separately by a delegated listener registered once
    // in the Wiring section below, rather than re-bound here on every call.
    // Above the breakpoint the grid isn't in this flex/sticky layout at all,
    // so none of this applies — the in-between desktop range (640-880px)
    // keeps its original plain horizontal-scroll-if-needed behavior.
    const gridEl = document.querySelector('.week-grid');
    if (gridEl && isMobileWeekView()) {
      scrollToDay(gridEl, viewDayIndex, 'instant');
    }
  }

  function renderMonthGrid() {
    const now = new Date();
    const todayDateStr = Store.toDateStr(now);
    const rows = Store.monthGrid(viewMonth);
    let html = `<div class="month-head-row">${Scheduler.DAYS.map(d => `<div class="month-head-cell"><span class="full">${Scheduler.DAY_LABELS[d]}</span><span class="abbr">${Scheduler.DAY_LABELS[d].slice(0, 3)}</span></div>`).join('')}</div>`;
    html += '<div class="month-grid">';
    for (const row of rows) {
      for (const cell of row.days) {
        const dayTasks = state.tasks.filter(t => (t.blocks || []).some(b => b.dateStr === cell.dateStr));
        const dateNum = Number(cell.dateStr.split('-')[2]);
        const isToday = cell.dateStr === todayDateStr;
        const shown = dayTasks.slice(0, 3);
        let chips = shown.map(t => `<div class="month-chip load-${t.load} ${t.status === 'done' ? 'done' : ''}">${escapeHtml(t.name)}</div>`).join('');
        if (dayTasks.length > shown.length) chips += `<div class="month-chip-more">+${dayTasks.length - shown.length} more</div>`;
        html += `<div class="month-cell ${cell.inMonth ? '' : 'dim'} ${isToday ? 'today' : ''}" data-action="jump-week" data-date="${cell.dateStr}">
          <div class="month-cell-date">${dateNum}</div>
          <div class="month-cell-tasks">${chips}</div>
        </div>`;
      }
    }
    html += '</div>';
    document.getElementById('weekContent').innerHTML = html;
  }

  function renderSchedulePanel() {
    renderScheduleNav();
    if (viewMode === 'week') {
      document.getElementById('weekSettings').style.display = '';
      renderWeekSettings();
      renderWeekGrid();
    } else {
      document.getElementById('weekSettings').style.display = 'none';
      renderMonthGrid();
    }
  }

  // ---------- Today ----------
  function renderTodayItem(task, packedBlock, todayDateStr, isDone, isCurrent) {
    const dot = `<span class="load-dot ${task.load}"></span>`;
    let timeLabel;
    if (isDone) {
      const b = task.blocks.find(x => x.dateStr === todayDateStr);
      timeLabel = `${Scheduler.minutesToLabel(b.start)}–${Scheduler.minutesToLabel(b.end)} · done in ${task.actualHours}h`;
    } else {
      timeLabel = `${Scheduler.minutesToLabel(packedBlock.start)}–${Scheduler.minutesToLabel(packedBlock.end)}`;
      if (packedBlock.inProgress) timeLabel += ' · in progress';
    }
    let actions;
    if (isDone) {
      actions = '<span>✅</span>';
    } else if (task.status === 'in-progress') {
      actions = `<button type="button" class="small primary" data-action="complete-task" data-id="${task.id}">Done</button>`;
    } else {
      actions = `<button type="button" class="small" data-action="start-task" data-id="${task.id}" ${isCurrent ? '' : 'disabled'}>Start</button>`;
    }
    return `<li class="today-item ${isDone ? 'done' : ''} ${isCurrent && !isDone ? 'current' : ''}">
      ${dot}
      <div class="info">
        <div class="name">${escapeHtml(task.name)} <span class="meta">(${task.people}p)</span></div>
        <div class="time">${timeLabel}</div>
      </div>
      <div class="actions">${actions}</div>
    </li>`;
  }

  function renderToday() {
    const now = new Date();
    const todayKey = Store.dayKeyOf(now);
    const el = document.getElementById('todayContent');
    if (!todayKey) {
      el.innerHTML = '<p class="no-tasks">No scheduled workday today — enjoy your weekend.</p>';
      return;
    }
    const todayDateStr = Store.toDateStr(now);
    const weekStart = Store.toDateStr(Store.mondayOf(now));
    const weekState = Store.ensureWeek(state, weekStart);
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const todaysTasks = state.tasks.filter(t => (t.blocks || []).some(b => b.dateStr === todayDateStr));
    if (!todaysTasks.length) {
      el.innerHTML = '<p class="no-tasks">Nothing scheduled yet today. Add tasks to the backlog, then hit <b>Auto-Schedule</b>.</p>';
      return;
    }

    const { packed, freeMinutesLeft } = Scheduler.repackToday(todayDateStr, todayKey, weekState, todaysTasks, nowMin);

    const doneToday = todaysTasks
      .filter(t => t.status === 'done')
      .sort((a, b) => a.blocks.find(x => x.dateStr === todayDateStr).start - b.blocks.find(x => x.dateStr === todayDateStr).start);

    let html = '<ul class="today-checklist">';
    for (const t of doneToday) html += renderTodayItem(t, null, todayDateStr, true, false);
    packed.forEach((p, i) => {
      const t = todaysTasks.find(x => x.id === p.taskId);
      html += renderTodayItem(t, p, todayDateStr, false, i === 0);
    });
    html += '</ul>';

    if (freeMinutesLeft > 0 && packed.length) {
      html += `<div class="free-time-banner">🎉 Running ahead — about ${Scheduler.hoursLabel(freeMinutesLeft)} of free time left today if things keep finishing early. Take a break, pull in a backlog task, or head out early.</div>`;
    }
    el.innerHTML = html;
  }

  // ---------- Motivation / fatigue ----------
  function renderLoadChart() {
    let rows = '';
    for (const day of Scheduler.DAYS) {
      const dateStr = Store.dateForWeekDay(viewWeekStart, day);
      const dayTasks = state.tasks.filter(t => (t.blocks || []).some(b => b.dateStr === dateStr));
      let low = 0, medium = 0, high = 0;
      for (const t of dayTasks) {
        const mins = t.blocks.filter(b => b.dateStr === dateStr).reduce((s, b) => s + (b.end - b.start), 0);
        const hrs = mins / 60;
        if (t.load === 'low') low += hrs; else if (t.load === 'medium') medium += hrs; else high += hrs;
      }
      const scale = 8;
      rows += `<div class="load-bar-row">
        <span class="day-name">${Scheduler.DAY_LABELS[day].slice(0, 3)}</span>
        <div class="load-bar-track">
          <div class="load-bar-seg low" style="width:${(low / scale) * 100}%"></div>
          <div class="load-bar-seg medium" style="width:${(medium / scale) * 100}%"></div>
          <div class="load-bar-seg high" style="width:${(high / scale) * 100}%"></div>
        </div>
      </div>`;
    }
    return `<div class="load-bar-chart"><div class="load-chart-caption">Load for week of ${viewWeekStart}</div>${rows}</div>
      <div class="legend">
        <span><i style="background:var(--low)"></i> Low brain</span>
        <span><i style="background:var(--medium)"></i> Medium</span>
        <span><i style="background:var(--high)"></i> High / engaging</span>
      </div>`;
  }

  function renderMotivation() {
    const now = new Date();
    const todayKey = Store.dayKeyOf(now);
    const todayDateStr = Store.toDateStr(now);
    const weekStart = Store.toDateStr(Store.mondayOf(now));
    const weekState = Store.ensureWeek(state, weekStart);
    const el = document.getElementById('motivationContent');

    let fatigueHtml = '';
    let breakCardHtml = '';

    if (todayKey) {
      const todaysTasks = state.tasks.filter(t => (t.blocks || []).some(b => b.dateStr === todayDateStr));
      const blocks = [];
      for (const t of todaysTasks) {
        const b = t.blocks.find(x => x.dateStr === todayDateStr);
        if (t.status === 'done') {
          blocks.push({ start: b.start, end: b.start + t.actualHours * 60, load: t.load });
        } else if (t.status === 'in-progress' && t.startedAtMinutes != null) {
          const nowMin = now.getHours() * 60 + now.getMinutes();
          blocks.push({ start: t.startedAtMinutes, end: nowMin, load: t.load });
        }
      }
      for (const brk of (weekState.breaksTaken[todayKey] || [])) blocks.push({ start: brk.start, end: brk.end, type: 'break' });
      blocks.sort((a, b) => a.start - b.start);

      const { fatigue, breakSuggested } = Scheduler.computeFatigue(blocks);
      const level = Scheduler.fatigueLevel(fatigue);
      const pct = Math.min(100, Math.round((fatigue / 10) * 100));
      fatigueHtml = `
        <div class="fatigue-gauge">
          <div class="fatigue-track"><div class="fatigue-fill ${level.tier}" style="width:${pct}%"></div></div>
          <div class="fatigue-label"><span>${level.label}</span><span>${fatigue}/10</span></div>
        </div>`;

      if (breakSuggested) {
        breakCardHtml = `
          <div class="break-card">
            <strong>🧠 Brain-break time.</strong>
            <div class="prompt">${escapeHtml(currentBreakPrompt)}</div>
            <button type="button" class="small primary" data-action="log-break">Log a 15-min brain break</button>
            <button type="button" class="small ghost" data-action="shuffle-break">Give me another</button>
          </div>`;
      }
    } else {
      fatigueHtml = '<p class="no-tasks">No workday today.</p>';
    }

    const streak = state.stats.streak || 0;
    const total = state.stats.totalCompleted || 0;
    const activeWeek = Store.activeWeekStart(now);
    const activeWeekState = Store.ensureWeek(state, activeWeek);
    const flexLeft = Scheduler.WEEKLY_FLEX_BUDGET - Scheduler.totalFlexUsed(activeWeekState);
    const statsHtml = `
      <div class="stats-row">
        <div class="mini-stat"><div class="num">${streak}</div><div class="label">day streak</div></div>
        <div class="mini-stat"><div class="num">${total}</div><div class="label">tasks done</div></div>
        <div class="mini-stat"><div class="num">${flexLeft}h</div><div class="label">flex left</div></div>
      </div>`;

    el.innerHTML = fatigueHtml + breakCardHtml + statsHtml + renderLoadChart();
  }

  // ---------- Actions ----------
  function buildOccupiedByDate() {
    const map = {};
    for (const t of state.tasks) {
      if (t.status === 'queued') continue;
      for (const b of (t.blocks || [])) {
        (map[b.dateStr] = map[b.dateStr] || []).push([b.start, b.end]);
      }
    }
    return map;
  }

  function buildSlotSequence(startWeekStart, horizonWeeks, todayInfo) {
    const seq = [];
    let ws = startWeekStart;
    for (let w = 0; w < horizonWeeks; w++) {
      const startDayIdx = (todayInfo && ws === todayInfo.weekStart) ? Scheduler.DAYS.indexOf(todayInfo.day) : 0;
      for (let di = startDayIdx; di < Scheduler.DAYS.length; di++) {
        const day = Scheduler.DAYS[di];
        const dateStr = Store.dateForWeekDay(ws, day);
        const slot = { weekStart: ws, day, dateStr };
        if (todayInfo && ws === todayInfo.weekStart && day === todayInfo.day) slot.clipMinute = todayInfo.minute;
        seq.push(slot);
      }
      ws = Store.addDays(ws, 7);
    }
    return seq;
  }

  function handleAutoSchedule() {
    const now = new Date();
    const startWeekStart = Store.activeWeekStart(now);
    const todayKey = Store.dayKeyOf(now);
    const todayInfo = (todayKey && startWeekStart === Store.toDateStr(Store.mondayOf(now)))
      ? { weekStart: startWeekStart, day: todayKey, minute: now.getHours() * 60 + now.getMinutes() }
      : null;

    const seq = buildSlotSequence(startWeekStart, AUTO_SCHEDULE_HORIZON_WEEKS, todayInfo);
    const getWeekState = (ws) => Store.ensureWeek(state, ws);
    const occupied = buildOccupiedByDate();
    const queuedTasks = state.tasks.filter(t => t.status === 'queued');
    const { scheduled, unscheduled } = Scheduler.scheduleForward(queuedTasks, getWeekState, seq, occupied);

    for (const st of scheduled) {
      const orig = state.tasks.find(t => t.id === st.id);
      orig.status = 'scheduled';
      orig.blocks = st.blocks;
    }
    persistAndRender();
    if (unscheduled.length) {
      window.setTimeout(() => {
        alert(`${unscheduled.length} task(s) didn’t fit within the next ${AUTO_SCHEDULE_HORIZON_WEEKS} weeks — check for a far-out "Not before" date, or the backlog is just very full. They’ll stay in the backlog.`);
      }, 10);
    }
  }

  function handleStartTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    const now = new Date();
    t.status = 'in-progress';
    t.startedAt = now.toISOString();
    t.startedAtMinutes = now.getHours() * 60 + now.getMinutes();
    persistAndRender();
  }

  function handleCompleteTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    const now = new Date();
    let actualHours;
    if (t.status === 'in-progress' && t.startedAtMinutes != null) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      actualHours = Math.max(0.25, Math.round(((nowMin - t.startedAtMinutes) / 60) * 4) / 4);
    } else {
      actualHours = t.estHours;
    }
    t.status = 'done';
    t.actualHours = actualHours;
    state.stats.totalCompleted = (state.stats.totalCompleted || 0) + 1;
    persistAndRender();
  }

  function handleDeleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    persistAndRender();
  }

  function handleReorder(id, dir) {
    const queued = state.tasks.filter(t => t.status === 'queued').sort((a, b) => a.order - b.order);
    const idx = queued.findIndex(t => t.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= queued.length) return;
    const a = queued[idx], b = queued[swapIdx];
    const tmp = a.order; a.order = b.order; b.order = tmp;
    persistAndRender();
  }

  function handleSaveEdit(id, li) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    const name = li.querySelector('.edit-name').value.trim();
    const hours = parseFloat(li.querySelector('.edit-hours').value);
    const people = parseInt(li.querySelector('.edit-people').value, 10);
    const load = li.querySelector('.edit-load').value;
    const notBefore = li.querySelector('.edit-notbefore').value || null;
    if (name) t.name = name;
    if (hours > 0) t.estHours = hours;
    if (people > 0) t.people = people;
    t.load = load;
    t.notBefore = notBefore;
    editingTaskId = null;
    persistAndRender();
  }

  function handleToggleFlex(day, hour) {
    const weekState = Store.ensureWeek(state, viewWeekStart);
    const arr = weekState.flexBlocks[day];
    const idx = arr.indexOf(hour);
    if (idx >= 0) {
      arr.splice(idx, 1);
    } else {
      if (Scheduler.totalFlexUsed(weekState) >= Scheduler.WEEKLY_FLEX_BUDGET) {
        alert('You’ve used all 5 Flex hours for this week.');
        return;
      }
      arr.push(hour);
    }
    persistAndRender();
  }

  function logBreak() {
    const now = new Date();
    const todayKey = Store.dayKeyOf(now);
    if (!todayKey) return;
    const weekStart = Store.toDateStr(Store.mondayOf(now));
    const weekState = Store.ensureWeek(state, weekStart);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    weekState.breaksTaken[todayKey].push({ start: Math.max(0, nowMin - 15), end: nowMin });
    currentBreakPrompt = BRAIN_BREAKS[Math.floor(Math.random() * BRAIN_BREAKS.length)];
    persistAndRender();
  }

  function shuffleBreakPrompt() {
    let next;
    do {
      next = BRAIN_BREAKS[Math.floor(Math.random() * BRAIN_BREAKS.length)];
    } while (next === currentBreakPrompt && BRAIN_BREAKS.length > 1);
    currentBreakPrompt = next;
    render();
  }

  function handleNav(dir) {
    if (viewMode === 'week') {
      viewWeekStart = Store.addDays(viewWeekStart, dir * 7);
    } else {
      const [y, m] = viewMonth.split('-').map(Number);
      const d = new Date(y, m - 1 + dir, 1);
      viewMonth = monthKeyOf(d);
    }
    render();
  }

  function handleNavToday() {
    const now = new Date();
    viewWeekStart = Store.activeWeekStart(now);
    viewMonth = monthKeyOf(now);
    viewDayIndex = dayIndexOf(now);
    render();
  }

  function handleJumpWeek(dateStr) {
    viewWeekStart = Store.toDateStr(Store.mondayOf(new Date(dateStr + 'T00:00:00')));
    viewMode = 'week';
    viewDayIndex = dayIndexOf(new Date(dateStr + 'T00:00:00'));
    render();
  }

  // Mobile day-nav buttons: moves the swipeable single-day view without a
  // full re-render, so it can animate smoothly instead of jumping instantly.
  function handleScrollDay(dir) {
    viewDayIndex = Math.max(0, Math.min(Scheduler.DAYS.length - 1, viewDayIndex + dir));
    const gridEl = document.querySelector('.week-grid');
    if (gridEl) scrollToDay(gridEl, viewDayIndex, 'smooth');
    renderScheduleNav(); // update the "Day" label/buttons without touching scroll position
  }

  // ---------- Wiring ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    switch (action) {
      case 'start-task': handleStartTask(el.dataset.id); break;
      case 'complete-task': handleCompleteTask(el.dataset.id); break;
      case 'delete-task': handleDeleteTask(el.dataset.id); break;
      case 'reorder-up': handleReorder(el.dataset.id, -1); break;
      case 'reorder-down': handleReorder(el.dataset.id, 1); break;
      case 'start-edit': editingTaskId = el.dataset.id; render(); break;
      case 'cancel-edit': editingTaskId = null; render(); break;
      case 'save-edit': handleSaveEdit(el.dataset.id, el.closest('li')); break;
      case 'toggle-flex': handleToggleFlex(el.dataset.day, Number(el.dataset.hour)); break;
      case 'log-break': logBreak(); break;
      case 'shuffle-break': shuffleBreakPrompt(); break;
      case 'set-view': viewMode = el.dataset.mode; render(); break;
      case 'nav-prev': handleNav(-1); break;
      case 'nav-next': handleNav(1); break;
      case 'nav-today': handleNavToday(); break;
      case 'jump-week': handleJumpWeek(el.dataset.date); break;
      case 'scroll-day': handleScrollDay(Number(el.dataset.dir)); break;
    }
  });

  // Tracks manual swipes on the mobile single-day view so viewDayIndex stays
  // correct even when the user drags rather than tapping the Day buttons.
  // Registered once here (not inside renderWeekGrid) because .week-grid is
  // torn down and rebuilt on every render() — a listener bound directly to
  // it would need re-binding every time and could fire against an already-
  // detached node. scroll events don't bubble, so this needs the capture
  // phase on #weekContent, which — unlike .week-grid — is never replaced,
  // only its contents are.
  let scrollSettleTimer = null;
  document.getElementById('weekContent').addEventListener('scroll', (e) => {
    const gridEl = e.target;
    if (!gridEl.classList || !gridEl.classList.contains('week-grid')) return;
    clearTimeout(scrollSettleTimer);
    scrollSettleTimer = setTimeout(() => {
      viewDayIndex = closestDayIndex(gridEl);
    }, 120);
  }, true);

  document.getElementById('scheduleWeekBtn').addEventListener('click', handleAutoSchedule);

  document.getElementById('addTaskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('taskName');
    const name = nameInput.value.trim();
    const hours = parseFloat(document.getElementById('taskHours').value);
    const people = parseInt(document.getElementById('taskPeople').value, 10);
    let load = document.getElementById('taskLoad').value;
    if (load === 'auto') load = Scheduler.guessLoad(name);
    const notBefore = document.getElementById('taskNotBefore').value || null;
    if (!name || !(hours > 0) || !(people > 0)) return;

    state.tasks.push({
      id: uid(), name, estHours: hours, people, load, notBefore,
      status: 'queued', order: state.nextOrder++, blocks: [],
      startedAt: null, startedAtMinutes: null, actualHours: null
    });
    e.target.reset();
    document.getElementById('taskHours').value = '1';
    document.getElementById('taskPeople').value = '1';
    document.getElementById('loadHint').textContent = ' ';
    persistAndRender();
  });

  document.getElementById('taskName').addEventListener('input', (e) => {
    const guess = Scheduler.guessLoad(e.target.value);
    document.getElementById('loadHint').textContent = e.target.value.trim() ? `Suggested: ${guess}` : ' ';
  });

  function render() {
    renderHeader();
    renderToday();
    renderMotivation();
    renderBacklog();
    renderSchedulePanel();
  }

  render();
  window.setInterval(render, 60000);
})();
