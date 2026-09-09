/* ── Constants ──────────────────────────────────────────────────── */
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

const EVENT_COLORS = [
  '#6366f1','#ef4444','#f59e0b','#10b981','#3b82f6','#ec4899','#8b5cf6','#f97316'
];

/* ── State ──────────────────────────────────────────────────────── */
let db = null;
let events = [];
let viewDate = new Date();          // month currently showing
let selectedDate = null;            // day sheet date
let editingEventId = null;          // event being edited (null = new)
let selectedColor = EVENT_COLORS[0];
let reminderTimers = [];

/* ── Utilities ──────────────────────────────────────────────────── */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function fmtFullDate(d) {
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function eventsOnDate(dateStr) {
  return events.filter(e => {
    const start = e.start_time.slice(0, 10);
    const end   = (e.end_time || e.start_time).slice(0, 10);
    return dateStr >= start && dateStr <= end;
  }).sort((a, b) => a.start_time < b.start_time ? -1 : 1);
}

function localDatetime(dateStr, timeStr) {
  // Build an ISO string in local time then convert to UTC for storage
  const s = timeStr ? `${dateStr}T${timeStr}:00` : `${dateStr}T00:00:00`;
  return new Date(s).toISOString();
}

/* ── Boot ───────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  // Check config
  if (
    typeof SUPABASE_URL === 'undefined' ||
    SUPABASE_URL.includes('YOUR_PROJECT_ID') ||
    typeof SUPABASE_ANON_KEY === 'undefined' ||
    SUPABASE_ANON_KEY.includes('YOUR_ANON_KEY')
  ) {
    show('config-error');
    return;
  }

  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const name = localStorage.getItem('cal_name');
  if (!name) {
    show('name-setup');
    setupNameScreen();
  } else {
    startApp();
  }
});

/* ── Name screen ────────────────────────────────────────────────── */
function setupNameScreen() {
  const input  = document.getElementById('name-input');
  const submit = document.getElementById('name-submit');

  function confirmName() {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    localStorage.setItem('cal_name', v);
    hide('name-setup');
    startApp();
  }

  submit.addEventListener('click', confirmName);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmName(); });
  setTimeout(() => input.focus(), 100);
}

/* ── App start ──────────────────────────────────────────────────── */
async function startApp() {
  show('main-app');
  buildColorPicker();
  attachListeners();
  renderCalendar();
  updateGreeting();

  const { data, error } = await db
    .from('events')
    .select('*')
    .order('start_time', { ascending: true });

  if (!error && data) {
    events = data;
    renderCalendar();
    scheduleReminders();
    requestNotifPermission();
  }

  // Real-time subscription
  db.channel('events-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, payload => {
      if (payload.eventType === 'INSERT') {
        events.push(payload.new);
      } else if (payload.eventType === 'UPDATE') {
        const i = events.findIndex(e => e.id === payload.new.id);
        if (i >= 0) events[i] = payload.new; else events.push(payload.new);
      } else if (payload.eventType === 'DELETE') {
        events = events.filter(e => e.id !== payload.old.id);
      }
      renderCalendar();
      if (selectedDate) renderDaySheet(selectedDate);
      scheduleReminders();
    })
    .subscribe();
}

/* ── Greeting ───────────────────────────────────────────────────── */
function updateGreeting() {
  const name = localStorage.getItem('cal_name') || '';
  const h = new Date().getHours();
  const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  document.getElementById('greeting').textContent = `Good ${part}, ${name}`;
}

/* ── Calendar render ────────────────────────────────────────────── */
function renderCalendar() {
  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();

  document.getElementById('month-year').textContent = `${MONTHS[month]} ${year}`;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = isoDate(new Date());

  // Previous month padding
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = firstDow - 1; i >= 0; i--) {
    const cell = makeCell(null, prevMonthDays - i, true);
    grid.appendChild(cell);
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dateStr = isoDate(date);
    const isToday = dateStr === today;
    const isSelected = selectedDate && dateStr === isoDate(selectedDate);
    const dayEvents = eventsOnDate(dateStr);

    const cell = document.createElement('div');
    cell.className = 'cal-cell' +
      (isToday    ? ' today'    : '') +
      (isSelected ? ' selected' : '');
    cell.dataset.date = dateStr;

    const numEl = document.createElement('div');
    numEl.className = 'day-num';
    numEl.textContent = d;
    cell.appendChild(numEl);

    if (dayEvents.length) {
      const dotsEl = document.createElement('div');
      dotsEl.className = 'event-dots';

      const MAX_BARS = 2;
      const bars = dayEvents.slice(0, MAX_BARS);
      const extra = dayEvents.length - MAX_BARS;

      bars.forEach(ev => {
        if (ev.all_day) {
          const bar = document.createElement('div');
          bar.className = 'event-bar';
          bar.style.background = ev.color || EVENT_COLORS[0];
          bar.textContent = ev.title;
          cell.appendChild(bar);
        } else {
          const dot = document.createElement('div');
          dot.className = 'event-dot';
          dot.style.background = ev.color || EVENT_COLORS[0];
          dotsEl.appendChild(dot);
        }
      });

      if (dotsEl.children.length) cell.appendChild(dotsEl);

      if (extra > 0) {
        const more = document.createElement('div');
        more.className = 'more-label';
        more.textContent = `+${extra} more`;
        cell.appendChild(more);
      }
    }

    cell.addEventListener('click', () => openDaySheet(date));
    grid.appendChild(cell);
  }

  // Next month padding
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const nextPad = totalCells - firstDow - daysInMonth;
  for (let i = 1; i <= nextPad; i++) {
    grid.appendChild(makeCell(null, i, true));
  }
}

