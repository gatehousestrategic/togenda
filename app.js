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
let holidays = [];   // [{date, title, type: 'jewish'|'us'}]
let viewDate = new Date();
let selectedDate = null;
let editingEventId = null;
let selectedColor = EVENT_COLORS[0];
let reminderTimers = [];
let currentView = 'dashboard';    // 'dashboard' | 'calendar'

/* ── Utilities ──────────────────────────────────────────────────── */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtTimeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'p' : 'a';
  const hour = h % 12 || 12;
  return m ? `${hour}:${String(m).padStart(2,'0')}${ampm}` : `${hour}${ampm}`;
}

function fmtFullDate(d) {
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function eventsOnDate(dateStr) {
  return events.filter(e => {
    const start = e.start_time.slice(0, 10);
    const end   = (e.end_time || e.start_time).slice(0, 10);
    return dateStr >= start && dateStr <= end;
  }).sort((a, b) => (a.start_time < b.start_time ? -1 : 1));
}

function holidaysOnDate(dateStr, type = null) {
  return holidays.filter(h => h.date === dateStr && (!type || h.type === type));
}

function localDatetime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr || '00:00'}:00`).toISOString();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Notification preferences ───────────────────────────────────── */
function notifGlobalOn()  { return localStorage.getItem('notif_opt_out') !== 'true'; }
function setNotifGlobal(on) {
  if (on) localStorage.removeItem('notif_opt_out');
  else     localStorage.setItem('notif_opt_out', 'true');
}

function getMutedEvents() {
  try { return new Set(JSON.parse(localStorage.getItem('muted_events') || '[]')); }
  catch { return new Set(); }
}
function setMutedEvents(set) {
  localStorage.setItem('muted_events', JSON.stringify([...set]));
}
function toggleMuteEvent(id) {
  const s = getMutedEvents();
  if (s.has(id)) s.delete(id); else s.add(id);
  setMutedEvents(s);
  scheduleReminders();
}
function isEventMuted(id) { return getMutedEvents().has(id); }

/* ── Holiday loading ────────────────────────────────────────────── */
async function loadAllHolidays() {
  holidays = [];   // clear before (re-)loading to prevent duplicates
  const thisYear = new Date().getFullYear();
  await Promise.all([
    loadJewishHolidays(thisYear),
    loadUSHolidays(thisYear),
  ]);
}

async function loadJewishHolidays(thisYear) {
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];
  const seen  = new Set();
  for (const year of years) {
    try {
      const res  = await fetch(
        `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mf=on&year=${year}&month=x&c=off`
      );
      const data = await res.json();
      (data.items || [])
        .filter(h => ['holiday','minor','mf'].includes(h.category))
        .forEach(h => {
          const date  = h.date.slice(0, 10);
          const title = cleanJewishTitle(h.title);
          const key   = `${date}|${title}`;
          // yomtov:true = full holiday; everything else (fasts, erev, CH"M, selichot) is minor
          const type  = h.yomtov === true ? 'jewish' : 'jewish-minor';
          if (!seen.has(key)) { seen.add(key); holidays.push({ date, title, type }); }
        });
    } catch {}
  }
}

async function loadUSHolidays(thisYear) {
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];
  const seen  = new Set();
  for (const year of years) {
    try {
      const res  = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/US`);
      const data = await res.json();
      (data || []).forEach(h => {
        const date  = h.date;
        const title = shortenUSTitle(h.localName || h.name);
        const key   = `${date}|${title}`;
        if (!seen.has(key)) { seen.add(key); holidays.push({ date, title, type: 'us' }); }
      });
    } catch {}
  }
}

function cleanJewishTitle(title) {
  let t = title.replace(/\s+5\d{3}$/, '').trim();
  t = t.replace(/^Chanukah:.*$/i, 'Chanukah');
  return t;
}

const US_TITLE_MAP = {
  "Martin Luther King, Jr. Day": "MLK Day",
  "Washington's Birthday": "Presidents' Day",
  "Juneteenth National Independence Day": "Juneteenth",
  "Thanksgiving Day": "Thanksgiving",
  "Christmas Day": "Christmas",
  "New Year's Day": "New Year's Day",
  "Independence Day": "July 4th",
};

function shortenUSTitle(title) {
  return US_TITLE_MAP[title] || title;
}

/* ── Boot ───────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
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

  db.auth.onAuthStateChange((event, session) => {
    if (session) {
      hide('sign-in');
      const name = localStorage.getItem('cal_name');
      if (!name) {
        show('name-setup');
        setupNameScreen();
      } else {
        hide('name-setup');
        startApp();
      }
    } else {
      hide('main-app');
      hide('name-setup');
      show('sign-in');
      setupSignIn();
    }
  });
});

/* ── Sign-in screen ─────────────────────────────────────────────── */
function setupSignIn() {
  const emailEl  = document.getElementById('si-email');
  const passEl   = document.getElementById('si-password');
  const submitEl = document.getElementById('si-submit');
  const errorEl  = document.getElementById('si-error');

  const newSubmit = submitEl.cloneNode(true);
  submitEl.parentNode.replaceChild(newSubmit, submitEl);

  async function doSignIn() {
    const email    = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) return;

    newSubmit.disabled = true;
    newSubmit.textContent = 'Signing in…';
    errorEl.classList.add('hidden');

    const { error } = await db.auth.signInWithPassword({ email, password });
    newSubmit.disabled = false;
    newSubmit.textContent = 'Sign In';

    if (error) {
      errorEl.textContent = 'Incorrect email or password.';
      errorEl.classList.remove('hidden');
      passEl.value = '';
      passEl.focus();
    }
  }

  newSubmit.addEventListener('click', doSignIn);
  [emailEl, passEl].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') doSignIn(); })
  );
  setTimeout(() => emailEl.focus(), 100);
}

/* ── Name screen ────────────────────────────────────────────────── */
function setupNameScreen() {
  const input  = document.getElementById('name-input');
  const submit = document.getElementById('name-submit');
  const newBtn = submit.cloneNode(true);
  submit.parentNode.replaceChild(newBtn, submit);

  function confirmName() {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    localStorage.setItem('cal_name', v);
    hide('name-setup');
    startApp();
  }

  newBtn.addEventListener('click', confirmName);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmName(); });
  setTimeout(() => input.focus(), 100);
}

/* ── App start ──────────────────────────────────────────────────── */
let appStarted = false;
async function startApp() {
  if (appStarted) return;
  appStarted = true;
  show('main-app');
  buildColorPicker();
  attachListeners();
  switchView('calendar');

  // Load events
  const { data, error } = await db
    .from('events')
    .select('*')
    .order('start_time', { ascending: true });

  if (!error && data) {
    events = data;
    renderDashboard();
    renderCalendar();
    scheduleReminders();
    requestNotifPermission();
  }

  // Load holidays in the background
  loadAllHolidays().then(() => {
    renderDashboard();
    renderCalendar();
  });

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
      renderDashboard();
      renderCalendar();
      if (selectedDate) renderDaySheet(selectedDate);
      scheduleReminders();
    })
    .subscribe();
}

/* ── View switching ─────────────────────────────────────────────── */
function switchView(v) {
  currentView = v;

  // Headers
  document.getElementById('header-dashboard').classList.toggle('hidden', v !== 'dashboard');
  document.getElementById('header-calendar').classList.toggle('hidden', v !== 'calendar');
  document.getElementById('dow-row').classList.toggle('hidden', v !== 'calendar');

  // Views
  document.getElementById('view-dashboard').classList.toggle('hidden', v !== 'dashboard');
  document.getElementById('view-calendar').classList.toggle('hidden', v !== 'calendar');

  // Tabs
  document.getElementById('tab-dashboard').classList.toggle('active', v === 'dashboard');
  document.getElementById('tab-calendar').classList.toggle('active', v === 'calendar');

  if (v === 'dashboard') renderDashboard();
  if (v === 'calendar')  renderCalendar();
}