function makeCell(date, day, otherMonth) {
  const cell = document.createElement('div');
  cell.className = 'cal-cell' + (otherMonth ? ' empty' : '');
  const numEl = document.createElement('div');
  numEl.className = 'day-num' + (otherMonth ? ' other-month' : '');
  numEl.textContent = day;
  cell.appendChild(numEl);
  return cell;
}

/* ── Day sheet ──────────────────────────────────────────────────── */
function openDaySheet(date) {
  selectedDate = date;
  renderCalendar();
  renderDaySheet(date);

  document.getElementById('day-sheet').classList.add('open');
  document.getElementById('sheet-backdrop').classList.add('visible');
}

function renderDaySheet(date) {
  const dateStr = isoDate(date);
  document.getElementById('sheet-date-label').textContent = fmtFullDate(date);

  const list = document.getElementById('sheet-events-list');
  list.innerHTML = '';

  const dayEvts = eventsOnDate(dateStr);

  if (!dayEvts.length) {
    const empty = document.createElement('div');
    empty.className = 'no-events';
    empty.textContent = 'No events — tap + Add to create one.';
    list.appendChild(empty);
    return;
  }

  dayEvts.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `
      <div class="event-stripe" style="background:${ev.color || EVENT_COLORS[0]}"></div>
      <div class="event-info">
        <div class="event-name">${escHtml(ev.title)}</div>
        <div class="event-meta">${ev.all_day ? 'All day' : (fmtTime(ev.start_time) + (ev.end_time ? ' – ' + fmtTime(ev.end_time) : ''))}</div>
        ${ev.description ? `<div class="event-meta">${escHtml(ev.description)}</div>` : ''}
        <div class="event-creator">Added by ${escHtml(ev.created_by)}</div>
      </div>
    `;
    item.addEventListener('click', () => openEventModal(ev));
    list.appendChild(item);
  });
}

function closeDaySheet() {
  document.getElementById('day-sheet').classList.remove('open');
  document.getElementById('sheet-backdrop').classList.remove('visible');
}

/* ── Event modal ────────────────────────────────────────────────── */
function openEventModal(ev = null) {
  editingEventId = ev ? ev.id : null;
  const isNew = !ev;

  document.getElementById('modal-heading').textContent = isNew ? 'New Event' : 'Edit Event';
  document.getElementById('delete-btn').classList.toggle('hidden', isNew);

  // Reset form
  document.getElementById('evt-title').value   = ev ? ev.title : '';
  document.getElementById('evt-notes').value   = ev ? (ev.description || '') : '';
  document.getElementById('evt-allday').checked = ev ? ev.all_day : false;
  document.getElementById('evt-reminder').value = ev ? (ev.reminder_minutes || '') : '';

  if (ev) {
    document.getElementById('evt-date').value  = ev.start_time.slice(0, 10);
    document.getElementById('evt-start').value = ev.all_day ? '' : ev.start_time.slice(11, 16);
    document.getElementById('evt-end').value   = ev.end_time ? ev.end_time.slice(11, 16) : '';
    selectedColor = ev.color || EVENT_COLORS[0];
  } else {
    // Default to selected day or today
    const base = selectedDate || new Date();
    document.getElementById('evt-date').value  = isoDate(base);
    document.getElementById('evt-start').value = '';
    document.getElementById('evt-end').value   = '';
    selectedColor = EVENT_COLORS[0];
  }

  updateColorPicker();
  toggleTimeFields();

  document.getElementById('event-modal').classList.add('open');
  document.getElementById('modal-backdrop').classList.add('visible');
  setTimeout(() => document.getElementById('evt-title').focus(), 300);
}

function closeEventModal() {
  document.getElementById('event-modal').classList.remove('open');
  document.getElementById('modal-backdrop').classList.remove('visible');
}

function toggleTimeFields() {
  const allDay = document.getElementById('evt-allday').checked;
  document.getElementById('time-fields').style.display = allDay ? 'none' : '';
}

/* ── Color picker ───────────────────────────────────────────────── */
function buildColorPicker() {
  const picker = document.getElementById('color-picker');
  EVENT_COLORS.forEach(c => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (c === selectedColor ? ' selected' : '');
    swatch.style.background = c;
    swatch.dataset.color = c;
    swatch.setAttribute('role', 'radio');
    swatch.setAttribute('aria-label', c);
    swatch.addEventListener('click', () => {
      selectedColor = c;
      updateColorPicker();
    });
    picker.appendChild(swatch);
  });
}