/* ── Dashboard render ───────────────────────────────────────────── */
function renderDashboard() {
  const today    = new Date();
  const todayStr = isoDate(today);

  document.getElementById('dash-date').textContent =
    today.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  renderWeekStrip(today, todayStr);

  // Today list
  const todayEvts     = eventsOnDate(todayStr);
  const todayHolidays = holidaysOnDate(todayStr);
  const todayList     = document.getElementById('dash-today-list');
  todayList.innerHTML = '';

  todayHolidays.forEach(h => todayList.appendChild(makeHolidayItem(h)));
  todayEvts.forEach(ev => todayList.appendChild(makeDashEventItem(ev)));

  if (!todayEvts.length && !todayHolidays.length) {
    const el = document.createElement('div');
    el.className = 'dash-empty';
    el.textContent = 'Nothing scheduled — enjoy the day!';
    todayList.appendChild(el);
  }

  // Coming up — next 14 days, capped at 8 items total
  const upcomingList = document.getElementById('dash-upcoming-list');
  upcomingList.innerHTML = '';
  let count = 0;
  const CAP = 8;

  for (let i = 1; i <= 14 && count < CAP; i++) {
    const d    = new Date(today);
    d.setDate(today.getDate() + i);
    const dStr = isoDate(d);

    const dayEvts     = eventsOnDate(dStr);
    const dayHolidays = holidaysOnDate(dStr);
    if (!dayEvts.length && !dayHolidays.length) continue;

    const relLabel  = i === 1 ? 'Tomorrow' : `In ${i} days`;
    const dateLabel = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

    const hdr = document.createElement('div');
    hdr.className = 'dash-day-header';
    hdr.innerHTML = `<span class="dash-rel">${relLabel}</span><span class="dash-rel-date">${dateLabel}</span>`;
    upcomingList.appendChild(hdr);

    dayHolidays.forEach(h => { if (count < CAP) { upcomingList.appendChild(makeHolidayItem(h)); count++; } });
    dayEvts.forEach(ev    => { if (count < CAP) { upcomingList.appendChild(makeDashEventItem(ev)); count++; } });
  }

  if (!count) {
    const el = document.createElement('div');
    el.className = 'dash-empty';
    el.textContent = 'Nothing in the next 2 weeks';
    upcomingList.appendChild(el);
  }
}

function renderWeekStrip(today, todayStr) {
  const strip = document.getElementById('dash-week-strip');
  if (!strip) return;
  strip.innerHTML = '';

  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  const LETTERS = ['S','M','T','W','T','F','S'];

  for (let i = 0; i < 7; i++) {
    const d    = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    const dStr = isoDate(d);
    const isToday  = dStr === todayStr;
    const hasStuff = eventsOnDate(dStr).length > 0 || holidaysOnDate(dStr).length > 0;

    const btn = document.createElement('button');
    btn.className = 'week-day' + (isToday ? ' week-day--today' : '');
    btn.innerHTML = `
      <span class="week-letter">${LETTERS[i]}</span>
      <span class="week-num">${d.getDate()}</span>
      <span class="week-dot${hasStuff ? ' week-dot--on' : ''}"></span>
    `;
    btn.addEventListener('click', () => {
      switchView('calendar');
      viewDate = new Date(d.getFullYear(), d.getMonth(), 1);
      selectedDate = new Date(d);
      renderCalendar();
      openDaySheet(new Date(d));
    });
    strip.appendChild(btn);
  }
}

function makeDashEventItem(ev) {
  const item = document.createElement('div');
  item.className = 'dash-event-item';
  item.innerHTML = `
    <div class="event-stripe" style="background:${ev.color || EVENT_COLORS[0]}"></div>
    <div class="event-info">
      <div class="event-name">${escHtml(ev.title)}</div>
      <div class="event-meta">${ev.all_day ? 'All day' : fmtTime(ev.start_time)}${ev.created_by ? ' · ' + escHtml(ev.created_by) : ''}</div>
    </div>
  `;
  item.addEventListener('click', () => openEventModal(ev));
  return item;
}

function holidayLabel(type) {
  if (type === 'jewish') return 'Jewish Holiday';
  if (type === 'jewish-minor') return 'Jewish observance';
  return 'Federal Holiday';
}

function makeHolidayItem(h) {
  const item = document.createElement('div');
  item.className = 'dash-event-item';
  item.style.cursor = 'default';
  item.innerHTML = `
    <div class="holiday-stripe holiday-stripe--${h.type}"></div>
    <div class="event-info">
      <div class="event-name${h.type === 'jewish-minor' ? ' event-name--minor' : ''}">${escHtml(h.title)}</div>
      <div class="event-meta holiday-meta">${holidayLabel(h.type)}</div>
    </div>
  `;
  return item;
}

/* ── Calendar render ────────────────────────────────────────────── */
function renderCalendar() {
  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();

  document.getElementById('month-year').textContent = `${MONTHS[month]} ${year}`;

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const firstDow     = new Date(year, month, 1).getDay();
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const prevMonthEnd = new Date(year, month, 0).getDate();
  const today        = isoDate(new Date());

  // Previous month filler
  for (let i = firstDow - 1; i >= 0; i--) {
    grid.appendChild(makeEmptyCell(prevMonthEnd - i));
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const date    = new Date(year, month, d);
    const dateStr = isoDate(date);
    const isToday = dateStr === today;
    const isSelected = selectedDate && dateStr === isoDate(selectedDate);

    const dayEvts     = eventsOnDate(dateStr);
    const dayHolidays = holidaysOnDate(dateStr);

    const hasJewish      = dayHolidays.some(h => h.type === 'jewish');
    const hasJewishMinor = !hasJewish && dayHolidays.some(h => h.type === 'jewish-minor');
    const hasUS          = dayHolidays.some(h => h.type === 'us');

    const cell = document.createElement('div');
    cell.className = 'cal-cell'
      + (isToday       ? ' today'               : '')
      + (isSelected    ? ' selected'             : '')
      + (hasJewish     ? ' has-holiday-jewish'   : '')
      + (hasJewishMinor? ' has-holiday-jewish-minor' : '')
      + (hasUS         ? ' has-holiday-us'       : '');
    cell.dataset.date = dateStr;

    const numEl = document.createElement('div');
    numEl.className = 'day-num';
    numEl.textContent = d;
    cell.appendChild(numEl);

    // Holiday name bars
    dayHolidays.forEach(h => {
      const bar = document.createElement('div');
      bar.className = `holiday-bar holiday-bar--${h.type}`;
      bar.textContent = h.title;
      cell.appendChild(bar);
    });

    // Event bars — always show name (+ time for timed events)
    const MAX = 3;
    const shown = dayEvts.slice(0, MAX);
    const extra = dayEvts.length - MAX;

    shown.forEach(ev => {
      const bar = document.createElement('div');
      bar.className = 'event-bar';
      bar.style.background = ev.color || EVENT_COLORS[0];
      bar.textContent = ev.all_day ? ev.title : `${fmtTimeShort(ev.start_time)} ${ev.title}`;
      cell.appendChild(bar);
    });

    if (extra > 0) {
      const more = document.createElement('div');
      more.className = 'more-label';
      more.textContent = `+${extra} more`;
      cell.appendChild(more);
    }

    cell.addEventListener('click', () => openDaySheet(date));
    grid.appendChild(cell);
  }

  // Next month filler
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  for (let i = 1; i <= totalCells - firstDow - daysInMonth; i++) {
    grid.appendChild(makeEmptyCell(i));
  }
}