function updateColorPicker() {
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === selectedColor);
  });
}

/* ── Save / Delete ──────────────────────────────────────────────── */
async function saveEvent(e) {
  e.preventDefault();

  const title   = document.getElementById('evt-title').value.trim();
  const allDay  = document.getElementById('evt-allday').checked;
  const dateVal = document.getElementById('evt-date').value;
  const startV  = document.getElementById('evt-start').value;
  const endV    = document.getElementById('evt-end').value;
  const remind  = document.getElementById('evt-reminder').value;
  const notes   = document.getElementById('evt-notes').value.trim();

  if (!title || !dateVal) return;

  const payload = {
    title,
    description:      notes || null,
    start_time:       allDay ? `${dateVal}T00:00:00Z` : localDatetime(dateVal, startV || '09:00'),
    end_time:         allDay ? `${dateVal}T23:59:00Z` : (endV ? localDatetime(dateVal, endV) : null),
    all_day:          allDay,
    reminder_minutes: remind ? parseInt(remind, 10) : null,
    color:            selectedColor,
    created_by:       localStorage.getItem('cal_name') || 'Someone',
  };

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  let error;
  if (editingEventId) {
    ({ error } = await db.from('events').update(payload).eq('id', editingEventId));
  } else {
    ({ error } = await db.from('events').insert(payload));
  }

  btn.disabled = false;
  btn.textContent = 'Save';

  if (error) {
    alert('Could not save: ' + error.message);
    return;
  }

  closeEventModal();
}

async function deleteEvent() {
  if (!editingEventId) return;
  if (!confirm('Delete this event?')) return;

  const { error } = await db.from('events').delete().eq('id', editingEventId);
  if (error) { alert('Delete failed: ' + error.message); return; }
  closeEventModal();
}

/* ── Notifications / Reminders ──────────────────────────────────── */
function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    const banner = document.getElementById('notif-banner');
    if (banner) {
      banner.classList.add('show');
      banner.querySelector('button').addEventListener('click', () => {
        Notification.requestPermission().then(() => banner.classList.remove('show'));
      }, { once: true });
      setTimeout(() => banner.classList.remove('show'), 8000);
    }
  }
}

function scheduleReminders() {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];

  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = Date.now();
  const horizon = now + 48 * 60 * 60 * 1000; // only schedule within 48h

  events.forEach(ev => {
    if (!ev.reminder_minutes) return;
    const eventMs   = new Date(ev.start_time).getTime();
    const reminderMs = eventMs - ev.reminder_minutes * 60 * 1000;
    const delay     = reminderMs - now;

    if (delay > 0 && reminderMs < horizon) {
      const t = setTimeout(() => {
        const mins = ev.reminder_minutes;
        const label = mins >= 1440 ? `${mins/1440} day(s)` :
                      mins >= 60   ? `${mins/60} hour(s)` : `${mins} min`;
        new Notification(ev.title, {
          body: `Starting in ${label}`,
          icon: '/icon.svg',
          tag:  `reminder-${ev.id}`,
        });
      }, delay);
      reminderTimers.push(t);
    }
  });
}

/* ── Event listeners ────────────────────────────────────────────── */
function attachListeners() {
  // Month navigation
  document.getElementById('prev-month').addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderCalendar();
  });

  document.getElementById('next-month').addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderCalendar();
  });

  document.getElementById('today-btn').addEventListener('click', () => {
    viewDate = new Date();
    selectedDate = null;
    renderCalendar();
    closeDaySheet();
  });

  // Add event button (main)
  document.getElementById('add-btn').addEventListener('click', () => openEventModal());

  // Add event from day sheet
  document.getElementById('sheet-add-btn').addEventListener('click', () => {
    closeDaySheet();
    setTimeout(() => openEventModal(), 100);
  });

  // All-day toggle
  document.getElementById('evt-allday').addEventListener('change', toggleTimeFields);

  // Form submit
  document.getElementById('event-form').addEventListener('submit', saveEvent);

  // Delete
  document.getElementById('delete-btn').addEventListener('click', deleteEvent);

  // Close buttons
  document.getElementById('modal-close').addEventListener('click', closeEventModal);

  // Backdrops
  document.getElementById('sheet-backdrop').addEventListener('click', () => {
    closeDaySheet();
    selectedDate = null;
    renderCalendar();
  });

  document.getElementById('modal-backdrop').addEventListener('click', closeEventModal);

  // Notification banner
  const banner = buildNotifBanner();
  document.body.appendChild(banner);
}

function buildNotifBanner() {
  const div = document.createElement('div');
  div.id = 'notif-banner';
  div.innerHTML = `<span>Enable reminders?</span><button>Allow</button>`;
  div.querySelector('button').addEventListener('click', () => {
    Notification.requestPermission().then(p => {
      div.classList.remove('show');
      if (p === 'granted') scheduleReminders();
    });
  });
  return div;
}

/* ── Helpers ────────────────────────────────────────────────────── */
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