function makeEmptyCell(day) {
  const cell  = document.createElement('div');
  cell.className = 'cal-cell empty';
  const num   = document.createElement('div');
  num.className = 'day-num other-month';
  num.textContent = day;
  cell.appendChild(num);
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

  const list      = document.getElementById('sheet-events-list');
  list.innerHTML  = '';

  const dayHolidays = holidaysOnDate(dateStr);
  const dayEvts     = eventsOnDate(dateStr);

  if (!dayHolidays.length && !dayEvts.length) {
    const el = document.createElement('div');
    el.className = 'no-events';
    el.textContent = 'No events — tap + Add to create one.';
    list.appendChild(el);
    return;
  }

  dayHolidays.forEach(h => {
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `
      <div class="holiday-stripe holiday-stripe--${h.type}"></div>
      <div class="event-info">
        <div class="event-name${h.type === 'jewish-minor' ? ' event-name--minor' : ''}">${escHtml(h.title)}</div>
        <div class="event-meta holiday-meta">${holidayLabel(h.type)}</div>
      </div>
    `;
    list.appendChild(item);
  });

  dayEvts.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'event-item';
    const hasMuteToggle = ev.reminder_minutes && notifGlobalOn() && 'Notification' in window && Notification.permission === 'granted';
    const muted = isEventMuted(ev.id);
    item.innerHTML = `
      <div class="event-stripe" style="background:${ev.color || EVENT_COLORS[0]}"></div>
      <div class="event-info">
        <div class="event-name">${escHtml(ev.title)}</div>
        <div class="event-meta">${ev.all_day ? 'All day' : (fmtTime(ev.start_time) + (ev.end_time ? ' – ' + fmtTime(ev.end_time) : ''))}</div>
        ${ev.description ? `<div class="event-meta">${escHtml(ev.description)}</div>` : ''}
        <div class="event-creator">Added by ${escHtml(ev.created_by)}</div>
        ${hasMuteToggle ? `<button class="mute-toggle ${muted ? 'muted' : ''}" data-id="${ev.id}">
          ${muted ? '🔕 Reminder off for me' : '🔔 Reminder on for me'}
        </button>` : ''}
      </div>
    `;
    item.querySelector('.event-info')?.addEventListener('click', () => openEventModal(ev));
    const muteBtn = item.querySelector('.mute-toggle');
    if (muteBtn) {
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleMuteEvent(ev.id);
        renderDaySheet(date);
      });
    }
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

  document.getElementById('evt-title').value    = ev ? ev.title : '';
  document.getElementById('evt-notes').value    = ev ? (ev.description || '') : '';
  document.getElementById('evt-allday').checked = ev ? ev.all_day : false;
  document.getElementById('evt-reminder').value = ev ? (ev.reminder_minutes || '') : '';

  const base = selectedDate || new Date();
  document.getElementById('evt-date').value  = ev ? ev.start_time.slice(0, 10) : isoDate(base);
  document.getElementById('evt-start').value = ev && !ev.all_day ? ev.start_time.slice(11, 16) : '';
  document.getElementById('evt-end').value   = ev && ev.end_time ? ev.end_time.slice(11, 16) : '';

  selectedColor = ev ? (ev.color || EVENT_COLORS[0]) : EVENT_COLORS[0];
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
  document.getElementById('time-fields').style.display =
    document.getElementById('evt-allday').checked ? 'none' : '';
}

/* ── Color picker ───────────────────────────────────────────────── */
function buildColorPicker() {
  const picker = document.getElementById('color-picker');
  EVENT_COLORS.forEach(c => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (c === selectedColor ? ' selected' : '');
    swatch.style.background = c;
    swatch.dataset.color = c;
    swatch.addEventListener('click', () => { selectedColor = c; updateColorPicker(); });
    picker.appendChild(swatch);
  });
}

function updateColorPicker() {
  document.querySelectorAll('.color-swatch').forEach(s =>
    s.classList.toggle('selected', s.dataset.color === selectedColor)
  );
}

/* ── Save / Delete ──────────────────────────────────────────────── */
async function saveEvent(e) {
  e.preventDefault();

  const title  = document.getElementById('evt-title').value.trim();
  const allDay = document.getElementById('evt-allday').checked;
  const dateV  = document.getElementById('evt-date').value;
  const startV = document.getElementById('evt-start').value;
  const endV   = document.getElementById('evt-end').value;
  const remind = document.getElementById('evt-reminder').value;
  const notes  = document.getElementById('evt-notes').value.trim();

  if (!title || !dateV) return;

  const payload = {
    title,
    description:      notes || null,
    start_time:       allDay ? `${dateV}T00:00:00Z` : localDatetime(dateV, startV || '09:00'),
    end_time:         allDay ? `${dateV}T23:59:00Z` : (endV ? localDatetime(dateV, endV) : null),
    all_day:          allDay,
    reminder_minutes: remind ? parseInt(remind, 10) : null,
    color:            selectedColor,
    created_by:       localStorage.getItem('cal_name') || 'Someone',
  };

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const { error } = editingEventId
    ? await db.from('events').update(payload).eq('id', editingEventId)
    : await db.from('events').insert(payload);

  btn.disabled = false;
  btn.textContent = 'Save';

  if (error) { alert('Could not save: ' + error.message); return; }
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
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  if (!notifGlobalOn()) return;

  // Show again if never dismissed, or if dismissed more than 3 days ago
  const dismissed = parseInt(localStorage.getItem('notif_dismissed') || '0', 10);
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  if (dismissed && Date.now() - dismissed < threeDays) return;

  const banner = document.getElementById('notif-banner');
  if (!banner) return;

  banner.classList.add('show');

  document.getElementById('notif-allow').addEventListener('click', () => {
    Notification.requestPermission().then(p => {
      banner.classList.remove('show');
      localStorage.removeItem('notif_dismissed');
      if (p === 'granted') scheduleReminders();
    });
  }, { once: true });

  document.getElementById('notif-dismiss').addEventListener('click', () => {
    banner.classList.remove('show');
    localStorage.setItem('notif_dismissed', Date.now());
  }, { once: true });
}

function scheduleReminders() {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!notifGlobalOn()) return;

  const now     = Date.now();
  const horizon = now + 48 * 60 * 60 * 1000;
  const muted   = getMutedEvents();

  events.forEach(ev => {
    if (!ev.reminder_minutes) return;
    if (muted.has(ev.id)) return;
    const eventMs    = new Date(ev.start_time).getTime();
    const reminderMs = eventMs - ev.reminder_minutes * 60 * 1000;
    const delay      = reminderMs - now;
    if (delay > 0 && reminderMs < horizon) {
      const t = setTimeout(() => {
        const mins  = ev.reminder_minutes;
        const label = mins >= 1440 ? `${mins/1440}d` : mins >= 60 ? `${mins/60}h` : `${mins}m`;
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

/* ── Listeners ──────────────────────────────────────────────────── */
function attachListeners() {
  // Tabs
  document.getElementById('tab-dashboard').addEventListener('click', () => switchView('dashboard'));
  document.getElementById('tab-calendar').addEventListener('click',  () => switchView('calendar'));

  // FAB — add event
  document.getElementById('fab-add').addEventListener('click', () => openEventModal());

  // Dashboard "Add today" button
  document.getElementById('dash-add-today').addEventListener('click', () => {
    selectedDate = new Date();
    openEventModal();
  });

  // Calendar nav
  document.getElementById('prev-month').addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderCalendar();
  });

  document.getElementById('next-month').addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderCalendar();
  });

  document.getElementById('cal-today-btn').addEventListener('click', () => {
    viewDate = new Date();
    selectedDate = null;
    renderCalendar();
    closeDaySheet();
  });

  // More tab → settings panel
  document.getElementById('tab-more').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-backdrop').addEventListener('click', closeSettings);

  document.getElementById('notif-global-toggle').addEventListener('change', e => {
    setNotifGlobal(e.target.checked);
    updateNotifStatusLabel();
    if (e.target.checked && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        updateNotifStatusLabel();
        if (p === 'granted') scheduleReminders();
      });
    } else {
      scheduleReminders();
    }
  });

  document.getElementById('settings-name-save').addEventListener('click', () => {
    const val = document.getElementById('settings-name').value.trim();
    if (!val) return;
    localStorage.setItem('cal_name', val);
    document.getElementById('settings-name-save').textContent = 'Saved!';
    setTimeout(() => document.getElementById('settings-name-save').textContent = 'Save', 1500);
  });

  document.getElementById('settings-signout').addEventListener('click', async () => {
    if (!confirm('Sign out?')) return;
    closeSettings();
    await db.auth.signOut();
  });

  // Invite (now inside settings panel)
  document.getElementById('invite-submit').addEventListener('click', sendInvite);
  document.getElementById('invite-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendInvite();
  });

  // All-day toggle
  document.getElementById('evt-allday').addEventListener('change', toggleTimeFields);

  // Form
  document.getElementById('event-form').addEventListener('submit', saveEvent);
  document.getElementById('delete-btn').addEventListener('click', deleteEvent);
  document.getElementById('modal-close').addEventListener('click', closeEventModal);

  // Sheet add
  document.getElementById('sheet-add-btn').addEventListener('click', () => {
    closeDaySheet();
    setTimeout(() => openEventModal(), 80);
  });

  // Backdrops
  document.getElementById('sheet-backdrop').addEventListener('click', () => {
    closeDaySheet();
    selectedDate = null;
    renderCalendar();
  });

  document.getElementById('modal-backdrop').addEventListener('click', closeEventModal);

  // Notification banner
  const banner = document.createElement('div');
  banner.id = 'notif-banner';
  banner.innerHTML = `<span>Enable reminders?</span><div style="display:flex;gap:0.5rem;flex-shrink:0"><button id="notif-allow">Allow</button><button id="notif-dismiss" style="background:rgba(255,255,255,0.15)">✕</button></div>`;
  document.getElementById('app-frame').appendChild(banner);
}

/* ── Settings panel ─────────────────────────────────────────────── */
function openSettings() {
  // Reset invite
  document.getElementById('invite-email').value = '';
  document.getElementById('invite-status').classList.add('hidden');
  document.getElementById('invite-submit').disabled = false;
  document.getElementById('invite-submit').textContent = 'Send Invite';

  // Global toggle state
  const toggle = document.getElementById('notif-global-toggle');
  toggle.checked = notifGlobalOn();
  updateNotifStatusLabel();

  // Name
  document.getElementById('settings-name').value = localStorage.getItem('cal_name') || '';

  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-backdrop').classList.add('visible');
}

function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-backdrop').classList.remove('visible');
}

function updateNotifStatusLabel() {
  const label = document.getElementById('notif-status-label');
  if (!label) return;
  if (!notifGlobalOn()) {
    label.textContent = 'Turned off';
    return;
  }
  if (!('Notification' in window)) {
    label.textContent = 'Not supported on this browser';
    return;
  }
  if (Notification.permission === 'granted') label.textContent = 'Allowed by this device';
  else if (Notification.permission === 'denied') label.textContent = 'Blocked — enable in device Settings';
  else label.textContent = 'Permission not yet granted';
}

/* ── Invite ─────────────────────────────────────────────────────── */

async function sendInvite() {
  const email  = document.getElementById('invite-email').value.trim();
  const status = document.getElementById('invite-status');
  const btn    = document.getElementById('invite-submit');

  if (!email || !email.includes('@')) {
    showInviteStatus('Enter a valid email address.', false);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending…';
  status.classList.add('hidden');

  try {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email }),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Unknown error');

    showInviteStatus(`Invite sent to ${email}!`, true);
    document.getElementById('invite-email').value = '';
  } catch (err) {
    showInviteStatus(err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Invite';
  }
}

function showInviteStatus(msg, success) {
  const el = document.getElementById('invite-status');
  el.textContent = msg;
  el.style.background = success ? '#d1fae5' : '#fee2e2';
  el.style.color      = success ? '#065f46' : '#b91c1c';
  el.classList.remove('hidden');
}

/* ── Helpers ────────────────────────────────────────────────────── */
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
